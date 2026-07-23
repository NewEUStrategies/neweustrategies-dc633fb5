-- ============================================================================
-- FIX (P1): kwota „Zapytanie do eksperta" - wyscig (TOCTOU) i obejscie przez
-- anulowanie.
--
--   (1) TOCTOU: send_expert_request liczyl `used`, sprawdzal limit i robil
--       INSERT bez blokady -> dwa rownolegle wywolania przy quota=1 wstawialy
--       dwa rekordy. Naprawa: pg_advisory_xact_lock per nadawca serializuje
--       rownolegle wysylki tego samego uzytkownika.
--   (2) Obejscie przez anulowanie: my_expert_request_quota liczylo
--       `status <> 'cancelled'`, wiec petla send->cancel->send zerowala `used`.
--       Naprawa: pula miesieczna liczy WSZYSTKIE wyslane w biezacym miesiacu
--       kalendarzowym, niezaleznie od pozniejszego statusu.
-- ============================================================================

-- (2) Zliczanie niezalezne od statusu (anulowane nadal licza sie do puli).
CREATE OR REPLACE FUNCTION public.my_expert_request_quota()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_direct boolean := false;
  v_quota integer := 0;
  v_used integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('quota', 0, 'used', 0, 'remaining', 0,
                              'unlimited', false, 'direct', false);
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_uid;

  WITH keys AS (
    SELECT g.tier_key
      FROM public.membership_grants g
     WHERE g.user_id = v_uid AND g.tenant_id = v_tenant
       AND g.revoked_at IS NULL
       AND g.starts_at <= now()
       AND (g.expires_at IS NULL OR g.expires_at > now())
    UNION
    SELECT ap.tier_key
      FROM public.user_subscriptions us
      JOIN public.access_plans ap ON ap.id = us.plan_id
     WHERE us.user_id = v_uid AND us.tenant_id = v_tenant
       AND us.status::text IN ('active', 'trialing', 'past_due')
       AND ap.tier_key IS NOT NULL
  )
  SELECT
    COALESCE(bool_or(COALESCE((mt.features ->> 'chat_direct_gated')::boolean, false)), false),
    COALESCE(max(NULLIF(mt.features ->> 'expert_request_quota', '')::integer), 0)
  INTO v_direct, v_quota
  FROM keys k
  JOIN public.membership_tiers mt
    ON mt.tenant_id = v_tenant AND mt.key = k.tier_key;

  IF public.is_super_admin(v_uid) OR public.is_expert_user(v_uid) THEN
    v_direct := true;
  END IF;

  -- Pula miesieczna liczy WSZYSTKIE wyslane w tym miesiacu (takze anulowane),
  -- inaczej send->cancel->send zerowaloby licznik (obejscie limitu).
  SELECT count(*) INTO v_used
    FROM public.expert_requests er
   WHERE er.sender_id = v_uid
     AND er.created_at >= date_trunc('month', now());

  IF v_direct THEN
    RETURN jsonb_build_object('quota', 100000, 'used', v_used, 'remaining', 100000,
                              'unlimited', true, 'direct', true);
  END IF;

  RETURN jsonb_build_object('quota', v_quota, 'used', v_used,
                            'remaining', GREATEST(v_quota - v_used, 0),
                            'unlimited', false, 'direct', false);
END $$;

-- (1) Advisory lock per nadawca serializuje rownolegle wysylki (atomowy
--     count-check-insert). Reszta ciala bez zmian merytorycznych.
CREATE OR REPLACE FUNCTION public.send_expert_request(
  p_recipient_id uuid, p_subject text, p_reason text,
  p_questions text[] DEFAULT ARRAY[]::text[],
  p_expected_answers text DEFAULT NULL,
  p_external_links text[] DEFAULT ARRAY[]::text[]
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid; v_peer_tenant uuid; v_new_id uuid; v_link text;
  v_q jsonb; v_quota integer; v_used integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'expert_request: authentication required'; END IF;
  IF p_recipient_id IS NULL OR p_recipient_id = v_uid THEN
    RAISE EXCEPTION 'expert_request: invalid recipient';
  END IF;

  -- Serializacja per nadawca: eliminuje wyscig TOCTOU miedzy count-check-insert.
  PERFORM pg_advisory_xact_lock(hashtext('expert_request:' || v_uid::text));

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_uid;
  SELECT tenant_id INTO v_peer_tenant FROM public.profiles WHERE id = p_recipient_id;
  IF v_tenant IS NULL OR v_peer_tenant IS NULL OR v_tenant <> v_peer_tenant THEN
    RAISE EXCEPTION 'expert_request: recipient not available';
  END IF;

  IF NOT public.is_gated_recipient(p_recipient_id) THEN
    RAISE EXCEPTION 'expert_request: recipient is not gated';
  END IF;

  v_q := public.my_expert_request_quota();
  v_quota := COALESCE((v_q ->> 'quota')::integer, 0);
  v_used  := COALESCE((v_q ->> 'used')::integer, 0);

  IF v_quota <= 0 THEN
    RAISE EXCEPTION 'expert_request: tier disabled';
  END IF;

  IF char_length(coalesce(p_subject, '')) < 5 OR char_length(coalesce(p_subject, '')) > 140 THEN
    RAISE EXCEPTION 'expert_request: subject length';
  END IF;
  IF char_length(coalesce(p_reason, '')) < 20 OR char_length(coalesce(p_reason, '')) > 2000 THEN
    RAISE EXCEPTION 'expert_request: reason length';
  END IF;
  IF p_questions IS NOT NULL AND array_length(p_questions, 1) > 5 THEN
    RAISE EXCEPTION 'expert_request: too many questions';
  END IF;
  IF p_external_links IS NOT NULL AND array_length(p_external_links, 1) > 3 THEN
    RAISE EXCEPTION 'expert_request: too many links';
  END IF;
  IF p_external_links IS NOT NULL THEN
    FOREACH v_link IN ARRAY p_external_links LOOP
      IF v_link !~* '^https?://' THEN
        RAISE EXCEPTION 'expert_request: invalid link';
      END IF;
    END LOOP;
  END IF;

  -- Pula miesieczna kalendarzowa (reset 1. dnia miesiaca); liczy wszystkie wyslane.
  IF v_used >= v_quota THEN
    RAISE EXCEPTION 'expert_request: monthly quota exceeded';
  END IF;

  INSERT INTO public.expert_requests
    (tenant_id, sender_id, recipient_id, subject, reason, questions,
     expected_answers, external_links)
  VALUES
    (v_tenant, v_uid, p_recipient_id, btrim(p_subject), btrim(p_reason),
     COALESCE(p_questions, ARRAY[]::text[]),
     NULLIF(btrim(coalesce(p_expected_answers, '')), ''),
     COALESCE(p_external_links, ARRAY[]::text[]))
  RETURNING id INTO v_new_id;
  RETURN v_new_id;
END $$;
