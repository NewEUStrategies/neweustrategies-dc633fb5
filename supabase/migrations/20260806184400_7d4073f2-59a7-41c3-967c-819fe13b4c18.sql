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

  EXECUTE format(v_quota_tpl, 'my_expert_request_quota', v_name);
  EXECUTE format(v_quota_tpl, 'my_inmail_quota',         v_name);
  EXECUTE format(v_send_tpl, 'send_expert_request', v_name, 'my_expert_request_quota');
  EXECUTE format(v_send_tpl, 'send_expert_inmail',  v_name, 'my_inmail_quota');
END
$do$;

COMMENT ON FUNCTION public.get_or_create_direct_conversation(uuid) IS
  'Otwiera/zwraca rozmowę bezpośrednią. Bramki tiera rozstrzygają status eksperta/VIP-a WYŁĄCZNIE w obszarze roboczym rozmowy - status z cudzego tenanta nie otwiera czatu.';
COMMENT ON FUNCTION public.create_group_conversation(text, uuid[]) IS
  'Zakłada krąg (rozmowę grupową). Obejście bramki tiera dla eksperta/VIP-a liczone w obszarze roboczym zakładającego.';

-- ============================================================================
-- POWIADOMIENIA O ZAPYTANIACH DO EKSPERTÓW
-- ============================================================================

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS enabled_expert_request boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.notification_preferences.enabled_expert_request IS
  'Zapytania do ekspertów: nowe zapytanie (odbiorca) i decyzja eksperta (nadawca).';

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('system','comment','follow','subscription','content',
                  'security','message','tracker','connection','saved_search',
                  'crm_task','expert_request'))
  NOT VALID;

CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_user_id uuid, p_kind text, p_title_pl text, p_title_en text,
  p_body_pl text DEFAULT NULL::text, p_body_en text DEFAULT NULL::text,
  p_href text DEFAULT NULL::text, p_icon text DEFAULT NULL::text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_tenant uuid; v_id uuid; v_enabled boolean;
BEGIN
  IF p_user_id IS NULL OR p_kind IS NULL OR btrim(p_kind) = '' THEN RETURN NULL; END IF;
  IF p_kind <> 'security' THEN
    SELECT CASE p_kind
             WHEN 'message'        THEN np.enabled_message
             WHEN 'comment'        THEN np.enabled_comment
             WHEN 'follow'         THEN np.enabled_follow
             WHEN 'subscription'   THEN np.enabled_subscription
             WHEN 'content'        THEN np.enabled_content
             WHEN 'system'         THEN np.enabled_system
             WHEN 'tracker'        THEN np.enabled_tracker
             WHEN 'connection'     THEN np.enabled_connection
             WHEN 'saved_search'   THEN np.enabled_saved_search
             WHEN 'crm_task'       THEN np.enabled_crm_task
             WHEN 'expert_request' THEN np.enabled_expert_request
             ELSE true END
      INTO v_enabled FROM public.notification_preferences np WHERE np.user_id = p_user_id;
    IF v_enabled IS FALSE THEN RETURN NULL; END IF;
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = p_user_id;
  IF v_tenant IS NULL THEN
    v_tenant := COALESCE(public.public_tenant_id(), public.current_tenant_id());
  END IF;
  IF v_tenant IS NULL THEN
    SELECT id INTO v_tenant FROM public.tenants ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.notifications n
    WHERE n.user_id = p_user_id AND n.kind = p_kind
      AND COALESCE(n.href, '') = COALESCE(p_href, '')
      AND n.created_at > now() - interval '5 minutes') THEN RETURN NULL; END IF;
  INSERT INTO public.notifications (
    user_id, tenant_id, kind, title_pl, title_en, body_pl, body_en, href, icon
  ) VALUES (
    p_user_id, v_tenant, p_kind,
    COALESCE(NULLIF(btrim(p_title_pl), ''), NULLIF(btrim(p_title_en), ''), p_kind),
    NULLIF(btrim(p_title_en), ''),
    NULLIF(btrim(p_body_pl), ''),
    NULLIF(btrim(p_body_en), ''),
    NULLIF(btrim(p_href), ''),
    NULLIF(btrim(p_icon), '')
  ) RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_expert_request_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_subject  text;
  v_sender   text;
  v_expert   text;
  v_href     text;
BEGIN
  v_subject := left(btrim(COALESCE(NEW.subject, '')), 140);

  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(NULLIF(btrim(p.display_name), ''), 'Użytkownik')
      INTO v_sender FROM public.profiles p WHERE p.id = NEW.sender_id;

    PERFORM public.enqueue_notification(
      NEW.recipient_id,
      'expert_request',
      'Nowe zapytanie do eksperta',
      'New expert request',
      COALESCE(v_sender, 'Użytkownik') || ': ' || v_subject,
      COALESCE(v_sender, 'A member') || ': ' || v_subject,
      '/profile/expert-requests?box=received&r=' || NEW.id::text,
      'HelpCircle'
    );
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(btrim(p.display_name), ''), 'Ekspert')
    INTO v_expert FROM public.profiles p WHERE p.id = NEW.recipient_id;

  v_href := CASE
    WHEN NEW.converted_conversation_id IS NOT NULL
      THEN '/messages?c=' || NEW.converted_conversation_id::text || '#' || NEW.status
    ELSE '/profile/expert-requests?box=sent&r=' || NEW.id::text || '#' || NEW.status
  END;

  IF NEW.status = 'approved' THEN
    PERFORM public.enqueue_notification(
      NEW.sender_id, 'expert_request',
      'Ekspert przyjął Twoje zapytanie',
      'Your expert request was accepted',
      COALESCE(v_expert, 'Ekspert') || ': ' || v_subject,
      COALESCE(v_expert, 'The expert') || ': ' || v_subject,
      v_href, 'CheckCircle2');

  ELSIF NEW.status = 'answered' THEN
    PERFORM public.enqueue_notification(
      NEW.sender_id, 'expert_request',
      'Ekspert odpowiedział na Twoje zapytanie',
      'The expert answered your request',
      COALESCE(v_expert, 'Ekspert') || ': ' || v_subject,
      COALESCE(v_expert, 'The expert') || ': ' || v_subject,
      v_href, 'MessagesSquare');

  ELSIF NEW.status = 'declined' THEN
    PERFORM public.enqueue_notification(
      NEW.sender_id, 'expert_request',
      'Ekspert odrzucił Twoje zapytanie',
      'Your expert request was declined',
      COALESCE(NULLIF(btrim(NEW.decline_reason), ''), v_subject),
      COALESCE(NULLIF(btrim(NEW.decline_reason), ''), v_subject),
      '/profile/expert-requests?box=sent&r=' || NEW.id::text || '#declined',
      'X');

  ELSIF NEW.status = 'cancelled' THEN
    PERFORM public.enqueue_notification(
      NEW.recipient_id, 'expert_request',
      'Wycofano zapytanie do eksperta',
      'An expert request was withdrawn',
      v_subject, v_subject,
      '/profile/expert-requests?box=received&r=' || NEW.id::text || '#cancelled',
      'X');
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_expert_request_notify() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.tg_expert_request_notify() IS
  'Producent powiadomień modułu Zapytanie do eksperta: INSERT -> odbiorca, zmiana statusu -> nadawca (przyjęte/odpowiedziane/odrzucone) albo odbiorca (wycofane). href zawsze z id zapytania, bo enqueue_notification deduplikuje po (user, kind, href).';

DO $do$
DECLARE
  v_rel  regclass := COALESCE(to_regclass('public.expert_requests'),
                              to_regclass('public.expert_inmails'));
  v_name text;
BEGIN
  IF v_rel IS NULL THEN
    RAISE NOTICE 'expert requests: brak relacji - trigger powiadomień nie został podpięty';
    RETURN;
  END IF;
  SELECT c.relname INTO v_name FROM pg_class c WHERE c.oid = v_rel;

  EXECUTE format('DROP TRIGGER IF EXISTS expert_requests_notify_insert ON public.%I', v_name);
  EXECUTE format('DROP TRIGGER IF EXISTS expert_requests_notify_status ON public.%I', v_name);

  EXECUTE format($t$
    CREATE TRIGGER expert_requests_notify_insert
      AFTER INSERT ON public.%I
      FOR EACH ROW EXECUTE FUNCTION public.tg_expert_request_notify()
  $t$, v_name);

  EXECUTE format($t$
    CREATE TRIGGER expert_requests_notify_status
      AFTER UPDATE OF status ON public.%I
      FOR EACH ROW EXECUTE FUNCTION public.tg_expert_request_notify()
  $t$, v_name);
END
$do$;