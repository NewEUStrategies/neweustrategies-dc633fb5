-- ============================================================================
-- PR #12: Chat privacy per tenant hardening
-- Full migration file from supabase/migrations/20260712190000_chat_privacy_tenant_hardening.sql
-- ============================================================================

-- 1) TENANT-AWARE MEMBERSHIP
CREATE OR REPLACE FUNCTION public.is_tenant_conversation_member(_conv uuid, _user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_participants cp
    JOIN public.conversations c ON c.id = cp.conversation_id
    WHERE cp.conversation_id = _conv
      AND cp.user_id = _user
      AND c.tenant_id = public.current_tenant_id()
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_tenant_conversation_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_tenant_conversation_member(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.chat_topic_conversation_id(_topic text)
RETURNS uuid
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN _topic ~ '^chat-conv:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN substring(_topic FROM 11)::uuid
    ELSE NULL
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.chat_topic_conversation_id(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_topic_conversation_id(text) TO authenticated, service_role;

-- 2) STORAGE
DROP POLICY IF EXISTS "chat attachments member read" ON storage.objects;
CREATE POLICY "chat attachments member read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND array_length(storage.foldername(name), 1) = 3
    AND (storage.foldername(name))[1] = (SELECT public.current_tenant_id()::text)
    AND (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
    AND public.is_tenant_conversation_member(
          ((storage.foldername(name))[2])::uuid, (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "chat attachments member upload" ON storage.objects;
CREATE POLICY "chat attachments member upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND array_length(storage.foldername(name), 1) = 3
    AND (storage.foldername(name))[1] = (SELECT public.current_tenant_id()::text)
    AND (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
    AND (storage.foldername(name))[3] = (SELECT auth.uid()::text)
    AND public.is_tenant_conversation_member(
          ((storage.foldername(name))[2])::uuid, (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "chat attachments owner delete" ON storage.objects;
CREATE POLICY "chat attachments owner delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND array_length(storage.foldername(name), 1) = 3
    AND (storage.foldername(name))[1] = (SELECT public.current_tenant_id()::text)
    AND (storage.foldername(name))[3] = (SELECT auth.uid()::text)
  );

DROP POLICY IF EXISTS "cv owner read" ON storage.objects;
CREATE POLICY "cv owner read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'cv'
    AND array_length(storage.foldername(name), 1) = 3
    AND (storage.foldername(name))[2] = 'users'
    AND (storage.foldername(name))[3] = (SELECT auth.uid()::text)
  );

DROP POLICY IF EXISTS "cv owner delete" ON storage.objects;
CREATE POLICY "cv owner delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'cv'
    AND array_length(storage.foldername(name), 1) = 3
    AND (storage.foldername(name))[2] = 'users'
    AND (storage.foldername(name))[3] = (SELECT auth.uid()::text)
  );

-- 3) PREFERENCES
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS read_receipts_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS typing_indicators_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_online_status boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_messages_from text NOT NULL DEFAULT 'everyone';

ALTER TABLE public.notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_allow_messages_from_check;
ALTER TABLE public.notification_preferences
  ADD CONSTRAINT notification_preferences_allow_messages_from_check
  CHECK (allow_messages_from IN ('everyone', 'existing', 'nobody'));

CREATE OR REPLACE FUNCTION public.notification_preferences_pin_identity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.user_id    := OLD.user_id;
    NEW.tenant_id  := OLD.tenant_id;
    NEW.created_at := OLD.created_at;
  ELSE
    SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = NEW.user_id;
    IF v_tenant IS NOT NULL THEN
      NEW.tenant_id := v_tenant;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS notification_preferences_pin_identity ON public.notification_preferences;
CREATE TRIGGER notification_preferences_pin_identity
  BEFORE INSERT OR UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.notification_preferences_pin_identity();

DROP POLICY IF EXISTS "own prefs update" ON public.notification_preferences;
CREATE POLICY "own prefs update"
  ON public.notification_preferences FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.chat_read_receipts_enabled(_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT np.read_receipts_enabled FROM public.notification_preferences np WHERE np.user_id = _user),
    true
  );
$$;
REVOKE EXECUTE ON FUNCTION public.chat_read_receipts_enabled(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_read_receipts_enabled(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.chat_show_online_status(_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT np.show_online_status FROM public.notification_preferences np WHERE np.user_id = _user),
    true
  );
$$;
REVOKE EXECUTE ON FUNCTION public.chat_show_online_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_show_online_status(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.chat_allow_messages_from(_user uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT np.allow_messages_from FROM public.notification_preferences np WHERE np.user_id = _user),
    'everyone'
  );
$$;
REVOKE EXECUTE ON FUNCTION public.chat_allow_messages_from(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_allow_messages_from(uuid) TO authenticated, service_role;

-- 4) READ RECEIPTS: participant visibility
DROP POLICY IF EXISTS conversation_participants_member_select ON public.conversation_participants;
CREATE POLICY conversation_participants_member_select ON public.conversation_participants
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      user_id = (SELECT auth.uid())
      OR (
        conversation_id IN (SELECT public.member_conversation_ids())
        AND public.chat_read_receipts_enabled(user_id)
        AND public.chat_read_receipts_enabled((SELECT auth.uid()))
      )
    )
  );

-- Backfill direct_key
WITH pairs AS (
  SELECT cp.conversation_id,
         min(cp.user_id::text) AS a,
         max(cp.user_id::text) AS b,
         count(*)              AS n
  FROM public.conversation_participants cp
  GROUP BY cp.conversation_id
),
candidates AS (
  SELECT DISTINCT ON (c.tenant_id, p.a, p.b)
         c.id,
         c.tenant_id::text || ':' || p.a || ':' || p.b AS key
  FROM public.conversations c
  JOIN pairs p ON p.conversation_id = c.id
  WHERE c.kind = 'direct'
    AND c.direct_key IS NULL
    AND p.n = 2
  ORDER BY c.tenant_id, p.a, p.b, c.created_at ASC
)
UPDATE public.conversations c
SET direct_key = cand.key
FROM candidates cand
WHERE c.id = cand.id
  AND NOT EXISTS (SELECT 1 FROM public.conversations c2 WHERE c2.direct_key = cand.key);

-- 5) RPC / TRIGGERS
CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation(p_peer_id uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
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
    IF public.chat_allow_messages_from(p_peer_id) <> 'everyone' THEN
      RAISE EXCEPTION 'chat: peer not available';
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
REVOKE EXECUTE ON FUNCTION public.get_or_create_direct_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_direct_conversation(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_messages_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_recent integer;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.conversation_participants cp
    WHERE cp.conversation_id = NEW.conversation_id
      AND cp.user_id <> NEW.sender_id
      AND public.is_blocked_pair(NEW.sender_id, cp.user_id)
  ) THEN
    RAISE EXCEPTION 'chat: blocked';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.conversation_participants cp
    WHERE cp.conversation_id = NEW.conversation_id
      AND cp.tenant_id = NEW.tenant_id
      AND cp.user_id <> NEW.sender_id
      AND public.chat_allow_messages_from(cp.user_id) = 'nobody'
  ) THEN
    RAISE EXCEPTION 'chat: recipient unavailable';
  END IF;

  SELECT count(*) INTO v_recent
  FROM public.messages m
  WHERE m.sender_id = NEW.sender_id
    AND m.created_at > now() - interval '60 seconds';
  IF v_recent >= 30 THEN
    RAISE EXCEPTION 'chat: rate limited';
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS messages_guard ON public.messages;
CREATE TRIGGER messages_guard
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_messages_guard();

CREATE OR REPLACE FUNCTION public.tg_messages_notify_recipients()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_sender_name text;
  v_preview text;
  v_href text;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(TRIM(p.display_name), ''), 'Ktoś')
    INTO v_sender_name
    FROM public.profiles p
   WHERE p.id = NEW.sender_id;
  IF v_sender_name IS NULL THEN v_sender_name := 'Ktoś'; END IF;

  IF NEW.kind = 'image' THEN
    v_preview := '📷 Zdjęcie';
  ELSIF NEW.kind = 'file' THEN
    v_preview := '📎 ' || COALESCE(NEW.attachment_name, 'Plik');
  ELSE
    v_preview := COALESCE(NULLIF(TRIM(NEW.body), ''), '…');
    IF length(v_preview) > 140 THEN
      v_preview := left(v_preview, 137) || '…';
    END IF;
  END IF;

  v_href := '/messages?c=' || NEW.conversation_id::text;

  BEGIN
    INSERT INTO public.notifications (user_id, tenant_id, kind, title_pl, title_en, body_pl, body_en, href, icon)
    SELECT cp.user_id,
           cp.tenant_id,
           'message',
           v_sender_name,
           v_sender_name,
           v_preview,
           v_preview,
           v_href,
           'MessagesSquare'
      FROM public.conversation_participants cp
      JOIN public.profiles pr
        ON pr.id = cp.user_id
       AND pr.tenant_id = cp.tenant_id
      LEFT JOIN public.notification_preferences np ON np.user_id = cp.user_id
     WHERE cp.conversation_id = NEW.conversation_id
       AND cp.tenant_id = NEW.tenant_id
       AND cp.user_id <> NEW.sender_id
       AND COALESCE(np.enabled_message, true) = true;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'chat: message notification fan-out failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.conversation_participants cp
  SET unread_count = 0, last_read_at = now(), updated_at = now()
  WHERE cp.conversation_id = p_conversation_id
    AND cp.user_id = auth.uid()
    AND cp.tenant_id = public.current_tenant_id()
    AND (cp.unread_count > 0
         OR cp.last_read_at IS NULL
         OR cp.last_read_at < (SELECT c.last_message_at FROM public.conversations c WHERE c.id = p_conversation_id))
$$;
REVOKE EXECUTE ON FUNCTION public.mark_conversation_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_chat_peers(p_user_ids uuid[])
RETURNS TABLE (
  id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  current_company text,
  specialization text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.display_name, p.avatar_url, p.job_title, p.current_company, p.specialization
  FROM public.profiles p
  WHERE auth.uid() IS NOT NULL
    AND cardinality(p_user_ids) BETWEEN 1 AND 200
    AND p.id = ANY (p_user_ids)
    AND (
      p.id = auth.uid()
      OR (
        p.tenant_id = (SELECT pr.tenant_id FROM public.profiles pr WHERE pr.id = auth.uid())
        AND (
          p.discoverable = true
          OR EXISTS (
            SELECT 1
            FROM public.conversation_participants me
            JOIN public.conversation_participants them
              ON them.conversation_id = me.conversation_id
            WHERE me.user_id = auth.uid()
              AND them.user_id = p.id
          )
        )
      )
    );
$$;
REVOKE EXECUTE ON FUNCTION public.get_chat_peers(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_chat_peers(uuid[]) TO authenticated, service_role;

-- 6) ATTACHMENT LIFECYCLE
CREATE OR REPLACE FUNCTION public.tg_messages_purge_attachment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_path text := OLD.attachment_path;
BEGIN
  IF v_path IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.attachment_path IS NOT DISTINCT FROM OLD.attachment_path THEN
    RETURN NEW;
  END IF;
  BEGIN
    DELETE FROM storage.objects
    WHERE bucket_id = 'chat-attachments' AND name = v_path;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'chat: attachment purge failed for %: %', v_path, SQLERRM;
  END;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS messages_purge_attachment ON public.messages;
CREATE TRIGGER messages_purge_attachment
  AFTER DELETE OR UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_messages_purge_attachment();

-- 7) REALTIME AUTHORIZATION
DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NULL
     OR to_regprocedure('realtime.topic()') IS NULL THEN
    RAISE NOTICE 'realtime authorization unavailable on this stack - skipping policies';
    RETURN;
  END IF;

  BEGIN
    EXECUTE 'ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'realtime.messages: enable RLS failed (%) - continuing', SQLERRM;
  END;

  EXECUTE 'DROP POLICY IF EXISTS chat_typing_member_read ON realtime.messages';
  EXECUTE $pol$
    CREATE POLICY chat_typing_member_read ON realtime.messages
      FOR SELECT TO authenticated
      USING (
        realtime.messages.extension = 'broadcast'
        AND public.chat_topic_conversation_id(realtime.topic()) IS NOT NULL
        AND public.is_tenant_conversation_member(
              public.chat_topic_conversation_id(realtime.topic()),
              (SELECT auth.uid()))
      )
  $pol$;

  EXECUTE 'DROP POLICY IF EXISTS chat_typing_member_write ON realtime.messages';
  EXECUTE $pol$
    CREATE POLICY chat_typing_member_write ON realtime.messages
      FOR INSERT TO authenticated
      WITH CHECK (
        realtime.messages.extension = 'broadcast'
        AND public.chat_topic_conversation_id(realtime.topic()) IS NOT NULL
        AND public.is_tenant_conversation_member(
              public.chat_topic_conversation_id(realtime.topic()),
              (SELECT auth.uid()))
      )
  $pol$;

  EXECUTE 'DROP POLICY IF EXISTS chat_presence_tenant_read ON realtime.messages';
  EXECUTE $pol$
    CREATE POLICY chat_presence_tenant_read ON realtime.messages
      FOR SELECT TO authenticated
      USING (
        realtime.messages.extension = 'presence'
        AND realtime.topic() = 'chat-presence:' || public.current_tenant_id()::text
      )
  $pol$;

  EXECUTE 'DROP POLICY IF EXISTS chat_presence_tenant_write ON realtime.messages';
  EXECUTE $pol$
    CREATE POLICY chat_presence_tenant_write ON realtime.messages
      FOR INSERT TO authenticated
      WITH CHECK (
        realtime.messages.extension = 'presence'
        AND realtime.topic() = 'chat-presence:' || public.current_tenant_id()::text
        AND public.chat_show_online_status((SELECT auth.uid()))
      )
  $pol$;

  EXECUTE 'DROP POLICY IF EXISTS entity_presence_tenant_read ON realtime.messages';
  EXECUTE $pol$
    CREATE POLICY entity_presence_tenant_read ON realtime.messages
      FOR SELECT TO authenticated
      USING (
        realtime.messages.extension = 'presence'
        AND realtime.topic() LIKE 'presence:%'
        AND split_part(realtime.topic(), ':', 2) = public.current_tenant_id()::text
      )
  $pol$;

  EXECUTE 'DROP POLICY IF EXISTS entity_presence_tenant_write ON realtime.messages';
  EXECUTE $pol$
    CREATE POLICY entity_presence_tenant_write ON realtime.messages
      FOR INSERT TO authenticated
      WITH CHECK (
        realtime.messages.extension = 'presence'
        AND realtime.topic() LIKE 'presence:%'
        AND split_part(realtime.topic(), ':', 2) = public.current_tenant_id()::text
      )
  $pol$;

  BEGIN
    EXECUTE 'GRANT SELECT, INSERT ON realtime.messages TO authenticated';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'realtime.messages: grant failed (%) - continuing', SQLERRM;
  END;
END $$;