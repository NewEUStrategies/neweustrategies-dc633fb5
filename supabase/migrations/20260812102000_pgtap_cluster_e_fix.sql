-- ============================================================================
-- Predykaty statusu w module „Zapytanie do eksperta" znów dostają tenanta JAWNIE.
--
-- STAN ZASTANY. 20260806160003/20260806184400 wprowadziły kanoniczne warianty
-- `is_expert_user(uuid, uuid)` / `is_gated_recipient(uuid, uuid)` i przepisały
-- WSZYSTKICH konsumentów na formę dwuargumentową, żeby obszar roboczy, w którym
-- rozstrzyga się status, był widoczny w miejscu wywołania:
--   get_or_create_direct_conversation -> is_expert_user(v_uid, v_tenant),
--                                        is_gated_recipient(p_peer_id, v_tenant)
--   create_group_conversation         -> is_vip_user(v_user, v_tenant)
-- Późniejsze 20260806185055 przepisało ciała `my_expert_request_quota()`
-- i `send_expert_request(...)` z innego powodu (scalenie dwóch generacji nazw,
-- pula miesięczna, TOCTOU) i przy okazji wróciło w nich do wariantów
-- JEDNOARGUMENTOWYCH. Dwóch z pięciu konsumentów wypadło więc z inwariantu.
--
-- DLACZEGO TO NAPRAWIAMY MIGRACJĄ, A NIE ASERCJĄ W TEŚCIE. Wariant 1-arg
-- rozstrzyga tenanta przez
-- `COALESCE(current_tenant_id(), (SELECT tenant_id FROM profiles WHERE id = _uid))`.
-- W `send_expert_request` `_uid` to ODBIORCA, więc gałąź awaryjna liczyłaby
-- status w obszarze roboczym odbiorcy, nie nadawcy. Dziś jej nie widać, bo trzy
-- linie wyżej stoi `v_tenant <> v_peer_tenant -> RAISE`, a `current_tenant_id()`
-- jest dokładnie tym, co funkcja trzyma już w `v_tenant`. Bezpieczeństwo tej
-- ścieżki wynika zatem z odległego, niezwiązanego warunku - i wywróci się przy
-- pierwszej zmianie kolejności bramek. Forma 2-arg wiąże tenanta w miejscu
-- decyzji, więc jest niewrażliwa na taką zmianę.
--
-- ZAKRES. Wyłącznie te dwa wywołania. Reszta ciał, podpisy i granty zostają bez
-- zmian (CREATE OR REPLACE zachowuje ACL), żeby migracja nie zmieniała
-- zachowania niczego poza wiązaniem tenanta.
--
-- Bramka pgTAP: expert_tenant_scope_notifications_test.sql (asercje „pula
-- zapytań przyznaje »direct« tylko ekspertowi TEGO obszaru" i „wysyłka zapytania
-- sprawdza status odbiorcy w obszarze nadawcy").
--
-- Idempotentna.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.my_expert_request_quota()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid;
  v_direct boolean := false;
  v_quota  integer := 0;
  v_legacy integer := 0;
  v_used   integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('quota', 0, 'used', 0, 'remaining', 0,
                              'unlimited', false, 'direct', false);
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_uid;
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('quota', 0, 'used', 0, 'remaining', 0,
                              'unlimited', false, 'direct', false);
  END IF;
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
    COALESCE(max(NULLIF(mt.features ->> 'expert_request_quota', '')::integer), 0),
    COALESCE(max(CASE
      WHEN COALESCE((mt.features ->> 'chat_inmail_quota_5')::boolean, false) THEN 5
      WHEN COALESCE((mt.features ->> 'chat_inmail_quota_2')::boolean, false) THEN 2
      ELSE 0
    END), 0)
  INTO v_direct, v_quota, v_legacy
  FROM keys k
  JOIN public.membership_tiers mt
    ON mt.tenant_id = v_tenant AND mt.key = k.tier_key;
  v_quota := GREATEST(v_quota, v_legacy);
  IF public.is_super_admin(v_uid) OR public.is_expert_user(v_uid, v_tenant) THEN
    v_direct := true;
  END IF;
  SELECT count(*) INTO v_used
    FROM public.expert_inmails ei
   WHERE ei.sender_id = v_uid
     AND ei.tenant_id = v_tenant
     AND ei.created_at >= date_trunc('month', now());
  IF v_direct THEN
    RETURN jsonb_build_object('quota', 100000, 'used', v_used, 'remaining', 100000,
                              'unlimited', true, 'direct', true);
  END IF;
  RETURN jsonb_build_object('quota', v_quota, 'used', v_used,
                            'remaining', GREATEST(v_quota - v_used, 0),
                            'unlimited', false, 'direct', false);
END $$;

COMMENT ON FUNCTION public.my_expert_request_quota() IS
  'Miesięczna pula „Zapytań do eksperta" (quota/used/remaining/unlimited/direct) per tenant. Pula = GREATEST(features.expert_request_quota, dawne chat_inmail_quota_2/5); `used` liczy WSZYSTKIE wysłane w bieżącym miesiącu, także anulowane. Status eksperta rozstrzygany JAWNIE w obszarze roboczym wołającego.';

CREATE OR REPLACE FUNCTION public.send_expert_request(
  p_recipient_id uuid,
  p_subject text,
  p_reason text,
  p_questions text[] DEFAULT ARRAY[]::text[],
  p_expected_answers text DEFAULT NULL,
  p_external_links text[] DEFAULT ARRAY[]::text[]
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_tenant      uuid;
  v_peer_tenant uuid;
  v_new_id      uuid;
  v_link        text;
  v_q           jsonb;
  v_quota       integer;
  v_used        integer;
  v_recent      integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'expert_request: authentication required';
  END IF;
  IF p_recipient_id IS NULL OR p_recipient_id = v_uid THEN
    RAISE EXCEPTION 'expert_request: invalid recipient';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('expert_request:' || v_uid::text));
  SELECT tenant_id INTO v_tenant      FROM public.profiles WHERE id = v_uid;
  SELECT tenant_id INTO v_peer_tenant FROM public.profiles WHERE id = p_recipient_id;
  IF v_tenant IS NULL OR v_peer_tenant IS NULL OR v_tenant <> v_peer_tenant THEN
    RAISE EXCEPTION 'expert_request: recipient not available';
  END IF;
  -- Status odbiorcy liczony w obszarze roboczym NADAWCY (v_tenant), wprost
  -- w miejscu decyzji - wariant 1-arg spadałby awaryjnie na tenanta domowego
  -- ODBIORCY.
  IF NOT public.is_gated_recipient(p_recipient_id, v_tenant) THEN
    RAISE EXCEPTION 'expert_request: recipient is not gated';
  END IF;
  IF NOT COALESCE(
       (SELECT p.expert_requests_enabled FROM public.profiles p WHERE p.id = p_recipient_id),
       true) THEN
    RAISE EXCEPTION 'expert_request: recipient not accepting requests';
  END IF;
  IF NOT COALESCE(
       (SELECT (s.value ->> 'expert_requests_enabled')::boolean
          FROM public.site_settings s
         WHERE s.key = 'community_modules' AND s.tenant_id = v_tenant),
       true) THEN
    RAISE EXCEPTION 'expert_request: feature disabled';
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
  v_q     := public.my_expert_request_quota();
  v_quota := COALESCE((v_q ->> 'quota')::integer, 0);
  v_used  := COALESCE((v_q ->> 'used')::integer, 0);
  IF v_quota <= 0 THEN
    RAISE EXCEPTION 'expert_request: tier disabled';
  END IF;
  IF v_used >= v_quota THEN
    RAISE EXCEPTION 'expert_request: monthly quota exceeded';
  END IF;
  SELECT count(*) INTO v_recent
    FROM public.expert_inmails ei
   WHERE ei.sender_id = v_uid
     AND ei.recipient_id = p_recipient_id
     AND ei.created_at > now() - interval '24 hours';
  IF v_recent >= 5 THEN
    RAISE EXCEPTION 'expert_request: rate limit';
  END IF;
  INSERT INTO public.expert_inmails
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

COMMENT ON FUNCTION public.send_expert_request(uuid, text, text, text[], text, text[]) IS
  'Wysyła „Zapytanie do eksperta". Bramki: ten sam tenant, odbiorca ekspert/VIP z włączonym przyjmowaniem (status liczony w obszarze roboczym nadawcy), moduł włączony w tenancie, walidacja treści, pula miesięczna (anulowane liczą się) i antyspam 5/24 h per odbiorca. Wysyłki jednego nadawcy serializuje pg_advisory_xact_lock.';
