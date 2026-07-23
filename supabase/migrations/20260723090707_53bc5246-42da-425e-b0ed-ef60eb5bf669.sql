-- v3: replace trigger fn name.
CREATE OR REPLACE FUNCTION public.is_expert_user(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _uid IS NOT NULL AND (
       EXISTS (SELECT 1 FROM public.author_profiles ap WHERE ap.user_id = _uid)
    OR EXISTS (SELECT 1 FROM public.event_speakers es WHERE es.user_id = _uid)
    OR EXISTS (SELECT 1 FROM public.podcast_episode_people pep WHERE pep.profile_id = _uid)
    OR EXISTS (SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = _uid
         AND ur.role IN ('admin'::public.app_role,'editor'::public.app_role,'author'::public.app_role))
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_expert_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_expert_user(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.my_effective_tier_features()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH me AS (SELECT auth.uid() AS uid, p.tenant_id
              FROM public.profiles p WHERE p.id = auth.uid()),
  keys AS (
    SELECT g.tier_key
      FROM public.membership_grants g, me
     WHERE g.user_id = me.uid AND g.tenant_id = me.tenant_id
       AND g.revoked_at IS NULL
       AND g.starts_at <= now()
       AND (g.expires_at IS NULL OR g.expires_at > now())
    UNION
    SELECT ap.tier_key
      FROM public.user_subscriptions us
      JOIN public.access_plans ap ON ap.id = us.plan_id
      JOIN me ON true
     WHERE us.user_id = me.uid AND us.tenant_id = me.tenant_id
       AND us.status::text IN ('active','trialing','past_due')
       AND ap.tier_key IS NOT NULL
  ),
  merged AS (
    SELECT COALESCE(jsonb_object_agg(feat.key, true), '{}'::jsonb) AS f
    FROM keys k
    JOIN public.membership_tiers mt
      ON mt.tenant_id = (SELECT tenant_id FROM me) AND mt.key = k.tier_key
    LEFT JOIN LATERAL jsonb_each(COALESCE(mt.features, '{}'::jsonb)) AS feat(key, value) ON true
    WHERE feat.value = 'true'::jsonb
  )
  SELECT COALESCE((SELECT f FROM merged), '{}'::jsonb);
$$;
REVOKE EXECUTE ON FUNCTION public.my_effective_tier_features() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_effective_tier_features() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.my_has_feature(p_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((public.my_effective_tier_features() ->> p_key)::boolean, false);
$$;
REVOKE EXECUTE ON FUNCTION public.my_has_feature(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_has_feature(text) TO authenticated, service_role;

UPDATE public.membership_tiers
   SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object('chat_enabled', true)
 WHERE key IN ('member','pro','vip','corporate','partner','partner_general',
               'presidents_circle','team','ngo','educator','student');

UPDATE public.membership_tiers
   SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object('chat_experts_direct', true)
 WHERE key IN ('pro','vip','corporate','partner','partner_general','presidents_circle');

UPDATE public.membership_tiers
   SET features = (COALESCE(features, '{}'::jsonb) - 'chat_enabled') - 'chat_experts_direct'
 WHERE key IN ('reader');

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
       AND COALESCE((v_features ->> 'chat_enabled')::boolean, false) = false THEN
      RAISE EXCEPTION 'chat: tier disabled';
    END IF;
    IF public.is_expert_user(p_peer_id)
       AND NOT public.is_expert_user(v_uid)
       AND COALESCE((v_features ->> 'chat_experts_direct')::boolean, false) = false THEN
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
  END IF;

  RETURN v_conversation;
END;
$$;

CREATE TABLE public.expert_inmails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  reason text NOT NULL,
  questions text[] NOT NULL DEFAULT ARRAY[]::text[],
  expected_answers text,
  external_links text[] NOT NULL DEFAULT ARRAY[]::text[],
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','declined','answered','cancelled')),
  admin_note text,
  decline_reason text,
  responded_at timestamptz,
  converted_conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sender_id <> recipient_id),
  CHECK (char_length(subject) BETWEEN 5 AND 140),
  CHECK (char_length(reason)  BETWEEN 20 AND 2000),
  CHECK (array_length(questions, 1) IS NULL OR array_length(questions, 1) <= 5),
  CHECK (array_length(external_links, 1) IS NULL OR array_length(external_links, 1) <= 3)
);

CREATE INDEX expert_inmails_tenant_idx    ON public.expert_inmails (tenant_id);
CREATE INDEX expert_inmails_sender_idx    ON public.expert_inmails (sender_id, created_at DESC);
CREATE INDEX expert_inmails_recipient_idx ON public.expert_inmails (recipient_id, created_at DESC);
CREATE INDEX expert_inmails_status_idx    ON public.expert_inmails (tenant_id, status, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.expert_inmails TO authenticated;
GRANT ALL ON public.expert_inmails TO service_role;

ALTER TABLE public.expert_inmails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inmails: participants and admin can read"
  ON public.expert_inmails FOR SELECT TO authenticated
  USING (sender_id = auth.uid() OR recipient_id = auth.uid() OR public.is_super_admin(auth.uid()));

CREATE POLICY "inmails: no direct insert"
  ON public.expert_inmails FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY "inmails: sender or admin may update"
  ON public.expert_inmails FOR UPDATE TO authenticated
  USING (sender_id = auth.uid() OR public.is_super_admin(auth.uid()))
  WITH CHECK (sender_id = auth.uid() OR public.is_super_admin(auth.uid()));

CREATE TRIGGER expert_inmails_set_updated_at
  BEFORE UPDATE ON public.expert_inmails
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.send_expert_inmail(
  p_recipient_id uuid, p_subject text, p_reason text,
  p_questions text[] DEFAULT ARRAY[]::text[],
  p_expected_answers text DEFAULT NULL,
  p_external_links text[] DEFAULT ARRAY[]::text[]
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid; v_peer_tenant uuid; v_features jsonb; v_new_id uuid; v_link text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'inmail: authentication required'; END IF;
  IF p_recipient_id IS NULL OR p_recipient_id = v_uid THEN
    RAISE EXCEPTION 'inmail: invalid recipient';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_uid;
  SELECT tenant_id INTO v_peer_tenant FROM public.profiles WHERE id = p_recipient_id;
  IF v_tenant IS NULL OR v_peer_tenant IS NULL OR v_tenant <> v_peer_tenant THEN
    RAISE EXCEPTION 'inmail: recipient not available';
  END IF;

  IF NOT public.is_expert_user(p_recipient_id) THEN
    RAISE EXCEPTION 'inmail: recipient is not an expert';
  END IF;

  v_features := public.my_effective_tier_features();
  IF NOT public.is_super_admin(v_uid)
     AND COALESCE((v_features ->> 'chat_enabled')::boolean, false) = false THEN
    RAISE EXCEPTION 'inmail: tier disabled';
  END IF;

  IF char_length(coalesce(p_subject,'')) < 5 OR char_length(coalesce(p_subject,'')) > 140 THEN
    RAISE EXCEPTION 'inmail: subject length';
  END IF;
  IF char_length(coalesce(p_reason,'')) < 20 OR char_length(coalesce(p_reason,'')) > 2000 THEN
    RAISE EXCEPTION 'inmail: reason length';
  END IF;
  IF p_questions IS NOT NULL AND array_length(p_questions, 1) > 5 THEN
    RAISE EXCEPTION 'inmail: too many questions';
  END IF;
  IF p_external_links IS NOT NULL AND array_length(p_external_links, 1) > 3 THEN
    RAISE EXCEPTION 'inmail: too many links';
  END IF;
  IF p_external_links IS NOT NULL THEN
    FOREACH v_link IN ARRAY p_external_links LOOP
      IF v_link !~* '^https?://' THEN
        RAISE EXCEPTION 'inmail: invalid link';
      END IF;
    END LOOP;
  END IF;

  IF (SELECT count(*) FROM public.expert_inmails ei
       WHERE ei.sender_id = v_uid AND ei.recipient_id = p_recipient_id
         AND ei.created_at > now() - interval '24 hours') >= 5 THEN
    RAISE EXCEPTION 'inmail: rate limit';
  END IF;

  INSERT INTO public.expert_inmails
    (tenant_id, sender_id, recipient_id, subject, reason, questions,
     expected_answers, external_links)
  VALUES
    (v_tenant, v_uid, p_recipient_id, btrim(p_subject), btrim(p_reason),
     COALESCE(p_questions, ARRAY[]::text[]),
     NULLIF(btrim(coalesce(p_expected_answers,'')),''),
     COALESCE(p_external_links, ARRAY[]::text[]))
  RETURNING id INTO v_new_id;
  RETURN v_new_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.send_expert_inmail(uuid, text, text, text[], text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_expert_inmail(uuid, text, text, text[], text, text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_expert_inmail(
  p_inmail_id uuid, p_action text, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.expert_inmails%ROWTYPE;
  v_is_admin boolean; v_key text; v_conv uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'inmail: authentication required'; END IF;
  IF p_action NOT IN ('approve','decline','answered','cancel') THEN
    RAISE EXCEPTION 'inmail: invalid action';
  END IF;

  SELECT * INTO v_row FROM public.expert_inmails WHERE id = p_inmail_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'inmail: not found'; END IF;

  v_is_admin := public.is_super_admin(v_uid);

  IF p_action = 'cancel' THEN
    IF v_uid <> v_row.sender_id AND NOT v_is_admin THEN
      RAISE EXCEPTION 'inmail: forbidden';
    END IF;
    UPDATE public.expert_inmails
       SET status='cancelled', responded_at=now(), admin_note=COALESCE(p_note, admin_note)
     WHERE id = p_inmail_id;
    RETURN jsonb_build_object('status','cancelled');
  END IF;

  IF v_uid <> v_row.recipient_id AND NOT v_is_admin THEN
    RAISE EXCEPTION 'inmail: forbidden';
  END IF;

  IF p_action = 'decline' THEN
    UPDATE public.expert_inmails
       SET status='declined', responded_at=now(), decline_reason=COALESCE(p_note, decline_reason)
     WHERE id = p_inmail_id;
    RETURN jsonb_build_object('status','declined');
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

  UPDATE public.expert_inmails
     SET status = CASE WHEN p_action = 'answered' THEN 'answered' ELSE 'approved' END,
         responded_at = now(),
         admin_note = COALESCE(p_note, admin_note),
         converted_conversation_id = v_conv
   WHERE id = p_inmail_id;

  RETURN jsonb_build_object(
    'status', CASE WHEN p_action = 'answered' THEN 'answered' ELSE 'approved' END,
    'conversation_id', v_conv
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.resolve_expert_inmail(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_expert_inmail(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_inmails(p_box text DEFAULT 'received')
RETURNS SETOF public.expert_inmails
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT * FROM public.expert_inmails ei
   WHERE (p_box = 'sent'     AND ei.sender_id    = auth.uid())
      OR (p_box = 'received' AND ei.recipient_id = auth.uid())
   ORDER BY ei.created_at DESC
   LIMIT 200;
$$;
REVOKE EXECUTE ON FUNCTION public.list_my_inmails(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_inmails(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_inmails(
  p_status text DEFAULT NULL, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0
) RETURNS SETOF public.expert_inmails
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tenant uuid;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'inmail: forbidden';
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = auth.uid();
  RETURN QUERY
    SELECT * FROM public.expert_inmails ei
     WHERE ei.tenant_id = v_tenant
       AND (p_status IS NULL OR ei.status = p_status)
     ORDER BY ei.created_at DESC
     OFFSET GREATEST(p_offset, 0)
     LIMIT LEAST(GREATEST(p_limit, 1), 500);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_list_inmails(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_inmails(text, integer, integer) TO authenticated;
