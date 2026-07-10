-- Preview columns for the conversation list ------------------------------
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_message_kind text,
  ADD COLUMN IF NOT EXISTS last_message_preview text,
  ADD COLUMN IF NOT EXISTS last_message_sender uuid;

-- Auto-fill tenant_id on messages ----------------------------------------
CREATE OR REPLACE FUNCTION public.tg_message_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT tenant_id INTO NEW.tenant_id
    FROM public.conversations WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS message_before_insert ON public.messages;
CREATE TRIGGER message_before_insert BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_message_before_insert();

-- Auto-fill tenant_id on reactions ---------------------------------------
CREATE OR REPLACE FUNCTION public.tg_reaction_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT tenant_id INTO NEW.tenant_id
    FROM public.conversations WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reaction_before_insert ON public.message_reactions;
CREATE TRIGGER reaction_before_insert BEFORE INSERT ON public.message_reactions
  FOR EACH ROW EXECUTE FUNCTION public.tg_reaction_before_insert();

-- Extend after-insert trigger to update conversation preview -------------
CREATE OR REPLACE FUNCTION public.tg_message_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.conversations
    SET last_message_at      = NEW.created_at,
        last_message_kind    = NEW.kind,
        last_message_sender  = NEW.sender_id,
        last_message_preview = CASE
          WHEN NEW.kind = 'text' THEN left(coalesce(NEW.body, ''), 200)
          WHEN NEW.kind = 'image' THEN NEW.attachment_name
          WHEN NEW.kind = 'file' THEN NEW.attachment_name
          ELSE NULL
        END
    WHERE id = NEW.conversation_id;

  UPDATE public.conversation_participants
    SET unread_count = unread_count + 1, updated_at = now()
    WHERE conversation_id = NEW.conversation_id AND user_id <> NEW.sender_id;

  UPDATE public.conversation_participants
    SET updated_at = now(), last_read_at = NEW.created_at
    WHERE conversation_id = NEW.conversation_id AND user_id = NEW.sender_id;

  RETURN NEW;
END $$;

-- Update RPCs to return specialization -----------------------------------
DROP FUNCTION IF EXISTS public.get_chat_peers(uuid[]);
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

DROP FUNCTION IF EXISTS public.search_people(text, integer);
CREATE OR REPLACE FUNCTION public.search_people(p_query text, p_limit integer DEFAULT 20)
RETURNS TABLE (
  id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  current_company text,
  specialization text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  SELECT p.id, p.display_name, p.avatar_url, p.job_title, p.current_company, p.specialization
  FROM public.profiles p, me
  WHERE p.discoverable = true
    AND p.tenant_id = me.tenant_id
    AND p.id <> auth.uid()
    AND (
      coalesce(p_query, '') = ''
      OR p.display_name    ILIKE '%' || p_query || '%'
      OR p.first_name      ILIKE '%' || p_query || '%'
      OR p.last_name       ILIKE '%' || p_query || '%'
      OR p.job_title       ILIKE '%' || p_query || '%'
      OR p.current_company ILIKE '%' || p_query || '%'
      OR p.specialization  ILIKE '%' || p_query || '%'
    )
  ORDER BY p.display_name NULLS LAST
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;
GRANT EXECUTE ON FUNCTION public.search_people(text, integer) TO authenticated;