-- =========================================================================
-- Chat feature schema (PR #51) — conversations, participants, messages,
-- reactions + supporting RPCs and RLS. Tenant-scoped, member-gated.
-- =========================================================================

-- 1) profiles.discoverable ------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS discoverable boolean NOT NULL DEFAULT false;

-- 2) conversations --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'direct' CHECK (kind IN ('direct','group')),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz
);
CREATE INDEX IF NOT EXISTS conversations_tenant_last_idx
  ON public.conversations (tenant_id, last_message_at DESC NULLS LAST);

GRANT SELECT, INSERT, UPDATE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- 3) conversation_participants -------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversation_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  unread_count integer NOT NULL DEFAULT 0,
  last_read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS cp_user_updated_idx
  ON public.conversation_participants (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS cp_conversation_idx
  ON public.conversation_participants (conversation_id);

GRANT SELECT, UPDATE ON public.conversation_participants TO authenticated;
GRANT ALL ON public.conversation_participants TO service_role;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;

-- 4) messages -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','image','file')),
  body text,
  attachment_path text,
  attachment_name text,
  attachment_mime text,
  attachment_size bigint,
  reply_to_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conv_created_idx
  ON public.messages (conversation_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- 5) message_reactions ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS mr_conv_created_idx
  ON public.message_reactions (conversation_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_reactions TO authenticated;
GRANT ALL ON public.message_reactions TO service_role;
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

-- 6) Membership helper (bypasses RLS to break the policy recursion) ------
CREATE OR REPLACE FUNCTION public.is_conversation_member(_conv uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id = _conv AND user_id = _user
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) TO authenticated, service_role;

-- 7) RLS policies ---------------------------------------------------------
DROP POLICY IF EXISTS conv_select_member ON public.conversations;
CREATE POLICY conv_select_member ON public.conversations
  FOR SELECT TO authenticated
  USING (public.is_conversation_member(id, auth.uid()));

DROP POLICY IF EXISTS conv_insert_self ON public.conversations;
CREATE POLICY conv_insert_self ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS conv_update_member ON public.conversations;
CREATE POLICY conv_update_member ON public.conversations
  FOR UPDATE TO authenticated
  USING (public.is_conversation_member(id, auth.uid()))
  WITH CHECK (public.is_conversation_member(id, auth.uid()));

DROP POLICY IF EXISTS cp_select_member ON public.conversation_participants;
CREATE POLICY cp_select_member ON public.conversation_participants
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_conversation_member(conversation_id, auth.uid())
  );

DROP POLICY IF EXISTS cp_update_self ON public.conversation_participants;
CREATE POLICY cp_update_self ON public.conversation_participants
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS msg_select_member ON public.messages;
CREATE POLICY msg_select_member ON public.messages
  FOR SELECT TO authenticated
  USING (public.is_conversation_member(conversation_id, auth.uid()));

DROP POLICY IF EXISTS msg_insert_sender ON public.messages;
CREATE POLICY msg_insert_sender ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_conversation_member(conversation_id, auth.uid())
  );

DROP POLICY IF EXISTS msg_update_own ON public.messages;
CREATE POLICY msg_update_own ON public.messages
  FOR UPDATE TO authenticated
  USING (sender_id = auth.uid())
  WITH CHECK (sender_id = auth.uid());

DROP POLICY IF EXISTS mr_select_member ON public.message_reactions;
CREATE POLICY mr_select_member ON public.message_reactions
  FOR SELECT TO authenticated
  USING (public.is_conversation_member(conversation_id, auth.uid()));

DROP POLICY IF EXISTS mr_write_own ON public.message_reactions;
CREATE POLICY mr_write_own ON public.message_reactions
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_conversation_member(conversation_id, auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.is_conversation_member(conversation_id, auth.uid()));

-- 8) Triggers -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_conversations_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.last_message_at := COALESCE(NEW.last_message_at, OLD.last_message_at); RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION public.tg_cp_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS cp_touch_updated_at ON public.conversation_participants;
CREATE TRIGGER cp_touch_updated_at BEFORE UPDATE ON public.conversation_participants
  FOR EACH ROW EXECUTE FUNCTION public.tg_cp_touch_updated_at();

CREATE OR REPLACE FUNCTION public.tg_message_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.conversations
    SET last_message_at = NEW.created_at
    WHERE id = NEW.conversation_id;
  UPDATE public.conversation_participants
    SET unread_count = unread_count + 1, updated_at = now()
    WHERE conversation_id = NEW.conversation_id AND user_id <> NEW.sender_id;
  UPDATE public.conversation_participants
    SET updated_at = now(), last_read_at = NEW.created_at
    WHERE conversation_id = NEW.conversation_id AND user_id = NEW.sender_id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS message_after_insert ON public.messages;
CREATE TRIGGER message_after_insert AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_message_after_insert();

CREATE OR REPLACE FUNCTION public.tg_message_before_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RETURN NEW;
  END IF;
  IF NEW.body IS DISTINCT FROM OLD.body THEN
    IF OLD.kind <> 'text' THEN
      RAISE EXCEPTION 'chat: only text messages can be edited';
    END IF;
    IF now() - OLD.created_at > interval '5 minutes' THEN
      RAISE EXCEPTION 'chat: edit window expired';
    END IF;
    NEW.edited_at := now();
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS message_before_update ON public.messages;
CREATE TRIGGER message_before_update BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_message_before_update();

-- 9) RPCs -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_chat_peers(p_user_ids uuid[])
RETURNS TABLE (
  id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  current_company text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.display_name, p.avatar_url, p.job_title, p.current_company
  FROM public.profiles p
  WHERE p.id = ANY (p_user_ids)
    AND (
      p.id = auth.uid()
      OR p.discoverable = true
      OR EXISTS (
        SELECT 1
        FROM public.conversation_participants me
        JOIN public.conversation_participants them
          ON them.conversation_id = me.conversation_id
        WHERE me.user_id = auth.uid()
          AND them.user_id = p.id
      )
    );
$$;
GRANT EXECUTE ON FUNCTION public.get_chat_peers(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.search_people(p_query text, p_limit integer DEFAULT 20)
RETURNS TABLE (
  id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  current_company text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  SELECT p.id, p.display_name, p.avatar_url, p.job_title, p.current_company
  FROM public.profiles p, me
  WHERE p.discoverable = true
    AND p.tenant_id = me.tenant_id
    AND p.id <> auth.uid()
    AND (
      coalesce(p_query, '') = ''
      OR p.display_name  ILIKE '%' || p_query || '%'
      OR p.first_name    ILIKE '%' || p_query || '%'
      OR p.last_name     ILIKE '%' || p_query || '%'
      OR p.job_title     ILIKE '%' || p_query || '%'
      OR p.current_company ILIKE '%' || p_query || '%'
    )
  ORDER BY p.display_name NULLS LAST
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;
GRANT EXECUTE ON FUNCTION public.search_people(text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation(p_peer_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_conv uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'chat: not authenticated';
  END IF;
  IF p_peer_id IS NULL OR p_peer_id = v_uid THEN
    RAISE EXCEPTION 'chat: invalid peer';
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_uid;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'chat: caller has no tenant';
  END IF;
  -- Peer must exist in the same tenant.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_peer_id AND tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'chat: peer not reachable';
  END IF;

  SELECT c.id INTO v_conv
  FROM public.conversations c
  JOIN public.conversation_participants a ON a.conversation_id = c.id AND a.user_id = v_uid
  JOIN public.conversation_participants b ON b.conversation_id = c.id AND b.user_id = p_peer_id
  WHERE c.kind = 'direct'
  LIMIT 1;

  IF v_conv IS NOT NULL THEN
    RETURN v_conv;
  END IF;

  INSERT INTO public.conversations (tenant_id, kind, created_by)
  VALUES (v_tenant, 'direct', v_uid)
  RETURNING id INTO v_conv;

  INSERT INTO public.conversation_participants (conversation_id, user_id, tenant_id)
  VALUES (v_conv, v_uid, v_tenant), (v_conv, p_peer_id, v_tenant);

  RETURN v_conv;
END $$;
GRANT EXECUTE ON FUNCTION public.get_or_create_direct_conversation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.conversation_participants
     SET unread_count = 0,
         last_read_at = now(),
         updated_at   = now()
   WHERE conversation_id = p_conversation_id
     AND user_id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated;

-- 10) Realtime -----------------------------------------------------------
ALTER TABLE public.conversations REPLICA IDENTITY FULL;
ALTER TABLE public.conversation_participants REPLICA IDENTITY FULL;
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.message_reactions REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participants; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.messages; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;