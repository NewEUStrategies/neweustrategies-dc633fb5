-- ============================================================================
-- IZOLACJA TENANTA W PREDYKATACH „EKSPERT" / „VIP" (bramka tiera czatu).
--
-- FINDING. `public.is_expert_user(uuid)` (20260723090707) i
-- `public.is_vip_user(uuid)` (20260723092200) rozstrzygały status GLOBALNIE -
-- bez ani jednego predykatu na `tenant_id`:
--
--   is_expert_user: author_profiles / event_speakers / podcast_episode_people /
--                   user_roles(admin|editor|author) - dowolny wiersz, dowolny
--                   obszar roboczy;
--   is_vip_user:    membership_grants / user_subscriptions+access_plans -
--                   dowolny grant, dowolny obszar roboczy.
--
-- Skutek: konto, które JEST autorem (albo ma grant VIP) w obszarze roboczym
-- firmy A, było „ekspertem/VIP-em" także w obszarze firmy B. A ponieważ obie
-- funkcje są w KAŻDEJ bramce tiera czatu jako obejście:
--
--   get_or_create_direct_conversation - `chat: tier disabled` i
--     `chat: expert requires inmail` przepuszczają eksperta/VIP-a,
--   create_group_conversation         - `chat: tier disabled` j.w.,
--   my_expert_request_quota           - ekspert dostaje `direct` = pula bez limitu,
--
-- to jedno członkostwo w cudzym obszarze roboczym otwierało w NASZYM obszarze
-- pełny czat i nielimitowane zapytania do ekspertów bez wykupionego progu.
-- Bramka tiera była obchodzona danymi spoza tenanta - a więc dokładnie tym,
-- czego izolacja obszarów roboczych ma zabraniać.
--
-- POPRAWKA (trzy warstwy, każda sprawdzalna osobno):
--
--   1) Warianty DWUARGUMENTOWE `(_uid, _tenant)` - kanoniczne, jawnie skalowane.
--      Każde źródło statusu dostaje predykat na tenanta; `event_speakers` nie ma
--      własnej kolumny, więc idzie przez `events.tenant_id` (jak polityka RLS
--      z 20260714112155).
--   2) Warianty JEDNOARGUMENTOWE zostają (są w wielu ciałach), ale delegują do
--      (1) z rozstrzygniętym tenantem: `current_tenant_id()` (obszar, w którym
--      pyta wołający), a gdy brak kontekstu HTTP (trigger, cron) - tenant domowy
--      PODMIOTU. Nigdy „gdziekolwiek".
--   3) Konsumenci przekazują tenanta JAWNIE. To nie jest kosmetyka: w ciele,
--      które i tak wyliczyło `v_tenant`, jawny argument czyni bramkę czytelną
--      i odporną na przyszłą zmianę semantyki wariantu 1-arg.
--
-- PRZY OKAZJI (ta sama powierzchnia, ten sam plik). Rodzina RPC zapytań do
-- ekspertów żyje pod DWOMA nazwami: kanoniczną (`*_expert_request*`, po
-- rebrandingu z 20260723180000) i zastaną (`*_inmail*`, wciąż wołaną przez
-- klienta - `src/lib/chat/useExpertRequests.ts`). Poprawki z 20260724090500
-- (wyścig TOCTOU pod advisory lockiem + domknięcie obejścia puli przez
-- `send -> cancel -> send`) dostała WYŁĄCZNIE gałąź kanoniczna, więc ścieżka
-- realnie używana przez UI została z obiema dziurami. Ten plik nadaje obu
-- nazwom JEDNO ciało (poprawione i tenant-scoped), żeby nazwa RPC nie
-- decydowała o poziomie zabezpieczeń.
--
-- Ciała dotykające tabeli zapytań są budowane dynamicznie, bo nazwa relacji
-- rozjechała się między środowiskami (`expert_requests` po migracji rebrandingu,
-- `expert_inmails` na produkcji - patrz SUPERSEDED w scripts/check-db-contract.ts).
-- Wykrywamy ją przez `to_regclass` zamiast zgadywać.
-- ============================================================================

-- ── 1) Predykaty tenant-scoped (kanoniczne) ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_expert_user(_uid uuid, _tenant uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT _uid IS NOT NULL AND _tenant IS NOT NULL AND (
       EXISTS (
         SELECT 1 FROM public.author_profiles ap
          WHERE ap.user_id = _uid AND ap.tenant_id = _tenant)
    OR EXISTS (
         SELECT 1 FROM public.event_speakers es
           JOIN public.events e ON e.id = es.event_id
          WHERE es.user_id = _uid AND e.tenant_id = _tenant)
    OR EXISTS (
         SELECT 1 FROM public.podcast_episode_people pep
          WHERE pep.profile_id = _uid AND pep.tenant_id = _tenant)
    OR EXISTS (
         SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = _uid AND ur.tenant_id = _tenant
            AND ur.role IN ('admin'::public.app_role,
                            'editor'::public.app_role,
                            'author'::public.app_role))
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_expert_user(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_expert_user(uuid, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.is_expert_user(uuid, uuid) IS
  'Czy konto ma status eksperta W PODANYM obszarze roboczym (author_profiles / event_speakers przez events / podcast_episode_people / role redakcyjne). Kanoniczny wariant - status nigdy nie przenosi się między tenantami.';

CREATE OR REPLACE FUNCTION public.is_vip_user(_uid uuid, _tenant uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT _uid IS NOT NULL AND _tenant IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.membership_grants g
       WHERE g.user_id = _uid
         AND g.tenant_id = _tenant
         AND g.revoked_at IS NULL
         AND g.starts_at <= now()
         AND (g.expires_at IS NULL OR g.expires_at > now())
         AND g.tier_key IN ('vip','corporate','partner','partner_general','presidents_circle')
    ) OR EXISTS (
      SELECT 1 FROM public.user_subscriptions us
        JOIN public.access_plans ap ON ap.id = us.plan_id
       WHERE us.user_id = _uid
         AND us.tenant_id = _tenant
         AND ap.tenant_id = _tenant
         AND us.status::text IN ('active','trialing','past_due')
         AND ap.tier_key IN ('vip','corporate','partner','partner_general','presidents_circle')
    )
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_vip_user(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_vip_user(uuid, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.is_vip_user(uuid, uuid) IS
  'Czy konto ma progu VIP+ W PODANYM obszarze roboczym (grant członkowski albo aktywna subskrypcja planu tego tenanta). Grant w cudzym obszarze roboczym nie daje tu żadnych praw.';

CREATE OR REPLACE FUNCTION public.is_gated_recipient(_uid uuid, _tenant uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.is_expert_user(_uid, _tenant) OR public.is_vip_user(_uid, _tenant);
$$;
REVOKE EXECUTE ON FUNCTION public.is_gated_recipient(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_gated_recipient(uuid, uuid) TO authenticated, service_role;

-- ── 2) Warianty 1-arg: delegacja z rozstrzygniętym tenantem ─────────────────
--
-- Kolejność COALESCE jest zamierzona i restrykcyjna: pytamy o status W OBSZARZE,
-- W KTÓRYM DZIEJE SIĘ WYWOŁANIE (`current_tenant_id()` = tenant domowy
-- zalogowanego). Dopiero gdy nie ma kontekstu żądania (trigger bazy, cron,
-- service_role), spadamy na tenant domowy PODMIOTU - wtedy „gdzie" jest
-- jednoznaczne i nie da się go podmienić nagłówkiem.

CREATE OR REPLACE FUNCTION public.is_expert_user(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.is_expert_user(
    _uid,
    COALESCE(public.current_tenant_id(),
             (SELECT p.tenant_id FROM public.profiles p WHERE p.id = _uid))
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_expert_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_expert_user(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.is_expert_user(uuid) IS
  'Skrót do is_expert_user(uid, tenant) dla obszaru wywołania (current_tenant_id(), fallback: tenant domowy podmiotu). Do 2026-08-06 wariant ten był GLOBALNY i przepuszczał ekspertów z cudzych obszarów roboczych przez bramkę tiera czatu.';

CREATE OR REPLACE FUNCTION public.is_vip_user(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.is_vip_user(
    _uid,
    COALESCE(public.current_tenant_id(),
             (SELECT p.tenant_id FROM public.profiles p WHERE p.id = _uid))
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_vip_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_vip_user(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.is_vip_user(uuid) IS
  'Skrót do is_vip_user(uid, tenant) dla obszaru wywołania. Do 2026-08-06 wariant ten był GLOBALNY - grant VIP w cudzym obszarze roboczym otwierał tu bezpośredni DM do ekspertów.';

CREATE OR REPLACE FUNCTION public.is_gated_recipient(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.is_gated_recipient(
    _uid,
    COALESCE(public.current_tenant_id(),
             (SELECT p.tenant_id FROM public.profiles p WHERE p.id = _uid))
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_gated_recipient(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_gated_recipient(uuid) TO authenticated, service_role;

-- ── 3a) Konsument: bezpośrednia rozmowa ─────────────────────────────────────
-- Bez zmian merytorycznych poza JAWNYM tenantem w każdej bramce (v_tenant jest
-- już zweryfikowany jako wspólny dla obu stron kilka linii wyżej).

CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation(p_peer_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid; v_peer_tenant uuid; v_peer_discoverable boolean;
  v_key text; v_conversation uuid; v_is_admin boolean; v_features jsonb;
  v_created boolean := false;
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

    -- Obejście bramki tiera: TYLKO status w TYM obszarze roboczym.
    IF NOT public.is_expert_user(v_uid, v_tenant)
       AND NOT public.is_vip_user(v_uid, v_tenant)
       AND COALESCE((v_features ->> 'chat_enabled')::boolean, false) = false THEN
      RAISE EXCEPTION 'chat: tier disabled';
    END IF;

    IF public.is_gated_recipient(p_peer_id, v_tenant)
       AND NOT public.is_expert_user(v_uid, v_tenant)
       AND NOT public.is_vip_user(v_uid, v_tenant)
       AND COALESCE((v_features ->> 'chat_direct_gated')::boolean, false) = false THEN
      RAISE EXCEPTION 'chat: expert requires inmail';
    END IF;
  END IF;

  v_key := v_tenant::text || ':' || LEAST(v_uid, p_peer_id)::text || ':' || GREATEST(v_uid, p_peer_id)::text;
  SELECT id INTO v_conversation FROM public.conversations WHERE direct_key = v_key;

  IF v_conversation IS NULL THEN
    IF NOT v_is_admin THEN
      IF NOT COALESCE(v_peer_discoverable, false) THEN
        RAISE EXCEPTION 'chat: peer not available';
      END IF;
      IF public.chat_allow_messages_from(p_peer_id) NOT IN ('everyone','contacts') THEN
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
    v_created := true;
  END IF;

  -- Reopen semantics: świadome otwarcie wątku przez wywołującego cofa jego
  -- własne archiwum. Nie tykamy wiersza peera (jego decyzje pozostają jego).
  IF NOT v_created THEN
    UPDATE public.conversation_participants
       SET archived_at = NULL,
           updated_at = now()
     WHERE conversation_id = v_conversation
       AND user_id = v_uid
       AND archived_at IS NOT NULL;

    UPDATE public.conversations
       SET updated_at = now()
     WHERE id = v_conversation;
  END IF;

  RETURN v_conversation;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_or_create_direct_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_direct_conversation(uuid) TO authenticated, service_role;

-- ── 3b) Konsument: krąg (rozmowa grupowa) ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_group_conversation(p_title text, p_member_ids uuid[])
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_title text := btrim(COALESCE(p_title, ''));
  v_members uuid[];
  v_conv uuid;
  v_m uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'chat: authentication required';
  END IF;
  IF length(v_title) < 2 OR length(v_title) > 80 THEN
    RAISE EXCEPTION 'chat: invalid group title';
  END IF;
  IF p_member_ids IS NULL OR array_length(p_member_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'chat: members required';
  END IF;
  IF array_length(p_member_ids, 1) > 49 THEN
    RAISE EXCEPTION 'chat: too many members';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_user;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'chat: profile missing';
  END IF;

  -- Bramka progu: czat (także grupowy) od Plus w górę. Eksperci/VIP TEGO
  -- obszaru roboczego oraz super-admin pomijają - jak w rozmowie bezpośredniej.
  IF NOT public.is_super_admin(v_user)
     AND NOT public.is_expert_user(v_user, v_tenant)
     AND NOT public.is_vip_user(v_user, v_tenant)
     AND COALESCE((public.my_effective_tier_features() ->> 'chat_enabled')::boolean, false) = false THEN
    RAISE EXCEPTION 'chat: tier disabled';
  END IF;

  v_members := public.filter_group_candidates(v_user, p_member_ids);
  IF array_length(v_members, 1) IS NULL THEN
    RAISE EXCEPTION 'chat: no eligible members';
  END IF;

  INSERT INTO public.conversations (tenant_id, kind, created_by, title, last_message_at)
  VALUES (v_tenant, 'group', v_user, v_title, now())
  RETURNING id INTO v_conv;

  INSERT INTO public.conversation_participants (conversation_id, user_id, tenant_id, role)
  VALUES (v_conv, v_user, v_tenant, 'owner');

  FOREACH v_m IN ARRAY v_members LOOP
    INSERT INTO public.conversation_participants (conversation_id, user_id, tenant_id, role)
    VALUES (v_conv, v_m, v_tenant, 'member')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;

    PERFORM public.enqueue_notification(
      v_m,
      'message',
      'Dodano Cię do kręgu: ' || v_title,
      'You were added to the circle: ' || v_title,
      NULL, NULL,
      '/messages?c=' || v_conv::text,
      'UsersRound'
    );
  END LOOP;

  RETURN v_conv;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.create_group_conversation(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_group_conversation(text, uuid[]) TO authenticated, service_role;

-- ── 3c) Konsumenci na tabeli zapytań: pula i wysyłka ────────────────────────
--
-- Jedno ciało pod dwiema nazwami (kanoniczną i zastaną), zbudowane dynamicznie
-- wokół realnie istniejącej relacji. Ciało zawiera komplet poprawek:
--   * tenant JAWNIE w każdej bramce (finding tego pliku),
--   * advisory lock per nadawca (TOCTOU z 20260724090500),
--   * pula liczy WSZYSTKIE wysłane w miesiącu, także anulowane (obejście
--     send -> cancel -> send z 20260724090500),
--   * pula czytana z `features.expert_request_quota`, z fallbackiem na zastane
--     flagi boolowskie (`chat_inmail_quota_5/2`) - katalog progów bywa
--     nierówno zmigrowany między obszarami roboczymi, a użytkownik nie może za
--     to płacić utratą puli.
DO $do$
DECLARE
  v_rel  regclass := COALESCE(to_regclass('public.expert_requests'),
                              to_regclass('public.expert_inmails'));
  v_name text;
  v_quota_tpl text;
  v_send_tpl  text;
BEGIN
  IF v_rel IS NULL THEN
    RAISE NOTICE 'expert requests: brak relacji expert_requests/expert_inmails - pomijam 3c';
    RETURN;
  END IF;
  -- Goła nazwa relacji (bez schematu): `%2$I` cytuje ją jako POJEDYNCZY
  -- identyfikator, więc `v_rel::text` z kwalifikacją schematu dałoby
  -- `"public.expert_requests"` - jedną, nieistniejącą nazwę.
  SELECT c.relname INTO v_name FROM pg_class c WHERE c.oid = v_rel;

  v_quota_tpl := $tpl$
CREATE OR REPLACE FUNCTION public.%1$s()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
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
    COALESCE(max(GREATEST(
      COALESCE(NULLIF(mt.features ->> 'expert_request_quota', '')::integer, 0),
      CASE WHEN COALESCE((mt.features ->> 'chat_inmail_quota_5')::boolean, false) THEN 5
           WHEN COALESCE((mt.features ->> 'chat_inmail_quota_2')::boolean, false) THEN 2
           ELSE 0 END
    )), 0)
  INTO v_direct, v_quota
  FROM keys k
  JOIN public.membership_tiers mt
    ON mt.tenant_id = v_tenant AND mt.key = k.tier_key;

  -- Obejście bramki: status rozstrzygany W TYM obszarze roboczym.
  IF public.is_super_admin(v_uid) OR public.is_expert_user(v_uid, v_tenant) THEN
    v_direct := true;
  END IF;

  SELECT count(*) INTO v_used
    FROM public.%2$I er
   WHERE er.sender_id = v_uid
     AND er.tenant_id = v_tenant
     AND er.created_at >= date_trunc('month', now());

  IF v_direct THEN
    RETURN jsonb_build_object('quota', 100000, 'used', v_used, 'remaining', 100000,
                              'unlimited', true, 'direct', true);
  END IF;

  RETURN jsonb_build_object('quota', v_quota, 'used', v_used,
                            'remaining', GREATEST(v_quota - v_used, 0),
                            'unlimited', false, 'direct', false);
END
$fn$;
REVOKE ALL ON FUNCTION public.%1$s() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.%1$s() TO authenticated, service_role;
$tpl$;

  v_send_tpl := $tpl$
CREATE OR REPLACE FUNCTION public.%1$s(
  p_recipient_id uuid, p_subject text, p_reason text,
  p_questions text[] DEFAULT ARRAY[]::text[],
  p_expected_answers text DEFAULT NULL,
  p_external_links text[] DEFAULT ARRAY[]::text[]
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid; v_peer_tenant uuid; v_new_id uuid; v_link text;
  v_q jsonb; v_quota integer; v_used integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'expert_request: authentication required'; END IF;
  IF p_recipient_id IS NULL OR p_recipient_id = v_uid THEN
    RAISE EXCEPTION 'expert_request: invalid recipient';
  END IF;

  -- Serializacja per nadawca: eliminuje wyścig TOCTOU między count-check-insert.
  PERFORM pg_advisory_xact_lock(hashtext('expert_request:' || v_uid::text));

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_uid;
  SELECT tenant_id INTO v_peer_tenant FROM public.profiles WHERE id = p_recipient_id;
  IF v_tenant IS NULL OR v_peer_tenant IS NULL OR v_tenant <> v_peer_tenant THEN
    RAISE EXCEPTION 'expert_request: recipient not available';
  END IF;

  IF NOT public.is_gated_recipient(p_recipient_id, v_tenant) THEN
    RAISE EXCEPTION 'expert_request: recipient is not gated';
  END IF;

  v_q := public.%3$s();
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

  IF v_used >= v_quota THEN
    RAISE EXCEPTION 'expert_request: monthly quota exceeded';
  END IF;

  INSERT INTO public.%2$I
    (tenant_id, sender_id, recipient_id, subject, reason, questions,
     expected_answers, external_links)
  VALUES
    (v_tenant, v_uid, p_recipient_id, btrim(p_subject), btrim(p_reason),
     COALESCE(p_questions, ARRAY[]::text[]),
     NULLIF(btrim(coalesce(p_expected_answers, '')), ''),
     COALESCE(p_external_links, ARRAY[]::text[]))
  RETURNING id INTO v_new_id;
  RETURN v_new_id;
END
$fn$;
REVOKE ALL ON FUNCTION public.%1$s(uuid, text, text, text[], text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.%1$s(uuid, text, text, text[], text, text[]) TO authenticated;
$tpl$;

  -- Pula: nazwa kanoniczna i zastana, oba ciała identyczne.
  EXECUTE format(v_quota_tpl, 'my_expert_request_quota', v_name);
  EXECUTE format(v_quota_tpl, 'my_inmail_quota',         v_name);
  -- Wysyłka: każda nazwa czyta pulę przez swój odpowiednik (ta sama liczba).
  EXECUTE format(v_send_tpl, 'send_expert_request', v_name, 'my_expert_request_quota');
  EXECUTE format(v_send_tpl, 'send_expert_inmail',  v_name, 'my_inmail_quota');
END
$do$;

COMMENT ON FUNCTION public.get_or_create_direct_conversation(uuid) IS
  'Otwiera/zwraca rozmowę bezpośrednią. Bramki tiera („chat_enabled", „chat_direct_gated") rozstrzygają status eksperta/VIP-a WYŁĄCZNIE w obszarze roboczym rozmowy - status z cudzego tenanta nie otwiera czatu.';
COMMENT ON FUNCTION public.create_group_conversation(text, uuid[]) IS
  'Zakłada krąg (rozmowę grupową). Obejście bramki tiera dla eksperta/VIP-a liczone w obszarze roboczym zakładającego.';
