-- ============================================================================
-- §8 - WYSZUKIWARKA ODBIORCÓW CZATU: ESCAPOWANIE WZORCA + INDEKSOWALNE
--      DOPASOWANIE (koniec z siedmioma surowymi ILIKE).
--
-- STAN ZASTANY (20260801124000). `search_chat_contacts` sklejała frazę wprost
-- w SIEDEM osobnych predykatów:
--
--     p.display_name ILIKE '%' || p_query || '%' OR p.first_name ILIKE ... (×7)
--
-- Dwie wady, obie realne:
--
--  1. BRAK ESCAPOWANIA. `%`, `_` i `\` z pola wyszukiwarki trafiały do wzorca
--     jako METAZNAKI, nie jako tekst. Fraza „100%" pasowała do KAŻDEGO wiersza
--     (bo `%…%` z gołym `%` w środku to wzorzec „cokolwiek"), a „a_b" łapało
--     „aXb". Użytkownik nie mógł wpisać nazwy firmy z podkreśleniem ani
--     stanowiska z procentem i dostać sensownej odpowiedzi - dostawał albo
--     wszystko, albo nie to. Ta sama klasa wady była już naprawiona w
--     `search_people` (20260711100000), ale RPC czatu powstało miesiąc później
--     i skopiowało STARY wzorzec.
--
--  2. BRAK INDEKSU. Siedem `ILIKE '%…%'` na kolumnach bazowych to siedem
--     skanów sekwencyjnych na `profiles` per naciśnięcie klawisza (zapytanie
--     leci z każdą zmianą frazy w `NewChatSearch`). Żaden indeks tego nie
--     obsłuży: `ILIKE` z wiodącym `%` nie użyje b-drzewa, a indeksu
--     trigramowego na tych kolumnach nie ma.
--
-- ROZSTRZYGNIĘCIE. Czat przechodzi na TĘ SAMĄ ścieżkę co katalog osób:
-- kolumnę `profiles.discovery_search` (unaccent + lower + `concat_ws` z tych
-- samych siedmiu pól, utrzymywana triggerem `profiles_discovery_search_trg`)
-- pokrytą częściowym indeksem GIN `profiles_discovery_trgm_idx`
-- (`gin_trgm_ops … WHERE discoverable`). Jedno dopasowanie `LIKE` zamiast
-- siedmiu `ILIKE`, wzorzec escapowany, indeks używany.
--
-- Efekt uboczny, którego nie było: diakrytyki przestają mieć znaczenie -
-- „Zolw" znajdzie „Żółw", bo obie strony przechodzą przez `unaccent`. Do tej
-- pory katalog osób to potrafił, a wyszukiwarka odbiorców czatu nie.
--
-- MIĘDZYMODUŁOWOŚĆ. Normalizacja i escapowanie przestają być skopiowanym
-- wyrażeniem i stają się dwiema funkcjami (`discovery_search_norm`,
-- `like_escape`), z których czyta czat, katalog osób i każdy przyszły
-- konsument `discovery_search`. Rozjazd „jedna wyszukiwarka escapuje, druga
-- nie" nie może się powtórzyć, bo nie ma już dwóch miejsc do rozjechania -
-- `search_people` jest tu przedefiniowana na te same prymitywy.
--
-- PRZY OKAZJI: KOLUMNA `verified`. Typ klienta `PersonHit` (lib/chat/types.ts)
-- wyprowadza kształt z `search_people`, więc od 20260801162647 OCZEKUJE pola
-- `verified` - a `search_chat_contacts` go nie zwracało. Różnicę zasłaniał cast
-- `as PersonHit[]` w `usePeopleSearch`: TypeScript milczał, a wyszukiwarka
-- odbiorców czatu jako jedyna lista osób w produkcie nie mogła pokazać odznaki
-- weryfikacji. Zestaw kolumn obu RPC jest teraz identyczny (stąd DROP przed
-- CREATE - zmiana listy parametrów OUT), a cast znika.
-- ============================================================================

-- ── 1) Wspólne prymitywy wzorca -------------------------------------------

-- STABLE, nie IMMUTABLE: `unaccent(text)` zależy od domyślnego słownika, więc
-- nie wolno jej zamrażać w indeksie. Do indeksu i tak nie trafia - kolumna
-- `discovery_search` jest materializowana triggerem.
CREATE OR REPLACE FUNCTION public.discovery_search_norm(_q text)
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path TO 'public', 'extensions'
AS $$
  SELECT unaccent(lower(btrim(COALESCE(_q, ''))))
$$;
COMMENT ON FUNCTION public.discovery_search_norm(text) IS
  'Normalizuje frazę do postaci kolumny profiles.discovery_search (btrim -> lower -> unaccent). Jedyne źródło prawdy dla wyszukiwarki osób i wyszukiwarki odbiorców czatu.';

-- Escapowanie metaznaków LIKE. Kolejność ma znaczenie: najpierw backslash,
-- inaczej podwoiłby escape wstawiony chwilę później dla `%`/`_`.
CREATE OR REPLACE FUNCTION public.like_escape(_s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'pg_catalog'
AS $$
  SELECT replace(replace(replace(COALESCE(_s, ''), '\', '\\'), '%', '\%'), '_', '\_')
$$;
COMMENT ON FUNCTION public.like_escape(text) IS
  'Zamienia %, _ i \ we frazie użytkownika na literały wzorca LIKE. Bez tego fraza „100%” pasuje do każdego wiersza, a „a_b” do „aXb”.';

REVOKE ALL ON FUNCTION public.discovery_search_norm(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.like_escape(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.discovery_search_norm(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.like_escape(text) TO anon, authenticated, service_role;

-- ── 2) Indeks pod dopasowanie ---------------------------------------------

-- Indeks istnieje od 20260711100000; powtarzamy go idempotentnie, bo od tej
-- migracji zależy od niego DRUGI konsument (czat), a nie tylko katalog osób.
-- Warunek częściowy pokrywa się z predykatem obu zapytań (`discoverable`).
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS profiles_discovery_trgm_idx
  ON public.profiles USING gin (discovery_search extensions.gin_trgm_ops)
  WHERE discoverable;

-- Lista bez frazy (pusty input = przegląd kontaktów) sortuje po nazwie
-- w obrębie tenanta - b-drzewo zdejmuje z tej ścieżki sortowanie.
CREATE INDEX IF NOT EXISTS profiles_tenant_discoverable_name_idx
  ON public.profiles (tenant_id, lower(display_name))
  WHERE discoverable;

-- ── 3) RPC ------------------------------------------------------------------

-- Zmiana listy parametrów OUT (dochodzi `verified`) wymaga DROP - PostgreSQL
-- nie pozwala jej podmienić przez CREATE OR REPLACE.
DROP FUNCTION IF EXISTS public.search_chat_contacts(text, integer);

CREATE FUNCTION public.search_chat_contacts(
  p_query text DEFAULT NULL::text,
  p_limit integer DEFAULT 24
)
RETURNS TABLE(
  id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  current_company text,
  specialization text,
  location text,
  slug text,
  verified boolean,
  total_count bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  WITH me AS (
    SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()
  ),
  is_admin AS (
    SELECT public.is_super_admin(auth.uid()) AS ok
  ),
  q AS (
    SELECT
      n.raw,
      public.like_escape(n.raw) AS esc
    FROM (SELECT public.discovery_search_norm(p_query) AS raw) n
  ),
  base AS (
    SELECT
      p.id,
      COALESCE(
        NULLIF(btrim(p.display_name), ''),
        NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
        'User'
      ) AS display_name,
      p.avatar_url,
      p.job_title,
      p.current_company,
      p.specialization,
      p.location,
      p.slug,
      (p.verified_at IS NOT NULL) AS verified,
      p.discovery_search
    FROM public.profiles p, me, is_admin, q
    WHERE auth.uid() IS NOT NULL
      AND p.discoverable
      AND p.tenant_id = me.tenant_id
      AND p.id <> auth.uid()
      -- Ta sama semantyka co przed zmianą: super_admin widzi wszystkich,
      -- pozostali wyłącznie zaakceptowane kontakty (dokładnie ten zbiór,
      -- któremu get_or_create_direct_conversation pozwoli napisać).
      AND (is_admin.ok OR public.is_connected_pair(auth.uid(), p.id))
      -- JEDNO indeksowalne dopasowanie zamiast siedmiu ILIKE. Fraza pusta =
      -- przegląd listy (bez dopasowania), więc indeks trigramowy nie jest
      -- wtedy w ogóle potrzebny.
      AND (q.raw = '' OR p.discovery_search LIKE '%' || q.esc || '%')
  ),
  counted AS (SELECT count(*) AS c FROM base)
  SELECT
    b.id,
    b.display_name,
    b.avatar_url,
    b.job_title,
    b.current_company,
    b.specialization,
    b.location,
    b.slug,
    b.verified,
    (SELECT c FROM counted) AS total_count
  FROM base b, q
  ORDER BY
    -- Trafienie od początku frazy przed trafieniem w środku ("Kowal" ->
    -- „Kowalski" przed „Jan Kowalczyk-Nowak"), potem podobieństwo trigramowe,
    -- na końcu alfabet - identycznie jak w katalogu osób (search_people).
    (q.raw <> '' AND b.discovery_search LIKE q.esc || '%') DESC,
    CASE WHEN q.raw <> '' THEN similarity(b.discovery_search, q.raw) ELSE 0 END DESC,
    lower(b.display_name) ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 100);
$$;

COMMENT ON FUNCTION public.search_chat_contacts(text, integer) IS
  'Wyszukiwarka ODBIORCÓW czatu: discoverable + ten sam tenant + zaakceptowane połączenie (super_admin widzi wszystkich). Dopasowanie po profiles.discovery_search (indeks GIN pg_trgm), fraza escapowana przez like_escape - %, _ i \ są tekstem, nie wzorcem.';

-- Czat wymaga zalogowania; anon nie ma czego szukać wśród kontaktów.
REVOKE ALL ON FUNCTION public.search_chat_contacts(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_chat_contacts(text, integer) TO authenticated, service_role;

-- ── 4) Katalog osób na tych samych prymitywach ------------------------------
--
-- Ciało jak w 20260801162647; ZMIANA WYŁĄCZNIE w budowie frazy: wklejone
-- `unaccent(lower(btrim(...)))` i potrójny `replace` ustępują dwóm funkcjom,
-- z których czyta też czat. Od teraz „escapujemy w jednym miejscu" jest
-- własnością kodu, a nie obietnicą w komentarzu.

CREATE OR REPLACE FUNCTION public.search_people(
  p_query text DEFAULT '',
  p_specialization text DEFAULT NULL,
  p_company text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_job_title text DEFAULT NULL,
  p_verified_only boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  current_company text,
  specialization text,
  location text,
  slug text,
  verified boolean,
  total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH q AS (
    SELECT n.raw, public.like_escape(n.raw) AS esc
    FROM (SELECT public.discovery_search_norm(p_query) AS raw) n
  )
  SELECT
    p.id,
    COALESCE(
      NULLIF(btrim(p.display_name), ''),
      NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
      'User'
    ) AS display_name,
    p.avatar_url,
    p.job_title,
    p.current_company,
    p.specialization,
    p.location,
    p.slug,
    (p.verified_at IS NOT NULL) AS verified,
    count(*) OVER () AS total_count
  FROM public.profiles p, q
  WHERE auth.uid() IS NOT NULL
    AND p.discoverable
    AND p.id <> auth.uid()
    AND p.tenant_id = (SELECT pr.tenant_id FROM public.profiles pr WHERE pr.id = auth.uid())
    AND (q.raw = '' OR p.discovery_search LIKE '%' || q.esc || '%')
    AND (COALESCE(btrim(p_specialization), '') = ''
         OR lower(btrim(p.specialization)) = lower(btrim(p_specialization)))
    AND (COALESCE(btrim(p_company), '') = ''
         OR lower(btrim(p.current_company)) = lower(btrim(p_company)))
    AND (COALESCE(btrim(p_location), '') = ''
         OR lower(btrim(p.location)) = lower(btrim(p_location)))
    AND (COALESCE(btrim(p_job_title), '') = ''
         OR lower(btrim(p.job_title)) = lower(btrim(p_job_title)))
    AND (NOT COALESCE(p_verified_only, false) OR p.verified_at IS NOT NULL)
  ORDER BY
    (q.raw <> '' AND p.discovery_search LIKE q.esc || '%') DESC,
    CASE WHEN q.raw <> '' THEN similarity(p.discovery_search, q.raw) ELSE 0 END DESC,
    lower(COALESCE(
      NULLIF(btrim(p.display_name), ''),
      concat_ws(' ', p.first_name, p.last_name)
    )) ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

REVOKE ALL ON FUNCTION public.search_people(text, text, text, text, integer, integer, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_people(text, text, text, text, integer, integer, text, boolean)
  TO authenticated, service_role;
