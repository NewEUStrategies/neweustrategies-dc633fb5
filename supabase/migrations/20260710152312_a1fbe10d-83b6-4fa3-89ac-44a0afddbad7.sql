
-- Trigger: create a notifications row for each recipient when a new message arrives.
CREATE OR REPLACE FUNCTION public.tg_messages_notify_recipients()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sender_name text;
  v_preview text;
  v_href text;
BEGIN
  -- Skip soft-deleted inserts (defensive).
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve sender display name (fallback to 'Ktoś' / 'Someone').
  SELECT COALESCE(NULLIF(TRIM(p.display_name), ''), 'Ktoś')
    INTO v_sender_name
    FROM public.profiles p
   WHERE p.id = NEW.sender_id;

  IF v_sender_name IS NULL THEN
    v_sender_name := 'Ktoś';
  END IF;

  -- Compact preview (body / attachment fallback / ellipsis).
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

  -- Insert one notification per participant (excluding the sender).
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
   WHERE cp.conversation_id = NEW.conversation_id
     AND cp.user_id <> NEW.sender_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_notify_recipients ON public.messages;
CREATE TRIGGER messages_notify_recipients
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.tg_messages_notify_recipients();

-- Extend mark_conversation_read so opening a chat also clears its "message" notifications.
CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.conversation_participants cp
     SET unread_count = 0, last_read_at = now(), updated_at = now()
   WHERE cp.conversation_id = p_conversation_id
     AND cp.user_id = auth.uid()
     AND (cp.unread_count > 0
          OR cp.last_read_at IS NULL
          OR cp.last_read_at < (SELECT c.last_message_at
                                  FROM public.conversations c
                                 WHERE c.id = p_conversation_id));

  UPDATE public.notifications n
     SET read_at = now()
   WHERE n.user_id = auth.uid()
     AND n.kind = 'message'
     AND n.href = '/messages?c=' || p_conversation_id::text
     AND n.read_at IS NULL;
END;
$$;
