-- ============================================================================
-- Chat (direct messages) + people discovery (internal, opt-in directory)
--
-- Privacy model:
--   * profiles.discoverable is an EXPLICIT OPT-IN (default false). Only when a
--     user enables it, their profile (safe columns only) is indexed by the
--     internal people search and visible to other REGISTERED users of the same
--     tenant. Anonymous visitors and crawlers have no read path at all: every
--     read goes through SECURITY DEFINER RPCs that hard-require auth.uid() and
--     are revoked from anon/PUBLIC.
--   * Conversations, participants, messages and reactions are readable only by
--     conversation members, always AND-ed with the tenant guard
--     (tenant_id = current_tenant_id()), following the notifications pattern.
--   * Attachments live in a dedicated PRIVATE bucket (chat-attachments) with a
--     30 MB cap and a strict MIME allowlist; objects are readable only by
--     conversation members via short-lived signed URLs.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) profiles.discoverable - opt-in for the internal people directory
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS discoverable boolean NOT NULL DEFAULT false;

-- Own-row read/write only (RLS "Users update own profile" already limits rows;
-- the column grant makes the new column reachable for authenticated users).
GRANT SELECT (discoverable), UPDATE (discoverable) ON public.profiles TO authenticated;

CREATE INDEX IF NOT EXISTS profiles_discoverable_idx
  ON public.profiles (tenant_id)
  WHERE discoverable;

-- ----------------------------------------------------------------------------
-- 2) Core chat tables
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'direct' CHECK (kind IN ('direct')),
  -- Stable dedup key for direct conversations: "tenant:minUid:maxUid".
  direct_key text UNIQUE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_message_at timestamptz,
  last_message_kind text,
  last_message_preview text,
  last_message_sender uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.conversation_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  unread_count integer NOT NULL DEFAULT 0,
  last_read_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS conversation_participants_user_idx
  ON public.conversation_participants (user_id, tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS conversation_participants_conversation_idx
  ON public.conversation_participants (conversation_id);

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'image', 'file')),
  body text CHECK (body IS NULL OR char_length(body) <= 8000),
  attachment_path text CHECK (attachment_path IS NULL OR char_length(attachment_path) <= 512),
  attachment_name text CHECK (attachment_name IS NULL OR char_length(attachment_name) <= 255),
  attachment_mime text CHECK (attachment_mime IS NULL OR char_length(attachment_mime) <= 127),
  attachment_size bigint CHECK (attachment_size IS NULL OR (attachment_size > 0 AND attachment_size <= 31457280)),
  reply_to_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A live message must carry content matching its kind; a soft-deleted
  -- message may have everything nulled out (privacy: unsend wipes content).
  CONSTRAINT messages_content_check CHECK (
    deleted_at IS NOT NULL
    OR (kind = 'text' AND body IS NOT NULL AND btrim(body) <> '')
    OR (kind IN ('image', 'file') AND attachment_path IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS messages_conversation_recent_idx
  ON public.messages (conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 16),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Messenger semantics: one (changeable) reaction per user per message.
  UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS message_reactions_conversation_idx
  ON public.message_reactions (conversation_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 3) Membership helper (SECURITY DEFINER avoids recursive RLS on participants)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_conversation_member(_conversation_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id = _conversation_id AND user_id = _user_id
  )
$$;
REVOKE EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) Grants + RLS
-- ----------------------------------------------------------------------------
GRANT SELECT ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.conversation_participants TO authenticated;
GRANT ALL ON public.conversation_participants TO service_role;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.messages TO authenticated;
GRANT UPDATE (body, edited_at, deleted_at, attachment_path, attachment_name, attachment_mime, attachment_size)
  ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON public.message_reactions TO authenticated;
GRANT UPDATE (emoji) ON public.message_reactions TO authenticated;
GRANT ALL ON public.message_reactions TO service_role;
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

-- conversations: members read; creation only via RPC (no INSERT policy).
DROP POLICY IF EXISTS "conversations_member_select" ON public.conversations;
CREATE POLICY "conversations_member_select" ON public.conversations
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.is_conversation_member(id, auth.uid())
  );

-- participants: any member of the conversation may read all its participant
-- rows (needed for read receipts); writes only via RPCs/triggers.
DROP POLICY IF EXISTS "conversation_participants_member_select" ON public.conversation_participants;
CREATE POLICY "conversation_participants_member_select" ON public.conversation_participants
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.is_conversation_member(conversation_id, auth.uid())
  );

-- messages: members read; members send as themselves; senders may edit/unsend
-- their own messages.
DROP POLICY IF EXISTS "messages_member_select" ON public.messages;
CREATE POLICY "messages_member_select" ON public.messages
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.is_conversation_member(conversation_id, auth.uid())
  );

DROP POLICY IF EXISTS "messages_member_insert" ON public.messages;
CREATE POLICY "messages_member_insert" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND tenant_id = public.current_tenant_id()
    AND public.is_conversation_member(conversation_id, auth.uid())
  );

DROP POLICY IF EXISTS "messages_sender_update" ON public.messages;
CREATE POLICY "messages_sender_update" ON public.messages
  FOR UPDATE TO authenticated
  USING (sender_id = auth.uid() AND tenant_id = public.current_tenant_id())
  WITH CHECK (sender_id = auth.uid() AND tenant_id = public.current_tenant_id());

-- reactions: members read; users manage their own reaction.
DROP POLICY IF EXISTS "message_reactions_member_select" ON public.message_reactions;
CREATE POLICY "message_reactions_member_select" ON public.message_reactions
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.is_conversation_member(conversation_id, auth.uid())
  );

DROP POLICY IF EXISTS "message_reactions_own_insert" ON public.message_reactions;
CREATE POLICY "message_reactions_own_insert" ON public.message_reactions
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND tenant_id = public.current_tenant_id()
    AND public.is_conversation_member(conversation_id, auth.uid())
  );

DROP POLICY IF EXISTS "message_reactions_own_update" ON public.message_reactions;
CREATE POLICY "message_reactions_own_update" ON public.message_reactions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND tenant_id = public.current_tenant_id())
  WITH CHECK (user_id = auth.uid() AND tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "message_reactions_own_delete" ON public.message_reactions;
CREATE POLICY "message_reactions_own_delete" ON public.message_reactions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND tenant_id = public.current_tenant_id());

-- ----------------------------------------------------------------------------
-- 5) Triggers
-- ----------------------------------------------------------------------------
-- Pin message tenant to the conversation tenant (client input is never trusted)
-- and validate reply targets stay within the same conversation.
CREATE OR REPLACE FUNCTION public.messages_before_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_reply_conversation uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.conversations WHERE id = NEW.conversation_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'messages: conversation % does not exist', NEW.conversation_id;
  END IF;
  NEW.tenant_id := v_tenant;
  IF NEW.reply_to_id IS NOT NULL THEN
    SELECT conversation_id INTO v_reply_conversation FROM public.messages WHERE id = NEW.reply_to_id;
    IF v_reply_conversation IS DISTINCT FROM NEW.conversation_id THEN
      NEW.reply_to_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_before_insert_trg ON public.messages;
CREATE TRIGGER messages_before_insert_trg
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_before_insert();

-- Same pinning for reactions: derive conversation + tenant from the message.
CREATE OR REPLACE FUNCTION public.message_reactions_before_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_conversation uuid;
  v_tenant uuid;
BEGIN
  SELECT conversation_id, tenant_id INTO v_conversation, v_tenant
  FROM public.messages WHERE id = NEW.message_id;
  IF v_conversation IS NULL THEN
    RAISE EXCEPTION 'message_reactions: message % does not exist', NEW.message_id;
  END IF;
  NEW.conversation_id := v_conversation;
  NEW.tenant_id := v_tenant;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS message_reactions_before_insert_trg ON public.message_reactions;
CREATE TRIGGER message_reactions_before_insert_trg
  BEFORE INSERT ON public.message_reactions
  FOR EACH ROW EXECUTE FUNCTION public.message_reactions_before_insert();

-- Fan-out on new message: refresh the conversation summary, bump unread
-- counters for the other members and touch every participant row so the
-- per-user realtime stream (filter user_id=eq.<uid>) fires for all members.
CREATE OR REPLACE FUNCTION public.messages_after_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.conversations
  SET last_message_at = NEW.created_at,
      last_message_kind = NEW.kind,
      last_message_preview = CASE WHEN NEW.kind = 'text' THEN left(NEW.body, 140) ELSE NULL END,
      last_message_sender = NEW.sender_id,
      updated_at = now()
  WHERE id = NEW.conversation_id;

  UPDATE public.conversation_participants
  SET unread_count = CASE WHEN user_id = NEW.sender_id THEN 0 ELSE unread_count + 1 END,
      last_read_at = CASE WHEN user_id = NEW.sender_id THEN NEW.created_at ELSE last_read_at END,
      updated_at = now()
  WHERE conversation_id = NEW.conversation_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_after_insert_trg ON public.messages;
CREATE TRIGGER messages_after_insert_trg
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_after_insert();

-- Edits are allowed only within 5 minutes of sending and only for live text
-- messages; unsend (setting deleted_at) stays possible at any time. Enforced
-- here (not only in the UI) so a crafted client cannot rewrite history.
CREATE OR REPLACE FUNCTION public.messages_enforce_edit_window()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Soft delete transition is always allowed (content gets wiped).
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- Attachments are immutable on live messages (only unsend may null them).
  IF NEW.attachment_path IS DISTINCT FROM OLD.attachment_path
     OR NEW.attachment_name IS DISTINCT FROM OLD.attachment_name
     OR NEW.attachment_mime IS DISTINCT FROM OLD.attachment_mime
     OR NEW.attachment_size IS DISTINCT FROM OLD.attachment_size THEN
    RAISE EXCEPTION 'chat: attachments cannot be modified';
  END IF;
  IF NEW.body IS DISTINCT FROM OLD.body THEN
    IF OLD.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'chat: cannot edit a deleted message';
    END IF;
    IF OLD.kind <> 'text' THEN
      RAISE EXCEPTION 'chat: only text messages can be edited';
    END IF;
    IF OLD.created_at < now() - interval '5 minutes' THEN
      RAISE EXCEPTION 'chat: edit window (5 minutes) has passed';
    END IF;
    NEW.edited_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_enforce_edit_window_trg ON public.messages;
CREATE TRIGGER messages_enforce_edit_window_trg
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_enforce_edit_window();

-- Keep list previews truthful after an edit of the newest message.
CREATE OR REPLACE FUNCTION public.messages_after_edit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.deleted_at IS NULL AND NEW.body IS DISTINCT FROM OLD.body THEN
    UPDATE public.conversations
    SET last_message_preview = left(NEW.body, 140),
        updated_at = now()
    WHERE id = NEW.conversation_id
      AND last_message_at = NEW.created_at
      AND last_message_sender = NEW.sender_id;

    UPDATE public.conversation_participants
    SET updated_at = now()
    WHERE conversation_id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_after_edit_trg ON public.messages;
CREATE TRIGGER messages_after_edit_trg
  AFTER UPDATE OF body ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_after_edit();

-- Unsend: when the removed message was the newest one, blank the conversation
-- preview so lists do not keep showing wiped content.
CREATE OR REPLACE FUNCTION public.messages_after_soft_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE public.conversations
    SET last_message_kind = 'deleted',
        last_message_preview = NULL,
        updated_at = now()
    WHERE id = NEW.conversation_id
      AND last_message_at = NEW.created_at
      AND last_message_sender = NEW.sender_id;

    UPDATE public.conversation_participants
    SET updated_at = now()
    WHERE conversation_id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_after_soft_delete_trg ON public.messages;
CREATE TRIGGER messages_after_soft_delete_trg
  AFTER UPDATE OF deleted_at ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_after_soft_delete();

DROP TRIGGER IF EXISTS conversations_set_updated_at ON public.conversations;
CREATE TRIGGER conversations_set_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 6) RPCs (SECURITY DEFINER, authenticated-only)
-- ----------------------------------------------------------------------------
-- Internal people search. Registered users only; returns ONLY the safe,
-- directory-approved column set for profiles that explicitly opted in
-- (discoverable = true) within the caller's tenant.
CREATE OR REPLACE FUNCTION public.search_people(p_query text DEFAULT '', p_limit integer DEFAULT 20)
RETURNS TABLE (
  id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  current_company text,
  specialization text,
  slug text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    p.id,
    COALESCE(
      NULLIF(btrim(p.display_name), ''),
      NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
      'User'
    ) AS display_name,
    p.avatar_url,
    p.job_title,
    p.current_company,
    p.specialization,
    p.slug
  FROM public.profiles p
  WHERE auth.uid() IS NOT NULL
    AND p.discoverable
    AND p.id <> auth.uid()
    AND p.tenant_id = (SELECT pr.tenant_id FROM public.profiles pr WHERE pr.id = auth.uid())
    AND (
      COALESCE(btrim(p_query), '') = ''
      OR p.display_name ILIKE '%' || btrim(p_query) || '%'
      OR concat_ws(' ', p.first_name, p.last_name) ILIKE '%' || btrim(p_query) || '%'
      OR p.job_title ILIKE '%' || btrim(p_query) || '%'
      OR p.current_company ILIKE '%' || btrim(p_query) || '%'
      OR p.specialization ILIKE '%' || btrim(p_query) || '%'
      OR p.location ILIKE '%' || btrim(p_query) || '%'
    )
  ORDER BY
    (COALESCE(NULLIF(btrim(p.display_name), ''), concat_ws(' ', p.first_name, p.last_name)) ILIKE btrim(p_query) || '%') DESC,
    lower(COALESCE(NULLIF(btrim(p.display_name), ''), concat_ws(' ', p.first_name, p.last_name))) ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
$$;
REVOKE EXECUTE ON FUNCTION public.search_people(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_people(text, integer) TO authenticated, service_role;

-- Safe profile cards for chat rendering. A caller may resolve: themselves,
-- anyone they share a conversation with (names must not vanish from history
-- when a peer later opts out), and same-tenant discoverable users.
CREATE OR REPLACE FUNCTION public.get_chat_peers(p_user_ids uuid[])
RETURNS TABLE (
  id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  current_company text,
  slug text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    p.id,
    COALESCE(
      NULLIF(btrim(p.display_name), ''),
      NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
      'User'
    ) AS display_name,
    p.avatar_url,
    p.job_title,
    p.current_company,
    p.slug
  FROM public.profiles p
  WHERE auth.uid() IS NOT NULL
    AND p.id = ANY (COALESCE(p_user_ids, ARRAY[]::uuid[]))
    AND (
      p.id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.conversation_participants me
        JOIN public.conversation_participants peer
          ON peer.conversation_id = me.conversation_id
        WHERE me.user_id = auth.uid() AND peer.user_id = p.id
      )
      OR (
        p.discoverable
        AND p.tenant_id = (SELECT pr.tenant_id FROM public.profiles pr WHERE pr.id = auth.uid())
      )
    )
$$;
REVOKE EXECUTE ON FUNCTION public.get_chat_peers(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_chat_peers(uuid[]) TO authenticated, service_role;

-- Open (or create) the direct conversation with a peer. Starting a NEW
-- conversation requires the peer to be discoverable; existing threads keep
-- working after an opt-out. Race-safe via ON CONFLICT on direct_key.
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
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'chat: authentication required';
  END IF;
  IF p_peer_id IS NULL OR p_peer_id = v_uid THEN
    RAISE EXCEPTION 'chat: invalid peer';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_uid;
  SELECT tenant_id, discoverable INTO v_peer_tenant, v_peer_discoverable
  FROM public.profiles WHERE id = p_peer_id;

  IF v_tenant IS NULL OR v_peer_tenant IS NULL OR v_tenant <> v_peer_tenant THEN
    RAISE EXCEPTION 'chat: peer not available';
  END IF;

  v_key := v_tenant::text || ':' || LEAST(v_uid, p_peer_id)::text || ':' || GREATEST(v_uid, p_peer_id)::text;

  SELECT c.id INTO v_conversation FROM public.conversations c WHERE c.direct_key = v_key;
  IF v_conversation IS NULL THEN
    IF NOT COALESCE(v_peer_discoverable, false) THEN
      RAISE EXCEPTION 'chat: peer not available';
    END IF;
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

-- Mark a conversation as read for the caller (resets the unread badge and
-- powers the peer's "seen" receipt).
CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.conversation_participants
  SET unread_count = 0,
      last_read_at = now(),
      updated_at = now()
  WHERE conversation_id = p_conversation_id
    AND user_id = auth.uid()
$$;
REVOKE EXECUTE ON FUNCTION public.mark_conversation_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7) Realtime
-- ----------------------------------------------------------------------------
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.conversation_participants REPLICA IDENTITY FULL;
ALTER TABLE public.message_reactions REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participants;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END;
$$;

-- ----------------------------------------------------------------------------
-- 8) Private storage bucket for chat attachments
--    Path convention: <tenant_id>/<conversation_id>/<sender_id>/<file>
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-attachments',
  'chat-attachments',
  false,
  31457280, -- 30 MB
  ARRAY[
    -- images
    'image/jpeg', 'image/png', 'image/gif', 'image/svg+xml', 'image/webp',
    -- documents
    'application/pdf',
    -- text files
    'text/plain', 'text/markdown', 'text/csv', 'application/rtf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.oasis.opendocument.text',
    -- spreadsheets
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.spreadsheet',
    -- presentations
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.presentation'
  ]
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "chat attachments member read" ON storage.objects;
CREATE POLICY "chat attachments member read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND array_length(storage.foldername(name), 1) >= 3
    AND public.is_conversation_member(((storage.foldername(name))[2])::uuid, auth.uid())
  );

DROP POLICY IF EXISTS "chat attachments member upload" ON storage.objects;
CREATE POLICY "chat attachments member upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND array_length(storage.foldername(name), 1) = 3
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
    AND (storage.foldername(name))[3] = auth.uid()::text
    AND public.is_conversation_member(((storage.foldername(name))[2])::uuid, auth.uid())
  );

DROP POLICY IF EXISTS "chat attachments owner delete" ON storage.objects;
CREATE POLICY "chat attachments owner delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND array_length(storage.foldername(name), 1) >= 3
    AND (storage.foldername(name))[3] = auth.uid()::text
  );
