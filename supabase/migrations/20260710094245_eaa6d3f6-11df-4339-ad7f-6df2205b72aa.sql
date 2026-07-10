ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_tenant_id_fkey,
  ADD CONSTRAINT conversations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.conversation_participants
  DROP CONSTRAINT IF EXISTS conversation_participants_tenant_id_fkey,
  ADD CONSTRAINT conversation_participants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_tenant_id_fkey,
  ADD CONSTRAINT messages_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.message_reactions
  DROP CONSTRAINT IF EXISTS message_reactions_tenant_id_fkey,
  ADD CONSTRAINT message_reactions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_kind_check;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_kind_check CHECK (kind = 'direct');
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_attachment_name_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_attachment_name_check CHECK (attachment_name IS NULL OR char_length(attachment_name) <= 255);
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_attachment_mime_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_attachment_mime_check CHECK (attachment_mime IS NULL OR char_length(attachment_mime) <= 127);

CREATE OR REPLACE FUNCTION public.messages_after_edit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.deleted_at IS NULL AND NEW.body IS DISTINCT FROM OLD.body THEN
    UPDATE public.conversations
    SET last_message_preview = left(NEW.body, 140), updated_at = now()
    WHERE id = NEW.conversation_id
      AND last_message_at = NEW.created_at
      AND last_message_sender = NEW.sender_id;
    IF FOUND THEN
      UPDATE public.conversation_participants SET updated_at = now()
      WHERE conversation_id = NEW.conversation_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS messages_after_edit_trg ON public.messages;
CREATE TRIGGER messages_after_edit_trg AFTER UPDATE OF body ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.messages_after_edit();

CREATE OR REPLACE FUNCTION public.messages_after_soft_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE public.conversations
    SET last_message_kind = 'deleted', last_message_preview = NULL, updated_at = now()
    WHERE id = NEW.conversation_id
      AND last_message_at = NEW.created_at
      AND last_message_sender = NEW.sender_id;
    IF FOUND THEN
      UPDATE public.conversation_participants SET updated_at = now()
      WHERE conversation_id = NEW.conversation_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS messages_after_soft_delete_trg ON public.messages;
CREATE TRIGGER messages_after_soft_delete_trg AFTER UPDATE OF deleted_at ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.messages_after_soft_delete();

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

CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.conversation_participants cp
  SET unread_count = 0, last_read_at = now(), updated_at = now()
  WHERE cp.conversation_id = p_conversation_id
    AND cp.user_id = auth.uid()
    AND (cp.unread_count > 0 OR cp.last_read_at IS NULL OR cp.last_read_at < (SELECT c.last_message_at FROM public.conversations c WHERE c.id = p_conversation_id))
$$;
REVOKE EXECUTE ON FUNCTION public.mark_conversation_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated, service_role;

ALTER TABLE public.conversations REPLICA IDENTITY DEFAULT;
ALTER TABLE public.conversation_participants REPLICA IDENTITY DEFAULT;
ALTER TABLE public.messages REPLICA IDENTITY DEFAULT;
ALTER TABLE public.message_reactions REPLICA IDENTITY FULL;