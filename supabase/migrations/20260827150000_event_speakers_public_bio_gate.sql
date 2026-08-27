-- ============================================================================
-- BRAMKA BIOGRAFII W `event_speakers_public`: PRZELACZNIK, KTORY OBIECYWAL
-- UKRYCIE, A ODSLANIAL DRUGIE ZRODLO TEGO SAMEGO FAKTU.
--
-- CO BYLO ZLE (P1, PRYWATNOSC - nie estetyka)
--
-- `20260826180000_event_speaker_person.sql` dolacza nakladke sceniczna
-- Z FILTREM na widocznosc (tamten plik, linia 903):
--     LEFT JOIN public.speaker_profiles sp
--       ON sp.id = b.speaker_profile_id AND sp.tenant_id = v_tenant AND sp.is_public
-- czyli przy `is_public = false` join NIE TRAFIA i cale `sp.*` jest NULL-em.
-- A biografia byla wybierana z fallbackiem na kartoteke osoby (tamten plik,
-- linie 878-879):
--     COALESCE(sp.bio_pl, pe.bio_pl) AS bio_pl,
--     COALESCE(sp.bio_en, pe.bio_en) AS bio_en,
--
-- Zlozenie tych dwoch linii daje zachowanie DOKLADNIE ODWROTNE do etykiety
-- w panelu. Wylaczenie „Pokaz opis sceniczny” ukrywalo biografie z NAKLADKI
-- i W TEJ SAMEJ CHWILI odslanialo biografie z KARTOTEKI `event_people` - a to
-- jest to samo pole tresci o tej samej osobie, tylko z drugiego rejestru.
-- Redaktor, ktory wpisal bio w popupie „Create manually” i zostawil suwak
-- wylaczony, publikowal ten tekst na otwartej stronie. Funkcja ma
-- `GRANT EXECUTE ... TO anon`, wiec czytal go kazdy niezalogowany gosc.
--
-- KOD PRZECZYL WLASNEMU UDOKUMENTOWANEMU KONTRAKTOWI. Naglowek tamtej samej
-- migracji (linie 773-776) mowi wprost, jaki kontrakt mial obowiazywac:
--   „`is_public` na nakladce dziala tak jak w `get_public_speakers`: ukrywa
--    OPIS SCENICZNY (headline/bio/tematy), a nie osobe. Nazwisko i zdjecie ida
--    bez warunku (…)”
-- Naglowek byl wiec poprawny, a implementacja - nie. To jest gorszy rodzaj
-- bledu niz brak dokumentacji: recenzent czytajacy naglowek dostawal
-- zapewnienie, ze pytanie zostalo rozstrzygniete.
--
-- CO ROBI TA MIGRACJA
--
-- Przepisuje CALE cialo `event_speakers_public` z jedna zmiana merytoryczna:
-- biografia (`bio_pl`, `bio_en`) wychodzi WYLACZNIE wtedy, gdy nakladka
-- sceniczna jest publiczna. Reszta ciala - UNION obu rejestrow, warunek
-- publikacji wydarzenia, izolacja najemcow, kolejnosc, limit - jest przeniesiona
-- BEZ ZMIAN, znak w znak.
--
-- DLACZEGO PRZEPISANIE CALEGO CIALA, A NIE JEDNEJ KOLUMNY. PostgreSQL nie ma
-- „ALTER FUNCTION ... SET COLUMN”: cialo funkcji jest jednym tekstem i jedyna
-- droga zmiany jednego wyrazenia SELECT jest `CREATE OR REPLACE` z pelnym
-- cialem. Zachowane sa DOKLADNIE: sygnatura `(jsonb)`, pelne `RETURNS TABLE`
-- (21 kolumn - zmiana ich liczby albo typu rusza `check:rpc-contract` i widget
-- buildera), `SECURITY DEFINER`, `SET search_path`, `REVOKE ALL … FROM PUBLIC`,
-- `GRANT EXECUTE … TO anon, authenticated, service_role` oraz komentarz.
--
-- DLACZEGO WARUNKIEM JEST `sp.id IS NOT NULL`, A NIE `sp.is_public`
--
-- Bo predykat `sp.is_public` STOI JUZ W WARUNKU JOIN-a. Nakladka niepubliczna
-- nie tworzy dopasowania, wiec `sp.id` jest NULL-em wtedy i tylko wtedy, gdy
-- nakladki nie ma ALBO jest niepubliczna - a to jest dokladnie zbior „opisu
-- scenicznego nie pokazujemy”. Powtorzenie `sp.is_public` w `CASE` bylo by
-- martwe (dla dopasowanego wiersza jest zawsze prawda) i mylace: sugerowalo by,
-- ze join przepuszcza tez nakladki niepubliczne.
--
-- CZEGO TA MIGRACJA NIE ROBI - I DLACZEGO (granice sa SWIADOME)
--
--   * NIE bramkuje `display_name` ani `avatar_url`. Kontrakt mowi „ukrywa opis
--     sceniczny, a NIE osobe”: o obecnosci na liscie decyduje WPIS do rejestru
--     prelegentow, ktory jest decyzja redakcji, a nie flaga nakladki. Prelegent
--     bez nazwiska nie jest karta - jest dziura w siatce.
--   * NIE bramkuje `job_title` ani `company`. Stanowisko i firma to
--     IDENTYFIKACJA osoby na liscie („kto to jest”), nie opis sceniczny
--     („o czym bedzie mowic”), i pochodza z tego samego zrodla, co nazwisko -
--     z kartoteki albo z publicznego profilu autora (`author_profiles.is_public`
--     ma wlasna bramke w swoim join-ie). To jest granica DO ZAKWESTIONOWANIA
--     przez wlasciciela produktu, a nie fakt techniczny: gdyby „opis sceniczny”
--     mial obejmowac afiliacje, zmiana jest jednolinijkowa i idzie tym samym
--     wzorcem `CASE WHEN sp.id IS NOT NULL`.
--   * NIE rusza `headline_pl/en`, `topics_pl/en`, `languages`, `talks_count`,
--     `rating`, `reviews_count`. Te kolumny czytaja WYLACZNIE `sp.*`, bez ani
--     jednego fallbacku na `pe.*`, wiec przy nietrafionym join-ie sa NULL-em
--     (albo `COALESCE(..., '{}')` / `0`) SAME Z SIEBIE. Dodanie im `CASE` nic
--     by nie zmienilo i sugerowaloby, ze bez niego wyciekaly.
--   * NIE wystawia `event_people.email` ani `.phone`. Tych kolumn NIE MA
--     w `RETURNS TABLE` i ta migracja ich tam nie dodaje - kontakt do osoby bez
--     konta nie ma na plaszczyznie tresci zadnego konsumenta.
--   * NIE wprowadza `has_role()`. To jest plaszczyzna TRESCI: najemca idzie
--     z `public_tenant_id()`, tak jak w wersji poprzedniej
--     (bramka `check:sql-tenant-scope`).
--
-- events-harness: include
-- Uzasadnienie znacznika: ta migracja nie zawiera ani `public.admin_event_`,
-- ani `events_tenant_id_key`, wiec selektor po tresci w
-- `scripts/events-harness/run.sh` by jej NIE zlapal - a bez niej replay
-- harnessu stawialby STARA, przeciekajaca wersje funkcji i asercje bramki
-- bio (`runtime_test.d/97_speaker_bio_gate.sql`) mierzylyby kod, ktorego nie
-- ma na produkcji.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_speakers_public(p_payload jsonb)
RETURNS TABLE (
  speaker_profile_id uuid,
  user_id uuid,
  person_id uuid,
  slug text,
  display_name text,
  avatar_url text,
  job_title text,
  company text,
  headline_pl text,
  headline_en text,
  bio_pl text,
  bio_en text,
  topics_pl text[],
  topics_en text[],
  languages text[],
  talks_count integer,
  rating numeric,
  reviews_count integer,
  is_expert boolean,
  has_speaker_profile boolean,
  sort_order integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant   uuid := public.public_tenant_id();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_slug     text := NULLIF(btrim(p_payload->>'slug'), '');
  v_limit    integer := LEAST(GREATEST(COALESCE((p_payload->>'limit')::integer, 100), 1), 200);
BEGIN
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  -- Wydarzenie rozwiazujemy po id ALBO po slugu - front strony publicznej ma
  -- slug w adresie, a widget buildera ma id.
  SELECT e.id INTO v_event_id
    FROM public.events e
   WHERE e.tenant_id = v_tenant
     AND e.status = 'published'
     AND (
       (v_event_id IS NOT NULL AND e.id = v_event_id)
       OR (v_event_id IS NULL AND v_slug IS NOT NULL AND e.slug = v_slug)
     );

  IF v_event_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      sp.id AS speaker_profile_id,
      sp.user_id,
      sp.person_id,
      en.sort_order
    FROM public.event_speaker_entries en
    JOIN public.speaker_profiles sp
      ON sp.id = en.speaker_profile_id AND sp.tenant_id = en.tenant_id
    WHERE en.tenant_id = v_tenant
      AND en.event_id = v_event_id
    UNION ALL
    -- Legacy `event_speakers`: bez tego czlonu publikacja nowej funkcji
    -- skasowala by z froncie wszystkich dotychczasowych prelegentow.
    SELECT
      sp.id AS speaker_profile_id,
      es.user_id,
      NULL::uuid AS person_id,
      es.sort_order
    FROM public.event_speakers es
    LEFT JOIN public.speaker_profiles sp
      ON sp.user_id = es.user_id AND sp.tenant_id = v_tenant
    WHERE es.event_id = v_event_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.event_speaker_entries en2
        JOIN public.speaker_profiles sp2
          ON sp2.id = en2.speaker_profile_id AND sp2.tenant_id = en2.tenant_id
        WHERE en2.tenant_id = v_tenant
          AND en2.event_id = v_event_id
          AND sp2.user_id = es.user_id
      )
  )
  SELECT
    b.speaker_profile_id,
    b.user_id,
    b.person_id,
    p.slug,
    COALESCE(
      p.display_name,
      NULLIF(btrim(COALESCE(pe.first_name, '') || ' ' || COALESCE(pe.last_name, '')), '')
    ) AS display_name,
    COALESCE(ap.avatar_url, p.avatar_url, pe.photo_url) AS avatar_url,
    COALESCE(ap.job_title, pe.job_title) AS job_title,
    COALESCE(ap.company, pe.company_text) AS company,
    sp.headline_pl,
    sp.headline_en,
    -- BRAMKA BIOGRAFII - jedyna zmiana merytoryczna tej migracji.
    --
    -- Join wyzej ma `AND sp.is_public`, wiec `sp.id IS NOT NULL` znaczy DOKLADNIE
    -- „nakladka sceniczna tej osoby istnieje I jest publiczna”. Bez tego `CASE`
    -- `COALESCE` schodzil na `pe.bio_pl` wlasnie w chwili, gdy redaktor
    -- WYLACZYL pokazywanie opisu - czyli przelacznik odslanial tekst, ktorego
    -- ukrycie obiecywal.
    --
    -- `CASE` bez `ELSE` daje NULL, a nie pusty napis: front rozroznia „brak
    -- biografii” od „biografia jest pusta” i przy NULL-u nie rysuje sekcji.
    CASE WHEN sp.id IS NOT NULL THEN COALESCE(sp.bio_pl, pe.bio_pl) END AS bio_pl,
    CASE WHEN sp.id IS NOT NULL THEN COALESCE(sp.bio_en, pe.bio_en) END AS bio_en,
    COALESCE(sp.topics_pl, '{}') AS topics_pl,
    COALESCE(sp.topics_en, '{}') AS topics_en,
    COALESCE(sp.languages, '{}') AS languages,
    COALESCE(sp.talks_count, 0) AS talks_count,
    COALESCE(sp.rating, 0) AS rating,
    COALESCE(sp.reviews_count, 0) AS reviews_count,
    EXISTS (
      SELECT 1 FROM public.profile_badges pb
       WHERE pb.user_id = b.user_id
         AND pb.badge = 'expert'
         AND pb.tenant_id = v_tenant
    ) AS is_expert,
    (b.speaker_profile_id IS NOT NULL) AS has_speaker_profile,
    b.sort_order
  FROM base b
  -- IZOLACJA: `event_speakers` nie ma `tenant_id`, wiec bez przypiecia
  -- `profiles.tenant_id` wpis wskazujacy konto obcego najemcy wyciekal by jego
  -- nazwe i awatar na naszej domenie (ten sam predykat co w get_public_speakers).
  LEFT JOIN public.profiles p
    ON p.id = b.user_id AND p.tenant_id = v_tenant
  LEFT JOIN public.event_people pe
    ON pe.id = b.person_id AND pe.tenant_id = v_tenant
  LEFT JOIN public.speaker_profiles sp
    ON sp.id = b.speaker_profile_id AND sp.tenant_id = v_tenant AND sp.is_public
  LEFT JOIN public.author_profiles ap
    ON ap.user_id = b.user_id AND ap.tenant_id = v_tenant AND ap.is_public
  -- Wiersz bez ZADNEGO zrodla tozsamosci (osierocony rzad legacy albo konto
  -- obcego najemcy) nie jest karta z pustym nazwiskiem - nie jest karta w ogole.
  WHERE p.id IS NOT NULL OR pe.id IS NOT NULL
  ORDER BY b.sort_order, lower(COALESCE(p.display_name, pe.last_name, ''))
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.event_speakers_public(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_speakers_public(jsonb)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_speakers_public(jsonb) IS
  'Publiczna lista prelegentow OPUBLIKOWANEGO wydarzenia (payload: event_id albo slug, opcjonalnie limit). UNION event_speaker_entries + legacy event_speakers, LEFT JOIN profiles - osoba BEZ konta bierze nazwisko, zdjecie, stanowisko i firme z kartoteki event_people. BRAMKA BIOGRAFII: bio_pl/bio_en wychodza WYLACZNIE przy PUBLICZNEJ nakladce scenicznej (speaker_profiles.is_public) - przy wylaczonym „Pokaz opis sceniczny" funkcja nie oddaje ani bio z nakladki, ani bio z kartoteki; nazwisko, zdjecie, stanowisko i firma ida bez warunku, bo flaga ukrywa OPIS, a nie osobe. Plaszczyzna tresci: public_tenant_id(), zero has_role().';
