-- ============================================================================
-- SPOŁECZNOŚĆ - wyrównanie RPC i egzekwowanie flag warstw członkostwa.
--
-- Audyt wykazał dwie klasy rozjazdów:
--
--   1) Publiczne UI omijało utwardzone RPC bezpośrednimi zapisami do tabel,
--      które przetrwały na politykach-zalążkach z 20260713050024 (RSVP bez
--      limitu miejsc i warstwy, pytania Q&A bez rate-limitu i z e-mailem w
--      author_display, głosy na pytania w statusie 'pending', ankiety z
--      "wynikami" liczonymi z własnego 1 wiersza). Zalążkowe polityki
--      zapisu znikają - jedyną ścieżką zapisu są RPC.
--
--   2) Flagi features warstw (qa_priority, pro_briefings) były martwymi
--      danymi. Tu zyskują egzekwowanie:
--        * qa_priority   -> list_qa_questions zwraca is_priority i porządek
--                           priorytet > głosy > wiek (konsumowane przez /qa),
--        * pro_briefings -> wydarzenia kind='briefing' o widoczności
--                           'members' wymagają flagi pro_briefings (nie
--                           samego rangu) w get_event_access i rsvp_event.
--
-- Dodatkowo: get_event_access dostaje tę samą efektywną rangę minimalną co
-- rsvp_event (visibility='members' podnosi próg do >=1), żeby oba RPC nie
-- rozjeżdżały się na wydarzeniach members z min_tier_rank=0, oraz
-- get_poll_results_bulk - zbiorcza wersja wyników ankiet dla listy /polls.
--
-- Wszystko idempotentne.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Helpery flag warstwy
-- ----------------------------------------------------------------------------

-- Flaga features bieżącego użytkownika (aktywna subskrypcja -> plan -> tier;
-- brak subskrypcji = tier domyślny tenanta, który flag nie ma).
CREATE OR REPLACE FUNCTION public.has_tier_feature(_feature text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT (t.features ->> _feature)::boolean
       FROM public.current_membership_tier() AS t
      LIMIT 1),
    false
  );
$$;

REVOKE EXECUTE ON FUNCTION public.has_tier_feature(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_tier_feature(text) TO anon, authenticated, service_role;

-- Flaga features DOWOLNEGO użytkownika - wewnętrzna (ordering Q&A liczy
-- priorytet autorów pytań). Nie wystawiana klientom.
CREATE OR REPLACE FUNCTION public.user_has_tier_feature(p_user uuid, _feature text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.user_subscriptions us
      JOIN public.access_plans ap
        ON ap.id = us.plan_id
      JOIN public.membership_tiers mt
        ON mt.tenant_id = ap.tenant_id
       AND mt.key = ap.tier_key
       AND mt.active
     WHERE us.user_id = p_user
       AND us.status = 'active'
       AND (us.current_period_end IS NULL OR us.current_period_end > now())
       AND (mt.features ->> _feature)::boolean IS TRUE
  );
$$;

REVOKE EXECUTE ON FUNCTION public.user_has_tier_feature(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_tier_feature(uuid, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 2) Wydarzenia: efektywny próg rangi + egzekwowanie pro_briefings
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rsvp_event(p_event_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_going integer;
  v_min_rank integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'events: authentication required';
  END IF;
  IF p_status NOT IN ('going', 'interested', 'cancelled') THEN
    RAISE EXCEPTION 'events: invalid status';
  END IF;

  -- FOR UPDATE serializuje równoległe RSVP - licznik miejsc nie może się
  -- ścigać (dwóch chętnych na ostatnie miejsce = jeden dostaje 'events: full').
  SELECT * INTO v_event
    FROM public.events
   WHERE id = p_event_id
     AND tenant_id = public.public_tenant_id()
     AND status = 'published'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'events: not found';
  END IF;

  IF v_event.visibility = 'members' THEN
    -- Briefing Pro: o wstępie decyduje flaga features, nie sam rank -
    -- benefity "pro_briefings" z cennika są egzekwowane, nie deklaratywne.
    IF v_event.kind = 'briefing' THEN
      IF NOT public.has_tier_feature('pro_briefings') THEN
        RAISE EXCEPTION 'events: membership required';
      END IF;
    ELSE
      v_min_rank := GREATEST(COALESCE(v_event.min_tier_rank, 0), 1);
      IF NOT public.has_tier_rank(v_min_rank) THEN
        RAISE EXCEPTION 'events: membership required';
      END IF;
    END IF;
  END IF;

  IF p_status = 'going' AND v_event.capacity IS NOT NULL THEN
    SELECT count(*) INTO v_going
      FROM public.event_rsvps
     WHERE event_id = p_event_id AND status = 'going' AND user_id <> v_user;
    IF v_going >= v_event.capacity THEN
      RAISE EXCEPTION 'events: full';
    END IF;
  END IF;

  INSERT INTO public.event_rsvps (tenant_id, event_id, user_id, status)
  VALUES (v_event.tenant_id, p_event_id, v_user, p_status)
  ON CONFLICT (event_id, user_id)
  DO UPDATE SET status = EXCLUDED.status, updated_at = now();

  SELECT count(*) INTO v_going
    FROM public.event_rsvps
   WHERE event_id = p_event_id AND status = 'going';

  RETURN jsonb_build_object('status', p_status, 'going', v_going);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rsvp_event(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rsvp_event(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_event_access(p_event_id uuid)
RETURNS TABLE (can_join boolean, join_url text, can_watch boolean, recording_url text, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_staff boolean := false;
  v_allowed boolean;
  v_rsvp text;
BEGIN
  SELECT * INTO v_event
    FROM public.events
   WHERE id = p_event_id AND tenant_id = public.public_tenant_id();
  IF NOT FOUND OR v_event.status <> 'published' THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'not_found';
    RETURN;
  END IF;

  IF v_user IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'auth_required';
    RETURN;
  END IF;

  v_staff := public.has_role(v_user, 'admin'::app_role)
          OR public.has_role(v_user, 'editor'::app_role);
  SELECT er.status INTO v_rsvp
    FROM public.event_rsvps er
   WHERE er.event_id = p_event_id AND er.user_id = v_user;

  -- Ta sama bramka co w rsvp_event: members-briefing wymaga flagi
  -- pro_briefings; pozostałe members - efektywnej rangi (min. 1).
  IF v_staff THEN
    v_allowed := true;
  ELSIF v_event.visibility = 'members' AND v_event.kind = 'briefing' THEN
    v_allowed := public.has_tier_feature('pro_briefings');
  ELSIF v_event.visibility = 'members' THEN
    v_allowed := public.has_tier_rank(GREATEST(COALESCE(v_event.min_tier_rank, 0), 1));
  ELSE
    v_allowed := public.has_tier_rank(COALESCE(v_event.min_tier_rank, 0));
  END IF;

  IF NOT v_allowed THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'tier_required';
    RETURN;
  END IF;

  RETURN QUERY SELECT
    (v_staff OR v_rsvp = 'going') AND v_event.join_url IS NOT NULL,
    CASE WHEN (v_staff OR v_rsvp = 'going') THEN v_event.join_url END,
    v_event.recording_url IS NOT NULL,
    v_event.recording_url,
    CASE WHEN v_rsvp = 'going' OR v_staff THEN 'ok' ELSE 'rsvp_required' END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_event_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_access(uuid) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3) Q&A: lista pytań z głosami i priorytetem Pro (qa_priority)
-- ----------------------------------------------------------------------------
-- Jedna ścieżka odczytu dla /qa/$slug: publiczne kolumny (bez user_id -
-- anonimowość Chatham House zostaje), licznik głosów i is_priority liczone
-- serwerowo. Porządek: priorytet Pro > liczba głosów > starszeństwo.
CREATE OR REPLACE FUNCTION public.list_qa_questions(p_session_id uuid)
RETURNS TABLE (
  id uuid,
  session_id uuid,
  author_display text,
  is_anonymous boolean,
  body text,
  status text,
  answer_body text,
  answered_at timestamptz,
  created_at timestamptz,
  votes bigint,
  is_priority boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    q.id,
    q.session_id,
    q.author_display,
    q.is_anonymous,
    q.body,
    q.status,
    q.answer_body,
    q.answered_at,
    q.created_at,
    COALESCE(v.votes, 0) AS votes,
    public.user_has_tier_feature(q.user_id, 'qa_priority') AS is_priority
  FROM public.qa_questions q
  LEFT JOIN LATERAL (
    SELECT count(*) AS votes
      FROM public.qa_question_votes qv
     WHERE qv.question_id = q.id
  ) v ON true
  WHERE q.session_id = p_session_id
    AND q.tenant_id = public.public_tenant_id()
    AND q.status IN ('approved', 'answered')
  ORDER BY
    public.user_has_tier_feature(q.user_id, 'qa_priority') DESC,
    COALESCE(v.votes, 0) DESC,
    q.created_at ASC
  LIMIT 500;
$$;

REVOKE EXECUTE ON FUNCTION public.list_qa_questions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_qa_questions(uuid) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) Ankiety: zbiorcze wyniki dla listy /polls
-- ----------------------------------------------------------------------------
-- Anti-anchoring per ankieta jak w get_poll_results (wyniki dopiero po
-- oddaniu głosu / zamknięciu / dla staffu) - jedna podróż zamiast N.
CREATE OR REPLACE FUNCTION public.get_poll_results_bulk(p_poll_ids uuid[])
RETURNS TABLE (poll_id uuid, result jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, public.get_poll_results(p.id)
    FROM public.polls p
   WHERE p.id = ANY (COALESCE(p_poll_ids, '{}'::uuid[]))
     AND p.tenant_id = public.public_tenant_id()
     AND p.status IN ('open', 'closed');
$$;

REVOKE EXECUTE ON FUNCTION public.get_poll_results_bulk(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_poll_results_bulk(uuid[]) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5) Zalążkowe polityki zapisu odchodzą - zapisy tylko przez RPC
-- ----------------------------------------------------------------------------
-- RSVP: rsvp_event (limit miejsc pod FOR UPDATE, bramka warstwy, poprawne
-- statusy going/interested/cancelled - zalążek pisał 'registered' wbrew
-- CHECK-owi utwardzonej tabeli).
DROP POLICY IF EXISTS "rsvps own insert" ON public.event_rsvps;
DROP POLICY IF EXISTS "rsvps own update" ON public.event_rsvps;
DROP POLICY IF EXISTS "rsvps own delete" ON public.event_rsvps;

-- Ankiety: vote_poll (walidacja opcji, okno czasowe, anti-anchoring).
DROP POLICY IF EXISTS "poll votes own insert" ON public.poll_votes;
DROP POLICY IF EXISTS "poll votes own update" ON public.poll_votes;
DROP POLICY IF EXISTS "poll votes own delete" ON public.poll_votes;

-- Q&A: ask_qa_question (rate limit 5/h, sanitizowany author_display -
-- zalążek wpisywał pełny e-mail, powiadomienie hosta).
DROP POLICY IF EXISTS "qa questions own insert" ON public.qa_questions;
-- Głosy Q&A: polityki z 20260713095000 ("qa votes own insert"/"own delete")
-- wymagają statusu approved/answered - zalążek "plus" pozwalał głosować na
-- pytania pending i duplikował politykę.
DROP POLICY IF EXISTS "qa votes own insert plus" ON public.qa_question_votes;

-- "qa questions own read pending" zostaje: autor widzi własne pytania
-- w kolejce moderacji (kolumny wrażliwe i tak ukrywa grant kolumnowy).

-- Zapisy bezpośrednie tracą też grant tabelowy tam, gdzie jedyną legalną
-- ścieżką jest RPC (INSERT przyznany w zalążkach; SELECT zostaje).
REVOKE INSERT, UPDATE, DELETE ON public.event_rsvps FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.poll_votes FROM authenticated;

-- ----------------------------------------------------------------------------
-- 5a) Polityka "Profiles anon public authors": EXISTS po user_roles nie działa
-- ----------------------------------------------------------------------------
-- Podzapytanie polityki wykonuje się z uprawnieniami i RLS WOŁAJĄCEGO, a
-- user_roles jest przed anonimem zarówno bez grantu SELECT, jak i schowane
-- politykami RLS - warunek EXISTS nigdy nie przechodzi, więc anonimowy odczyt
-- profilu redakcyjnego był martwy na bazie budowanej wyłącznie z migracji.
-- Sprawdzenie roli przechodzi przez helper SECURITY DEFINER, który ujawnia
-- wyłącznie fakt "ten użytkownik jest redakcyjny" (dokładnie to, co polityka
-- i tak semantycznie upublicznia), bez otwierania tabeli ról.
CREATE OR REPLACE FUNCTION public.user_is_editorial(p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
     WHERE ur.user_id = p_user
       AND ur.role IN ('admin'::app_role, 'editor'::app_role,
                       'author'::app_role, 'super_admin'::app_role)
  );
$$;

REVOKE ALL ON FUNCTION public.user_is_editorial(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_is_editorial(uuid) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Profiles anon public authors" ON public.profiles;
CREATE POLICY "Profiles anon public authors" ON public.profiles
  FOR SELECT TO anon
  USING (
    slug IS NOT NULL
    AND tenant_id = public.public_tenant_id()
    AND public.user_is_editorial(id)
  );

-- ----------------------------------------------------------------------------
-- 6) Kręgi: odblokowanie kind='group' + guard świadomy kręgów (fan-out N>2)
-- ----------------------------------------------------------------------------
-- Hardening czatu 1:1 (20260710094245) zawęził CHECK do kind='direct', a
-- migracja kręgów (20260713094000) tego nie cofnęła - create_group_conversation
-- wywalał się o constraint przy KAŻDEJ próbie utworzenia kręgu (wykryte przez
-- pgTAP na świeżej bazie). Przywracamy dwuwartościową domenę.
ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_kind_check;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_kind_check CHECK (kind IN ('direct', 'group'));

-- Dotychczasowy tg_messages_guard traktował KAŻDĄ konwersację jak 1:1: jeden
-- uczestnik z allow_messages_from='nobody' (tryb cichy) blokował wysyłkę
-- CAŁEMU kręgowi ('chat: recipient unavailable'). W grupie tryb cichy ma
-- wyciszać powiadomienia adresata, a nie knebluje pozostałych - zawężamy tę
-- bramkę do rozmów kind='direct'. Blokada pary zostaje w obu rodzajach
-- (osoby zablokowane nie wymieniają wiadomości także wewnątrz kręgu),
-- podobnie rate limit nadawcy.
CREATE OR REPLACE FUNCTION public.tg_messages_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_recent integer;
  v_kind text;
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

  SELECT c.kind INTO v_kind FROM public.conversations c WHERE c.id = NEW.conversation_id;

  -- Tryb cichy odbiorcy zatrzymuje wyłącznie rozmowy 1:1. Zawężone do
  -- uczestników tenanta wiadomości: niespójny legacy wiersz spoza tenanta
  -- nie może wyciszyć cudzego wątku.
  IF COALESCE(v_kind, 'direct') = 'direct' AND EXISTS (
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
