ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_wallpaper_check;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_wallpaper_check
  CHECK (wallpaper IS NULL OR wallpaper IN ('dots', 'lines', 'none'));

CREATE OR REPLACE FUNCTION public.chat_set_appearance(
  p_conversation_id uuid,
  p_theme text DEFAULT 'keep',
  p_wallpaper text DEFAULT 'keep',
  p_quick_emoji text DEFAULT 'keep'
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'chat: authentication required'; END IF;
  IF NOT public.is_tenant_conversation_member(p_conversation_id, v_uid) THEN
    RAISE EXCEPTION 'chat: not a member';
  END IF;
  IF p_theme IS DISTINCT FROM 'keep' AND p_theme IS NOT NULL
     AND p_theme NOT IN ('ocean', 'forest', 'sunset', 'orchid', 'rose', 'graphite', 'midnight') THEN
    RAISE EXCEPTION 'chat: invalid theme';
  END IF;
  IF p_wallpaper IS DISTINCT FROM 'keep' AND p_wallpaper IS NOT NULL
     AND p_wallpaper NOT IN ('dots', 'lines', 'none') THEN
    RAISE EXCEPTION 'chat: invalid wallpaper';
  END IF;
  IF p_quick_emoji IS DISTINCT FROM 'keep' AND p_quick_emoji IS NOT NULL
     AND char_length(btrim(p_quick_emoji)) NOT BETWEEN 1 AND 16 THEN
    RAISE EXCEPTION 'chat: invalid quick emoji';
  END IF;

  UPDATE public.conversations c
     SET theme = CASE WHEN p_theme IS DISTINCT FROM 'keep' THEN p_theme ELSE c.theme END,
         wallpaper = CASE WHEN p_wallpaper IS DISTINCT FROM 'keep' THEN p_wallpaper ELSE c.wallpaper END,
         quick_emoji = CASE WHEN p_quick_emoji IS DISTINCT FROM 'keep'
                            THEN NULLIF(btrim(COALESCE(p_quick_emoji, '')), '')
                            ELSE c.quick_emoji END,
         updated_at = now()
   WHERE c.id = p_conversation_id;

  UPDATE public.conversation_participants cp
     SET updated_at = now()
   WHERE cp.conversation_id = p_conversation_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.chat_set_appearance(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_set_appearance(uuid, text, text, text) TO authenticated, service_role;