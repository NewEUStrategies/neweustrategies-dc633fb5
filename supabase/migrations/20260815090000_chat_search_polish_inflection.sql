-- ============================================================================
-- FTS CZATU: SŁOWNIK Z FLEKSJĄ ZAMIAST GOŁEGO `simple`
--
-- CO BYŁO ZEPSUTE (siódme wydanie audytu, OCENA_FUNKCJI_TABELE §MODUŁ 9)
-- `20260720160000_chat_message_search.sql` deklaruje w nagłówku, że korzysta
-- z infrastruktury FTS platformy „z polską fleksją", po czym buduje wektor
-- i podświetlenie w konfiguracji `simple`, czyli DOKŁADNIE bez fleksji.
-- Skutek dla użytkownika: „polityki" nie znajdowało „polityka", „umowę" nie
-- znajdowało „umowa" - a komentarz twierdził, że znajduje. To gorsze niż brak
-- funkcji, bo czytający kod nie ma powodu jej sprawdzać.
--
-- Rozstrzygnięcie NIE jest nowe - moduł Discussion Club wprowadził
-- `public.nes_polish` (20260807154127) i nazwał ten dług wprost:
-- „FTS w konfiguracji public.nes_polish … - nie powielamy dlugu czatu"
-- (20260808093000:168). Ta migracja spłaca ten dług w czacie.
--
-- CO ROBI TA MIGRACJA
--   1. `public.nes_polish_tsquery(_q)` - zapytanie w TEJ SAMEJ konfiguracji,
--      w której stoi wektor, z prefiksem na każdym wyrazie (search-as-you-type).
--   2. `messages.search_vector` przebudowany na `public.nes_polish`
--      (trigger + PEŁNY backfill, nie tylko wierszy NULL - stare wiersze mają
--      lematy z `simple` i bez przeliczenia byłyby niewyszukiwalne nową drogą).
--   3. `search_messages` czyta nowym zapytaniem i podświetla w tej samej
--      konfiguracji - warunki RLS, tombstone'y i limity BEZ ZMIAN.
--
-- DLACZEGO WŁASNY BUDOWNICZY ZAPYTANIA, A NIE `websearch_to_tsquery`
-- Klub używa `websearch_to_tsquery`, bo szuka się tam w archiwum wątków -
-- pełnymi słowami, z frazami w cudzysłowie. Czat jest szukaniem W TRAKCIE
-- PISANIA: pole filtruje listę po każdym znaku. `websearch_to_tsquery` nie robi
-- prefiksów, więc wpisane „poli" nie trafiłoby w NIC, dopóki użytkownik nie
-- dokończy słowa - a to jest cała funkcja tej wyszukiwarki. Dlatego zapytanie
-- powstaje z lematów (`to_tsvector` w tej samej konfiguracji, co wektor)
-- z doklejonym `:*`.
--
-- SYMETRIA JEST WARUNKIEM POPRAWNOŚCI, nie ozdobą. Gdyby wektor stemował
-- („polityka" -> `polityk`), a zapytanie nie („polityki" -> `polityki:*`),
-- prefiks NIE trafiłby w krótszy lemat i wyszukiwarka byłaby GORSZA niż na
-- `simple`. Obie strony idą więc przez `public.nes_polish`.
--
-- ZACHOWANIE PRZY BRAKU SŁOWNIKA. `public.nes_polish` kopiuje `polish`, jeśli
-- serwer go ma, a w przeciwnym razie `simple` (w obu przypadkach z `unaccent`).
-- Na hostingu bez słownika ispell zachowanie jest więc identyczne z dzisiejszym
-- - z prefiksami, które i tak zdejmowały część fleksji. Migracja nie może
-- „zepsuć" wyszukiwarki tam, gdzie słownika nie ma; tam, gdzie jest, zaczyna
-- działać to, co komentarz obiecywał od 20.07.
-- ============================================================================

-- 0. Konfiguracja musi istnieć, zanim się na niej oprzemy -------------------
-- Tworzą ją migracje modułu klubów (20260807154127, 20260808093000). Baza
-- odtwarzana od zera przechodzi je wcześniej, więc to wyłącznie asercja
-- kolejności - fail-fast z czytelnym komunikatem zamiast błędu 42704
-- ("text search configuration does not exist") w środku przebudowy indeksu.
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_ts_config
     WHERE cfgname = 'nes_polish' AND cfgnamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION
      'Brak konfiguracji public.nes_polish - uruchom najpierw migracje modulu klubow (20260807154127).';
  END IF;
END
$guard$;

-- 1. Budowniczy zapytania w konfiguracji wektora ----------------------------
CREATE OR REPLACE FUNCTION public.nes_polish_tsquery(_q text)
RETURNS tsquery
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_terms text;
BEGIN
  -- Każdy wyraz wejścia przechodzi przez TĘ SAMĄ konfigurację, co wektor, więc
  -- dostajemy lemat, nie surowy tekst. `:*` na lemacie daje wyszukiwanie
  -- w trakcie pisania; `&` między wyrazami zawęża (kolejny znak zawsze zwęża
  -- wynik, nigdy go nie rozszerza - to jedyne zachowanie, które w polu
  -- filtrującym listę nie zaskakuje).
  SELECT string_agg(quote_literal(t.lexeme) || ':*', ' & ' ORDER BY t.lexeme)
    INTO v_terms
    FROM unnest(to_tsvector('public.nes_polish', btrim(coalesce(_q, '')))) AS t
   WHERE t.lexeme <> '';

  IF v_terms IS NULL OR v_terms = '' THEN
    RETURN NULL;
  END IF;

  RETURN to_tsquery('public.nes_polish', v_terms);
EXCEPTION WHEN others THEN
  -- Awaryjnie: wyszukiwarka nie wywraca się na egzotycznym wejściu. Ta sama
  -- zasada, co w `nes_search_tsquery` - bez prefiksów, ale z wynikiem.
  RETURN plainto_tsquery('public.nes_polish', coalesce(_q, ''));
END;
$$;

COMMENT ON FUNCTION public.nes_polish_tsquery(text) IS
  'Zapytanie FTS w konfiguracji public.nes_polish z prefiksem na kazdym lemacie (search-as-you-type). Symetryczne wzgledem wektorow budowanych ta sama konfiguracja - patrz 20260815090000.';

REVOKE EXECUTE ON FUNCTION public.nes_polish_tsquery(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nes_polish_tsquery(text) TO anon, authenticated, service_role;

-- 2. Wektor wiadomości w konfiguracji z fleksją -----------------------------
CREATE OR REPLACE FUNCTION public.nes_messages_search_vector()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  -- Tombstone (cofnięcie wysłania) zeruje body -> wektor też się zeruje,
  -- więc usunięta treść znika z indeksu bez osobnego sprzątania.
  -- `unaccent` jest już w mapowaniu `public.nes_polish`, więc drugie wywołanie
  -- byłoby nie tylko zbędne, ale i szkodliwe: zdejmowałoby znaki diakrytyczne
  -- PRZED stemmerem, któremu są potrzebne do rozpoznania formy.
  NEW.search_vector :=
    setweight(to_tsvector('public.nes_polish', coalesce(NEW.body, '')), 'A') ||
    setweight(to_tsvector('public.nes_polish', coalesce(NEW.attachment_name, '')), 'B');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_search_vector ON public.messages;
CREATE TRIGGER trg_messages_search_vector
  BEFORE INSERT OR UPDATE OF body, attachment_name ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.nes_messages_search_vector();

-- Backfill PEŁNY, nie tylko `search_vector IS NULL`. Wiersze zapisane od
-- 20.07 mają lematy z `simple`; nieprzeliczone byłyby niewyszukiwalne
-- zapytaniem z nowej konfiguracji - czyli cała historia rozmów zniknęłaby
-- z wyszukiwarki w chwili wdrożenia. Backfill zapisem do kolumny (a nie przez
-- trigger) jest tu tańszy o jedno wywołanie funkcji na wiersz.
UPDATE public.messages
   SET search_vector =
         setweight(to_tsvector('public.nes_polish', coalesce(body, '')), 'A') ||
         setweight(to_tsvector('public.nes_polish', coalesce(attachment_name, '')), 'B')
 WHERE body IS NOT NULL OR attachment_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS messages_search_vector_gin
  ON public.messages USING gin (search_vector);

-- 3. RPC: zapytanie i podświetlenie w tej samej konfiguracji ----------------
-- Ciało jest kopią definicji z 20260720215250 z trzema zmianami:
--   * `nes_search_tsquery` -> `nes_polish_tsquery`,
--   * `ts_headline('simple', …)` -> `ts_headline('public.nes_polish', …)`,
--   * kursor porządkujący bez zmian.
-- Warunki bezpieczeństwa (lustro `messages_member_select`: tenant, członkostwo,
-- `expires_at`, `cleared_before`, wykluczenie tombstone'ów) przepisane CO DO
-- ZNAKU - to jest jedyny powód, dla którego ta funkcja jest SECURITY DEFINER,
-- więc każda ich zmiana musi być zamierzona, a nie skutkiem ubocznym refaktoru
-- wyszukiwarki.
CREATE OR REPLACE FUNCTION public.search_messages(
  _q text, _conversation_id uuid DEFAULT NULL,
  _limit integer DEFAULT 30, _offset integer DEFAULT 0
) RETURNS TABLE (
  id uuid, conversation_id uuid, sender_id uuid, kind text,
  snippet text, created_at timestamptz, rank real, total_count bigint
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  WITH tq AS (SELECT public.nes_polish_tsquery(_q) AS q),
  hits AS (
    SELECT m.id, m.conversation_id, m.sender_id, m.kind, m.body,
           m.attachment_name, m.created_at,
           ts_rank_cd(m.search_vector, tq.q)::real AS rank
      FROM public.messages m
      JOIN public.conversation_participants cp
        ON cp.conversation_id = m.conversation_id AND cp.user_id = auth.uid()
      CROSS JOIN tq
     WHERE auth.uid() IS NOT NULL AND tq.q IS NOT NULL
       AND m.search_vector @@ tq.q
       AND m.tenant_id = (SELECT public.current_tenant_id())
       AND m.deleted_at IS NULL
       AND (m.expires_at IS NULL OR m.expires_at > now())
       AND m.created_at >= coalesce(cp.cleared_before, '-infinity'::timestamptz)
       AND (_conversation_id IS NULL OR m.conversation_id = _conversation_id)
  )
  SELECT h.id, h.conversation_id, h.sender_id, h.kind,
         ts_headline('public.nes_polish', left(coalesce(h.body, h.attachment_name, ''), 1000), tq.q,
           'StartSel=[[[, StopSel=]]], MaxWords=18, MinWords=8, ShortWord=2, MaxFragments=1') AS snippet,
         h.created_at, h.rank, (count(*) OVER ())::bigint AS total_count
    FROM hits h CROSS JOIN tq
   ORDER BY h.created_at DESC, h.id DESC
   LIMIT GREATEST(LEAST(coalesce(_limit, 30), 100), 1)
  OFFSET GREATEST(coalesce(_offset, 0), 0);
$$;

COMMENT ON FUNCTION public.search_messages(text, uuid, integer, integer) IS
  'Wyszukiwanie w tresci rozmow. Wektor, zapytanie i podswietlenie w jednej konfiguracji public.nes_polish (fleksja tam, gdzie serwer ma slownik; simple + unaccent tam, gdzie nie ma). SECURITY DEFINER z jawnie powtorzonymi warunkami messages_member_select + wykluczeniem tombstoneow.';

REVOKE EXECUTE ON FUNCTION public.search_messages(text, uuid, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_messages(text, uuid, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_messages(text, uuid, integer, integer) TO authenticated, service_role;
