-- ============================================================================
-- Czat - runda poprawek (bezpieczeństwo + funkcje). Idempotentne.
--
--   1) ZNIKAJĄCE WIADOMOŚCI NAPRAWDĘ ZNIKAJĄ. Dotąd treść wygasłej wiadomości
--      przeciekała dwiema drogami mimo purge wiersza:
--        a) conversations.last_message_preview trzymał do 140 znaków treści i
--           nie był czyszczony po twardym DELETE (brak triggera na DELETE),
--        b) tg_messages_notify_recipients kopiował treść do notifications.body,
--           a notyfikacje nie mają TTL - zostawały na stałe.
--      Fix: (a) chat_purge_expired_messages po skasowaniu przelicza podgląd
--      konwersacji z najnowszej OCALAŁEJ wiadomości; (b) fan-out przy włączonym
--      TTL zapisuje generyczny podgląd ("Nowa wiadomość"), nigdy treści; purge
--      dodatkowo kasuje przeterminowane notyfikacje 'message' dla rozmów z TTL.
--      Cron przyspieszony do co 15 min (mniejsze okno nieświeżego podglądu).
--
--   2) LIMIT TEMPA UPLOADÓW (chat-attachments/głosówki). Upload leci do storage
--      PRZED insertem wiadomości, więc guard 30/min na messages go nie łapał -
--      wektor nadużycia storage/bandwidth. RPC chat_check_upload_quota()
--      liczy próby w rate_limits (20/min per użytkownik) i odmawia; klient woła
--      je przed poproszeniem o signed upload URL.
--
--   3) PODPISY POD ZAŁĄCZNIKAMI. CHECK dopuszczał body przy załączniku, ale bez
--      limitu długości. Domykamy: opcjonalny podpis <= 2000 znaków dla
--      image/file/audio; podgląd listy woli podpis od nazwy pliku.
--
--   4) PRZEKAZYWANIE (forward). messages.forwarded (bool) - etykieta
--      "Przekazano" w UI; kopię tworzy klient jako zwykłą nową wiadomość
--      (przechodzi ten sam guard tenant/blokada/limit).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- KOLUMNY
-- ----------------------------------------------------------------------------
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS forwarded boolean NOT NULL DEFAULT false;

-- Podpis pod załącznikiem: opcjonalny body <= 2000 znaków (osobny, krótszy cap
-- niż 8000 dla czystego tekstu).
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

-- ----------------------------------------------------------------------------
-- 1a) FAN-OUT: generyczny podgląd przy włączonym TTL (zero treści w notifications)
-- ----------------------------------------------------------------------------
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
    -- Znikające wiadomości: powiadomienie NIE utrwala treści (notifications
    -- nie mają TTL). Generyczny podgląd - odbiorca i tak zobaczy treść w czacie
    -- dopóki nie wygaśnie.
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
       AND (cp.muted_until IS NULL OR cp.muted_until <= now())
       AND COALESCE(np.enabled_message, true) = true;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'chat: message notification fan-out failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- Podgląd listy: podpis pod obrazem/plikiem wygrywa z nazwą pliku (jak WhatsApp
-- "📷 podpis"); głosówka bez treści (etykietę nadaje klient).
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

-- ----------------------------------------------------------------------------
-- 1b) PURGE: przelicza podgląd konwersacji po skasowaniu wygasłych + czyści
--     przeterminowane notyfikacje rozmów z TTL
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_purge_expired_messages()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_conv record;
  v_last record;
BEGIN
  -- Rozmowy dotknięte purgem (do przeliczenia podglądu).
  CREATE TEMP TABLE _purged_convs ON COMMIT DROP AS
  SELECT DISTINCT conversation_id
    FROM public.messages
   WHERE expires_at IS NOT NULL AND expires_at < now();

  DELETE FROM public.messages
   WHERE expires_at IS NOT NULL AND expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Przelicz denormalizowany podgląd z najnowszej OCALAŁEJ wiadomości -
  -- inaczej treść wygasłej wiadomości zostawałaby na wierszu konwersacji.
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

  -- Notyfikacje 'message' rozmów z włączonym TTL nie powinny przetrwać dłużej
  -- niż samo okno znikania (obrona w głąb - fan-out i tak już nie zapisuje
  -- treści dla takich rozmów).
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
    RAISE NOTICE 'pg_cron unavailable - chat_purge_expired_messages must be scheduled externally';
    RETURN;
  END IF;
  PERFORM cron.schedule(
    'chat-purge-expired-messages',
    '*/15 * * * *',
    $job$SELECT public.chat_purge_expired_messages()$job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'chat: scheduling purge job failed (%) - schedule it manually', SQLERRM;
END $$;

-- ----------------------------------------------------------------------------
-- 2) LIMIT TEMPA UPLOADÓW ZAŁĄCZNIKÓW
-- ----------------------------------------------------------------------------
-- Klient woła to PRZED createSignedUploadUrl. SECURITY DEFINER pisze do
-- rate_limits mimo braku polityk klienckich (wzorzec verify_content_password).
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
