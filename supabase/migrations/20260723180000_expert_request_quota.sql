-- ============================================================================
-- „Zapytanie do eksperta" (Expert Request) - konfigurowalny limit per plan/tenant.
--
-- Zastępuje dawny „inMail" na poziomie danych i logiki:
--   * tabela expert_inmails      -> expert_requests (ALTER RENAME: dane, RLS,
--     indeksy i trigger zachowane - operacja stabilna, bez utraty rekordów),
--   * funkcje send/list/resolve/admin/quota -> nazwy *_expert_request*,
--   * kwota miesięczna sterowana LICZBĄ w membership_tiers.features
--     .expert_request_quota (Plus=1, Pro=3), a progi „bezpośrednie"
--     (chat_direct_gated: VIP i wyżej) piszą wprost bez zużywania puli,
--   * sentinel bramki czatu „chat: expert requires inmail"
--     -> „chat: expert requires request".
--
-- Wszystko per tenant i egzekwowane serwerowo (SECURITY DEFINER). Kwota jest
-- kanonicznym źródłem prawdy dla: bramki send_expert_request, podglądu
-- my_expert_request_quota (UI: „1/1 wykorzystane"), macierzy cennika i panelu
-- /admin/membership. Idempotentne.
-- ============================================================================

-- 1) Usuwamy stare funkcje inMail (zależą od dawnej tabeli / nazw).
DROP FUNCTION IF EXISTS public.send_expert_inmail(uuid, text, text, text[], text, text[]);
DROP FUNCTION IF EXISTS public.my_inmail_quota();
DROP FUNCTION IF EXISTS public.list_my_inmails(text);
DROP FUNCTION IF EXISTS public.admin_list_inmails(text, integer, integer);
DROP FUNCTION IF EXISTS public.resolve_expert_inmail(uuid, text, text);

-- 2) RENAME tabeli i obiektów zależnych (dane/RLS/FK/CHECK zachowane w miejscu).
ALTER TABLE IF EXISTS public.expert_inmails RENAME TO expert_requests;
ALTER INDEX IF EXISTS expert_inmails_tenant_idx    RENAME TO expert_requests_tenant_idx;
ALTER INDEX IF EXISTS expert_inmails_sender_idx    RENAME TO expert_requests_sender_idx;
ALTER INDEX IF EXISTS expert_inmails_recipient_idx RENAME TO expert_requests_recipient_idx;
ALTER INDEX IF EXISTS expert_inmails_status_idx    RENAME TO expert_requests_status_idx;

-- Trigger i polityki: odtwarzamy pod nowymi nazwami (idempotentnie).
DROP TRIGGER IF EXISTS expert_inmails_set_updated_at   ON public.expert_requests;
DROP TRIGGER IF EXISTS expert_requests_set_updated_at  ON public.expert_requests;
CREATE TRIGGER expert_requests_set_updated_at
  BEFORE UPDATE ON public.expert_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP POLICY IF EXISTS "inmails: participants and admin can read"  ON public.expert_requests;
DROP POLICY IF EXISTS "expert_requests: participants and admin can read" ON public.expert_requests;
CREATE POLICY "expert_requests: participants and admin can read"
  ON public.expert_requests FOR SELECT TO authenticated
  USING (sender_id = auth.uid() OR recipient_id = auth.uid() OR public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "inmails: no direct insert"         ON public.expert_requests;
DROP POLICY IF EXISTS "expert_requests: no direct insert" ON public.expert_requests;
CREATE POLICY "expert_requests: no direct insert"
  ON public.expert_requests FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "inmails: sender or admin may update"         ON public.expert_requests;
DROP POLICY IF EXISTS "expert_requests: sender or admin may update" ON public.expert_requests;
CREATE POLICY "expert_requests: sender or admin may update"
  ON public.expert_requests FOR UPDATE TO authenticated
  USING (sender_id = auth.uid() OR public.is_super_admin(auth.uid()))
  WITH CHECK (sender_id = auth.uid() OR public.is_super_admin(auth.uid()));

-- 3) Kwota per plan w features (istniejące tenanty). Liczba = pula miesięczna;
--    progi bezpośrednie zostają na chat_direct_gated. Sprzątamy dawne flagi
--    boolowskie (chat_inmail_quota_2/5) oraz dekoracyjny expert_request.
UPDATE public.membership_tiers
   SET features = (COALESCE(features, '{}'::jsonb)
                   - 'chat_inmail_quota_2' - 'chat_inmail_quota_5' - 'expert_request')
                  || jsonb_build_object('expert_request_quota', 1)
 WHERE key = 'member';

UPDATE public.membership_tiers
   SET features = (COALESCE(features, '{}'::jsonb)
                   - 'chat_inmail_quota_2' - 'chat_inmail_quota_5' - 'expert_request')
                  || jsonb_build_object('expert_request_quota', 3)
 WHERE key IN ('pro', 'ngo');

-- Progi „bezpośrednie" (VIP i wyżej + zespół): piszą wprost, bez puli.
UPDATE public.membership_tiers
   SET features = (COALESCE(features, '{}'::jsonb)
                   - 'chat_inmail_quota_2' - 'chat_inmail_quota_5'
                   - 'expert_request' - 'expert_request_quota')
                  || jsonb_build_object('chat_direct_gated', true)
 WHERE key IN ('vip', 'team', 'corporate', 'partner', 'partner_general', 'presidents_circle');

-- 4) my_expert_request_quota: kanoniczny podgląd puli zalogowanego użytkownika.
--    Rozstrzyga po WSZYSTKICH aktywnych progach (grants + subskrypcje) per tenant:
--    najwyższa liczba wygrywa; chat_direct_gated / ekspert / admin => bezpośrednio.
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

  -- Eksperci i administracja piszą do siebie bez limitu (relacja pozioma).
  IF public.is_super_admin(v_uid) OR public.is_expert_user(v_uid) THEN
    v_direct := true;
  END IF;

  SELECT count(*) INTO v_used
    FROM public.expert_requests er
   WHERE er.sender_id = v_uid
     AND er.created_at >= date_trunc('month', now())
     AND er.status <> 'cancelled';

  IF v_direct THEN
    RETURN jsonb_build_object('quota', 100000, 'used', v_used, 'remaining', 100000,
                              'unlimited', true, 'direct', true);
  END IF;

  RETURN jsonb_build_object('quota', v_quota, 'used', v_used,
                            'remaining', GREATEST(v_quota - v_used, 0),
                            'unlimited', false, 'direct', false);
END $$;
REVOKE ALL ON FUNCTION public.my_expert_request_quota() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_expert_request_quota() TO authenticated, service_role;
COMMENT ON FUNCTION public.my_expert_request_quota() IS
  'Podgląd miesięcznej puli „Zapytań do eksperta" (quota/used/remaining/direct), rozstrzygany per tenant po aktywnych progach.';

-- 5) send_expert_request: bramka odbiorcy (ekspert/VIP) + pula miesięczna z planu.
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

  -- Pula miesięczna kalendarzowa (reset 1. dnia miesiąca); anulowane nie liczą się.
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
REVOKE ALL ON FUNCTION public.send_expert_request(uuid, text, text, text[], text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_expert_request(uuid, text, text, text[], text, text[]) TO authenticated;
COMMENT ON FUNCTION public.send_expert_request(uuid, text, text, text[], text, text[]) IS
  'Wysyła „Zapytanie do eksperta". Bramka: odbiorca ekspert/VIP + miesięczna pula z planu (features.expert_request_quota), rozstrzygana per tenant.';

-- 6) resolve_expert_request: decyzja odbiorcy/nadawcy/admina (odpowiednik dawnego resolve).
CREATE OR REPLACE FUNCTION public.resolve_expert_request(
  p_request_id uuid, p_action text, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.expert_requests%ROWTYPE;
  v_is_admin boolean; v_key text; v_conv uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'expert_request: authentication required'; END IF;
  IF p_action NOT IN ('approve', 'decline', 'answered', 'cancel') THEN
    RAISE EXCEPTION 'expert_request: invalid action';
  END IF;

  SELECT * INTO v_row FROM public.expert_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'expert_request: not found'; END IF;

  v_is_admin := public.is_super_admin(v_uid);

  IF p_action = 'cancel' THEN
    IF v_uid <> v_row.sender_id AND NOT v_is_admin THEN
      RAISE EXCEPTION 'expert_request: forbidden';
    END IF;
    UPDATE public.expert_requests
       SET status = 'cancelled', responded_at = now(), admin_note = COALESCE(p_note, admin_note)
     WHERE id = p_request_id;
    RETURN jsonb_build_object('status', 'cancelled');
  END IF;

  IF v_uid <> v_row.recipient_id AND NOT v_is_admin THEN
    RAISE EXCEPTION 'expert_request: forbidden';
  END IF;

  IF p_action = 'decline' THEN
    UPDATE public.expert_requests
       SET status = 'declined', responded_at = now(), decline_reason = COALESCE(p_note, decline_reason)
     WHERE id = p_request_id;
    RETURN jsonb_build_object('status', 'declined');
  END IF;

  v_key := v_row.tenant_id::text || ':'
        || LEAST(v_row.sender_id, v_row.recipient_id)::text || ':'
        || GREATEST(v_row.sender_id, v_row.recipient_id)::text;

  SELECT id INTO v_conv FROM public.conversations WHERE direct_key = v_key;
  IF v_conv IS NULL THEN
    INSERT INTO public.conversations (tenant_id, kind, direct_key, created_by)
    VALUES (v_row.tenant_id, 'direct', v_key, v_row.recipient_id)
    ON CONFLICT (direct_key) WHERE direct_key IS NOT NULL DO UPDATE SET updated_at = now()
    RETURNING id INTO v_conv;
    INSERT INTO public.conversation_participants (conversation_id, tenant_id, user_id)
    VALUES (v_conv, v_row.tenant_id, v_row.sender_id),
           (v_conv, v_row.tenant_id, v_row.recipient_id)
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  UPDATE public.expert_requests
     SET status = CASE WHEN p_action = 'answered' THEN 'answered' ELSE 'approved' END,
         responded_at = now(),
         admin_note = COALESCE(p_note, admin_note),
         converted_conversation_id = v_conv
   WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'status', CASE WHEN p_action = 'answered' THEN 'answered' ELSE 'approved' END,
    'conversation_id', v_conv
  );
END $$;
REVOKE ALL ON FUNCTION public.resolve_expert_request(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_expert_request(uuid, text, text) TO authenticated;

-- 7) list_my_expert_requests / admin_list_expert_requests (skrzynki + moderacja).
CREATE OR REPLACE FUNCTION public.list_my_expert_requests(p_box text DEFAULT 'received')
RETURNS SETOF public.expert_requests
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT * FROM public.expert_requests er
   WHERE (p_box = 'sent'     AND er.sender_id    = auth.uid())
      OR (p_box = 'received' AND er.recipient_id = auth.uid())
   ORDER BY er.created_at DESC
   LIMIT 200;
$$;
REVOKE ALL ON FUNCTION public.list_my_expert_requests(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_expert_requests(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_expert_requests(
  p_status text DEFAULT NULL, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0
) RETURNS SETOF public.expert_requests
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tenant uuid;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'expert_request: forbidden';
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = auth.uid();
  RETURN QUERY
    SELECT * FROM public.expert_requests er
     WHERE er.tenant_id = v_tenant
       AND (p_status IS NULL OR er.status = p_status)
     ORDER BY er.created_at DESC
     OFFSET GREATEST(p_offset, 0)
     LIMIT LEAST(GREATEST(p_limit, 1), 500);
END $$;
REVOKE ALL ON FUNCTION public.admin_list_expert_requests(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_expert_requests(text, integer, integer) TO authenticated;

-- 8) Bramka czatu: sentinel „expert requires request" (bez słowa inMail).
CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation(p_peer_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid; v_peer_tenant uuid; v_peer_discoverable boolean;
  v_key text; v_conversation uuid; v_is_admin boolean; v_features jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'chat: authentication required'; END IF;
  IF p_peer_id IS NULL OR p_peer_id = v_uid THEN RAISE EXCEPTION 'chat: invalid peer'; END IF;
  IF public.is_blocked_pair(v_uid, p_peer_id) THEN RAISE EXCEPTION 'chat: blocked'; END IF;

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_uid;
  SELECT tenant_id, discoverable INTO v_peer_tenant, v_peer_discoverable
    FROM public.profiles WHERE id = p_peer_id;
  IF v_tenant IS NULL OR v_peer_tenant IS NULL OR v_tenant <> v_peer_tenant THEN
    RAISE EXCEPTION 'chat: peer not available';
  END IF;

  v_is_admin := public.is_super_admin(v_uid);

  IF NOT v_is_admin AND NOT public.is_connected_pair(v_uid, p_peer_id) THEN
    RAISE EXCEPTION 'chat: not in your network';
  END IF;

  IF NOT v_is_admin THEN
    v_features := public.my_effective_tier_features();

    IF NOT public.is_expert_user(v_uid)
       AND NOT public.is_vip_user(v_uid)
       AND COALESCE((v_features ->> 'chat_enabled')::boolean, false) = false THEN
      RAISE EXCEPTION 'chat: tier disabled';
    END IF;

    -- Bezpośredni czat z „gated" (ekspert / VIP): wymaga chat_direct_gated ALBO
    -- bycia samemu ekspertem/VIP-em. W przeciwnym razie -> „Zapytanie do eksperta".
    IF public.is_gated_recipient(p_peer_id)
       AND NOT public.is_expert_user(v_uid)
       AND NOT public.is_vip_user(v_uid)
       AND COALESCE((v_features ->> 'chat_direct_gated')::boolean, false) = false THEN
      RAISE EXCEPTION 'chat: expert requires request';
    END IF;
  END IF;

  v_key := v_tenant::text || ':' || LEAST(v_uid, p_peer_id)::text || ':' || GREATEST(v_uid, p_peer_id)::text;
  SELECT id INTO v_conversation FROM public.conversations WHERE direct_key = v_key;

  IF v_conversation IS NULL THEN
    IF NOT v_is_admin THEN
      IF NOT COALESCE(v_peer_discoverable, false) THEN
        RAISE EXCEPTION 'chat: peer not available';
      END IF;
      IF public.chat_allow_messages_from(p_peer_id) NOT IN ('everyone', 'contacts') THEN
        RAISE EXCEPTION 'chat: peer not available';
      END IF;
    END IF;
    INSERT INTO public.conversations (tenant_id, kind, direct_key, created_by)
    VALUES (v_tenant, 'direct', v_key, v_uid)
    ON CONFLICT (direct_key) WHERE direct_key IS NOT NULL DO UPDATE SET updated_at = now()
    RETURNING id INTO v_conversation;
    INSERT INTO public.conversation_participants (conversation_id, tenant_id, user_id)
    VALUES (v_conversation, v_tenant, v_uid), (v_conversation, v_tenant, p_peer_id)
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  RETURN v_conversation;
END $$;

-- 9) Nowe tenanty: kwota per plan w seed_pricing_defaults (obok reszty katalogu).
CREATE OR REPLACE FUNCTION public.seed_pricing_defaults(p_tenant uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_pricing_audiences(p_tenant);
  PERFORM public.seed_membership_tiers(p_tenant);

  UPDATE public.membership_tiers
     SET audience_key = CASE
       WHEN key IN ('reader', 'supporter', 'member', 'pro', 'vip') THEN 'individual'
       WHEN key IN ('corporate', 'partner', 'partner_general', 'presidents_circle')
         THEN 'business'
       WHEN key IN ('student', 'educator', 'ngo') THEN 'academic'
       WHEN key = 'team' THEN 'team'
       ELSE audience_key
     END
   WHERE tenant_id = p_tenant AND audience_key IS NULL;

  -- Monitoring regulacyjny (tracker) - benefit Pro i wyżej.
  UPDATE public.membership_tiers
     SET features = features || jsonb_build_object('regulatory_monitoring', true)
   WHERE tenant_id = p_tenant
     AND key IN ('pro', 'vip', 'corporate', 'partner', 'partner_general', 'presidents_circle')
     AND NOT (features ? 'regulatory_monitoring');

  -- Linki podarunkowe - od Pro w górę (flaga boolowska, egzekwowana).
  UPDATE public.membership_tiers
     SET features = features || jsonb_build_object('gift_links', true)
   WHERE tenant_id = p_tenant
     AND key IN ('pro', 'vip', 'corporate', 'partner', 'partner_general', 'presidents_circle', 'ngo', 'team')
     AND NOT (features ? 'gift_links');

  -- „Zapytanie do eksperta": pula miesięczna per plan (Plus=1, Pro/NGO=3),
  -- progi bezpośrednie (VIP i wyżej + zespół) na chat_direct_gated.
  UPDATE public.membership_tiers
     SET features = (features - 'expert_request') || jsonb_build_object('expert_request_quota', 1)
   WHERE tenant_id = p_tenant AND key = 'member'
     AND NOT (features ? 'expert_request_quota');

  UPDATE public.membership_tiers
     SET features = (features - 'expert_request') || jsonb_build_object('expert_request_quota', 3)
   WHERE tenant_id = p_tenant AND key IN ('pro', 'ngo')
     AND NOT (features ? 'expert_request_quota');

  UPDATE public.membership_tiers
     SET features = (features - 'expert_request') || jsonb_build_object('chat_direct_gated', true)
   WHERE tenant_id = p_tenant
     AND key IN ('vip', 'team', 'corporate', 'partner', 'partner_general', 'presidents_circle')
     AND NOT (features ? 'chat_direct_gated');

  PERFORM public.seed_pricing_faq(p_tenant);
  PERFORM public.seed_pricing_plans_v3(p_tenant);
  PERFORM public.seed_retention_defaults(p_tenant);
  PERFORM public.apply_pricing_catalog_v4(p_tenant);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seed_pricing_defaults(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_pricing_defaults(uuid) TO service_role;
