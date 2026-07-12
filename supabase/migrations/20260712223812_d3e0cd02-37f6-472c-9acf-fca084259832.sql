-- Chat improvements round 3 (PR #14): TTL leak fix, upload rate limit, caption support, forward flag

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS forwarded boolean NOT NULL DEFAULT false;

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_content_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_content_check
  CHECK (
    deleted_at IS NOT NULL
    OR (kind = 'text' AND body IS NOT NULL AND btrim(body) <> '' AND char_length(body) <= 8000)
    OR (
      kind IN ('image', 'file', 'audio')
      AND attachment_path IS NOT NULL AND char_length(attachment_path) <= 512
      AND (body IS NULL OR char_length(body) <= 2000)
    )
  );

CREATE OR REPLACE FUNCTION public.tg_messages_notify_recipients()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_sender_name text;
  v_preview text;
  v_href text;
  v_ttl integer;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT message_ttl_seconds INTO v_ttl
    FROM public.conversations WHERE id = NEW.conversation_id;

  SELECT COALESCE(NULLIF(TRIM(p.display_name), ''), 'Ktoś')
    INTO v_sender_name
    FROM public.profiles p
   WHERE p.id = NEW.sender_id;
  IF v_sender_name IS NULL THEN v_sender_name := 'Ktoś'; END IF;

  IF v_ttl IS NOT NULL THEN
    v_preview := 'Nowa wiadomość';
  ELSIF NEW.kind = 'image' THEN
    v_preview := '📷 ' || COALESCE(NULLIF(TRIM(NEW.body), ''), 'Zdjęcie');
  ELSIF NEW.kind = 'file' THEN
    v_preview := '📎 ' || COALESCE(NULLIF(TRIM(NEW.body), ''), NEW.attachment_name, 'Plik');
  ELSIF NEW.kind = 'audio' THEN
    v_preview := '🎤 Wiadomość głosowa';
  ELSE
    v_preview := COALESCE(NULLIF(TRIM(NEW.body), ''), '…');
    IF length(v_preview) > 140 THEN
      v_preview := left(v_preview, 137) || '…';
    END IF;
  END IF;

  v_href := '/messages?c=' || NEW.conversation_id::text;

  BEGIN
    INSERT INTO public.notifications (user_id, tenant_id, kind, title_pl, title_en, body_pl, body_en, href, icon)
    SELECT cp.user_id, cp.tenant_id, 'message', v_sender_name, v_sender_name,
           v_preview, v_preview, v_href, 'MessagesSquare'
      FROM public.conversation_participants cp
      JOIN public.profiles pr ON pr.id = cp.user_id AND pr.tenant_id = cp.tenant_id
      LEFT JOIN public.notification_preferences np ON np.user_id = cp.user_id
     WHERE cp.conversation_id = NEW.conversation_id
       AND cp.tenant_id = NEW.tenant_id
       AND cp.user_id <> NEW.sender_id
       AND (cp.muted_until IS NULL OR cp.muted_until <= now())
       AND COALESCE(np.enabled_message, true) = true;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'chat: message notification fan-out failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.messages_after_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.conversations
     SET last_message_at = NEW.created_at,
         last_message_kind = NEW.kind,
         last_message_preview = CASE
           WHEN NEW.kind = 'text' THEN left(NEW.body, 140)
           WHEN NEW.kind = 'audio' THEN NULL
           ELSE COALESCE(NULLIF(left(NEW.body, 140), ''), NEW.attachment_name)
         END,
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

CREATE OR REPLACE FUNCTION public.chat_purge_expired_messages()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_conv record;
  v_last record;
BEGIN
  CREATE TEMP TABLE _purged_convs ON COMMIT DROP AS
  SELECT DISTINCT conversation_id
    FROM public.messages
   WHERE expires_at IS NOT NULL AND expires_at < now();

  DELETE FROM public.messages
   WHERE expires_at IS NOT NULL AND expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;

  FOR v_conv IN SELECT conversation_id FROM _purged_convs LOOP
    SELECT m.created_at, m.kind, m.sender_id, m.body, m.attachment_name
      INTO v_last
      FROM public.messages m
     WHERE m.conversation_id = v_conv.conversation_id
       AND m.deleted_at IS NULL
       AND (m.expires_at IS NULL OR m.expires_at >= now())
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT 1;

    IF FOUND THEN
      UPDATE public.conversations c
         SET last_message_at = v_last.created_at,
             last_message_kind = v_last.kind,
             last_message_sender = v_last.sender_id,
             last_message_preview = CASE
               WHEN v_last.kind = 'text' THEN left(v_last.body, 140)
               WHEN v_last.kind = 'audio' THEN NULL
               ELSE COALESCE(NULLIF(left(v_last.body, 140), ''), v_last.attachment_name)
             END
       WHERE c.id = v_conv.conversation_id;
    ELSE
      UPDATE public.conversations c
         SET last_message_kind = NULL,
             last_message_preview = NULL,
             last_message_sender = NULL
       WHERE c.id = v_conv.conversation_id;
    END IF;
  END LOOP;

  DELETE FROM public.notifications n
   USING public.conversations c
   WHERE n.kind = 'message'
     AND c.message_ttl_seconds IS NOT NULL
     AND n.href = '/messages?c=' || c.id::text
     AND n.created_at < now() - make_interval(secs => c.message_ttl_seconds);

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.chat_purge_expired_messages() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_purge_expired_messages() TO service_role;

DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron unavailable';
    RETURN;
  END IF;
  BEGIN
    PERFORM cron.unschedule('chat-purge-expired-messages');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM cron.schedule(
    'chat-purge-expired-messages',
    '*/15 * * * *',
    $job$SELECT public.chat_purge_expired_messages()$job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'chat: scheduling purge job failed (%)', SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION public.chat_check_upload_quota()
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'chat: authentication required'; END IF;
  INSERT INTO public.rate_limits (scope, subject_id, window_start, count)
  VALUES ('chat_upload', v_uid::text, date_trunc('minute', now()), 1)
  ON CONFLICT (scope, subject_id, window_start)
  DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO v_count;
  IF v_count > 20 THEN
    RAISE EXCEPTION 'chat: upload rate limited';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.chat_check_upload_quota() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_check_upload_quota() TO authenticated, service_role;