-- ============================================================================
-- Prywatność czatu per tenant + pliki między użytkownikami + preferencje.
-- Wszystko idempotentne. Zakres (audyt tej gałęzi):
--
--   1) TENANT-AWARE CZŁONKOSTWO: is_conversation_member() nie patrzyło na
--      tenant. Wiadomości mają twardy filtr tenant_id w RLS, ale polityki
--      storage (chat-attachments) gate'owały wyłącznie członkostwem - po
--      przeniesieniu konta do innego tenanta (albo przy legacy wierszu
--      członkostwa cross-tenant) załączniki starych rozmów pozostawały
--      czytelne, mimo że same wiadomości już nie. Nowy helper
--      is_tenant_conversation_member() domyka spójność: konwersacja musi
--      należeć do BIEŻĄCEGO tenanta wołającego.
--
--   2) STORAGE chat-attachments: odczyt/kasowanie bez kontroli tenanta i z
--      luźną głębokością ścieżki (>=3). Teraz: dokładny kontrakt
--      <tenant>/<konwersacja>/<uploader>/<plik>, folder tenanta musi być
--      tenantem wołającego, a członkostwo jest tenant-aware. Bucket `cv`
--      dostaje ten sam dokładny kontrakt głębokości.
--
--   3) REALTIME AUTHORIZATION: kanały broadcast/presence czatu były
--      PUBLICZNYMI topicami - każdy zalogowany znający UUID konwersacji mógł
--      podsłuchiwać zdarzenia "pisze..." (userId + aktywność), a znając UUID
--      tenanta - pełną listę osób online w cudzym tenancie (plus spoofing
--      obu). Polityki na realtime.messages + private channels po stronie
--      klienta zamykają oba kanały do członków/tenanta.
--
--   4) CYKL ŻYCIA ZAŁĄCZNIKÓW: "cofnij wysłanie" zerowało attachment_path w
--      wierszu, ale obiekt w buckecie żył wiecznie (i każdy uczestnik ze
--      zapisaną ścieżką mógł dalej podpisywać URL-e). Trigger AFTER
--      DELETE/UPDATE kasuje obiekt storage przy soft/hard delete wiadomości
--      (kaskada usunięcia konwersacji też przechodzi przez row-level DELETE).
--
--   5) PREFERENCJE: notification_preferences z przypiętym user_id/tenant_id
--      (trigger jak profiles_pin_tenant - dotąd UPDATE mógł przepisać własny
--      wiersz do obcego tenanta), plus NOWE preferencje prywatności czatu:
--        - read_receipts_enabled  (wzajemne: wyłączasz -> nie udostępniasz
--          i nie widzisz cudzych potwierdzeń odczytu; egzekwowane w RLS
--          conversation_participants, nie w UI),
--        - typing_indicators_enabled (klient nie nadaje "pisze..."),
--        - show_online_status (klient nie trackuje presence; polityka INSERT
--          na realtime.messages odmawia tracka przy wyłączonej preferencji),
--        - allow_messages_from: 'everyone' | 'existing' | 'nobody'
--          ('existing'/'nobody' blokują NOWE konwersacje w RPC; 'nobody'
--          dodatkowo wycisza wysyłkę w istniejących wątkach - trigger).
--
--   6) RPC: get_chat_peers - gałąź wspólnej konwersacji ograniczona do
--      tenanta wołającego (legacy cross-tenant członkostwo nie ujawnia już
--      profilu) + limit rozmiaru wejścia; mark_conversation_read z guardem
--      tenanta; get_or_create_direct_conversation honoruje
--      allow_messages_from odbiorcy.
--
--   7) NAPRAWY BŁĘDÓW WYKRYTYCH PRZY TESTACH (pgTAP chat_privacy_isolation):
--      - get_or_create_direct_conversation: "ON CONFLICT (direct_key)" nie
--        mogło wywnioskować CZĘŚCIOWEGO indeksu unikalnego -> 42P10 przy
--        każdym utworzeniu NOWEJ konwersacji;
--      - tg_messages_notify_recipients: ślepy fan-out po wierszach
--        uczestników - pojedynczy niespójny (cross-tenant) wiersz wywracał
--        guardem notifications_enforce_tenant CAŁY INSERT wiadomości
--        (zamrożona konwersacja) i adresował powiadomienie poza tenant.
--        Teraz: odbiorcy tylko z tenanta wiadomości, spójni profilowo,
--        a błąd powiadomień nigdy nie blokuje samej wiadomości.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) TENANT-AWARE CZŁONKOSTWO
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_tenant_conversation_member(_conv uuid, _user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_participants cp
    JOIN public.conversations c ON c.id = cp.conversation_id
    WHERE cp.conversation_id = _conv
      AND cp.user_id = _user
      AND c.tenant_id = public.current_tenant_id()
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_tenant_conversation_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_tenant_conversation_member(uuid, uuid) TO authenticated, service_role;

-- Bezpieczny parser topiców 'chat-conv:<uuid>' (błędny format -> NULL zamiast
-- wyjątku rzutowania, który wywróciłby ewaluację polityki).
CREATE OR REPLACE FUNCTION public.chat_topic_conversation_id(_topic text)
RETURNS uuid
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN _topic ~ '^chat-conv:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN substring(_topic FROM 11)::uuid
    ELSE NULL
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.chat_topic_conversation_id(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_topic_conversation_id(text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2) STORAGE: chat-attachments + cv - dokładny kontrakt ścieżki i tenant
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "chat attachments member read" ON storage.objects;
CREATE POLICY "chat attachments member read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND array_length(storage.foldername(name), 1) = 3
    AND (storage.foldername(name))[1] = (SELECT public.current_tenant_id()::text)
    AND (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
    AND public.is_tenant_conversation_member(
          ((storage.foldername(name))[2])::uuid, (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "chat attachments member upload" ON storage.objects;
CREATE POLICY "chat attachments member upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND array_length(storage.foldername(name), 1) = 3
    AND (storage.foldername(name))[1] = (SELECT public.current_tenant_id()::text)
    AND (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
    AND (storage.foldername(name))[3] = (SELECT auth.uid()::text)
    AND public.is_tenant_conversation_member(
          ((storage.foldername(name))[2])::uuid, (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "chat attachments owner delete" ON storage.objects;
CREATE POLICY "chat attachments owner delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND array_length(storage.foldername(name), 1) = 3
    AND (storage.foldername(name))[1] = (SELECT public.current_tenant_id()::text)
    AND (storage.foldername(name))[3] = (SELECT auth.uid()::text)
  );

-- cv: właścicielski odczyt/kasowanie z dokładnym kontraktem
-- <tenant>/users/<uid>/<plik> (dotąd wystarczało [3]=uid na dowolnej głębi).
-- Bez bramki tenanta przy odczycie: CV jest plikiem UŻYTKOWNIKA - po
-- przeniesieniu konta do innego tenanta właściciel nie może stracić dostępu
-- do własnego dokumentu.
DROP POLICY IF EXISTS "cv owner read" ON storage.objects;
CREATE POLICY "cv owner read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'cv'
    AND array_length(storage.foldername(name), 1) = 3
    AND (storage.foldername(name))[2] = 'users'
    AND (storage.foldername(name))[3] = (SELECT auth.uid()::text)
  );

DROP POLICY IF EXISTS "cv owner delete" ON storage.objects;
CREATE POLICY "cv owner delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'cv'
    AND array_length(storage.foldername(name), 1) = 3
    AND (storage.foldername(name))[2] = 'users'
    AND (storage.foldername(name))[3] = (SELECT auth.uid()::text)
  );

-- ----------------------------------------------------------------------------
-- 3) PREFERENCJE: pin tożsamości + nowe preferencje prywatności czatu
-- ----------------------------------------------------------------------------
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS read_receipts_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS typing_indicators_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_online_status boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_messages_from text NOT NULL DEFAULT 'everyone';

ALTER TABLE public.notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_allow_messages_from_check;
ALTER TABLE public.notification_preferences
  ADD CONSTRAINT notification_preferences_allow_messages_from_check
  CHECK (allow_messages_from IN ('everyone', 'existing', 'nobody'));

-- Pin: UPDATE nie może przepisać wiersza na innego użytkownika/tenanta ani
-- cofnąć created_at (dotąd WITH CHECK sprawdzał tylko user_id, a grant UPDATE
-- obejmował całą tabelę - własny wiersz dawało się "przenieść" do obcego
-- tenanta). INSERT zawsze przypina tenant do tenanta WŁAŚCICIELA wiersza -
-- niezależnie od tego, co przysłał klient.
CREATE OR REPLACE FUNCTION public.notification_preferences_pin_identity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.user_id    := OLD.user_id;
    NEW.tenant_id  := OLD.tenant_id;
    NEW.created_at := OLD.created_at;
  ELSE
    SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = NEW.user_id;
    IF v_tenant IS NOT NULL THEN
      NEW.tenant_id := v_tenant;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS notification_preferences_pin_identity ON public.notification_preferences;
CREATE TRIGGER notification_preferences_pin_identity
  BEFORE INSERT OR UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.notification_preferences_pin_identity();

-- Pas i szelki: WITH CHECK na UPDATE wymusza też zgodność tenanta (pin i tak
-- ją gwarantuje, ale polityka jest jawna i samodokumentująca).
DROP POLICY IF EXISTS "own prefs update" ON public.notification_preferences;
CREATE POLICY "own prefs update"
  ON public.notification_preferences FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid())
  );

-- Helpery preferencji dla polityk RLS i triggerów. SECURITY DEFINER, bo
-- polityka działa w kontekście wołającego, a RLS notification_preferences
-- pokazuje wyłącznie własny wiersz (odczyt cudzej preferencji wprost jest
-- niemożliwy - helper zwraca tylko pojedynczy boolean/tekst, zero PII).
CREATE OR REPLACE FUNCTION public.chat_read_receipts_enabled(_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT np.read_receipts_enabled FROM public.notification_preferences np WHERE np.user_id = _user),
    true
  );
$$;
REVOKE EXECUTE ON FUNCTION public.chat_read_receipts_enabled(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_read_receipts_enabled(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.chat_show_online_status(_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT np.show_online_status FROM public.notification_preferences np WHERE np.user_id = _user),
    true
  );
$$;
REVOKE EXECUTE ON FUNCTION public.chat_show_online_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_show_online_status(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.chat_allow_messages_from(_user uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT np.allow_messages_from FROM public.notification_preferences np WHERE np.user_id = _user),
    'everyone'
  );
$$;
REVOKE EXECUTE ON FUNCTION public.chat_allow_messages_from(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_allow_messages_from(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) POTWIERDZENIA ODCZYTU: wzajemna widoczność wierszy uczestników
-- ----------------------------------------------------------------------------
-- Wiersz uczestnika (unread_count, last_read_at = pełny stan odczytu) widzą:
--   - zawsze on sam,
--   - współuczestnicy z tego samego tenanta, ale TYLKO gdy potwierdzenia
--     odczytu są włączone u OBU stron (wzajemność jak w komunikatorach:
--     wyłączając własne potwierdzenia, przestajesz widzieć cudze - preferencja
--     nie pozwala na "jazdę na gapę").
-- Tożsamość rozmówcy w UI nie zależy już od tego wiersza (direct_key niesie
-- pary uczestników; frontend syntetyzuje ukrytych rozmówców).
DROP POLICY IF EXISTS conversation_participants_member_select ON public.conversation_participants;
CREATE POLICY conversation_participants_member_select ON public.conversation_participants
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      user_id = (SELECT auth.uid())
      OR (
        conversation_id IN (SELECT public.member_conversation_ids())
        AND public.chat_read_receipts_enabled(user_id)
        AND public.chat_read_receipts_enabled((SELECT auth.uid()))
      )
    )
  );

-- Backfill direct_key dla konwersacji sprzed jego wprowadzenia, żeby frontend
-- zawsze mógł wywieść parę uczestników bez wierszy cp. Deterministycznie:
-- przy duplikatach pary klucz dostaje najstarsza konwersacja.
WITH pairs AS (
  SELECT cp.conversation_id,
         min(cp.user_id::text) AS a,
         max(cp.user_id::text) AS b,
         count(*)              AS n
  FROM public.conversation_participants cp
  GROUP BY cp.conversation_id
),
candidates AS (
  SELECT DISTINCT ON (c.tenant_id, p.a, p.b)
         c.id,
         c.tenant_id::text || ':' || p.a || ':' || p.b AS key
  FROM public.conversations c
  JOIN pairs p ON p.conversation_id = c.id
  WHERE c.kind = 'direct'
    AND c.direct_key IS NULL
    AND p.n = 2
  ORDER BY c.tenant_id, p.a, p.b, c.created_at ASC
)
UPDATE public.conversations c
SET direct_key = cand.key
FROM candidates cand
WHERE c.id = cand.id
  AND NOT EXISTS (SELECT 1 FROM public.conversations c2 WHERE c2.direct_key = cand.key);

-- ----------------------------------------------------------------------------
-- 5) RPC / TRIGGERY CZATU
-- ----------------------------------------------------------------------------
-- Tworzenie konwersacji honoruje preferencję odbiorcy: nową rozmowę można
-- zacząć tylko z osobą discoverable, której allow_messages_from = 'everyone'.
-- Komunikat błędu celowo identyczny z "peer nieosiągalny" (bez enumeracji,
-- która preferencja zablokowała).
--
-- Przy okazji naprawa istniejącego błędu: conversations_direct_key_uidx jest
-- indeksem CZĘŚCIOWYM (WHERE direct_key IS NOT NULL), a "ON CONFLICT
-- (direct_key)" bez predykatu nie może go wywnioskować - gałąź INSERT padała
-- z 42P10 przy każdej próbie utworzenia NOWEJ konwersacji (wykryte w pgTAP
-- chat_privacy_isolation_test).
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
  IF public.is_blocked_pair(v_uid, p_peer_id) THEN RAISE EXCEPTION 'chat: blocked'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_uid;
  SELECT tenant_id, discoverable INTO v_peer_tenant, v_peer_discoverable FROM public.profiles WHERE id = p_peer_id;
  IF v_tenant IS NULL OR v_peer_tenant IS NULL OR v_tenant <> v_peer_tenant THEN RAISE EXCEPTION 'chat: peer not available'; END IF;
  v_key := v_tenant::text || ':' || LEAST(v_uid, p_peer_id)::text || ':' || GREATEST(v_uid, p_peer_id)::text;
  SELECT id INTO v_conversation FROM public.conversations WHERE direct_key = v_key;
  IF v_conversation IS NULL THEN
    IF NOT COALESCE(v_peer_discoverable, false) THEN RAISE EXCEPTION 'chat: peer not available'; END IF;
    IF public.chat_allow_messages_from(p_peer_id) <> 'everyone' THEN
      RAISE EXCEPTION 'chat: peer not available';
    END IF;
    INSERT INTO public.conversations (tenant_id, kind, direct_key, created_by)
    VALUES (v_tenant, 'direct', v_key, v_uid)
    ON CONFLICT (direct_key) WHERE direct_key IS NOT NULL DO UPDATE SET updated_at = now()
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

-- Guard wiadomości: blokady + allow_messages_from='nobody' (tryb cichy - nikt
-- nie pisze do tej osoby nawet w istniejących wątkach) + limit tempa.
CREATE OR REPLACE FUNCTION public.tg_messages_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_recent integer;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.conversation_participants cp
    WHERE cp.conversation_id = NEW.conversation_id
      AND cp.user_id <> NEW.sender_id
      AND public.is_blocked_pair(NEW.sender_id, cp.user_id)
  ) THEN
    RAISE EXCEPTION 'chat: blocked';
  END IF;

  -- Zawężone do uczestników tenanta wiadomości: niespójny legacy wiersz
  -- spoza tenanta nie może wyciszyć cudzego wątku.
  IF EXISTS (
    SELECT 1
    FROM public.conversation_participants cp
    WHERE cp.conversation_id = NEW.conversation_id
      AND cp.tenant_id = NEW.tenant_id
      AND cp.user_id <> NEW.sender_id
      AND public.chat_allow_messages_from(cp.user_id) = 'nobody'
  ) THEN
    RAISE EXCEPTION 'chat: recipient unavailable';
  END IF;

  SELECT count(*) INTO v_recent
  FROM public.messages m
  WHERE m.sender_id = NEW.sender_id
    AND m.created_at > now() - interval '60 seconds';
  IF v_recent >= 30 THEN
    RAISE EXCEPTION 'chat: rate limited';
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS messages_guard ON public.messages;
CREATE TRIGGER messages_guard
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_messages_guard();

-- Fan-out powiadomień o wiadomości: odbiorcy WYŁĄCZNIE z tenanta wiadomości
-- i spójni profilowo (tenant profilu = tenant wiersza uczestnika). Dotąd ślepy
-- fan-out po cp.tenant_id: (a) adresował powiadomienie do użytkownika spoza
-- tenanta konwersacji, (b) guard notifications_enforce_tenant słusznie to
-- odrzucał, ale wyjątek wywracał CAŁY INSERT wiadomości - jeden niespójny
-- wiersz uczestnika zamrażał konwersację wszystkim. Powiadomienia są
-- best-effort: ich błąd nie może blokować samej wiadomości.
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
       AND COALESCE(np.enabled_message, true) = true;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'chat: message notification fan-out failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- mark_conversation_read: guard tenanta - konto przeniesione do innego tenanta
-- nie modyfikuje już stanu odczytu w starych rozmowach (spójnie z RLS
-- messages/conversations, które też znikają po zmianie tenanta).
CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.conversation_participants cp
  SET unread_count = 0, last_read_at = now(), updated_at = now()
  WHERE cp.conversation_id = p_conversation_id
    AND cp.user_id = auth.uid()
    AND cp.tenant_id = public.current_tenant_id()
    AND (cp.unread_count > 0
         OR cp.last_read_at IS NULL
         OR cp.last_read_at < (SELECT c.last_message_at FROM public.conversations c WHERE c.id = p_conversation_id))
$$;
REVOKE EXECUTE ON FUNCTION public.mark_conversation_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated, service_role;

-- get_chat_peers: gałąź wspólnej konwersacji wymaga teraz tego samego tenanta
-- (legacy cross-tenant członkostwo nie ujawnia profilu) + twardy limit
-- rozmiaru wejścia (dotąd nieograniczona tablica = darmowy skan profili).
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
  WHERE auth.uid() IS NOT NULL
    AND cardinality(p_user_ids) BETWEEN 1 AND 200
    AND p.id = ANY (p_user_ids)
    AND (
      p.id = auth.uid()
      OR (
        p.tenant_id = (SELECT pr.tenant_id FROM public.profiles pr WHERE pr.id = auth.uid())
        AND (
          p.discoverable = true
          OR EXISTS (
            SELECT 1
            FROM public.conversation_participants me
            JOIN public.conversation_participants them
              ON them.conversation_id = me.conversation_id
            WHERE me.user_id = auth.uid()
              AND them.user_id = p.id
          )
        )
      )
    );
$$;
REVOKE EXECUTE ON FUNCTION public.get_chat_peers(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_chat_peers(uuid[]) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6) CYKL ŻYCIA ZAŁĄCZNIKÓW: purge obiektu storage przy usunięciu wiadomości
-- ----------------------------------------------------------------------------
-- Soft delete (deleted_at + wyzerowany attachment_path), hard delete i kaskada
-- po DELETE konwersacji przechodzą przez ten trigger. Purge jest best-effort:
-- błąd storage nie może wywrócić samego usunięcia wiadomości.
CREATE OR REPLACE FUNCTION public.tg_messages_purge_attachment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_path text := OLD.attachment_path;
BEGIN
  IF v_path IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.attachment_path IS NOT DISTINCT FROM OLD.attachment_path THEN
    RETURN NEW;
  END IF;
  BEGIN
    DELETE FROM storage.objects
    WHERE bucket_id = 'chat-attachments' AND name = v_path;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'chat: attachment purge failed for %: %', v_path, SQLERRM;
  END;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS messages_purge_attachment ON public.messages;
CREATE TRIGGER messages_purge_attachment
  AFTER DELETE OR UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_messages_purge_attachment();

-- ----------------------------------------------------------------------------
-- 7) REALTIME AUTHORIZATION: typing broadcast + presence jako kanały prywatne
-- ----------------------------------------------------------------------------
-- Polityki działają wyłącznie dla kanałów z config.private=true (klient
-- przełączony w tym samym PR). Public topici przestają istnieć dla czatu.
DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NULL
     OR to_regprocedure('realtime.topic()') IS NULL THEN
    RAISE NOTICE 'realtime authorization unavailable on this stack - skipping policies';
    RETURN;
  END IF;

  -- Wymagane, by WITH CHECK/USING w ogóle było egzekwowane. Na aktualnych
  -- stackach RLS jest już włączone - wtedy to no-op.
  BEGIN
    EXECUTE 'ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'realtime.messages: enable RLS failed (%) - continuing', SQLERRM;
  END;

  -- Typing "chat-conv:<uuid>": odbiór i nadawanie tylko dla członków
  -- konwersacji w ich bieżącym tenancie.
  EXECUTE 'DROP POLICY IF EXISTS chat_typing_member_read ON realtime.messages';
  EXECUTE $pol$
    CREATE POLICY chat_typing_member_read ON realtime.messages
      FOR SELECT TO authenticated
      USING (
        realtime.messages.extension = 'broadcast'
        AND public.chat_topic_conversation_id(realtime.topic()) IS NOT NULL
        AND public.is_tenant_conversation_member(
              public.chat_topic_conversation_id(realtime.topic()),
              (SELECT auth.uid()))
      )
  $pol$;

  EXECUTE 'DROP POLICY IF EXISTS chat_typing_member_write ON realtime.messages';
  EXECUTE $pol$
    CREATE POLICY chat_typing_member_write ON realtime.messages
      FOR INSERT TO authenticated
      WITH CHECK (
        realtime.messages.extension = 'broadcast'
        AND public.chat_topic_conversation_id(realtime.topic()) IS NOT NULL
        AND public.is_tenant_conversation_member(
              public.chat_topic_conversation_id(realtime.topic()),
              (SELECT auth.uid()))
      )
  $pol$;

  -- Presence czatu "chat-presence:<tenant>": wyłącznie własny tenant; track
  -- (INSERT) dodatkowo wymaga włączonego show_online_status.
  EXECUTE 'DROP POLICY IF EXISTS chat_presence_tenant_read ON realtime.messages';
  EXECUTE $pol$
    CREATE POLICY chat_presence_tenant_read ON realtime.messages
      FOR SELECT TO authenticated
      USING (
        realtime.messages.extension = 'presence'
        AND realtime.topic() = 'chat-presence:' || public.current_tenant_id()::text
      )
  $pol$;

  EXECUTE 'DROP POLICY IF EXISTS chat_presence_tenant_write ON realtime.messages';
  EXECUTE $pol$
    CREATE POLICY chat_presence_tenant_write ON realtime.messages
      FOR INSERT TO authenticated
      WITH CHECK (
        realtime.messages.extension = 'presence'
        AND realtime.topic() = 'chat-presence:' || public.current_tenant_id()::text
        AND public.chat_show_online_status((SELECT auth.uid()))
      )
  $pol$;

  -- Presence per-encja "presence:<tenant>:<typ>:<id>" (kto edytuje/ogląda):
  -- dotąd publiczny topic ujawniał nazwiska edytorów każdemu, kto zgadł topic.
  EXECUTE 'DROP POLICY IF EXISTS entity_presence_tenant_read ON realtime.messages';
  EXECUTE $pol$
    CREATE POLICY entity_presence_tenant_read ON realtime.messages
      FOR SELECT TO authenticated
      USING (
        realtime.messages.extension = 'presence'
        AND realtime.topic() LIKE 'presence:%'
        AND split_part(realtime.topic(), ':', 2) = public.current_tenant_id()::text
      )
  $pol$;

  EXECUTE 'DROP POLICY IF EXISTS entity_presence_tenant_write ON realtime.messages';
  EXECUTE $pol$
    CREATE POLICY entity_presence_tenant_write ON realtime.messages
      FOR INSERT TO authenticated
      WITH CHECK (
        realtime.messages.extension = 'presence'
        AND realtime.topic() LIKE 'presence:%'
        AND split_part(realtime.topic(), ':', 2) = public.current_tenant_id()::text
      )
  $pol$;

  BEGIN
    EXECUTE 'GRANT SELECT, INSERT ON realtime.messages TO authenticated';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'realtime.messages: grant failed (%) - continuing', SQLERRM;
  END;
END $$;
