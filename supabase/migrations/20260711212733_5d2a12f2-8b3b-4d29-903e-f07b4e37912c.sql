-- Runda world-class (PR #4): blokowanie w czacie, rate-limity, paywall serwerowy,
-- podcast_settings per-tenant, welcome respektuje enabled_system.

CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON public.user_blocks (blocked_id);
GRANT SELECT, INSERT, DELETE ON public.user_blocks TO authenticated;
GRANT ALL ON public.user_blocks TO service_role;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_blocks_owner_select ON public.user_blocks;
CREATE POLICY user_blocks_owner_select ON public.user_blocks FOR SELECT TO authenticated USING (blocker_id = auth.uid());
DROP POLICY IF EXISTS user_blocks_owner_insert ON public.user_blocks;
CREATE POLICY user_blocks_owner_insert ON public.user_blocks FOR INSERT TO authenticated
  WITH CHECK (blocker_id = auth.uid() AND tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()));
DROP POLICY IF EXISTS user_blocks_owner_delete ON public.user_blocks;
CREATE POLICY user_blocks_owner_delete ON public.user_blocks FOR DELETE TO authenticated USING (blocker_id = auth.uid());

CREATE OR REPLACE FUNCTION public.is_blocked_pair(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_id = _a AND blocked_id = _b) OR (blocker_id = _b AND blocked_id = _a)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_blocked_pair(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_blocked_pair(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation(p_peer_id uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_peer_tenant uuid;
  v_peer_discoverable boolean;
  v_key text;
  v_conversation uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'chat: authentication required'; END IF;
  IF p_peer_id IS NULL OR p_peer_id = v_uid THEN RAISE EXCEPTION 'chat: invalid peer'; END IF;
  IF public.is_blocked_pair(v_uid, p_peer_id) THEN RAISE EXCEPTION 'chat: blocked'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_uid;
  SELECT tenant_id, discoverable INTO v_peer_tenant, v_peer_discoverable FROM public.profiles WHERE id = p_peer_id;
  IF v_tenant IS NULL OR v_peer_tenant IS NULL OR v_tenant <> v_peer_tenant THEN RAISE EXCEPTION 'chat: peer not available'; END IF;
  v_key := v_tenant::text || ':' || LEAST(v_uid, p_peer_id)::text || ':' || GREATEST(v_uid, p_peer_id)::text;
  SELECT id INTO v_conversation FROM public.conversations WHERE direct_key = v_key;
  IF v_conversation IS NULL THEN
    IF NOT COALESCE(v_peer_discoverable, false) THEN RAISE EXCEPTION 'chat: peer not available'; END IF;
    INSERT INTO public.conversations (tenant_id, kind, direct_key, created_by)
    VALUES (v_tenant, 'direct', v_key, v_uid)
    ON CONFLICT (direct_key) DO UPDATE SET updated_at = now()
    RETURNING id INTO v_conversation;
    INSERT INTO public.conversation_participants (conversation_id, tenant_id, user_id)
    VALUES (v_conversation, v_tenant, v_uid), (v_conversation, v_tenant, p_peer_id)
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;
  RETURN v_conversation;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_or_create_direct_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_direct_conversation(uuid) TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_messages_sender_created ON public.messages (sender_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.tg_messages_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_recent integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.conversation_participants cp
    WHERE cp.conversation_id = NEW.conversation_id
      AND cp.user_id <> NEW.sender_id
      AND public.is_blocked_pair(NEW.sender_id, cp.user_id)
  ) THEN RAISE EXCEPTION 'chat: blocked'; END IF;
  SELECT count(*) INTO v_recent FROM public.messages m
   WHERE m.sender_id = NEW.sender_id AND m.created_at > now() - interval '60 seconds';
  IF v_recent >= 30 THEN RAISE EXCEPTION 'chat: rate limited'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS messages_guard ON public.messages;
CREATE TRIGGER messages_guard BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.tg_messages_guard();

CREATE INDEX IF NOT EXISTS idx_comments_user_created ON public.comments (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.tg_comments_rate_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_minute integer; v_hour integer;
BEGIN
  SELECT count(*) FILTER (WHERE c.created_at > now() - interval '60 seconds'), count(*)
    INTO v_minute, v_hour
    FROM public.comments c
   WHERE c.user_id = NEW.user_id AND c.created_at > now() - interval '1 hour';
  IF v_minute >= 5 OR v_hour >= 30 THEN RAISE EXCEPTION 'comments: rate limited'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS comments_rate_limit ON public.comments;
CREATE TRIGGER comments_rate_limit BEFORE INSERT ON public.comments FOR EACH ROW EXECUTE FUNCTION public.tg_comments_rate_limit();

CREATE OR REPLACE FUNCTION public.verify_content_password(
  _entity_type public.access_entity_type, _entity_id uuid, _password text
) RETURNS TABLE(ok boolean, content_pl text, content_en text, builder_data jsonb, blocks_data jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_hash text; v_mode public.access_mode;
  v_tenant uuid := public.public_tenant_id();
  v_attempts integer;
BEGIN
  INSERT INTO public.rate_limits (scope, subject_id, window_start, count)
  VALUES ('content_password', 'pwd:' || _entity_id::text, date_trunc('minute', now()), 1)
  ON CONFLICT (scope, subject_id, window_start)
  DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO v_attempts;
  IF v_attempts > 10 THEN RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb; RETURN; END IF;

  SELECT ca.mode, ca.password_hash INTO v_mode, v_hash
    FROM public.content_access ca
   WHERE ca.entity_type = _entity_type AND ca.entity_id = _entity_id
   LIMIT 1;
  IF v_mode IS DISTINCT FROM 'password' OR v_hash IS NULL
     OR extensions.crypt(_password, v_hash) <> v_hash THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb; RETURN;
  END IF;

  IF _entity_type = 'post' THEN
    RETURN QUERY SELECT true, p.content_pl, p.content_en, p.builder_data, p.blocks_data
      FROM public.posts p
     WHERE p.id = _entity_id AND p.tenant_id = v_tenant
       AND p.status = 'published' AND p.deleted_at IS NULL;
  ELSIF _entity_type = 'page' THEN
    RETURN QUERY SELECT true, pg.content_pl, pg.content_en, pg.builder_data, NULL::jsonb
      FROM public.pages pg
     WHERE pg.id = _entity_id AND pg.tenant_id = v_tenant
       AND pg.status = 'published' AND pg.deleted_at IS NULL;
  END IF;
  RETURN;
END;
$$;

DROP POLICY IF EXISTS "podcast_settings_public_read" ON public.podcast_settings;
CREATE POLICY "podcast_settings_public_read" ON public.podcast_settings FOR SELECT TO anon, authenticated
  USING (tenant_id = public.public_tenant_id() OR tenant_id = public.current_tenant_id());

CREATE OR REPLACE FUNCTION public.notify_profile_welcome()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_enabled boolean;
BEGIN
  SELECT np.enabled_system INTO v_enabled FROM public.notification_preferences np WHERE np.user_id = NEW.id;
  IF v_enabled IS FALSE THEN RETURN NEW; END IF;
  BEGIN
    INSERT INTO public.notifications (user_id, tenant_id, kind, title_pl, title_en, body_pl, body_en, href, icon, meta)
    VALUES (NEW.id, NEW.tenant_id, 'system',
      'Witamy! Dopasuj swoje zainteresowania', 'Welcome! Customize your interests',
      'Wybierz tematy i autorów, a rekomendacje oraz powiadomienia dopasują się do Ciebie.',
      'Pick topics and authors - recommendations and notifications will adapt to you.',
      '/profile/interests', 'Sparkles', jsonb_build_object('event', 'welcome'));
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'notify_profile_welcome failed: %', SQLERRM;
  END;
  RETURN NEW;
END $$;