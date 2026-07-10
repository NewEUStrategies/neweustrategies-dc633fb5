
-- 1) Preferences table
CREATE TABLE public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  enabled_message boolean NOT NULL DEFAULT true,
  enabled_comment boolean NOT NULL DEFAULT true,
  enabled_follow boolean NOT NULL DEFAULT true,
  enabled_subscription boolean NOT NULL DEFAULT true,
  enabled_content boolean NOT NULL DEFAULT true,
  enabled_system boolean NOT NULL DEFAULT true,
  enabled_security boolean NOT NULL DEFAULT true,
  auto_mark_on_open boolean NOT NULL DEFAULT true,
  group_by_conversation boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own prefs select"
  ON public.notification_preferences FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "own prefs insert"
  ON public.notification_preferences FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid()
              AND tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "own prefs update"
  ON public.notification_preferences FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "own prefs delete"
  ON public.notification_preferences FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Auto-touch updated_at
CREATE OR REPLACE FUNCTION public.tg_notification_preferences_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER notification_preferences_touch
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.tg_notification_preferences_touch();

-- 2) Mark a single notification back to unread
CREATE OR REPLACE FUNCTION public.mark_notification_unread(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.notifications
     SET read_at = NULL
   WHERE id = p_id
     AND user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.mark_notification_unread(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notification_unread(uuid) TO authenticated;

-- 3) Message notify trigger honors recipient's pref
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
    LEFT JOIN public.notification_preferences np ON np.user_id = cp.user_id
   WHERE cp.conversation_id = NEW.conversation_id
     AND cp.user_id <> NEW.sender_id
     AND COALESCE(np.enabled_message, true) = true;

  RETURN NEW;
END;
$$;

-- 4) mark_conversation_read honors auto_mark_on_open
CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_auto boolean;
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

  SELECT COALESCE(auto_mark_on_open, true) INTO v_auto
    FROM public.notification_preferences
   WHERE user_id = auth.uid();
  IF v_auto IS NULL THEN v_auto := true; END IF;

  IF v_auto THEN
    UPDATE public.notifications n
       SET read_at = now()
     WHERE n.user_id = auth.uid()
       AND n.kind = 'message'
       AND n.href = '/messages?c=' || p_conversation_id::text
       AND n.read_at IS NULL;
  END IF;
END;
$$;
