-- ============================================================================
-- Czat klasy WhatsApp: potwierdzenia dostarczenia, wiadomości głosowe,
-- gwiazdki, przypinanie/archiwum/wyciszanie rozmów, czyszczenie historii
-- "dla mnie" oraz wiadomości znikające (TTL) z twardym purge po stronie DB.
-- Wszystko idempotentne; każda nowa powierzchnia egzekwowana w bazie
-- (RLS / SECURITY DEFINER z guardem tenant+członkostwo), nie w UI.
--
--   1) DOSTARCZENIA: conversation_participants.last_delivered_at + RPC
--      mark_conversations_delivered() (klient woła po odebraniu wiadomości).
--      Ticki ✓/✓✓/✓✓(niebieskie) przestają zgadywać po "peer online";
--      widoczność stanu dostarczenia/odczytu dalej podlega wzajemnej
--      polityce potwierdzeń odczytu z 20260712190000.
--
--   2) ROZMOWY: pinned_at (limit 5, sort na szczycie), archived_at (sekcja
--      "Zarchiwizowane"), muted_until (wyciszenie 8h/1t/zawsze - fan-out
--      powiadomień pomija wyciszone), cleared_before ("wyczyść czat dla
--      mnie" - RLS wiadomości ukrywa starsze wpisy tylko wołającemu).
--
--   3) ZNIKAJĄCE WIADOMOŚCI: conversations.message_ttl_seconds (24h/7d/90d,
--      ustawia dowolny uczestnik jak w WhatsApp 1:1), trigger stampuje
--      messages.expires_at dla NOWYCH wiadomości, RLS ukrywa wygasłe
--      natychmiast, a zaplanowany chat_purge_expired_messages() usuwa je
--      twardo (kaskada czyści też obiekt załącznika w storage przez
--      istniejący trigger purge).
--
--   4) GŁOSÓWKI: kind='audio' + attachment_duration (sekundy, cap 600),
--      allowlist bucketu poszerzona o kontenery audio przeglądarek
--      (webm/ogg/mp4/mpeg). Nagranie przechodzi ten sam prywatny,
--      member-gated pipeline co zwykłe załączniki.
--
--   5) GWIAZDKI: message_stars (prywatne per użytkownik - nadawca NIE widzi,
--      że ktoś oznaczył jego wiadomość), tenant+członkostwo w RLS, kaskady
--      po usunięciu wiadomości/konwersacji.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) KOLUMNY
-- ----------------------------------------------------------------------------
ALTER TABLE public.conversation_participants
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS muted_until timestamptz,
  ADD COLUMN IF NOT EXISTS cleared_before timestamptz,
  ADD COLUMN IF NOT EXISTS last_delivered_at timestamptz;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS message_ttl_seconds integer;
ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_message_ttl_check;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_message_ttl_check
  CHECK (message_ttl_seconds IS NULL OR message_ttl_seconds IN (86400, 604800, 7776000));

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS attachment_duration integer;
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_attachment_duration_check;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_attachment_duration_check
  CHECK (attachment_duration IS NULL OR (attachment_duration > 0 AND attachment_duration <= 600));

CREATE INDEX IF NOT EXISTS messages_expires_idx
  ON public.messages (expires_at) WHERE expires_at IS NOT NULL;

-- kind='audio' + załącznik obowiązkowy również dla audio.
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_kind_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_kind_check
  CHECK (kind IN ('text', 'image', 'file', 'audio'));
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_content_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_content_check
  CHECK (
    deleted_at IS NOT NULL
    OR (kind = 'text' AND body IS NOT NULL AND btrim(body) <> '' AND char_length(body) <= 8000)
    OR (kind IN ('image', 'file', 'audio') AND attachment_path IS NOT NULL AND char_length(attachment_path) <= 512)
  );

-- Kontenery audio nagrywane przez MediaRecorder (Chrome/Firefox: webm|ogg,
-- Safari: mp4). Bez rozszerzania listy typów dokumentów.
UPDATE storage.buckets
SET allowed_mime_types = (
  SELECT array_agg(DISTINCT m) FROM unnest(
    allowed_mime_types || ARRAY['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg']
  ) AS m
)
WHERE id = 'chat-attachments';

-- ----------------------------------------------------------------------------
-- 2) GWIAZDKI
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.message_stars (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);
CREATE INDEX IF NOT EXISTS message_stars_user_created_idx
  ON public.message_stars (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS message_stars_message_idx
  ON public.message_stars (message_id);

GRANT SELECT, INSERT, DELETE ON public.message_stars TO authenticated;
GRANT ALL ON public.message_stars TO service_role;
ALTER TABLE public.message_stars ENABLE ROW LEVEL SECURITY;

-- conversation_id/tenant_id zawsze z wiadomości - klient nie może ich
-- sfałszować (ten sam wzorzec co reakcje).
CREATE OR REPLACE FUNCTION public.message_stars_before_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  SELECT m.conversation_id, m.tenant_id
    INTO NEW.conversation_id, NEW.tenant_id
    FROM public.messages m WHERE m.id = NEW.message_id;
  IF NEW.conversation_id IS NULL THEN
    RAISE EXCEPTION 'chat: message missing';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS message_stars_before_insert_trg ON public.message_stars;
CREATE TRIGGER message_stars_before_insert_trg
  BEFORE INSERT ON public.message_stars
  FOR EACH ROW EXECUTE FUNCTION public.message_stars_before_insert();

-- Prywatne per użytkownik: tylko własne gwiazdki, tylko we własnym tenancie,
-- tylko w rozmowach, których jest się członkiem.
DROP POLICY IF EXISTS message_stars_own_select ON public.message_stars;
CREATE POLICY message_stars_own_select ON public.message_stars
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

DROP POLICY IF EXISTS message_stars_own_insert ON public.message_stars;
CREATE POLICY message_stars_own_insert ON public.message_stars
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
    AND conversation_id IN (SELECT public.member_conversation_ids())
  );

DROP POLICY IF EXISTS message_stars_own_delete ON public.message_stars;
CREATE POLICY message_stars_own_delete ON public.message_stars
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ----------------------------------------------------------------------------
-- 3) RLS WIADOMOŚCI: wygasanie + "wyczyść czat dla mnie"
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS messages_member_select ON public.messages;
CREATE POLICY messages_member_select ON public.messages
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND conversation_id IN (SELECT public.member_conversation_ids())
    AND (expires_at IS NULL OR expires_at > now())
    AND created_at >= COALESCE(
      (SELECT cp.cleared_before
         FROM public.conversation_participants cp
        WHERE cp.conversation_id = messages.conversation_id
          AND cp.user_id = (SELECT auth.uid())),
      '-infinity'::timestamptz
    )
  );

-- Stampowanie expires_at przy wysyłce (TTL konwersacji dotyczy tylko NOWYCH
-- wiadomości - jak w WhatsApp). Reszta logiki before-insert bez zmian.
CREATE OR REPLACE FUNCTION public.messages_before_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_ttl integer;
  v_reply uuid;
BEGIN
  SELECT tenant_id, message_ttl_seconds INTO v_tenant, v_ttl
    FROM public.conversations WHERE id = NEW.conversation_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'chat: conversation missing';
  END IF;
  NEW.tenant_id := v_tenant;
  NEW.expires_at := CASE
    WHEN v_ttl IS NULL THEN NULL
    ELSE now() + make_interval(secs => v_ttl)
  END;
  IF NEW.reply_to_id IS NOT NULL THEN
    SELECT conversation_id INTO v_reply FROM public.messages WHERE id = NEW.reply_to_id;
    IF v_reply IS DISTINCT FROM NEW.conversation_id THEN
      NEW.reply_to_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Podgląd listy: głosówka nie pokazuje nazwy pliku (klient tłumaczy po
-- last_message_kind); reszta bez zmian.
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
           ELSE NEW.attachment_name
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

-- Edycja/immutability: attachment_duration dołącza do niezmienialnych pól
-- załącznika i jest zerowany przy tombstone.
CREATE OR REPLACE FUNCTION public.messages_enforce_edit_window()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    NEW.body := NULL;
    NEW.attachment_path := NULL;
    NEW.attachment_name := NULL;
    NEW.attachment_mime := NULL;
    NEW.attachment_size := NULL;
    NEW.attachment_duration := NULL;
    RETURN NEW;
  END IF;
  IF NEW.attachment_path IS DISTINCT FROM OLD.attachment_path
     OR NEW.attachment_name IS DISTINCT FROM OLD.attachment_name
     OR NEW.attachment_mime IS DISTINCT FROM OLD.attachment_mime
     OR NEW.attachment_size IS DISTINCT FROM OLD.attachment_size
     OR NEW.attachment_duration IS DISTINCT FROM OLD.attachment_duration THEN
    RAISE EXCEPTION 'chat: attachments immutable';
  END IF;
  IF NEW.body IS DISTINCT FROM OLD.body THEN
    IF OLD.deleted_at IS NOT NULL OR OLD.kind <> 'text'
       OR OLD.created_at < now() - interval '5 minutes' THEN
      RAISE EXCEPTION 'chat: edit denied';
    END IF;
    NEW.edited_at := now();
  END IF;
  RETURN NEW;
END;
$$;

-- Kolumna attachment_duration musi być zapisywalna przy insercie i zerowalna
-- przy tombstone (grant kolumnowy jak dla pozostałych pól załącznika).
GRANT UPDATE(attachment_duration) ON public.messages TO authenticated;

-- ----------------------------------------------------------------------------
-- 4) RPC USTAWIEŃ ROZMOWY (self-row, tenant-gated)
-- ----------------------------------------------------------------------------
-- Przypięcie: maks. 5 rozmów (jak limit WhatsApp; zapobiega też nadużyciu
-- kolumny jako nieograniczonego stanu).
CREATE OR REPLACE FUNCTION public.chat_set_pinned(p_conversation_id uuid, p_pinned boolean)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'chat: authentication required'; END IF;
  IF p_pinned AND (
    SELECT count(*) FROM public.conversation_participants cp
    WHERE cp.user_id = v_uid AND cp.pinned_at IS NOT NULL
      AND cp.conversation_id <> p_conversation_id
  ) >= 5 THEN
    RAISE EXCEPTION 'chat: pin limit';
  END IF;
  UPDATE public.conversation_participants cp
     SET pinned_at = CASE WHEN p_pinned THEN now() ELSE NULL END,
         updated_at = now()
   WHERE cp.conversation_id = p_conversation_id
     AND cp.user_id = v_uid
     AND cp.tenant_id = public.current_tenant_id();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.chat_set_pinned(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_set_pinned(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.chat_set_archived(p_conversation_id uuid, p_archived boolean)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.conversation_participants cp
     SET archived_at = CASE WHEN p_archived THEN now() ELSE NULL END,
         pinned_at = CASE WHEN p_archived THEN NULL ELSE cp.pinned_at END,
         updated_at = now()
   WHERE cp.conversation_id = p_conversation_id
     AND cp.user_id = auth.uid()
     AND cp.tenant_id = public.current_tenant_id()
$$;
REVOKE EXECUTE ON FUNCTION public.chat_set_archived(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_set_archived(uuid, boolean) TO authenticated, service_role;

-- p_seconds: NULL = wyłącz wyciszenie, -1 = na zawsze, inaczej cap 1 rok.
CREATE OR REPLACE FUNCTION public.chat_set_muted(p_conversation_id uuid, p_seconds bigint)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.conversation_participants cp
     SET muted_until = CASE
           WHEN p_seconds IS NULL THEN NULL
           WHEN p_seconds < 0 THEN 'infinity'::timestamptz
           ELSE now() + make_interval(secs => LEAST(p_seconds, 31536000)::double precision)
         END,
         updated_at = now()
   WHERE cp.conversation_id = p_conversation_id
     AND cp.user_id = auth.uid()
     AND cp.tenant_id = public.current_tenant_id()
$$;
REVOKE EXECUTE ON FUNCTION public.chat_set_muted(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_set_muted(uuid, bigint) TO authenticated, service_role;

-- "Wyczyść czat dla mnie": wiadomości sprzed tej chwili znikają wyłącznie
-- z widoku wołającego (RLS wyżej); rozmówca zachowuje pełną historię.
-- clock_timestamp() zamiast now(): granica czyszczenia to FAKTYCZNY moment
-- wywołania, a nie start transakcji - wiadomość zapisana wcześniej w tej
-- samej transakcji (created_at = now()) też ma zniknąć.
CREATE OR REPLACE FUNCTION public.chat_clear_history(p_conversation_id uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.conversation_participants cp
     SET cleared_before = clock_timestamp(),
         unread_count = 0,
         updated_at = now()
   WHERE cp.conversation_id = p_conversation_id
     AND cp.user_id = auth.uid()
     AND cp.tenant_id = public.current_tenant_id()
$$;
REVOKE EXECUTE ON FUNCTION public.chat_clear_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_clear_history(uuid) TO authenticated, service_role;

-- Znikające wiadomości: ustawia dowolny UCZESTNIK rozmowy w swoim tenancie
-- (semantyka WhatsApp 1:1). Wartości ograniczone do 24h / 7 dni / 90 dni.
CREATE OR REPLACE FUNCTION public.chat_set_message_ttl(p_conversation_id uuid, p_ttl_seconds integer)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'chat: authentication required'; END IF;
  IF p_ttl_seconds IS NOT NULL AND p_ttl_seconds NOT IN (86400, 604800, 7776000) THEN
    RAISE EXCEPTION 'chat: invalid ttl';
  END IF;
  IF NOT public.is_tenant_conversation_member(p_conversation_id, v_uid) THEN
    RAISE EXCEPTION 'chat: not a member';
  END IF;
  UPDATE public.conversations c
     SET message_ttl_seconds = p_ttl_seconds,
         updated_at = now()
   WHERE c.id = p_conversation_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.chat_set_message_ttl(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_set_message_ttl(uuid, integer) TO authenticated, service_role;

-- Potwierdzenie dostarczenia: jedno wywołanie odhacza wszystkie rozmowy
-- wołającego, w których pojawiło się coś nowego (klient woła przy załadowaniu
-- listy i na każdy realtime INSERT). Guard no-op trzyma ruch realtime nisko.
CREATE OR REPLACE FUNCTION public.mark_conversations_delivered()
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.conversation_participants cp
     SET last_delivered_at = c.last_message_at,
         updated_at = now()
    FROM public.conversations c
   WHERE c.id = cp.conversation_id
     AND cp.user_id = auth.uid()
     AND cp.tenant_id = public.current_tenant_id()
     AND c.last_message_at IS NOT NULL
     AND (cp.last_delivered_at IS NULL OR cp.last_delivered_at < c.last_message_at)
$$;
REVOKE EXECUTE ON FUNCTION public.mark_conversations_delivered() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_conversations_delivered() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5) WYCISZENIE W FAN-OUCIE POWIADOMIEŃ + podgląd głosówki
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 6) PURGE WYGASŁYCH WIADOMOŚCI (znikające na twardo, nie tylko w RLS)
-- ----------------------------------------------------------------------------
-- Godzinna karencja po wygaśnięciu (RLS i tak ukrywa natychmiast); DELETE
-- odpala istniejący trigger messages_purge_attachment, więc pliki głosówek
-- i załączników znikają ze storage razem z wierszami.
CREATE OR REPLACE FUNCTION public.chat_purge_expired_messages()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.messages
   WHERE expires_at IS NOT NULL
     AND expires_at < now() - interval '1 hour';
  GET DIAGNOSTICS v_count = ROW_COUNT;
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
  -- cron.schedule nadpisuje istniejący job o tej samej nazwie.
  PERFORM cron.schedule(
    'chat-purge-expired-messages',
    '23 * * * *',
    $job$SELECT public.chat_purge_expired_messages()$job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'chat: scheduling purge job failed (%) - schedule it manually', SQLERRM;
END $$;
