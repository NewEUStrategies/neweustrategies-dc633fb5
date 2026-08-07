-- ============================================================================
-- LUKA #1: pgvector JEST WDROŻONY, ALE TYLKO DLA WPISÓW.
--
-- Stan przed: 768 wymiarów, indeks HNSW, kolejka indeksera w aplikacji
-- (jobs-tick -> embeddings.server.ts), server fn zapytania - cała
-- infrastruktura z 20260720190000 obsługuje JEDNĄ tabelę: post_embeddings.
-- Profile nie mają wektorów, więc "kto zna się na CBAM i pracował w Brukseli"
-- trafia w dopasowanie trigramów: LIKE '%cbam%' na discovery_search znajdzie
-- dokładnie te profile, które mają w tekście literalnie "cbam", i ani jednego,
-- który pisze o "granicznym podatku węglowym". Infrastruktura była już
-- opłacona; brakowało powielenia wzorca na drugą tabelę.
--
-- KOLEJNOŚĆ MA ZNACZENIE: ta migracja jest CZWARTA, po intencji (#4) i po
-- alertach (#3), bo wektor policzony z pustego profilu jest bezwartościowy -
-- opisuje szum, nie osobę. Dlatego kolejka indeksera ma twardą bramkę
-- `completeness_score >= MIN`: profil bez bio i bez intencji nie dostaje
-- wektora, a więc nie zaśmieca sąsiedztwa kosinusowego.
--
-- Zakres (1:1 wzorzec warstwy semantycznej wpisów):
--   1. profile_embeddings: jeden wektor per profil, vector(768) (wspólny
--      mianownik text-embedding-3-small z dimensions=768 i Gemini
--      text-embedding-004), indeks HNSW + indeks tenanta.
--   2. nes_profile_embedding_source: JEDNA definicja tekstu źródłowego -
--      używa jej kolejka indeksera i porównanie świeżości (md5). Tekst zbiera
--      to, co REALNIE opisuje kompetencję: stanowisko, firmę, specjalizację,
--      lokalizację, oba bio, intencję (czego szukam / co oferuję, PL+EN) oraz
--      umiejętności i role z historii zawodowej.
--   3. profiles_needing_embeddings: kolejka dla service_role.
--   4. semantic_search_profiles: podobieństwo kosinusowe w tenancie
--      WOŁAJĄCEGO (katalog jest członkowski - nigdy public_tenant_id()).
--   5. search_people v3: `p_open_to` (faseta intencji) + `p_embedding`
--      (blend semantyczny) + projekcja intencji i kompletności.
--      Blend liczy BAZA, nie klient: inaczej stronicowanie offsetowe
--      sortowałoby każdą stronę osobno i wyniki skakałyby przy "Pokaż więcej".
--      Brak wektora zapytania = zachowanie dokładnie jak dotychczas
--      (degradacja do czystego trigramu, zero zmian dla wołających bez
--      nowych argumentów).
--
-- Wszystko idempotentne. Zmiana sygnatury search_people przez DROP + CREATE
-- (dodanie argumentu z DEFAULT-em przez CREATE OR REPLACE zrobiłoby
-- PRZECIĄŻENIE i wywołania 4-argumentowe stałyby się niejednoznaczne, 42725 -
-- ten błąd już raz kosztował ten moduł, patrz komentarz w overlayTabs.ts).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ----------------------------------------------------------------------------
-- 1) Tabela wektorów profili
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profile_embeddings (
  profile_id   uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  content_hash text NOT NULL,
  embedding    extensions.vector(768) NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.profile_embeddings IS
  'Wektor semantyczny profilu (768D). Niedostępny dla klientów: embedding to pochodna danych profilu, ale nie ma powodu wystawiać surowych wektorów - odczyt wyłącznie przez semantic_search_profiles.';

ALTER TABLE public.profile_embeddings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profile_embeddings FROM PUBLIC;
REVOKE ALL ON public.profile_embeddings FROM anon, authenticated;
GRANT ALL ON public.profile_embeddings TO service_role;

CREATE INDEX IF NOT EXISTS profile_embeddings_tenant_idx
  ON public.profile_embeddings (tenant_id);
CREATE INDEX IF NOT EXISTS profile_embeddings_hnsw
  ON public.profile_embeddings
  USING hnsw (embedding extensions.vector_cosine_ops);

-- ----------------------------------------------------------------------------
-- 2) Tekst źródłowy embeddingu profilu
--
-- Kolejność sekcji nie jest przypadkowa: modele embeddingowe ważą początek
-- tekstu mocniej, więc najpierw idzie tożsamość zawodowa, potem intencja
-- (najbardziej odróżniający sygnał w katalogu), na końcu dorobek.
-- Sufit 2000 znaków - jak w nes_post_embedding_source.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nes_profile_embedding_source(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT left(btrim(concat_ws(E'\n',
    nullif(btrim(concat_ws(' ',
      nullif(btrim(coalesce(p.job_title, '')), ''),
      nullif(btrim(coalesce(p.current_company, '')), ''))), ''),
    nullif(btrim(coalesce(p.specialization, '')), ''),
    nullif(btrim(coalesce(p.location, '')), ''),
    nullif(btrim(coalesce(p.seeking_pl, '')), ''),
    nullif(btrim(coalesce(p.seeking_en, '')), ''),
    nullif(btrim(coalesce(p.offering_pl, '')), ''),
    nullif(btrim(coalesce(p.offering_en, '')), ''),
    nullif(btrim(coalesce(p.bio_pl, '')), ''),
    nullif(btrim(coalesce(p.bio_en, '')), ''),
    (SELECT nullif(string_agg(s.label, ', ' ORDER BY s.sort_order, s.label), '')
       FROM public.profile_skills s WHERE s.user_id = p.id),
    (SELECT nullif(string_agg(DISTINCT e.role_title, ', '), '')
       FROM public.profile_experiences e WHERE e.user_id = p.id)
  )), 2000)
  FROM public.profiles p
  WHERE p.id = p_user_id;
$$;

COMMENT ON FUNCTION public.nes_profile_embedding_source(uuid) IS
  'Tekst źródłowy wektora profilu (tożsamość zawodowa -> intencja -> bio -> dorobek). Jedna definicja dla kolejki indeksera i dla porównania świeżości (md5).';

REVOKE ALL ON FUNCTION public.nes_profile_embedding_source(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nes_profile_embedding_source(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 3) Kolejka indeksera
--
-- Bramka kompletności: profil poniżej progu NIE dostaje wektora. To nie jest
-- oszczędność na wywołaniach bramki AI - to jakość sąsiedztwa. Wektor
-- policzony z samego stanowiska ("Analityk") jest podobny do wszystkiego, co
-- ma w tekście "analityk", i wypycha z listy osoby, które naprawdę opisały,
-- czym się zajmują.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.profiles_needing_embeddings(
  _limit integer DEFAULT 24,
  _min_completeness integer DEFAULT 40
)
RETURNS TABLE (profile_id uuid, tenant_id uuid, content_hash text, embed_text text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH src AS (
    SELECT p.id, p.tenant_id,
           public.nes_profile_embedding_source(p.id) AS embed_text
      FROM public.profiles p
     WHERE p.discoverable
       AND p.completeness_score >= GREATEST(LEAST(COALESCE(_min_completeness, 40), 100), 0)
  )
  SELECT s.id, s.tenant_id, md5(s.embed_text), s.embed_text
    FROM src s
    LEFT JOIN public.profile_embeddings pe ON pe.profile_id = s.id
   WHERE COALESCE(s.embed_text, '') <> ''
     AND (pe.profile_id IS NULL OR pe.content_hash IS DISTINCT FROM md5(s.embed_text))
   ORDER BY pe.profile_id IS NULL DESC, s.id
   LIMIT GREATEST(LEAST(COALESCE(_limit, 24), 200), 1);
$$;

COMMENT ON FUNCTION public.profiles_needing_embeddings(integer, integer) IS
  'Kolejka wektorów profili: widoczne profile powyżej progu kompletności, bez wektora albo z wektorem policzonym dla starszej treści. Nowe profile (bez wektora) mają priorytet.';

REVOKE EXECUTE ON FUNCTION public.profiles_needing_embeddings(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profiles_needing_embeddings(integer, integer)
  TO service_role;

-- Sprzątanie: profil wycofany z katalogu (opt-out) traci wektor przy
-- najbliższym przebiegu - inaczej wyszukiwanie semantyczne serwowałoby osoby,
-- które właśnie poprosiły o niewidoczność.
CREATE OR REPLACE FUNCTION public.prune_profile_embeddings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_removed integer;
BEGIN
  DELETE FROM public.profile_embeddings pe
   WHERE NOT EXISTS (
     SELECT 1 FROM public.profiles p
      WHERE p.id = pe.profile_id
        AND p.discoverable
        AND p.completeness_score >= 40
   );
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  RETURN v_removed;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prune_profile_embeddings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_profile_embeddings() TO service_role;

-- ----------------------------------------------------------------------------
-- 4) Zapytanie semantyczne po profilach
--
-- Wektor przyjeżdża jako float8[] (PostgREST nie rzutuje json -> vector).
-- Tenant rozstrzygany WYŁĄCZNIE z profilu wołającego - katalog osób jest
-- członkowski, więc nagłówek x-tenant-host nie ma tu nic do powiedzenia.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.semantic_search_profiles(
  _embedding double precision[],
  _limit integer DEFAULT 40
)
RETURNS TABLE (profile_id uuid, similarity real)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH me AS (
    SELECT p.id AS uid, p.tenant_id
      FROM public.profiles p
     WHERE p.id = auth.uid()
  ),
  q AS (
    SELECT (_embedding::extensions.vector(768)) AS v
  )
  SELECT pe.profile_id, (1 - (pe.embedding <=> q.v))::real AS similarity
    FROM public.profile_embeddings pe
    JOIN public.profiles p ON p.id = pe.profile_id
    CROSS JOIN me
    CROSS JOIN q
   WHERE auth.uid() IS NOT NULL
     AND cardinality(_embedding) = 768
     AND pe.tenant_id = me.tenant_id
     AND p.discoverable
     AND p.id <> me.uid
   ORDER BY pe.embedding <=> q.v
   LIMIT GREATEST(LEAST(COALESCE(_limit, 40), 100), 1);
$$;

COMMENT ON FUNCTION public.semantic_search_profiles(double precision[], integer) IS
  'Sąsiedztwo kosinusowe profili w tenancie wołającego (tylko discoverable, bez siebie). Wektor zapytania liczy warstwa serwerowa aplikacji.';

REVOKE ALL ON FUNCTION public.semantic_search_profiles(double precision[], integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.semantic_search_profiles(double precision[], integer)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5) search_people v3: faseta intencji + blend semantyczny + intencja w projekcji
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.search_people(text, text, text, text, integer, integer, text, boolean);

CREATE FUNCTION public.search_people(
  p_query text DEFAULT '',
  p_specialization text DEFAULT NULL,
  p_company text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_job_title text DEFAULT NULL,
  p_verified_only boolean DEFAULT false,
  p_open_to text[] DEFAULT NULL,
  p_embedding double precision[] DEFAULT NULL
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
  open_to text[],
  seeking_pl text,
  seeking_en text,
  completeness_score smallint,
  match_score real,
  total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH q AS (
    SELECT n.raw, public.like_escape(n.raw) AS esc
    FROM (SELECT public.discovery_search_norm(p_query) AS raw) n
  ),
  -- Jeden cast wektora zapytania na całe zapytanie (nie per wiersz).
  qv AS (
    SELECT CASE
             WHEN p_embedding IS NOT NULL AND cardinality(p_embedding) = 768
               THEN p_embedding::extensions.vector(768)
           END AS v
  ),
  intents AS (
    -- Nieznane kody odpadają; pusta lista = brak filtra.
    SELECT NULLIF(ARRAY(
             SELECT c FROM unnest(COALESCE(p_open_to, '{}'::text[])) AS c
              WHERE c = ANY (public.nes_profile_open_to_catalog())
           ), '{}'::text[]) AS codes
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
    p.open_to,
    p.seeking_pl,
    p.seeking_en,
    p.completeness_score,
    -- Wynik dopasowania widoczny dla interfejsu (odznaka "dopasowanie
    -- semantyczne"): trigram frazy + 1,5x podobieństwo kosinusowe + drobny
    -- bonus kompletności jako rozstrzygnięcie remisów (0-0,2).
    (
      CASE WHEN q.raw <> '' THEN similarity(p.discovery_search, q.raw) ELSE 0 END
      + COALESCE((1 - (pe.embedding <=> qv.v))::real, 0) * 1.5
      + (COALESCE(p.completeness_score, 0)::real / 500)
    )::real AS match_score,
    count(*) OVER () AS total_count
  FROM public.profiles p
  CROSS JOIN q
  CROSS JOIN qv
  CROSS JOIN intents
  -- LEFT JOIN, więc brak wektora profilu NIE usuwa go z wyników (degradacja
  -- do czystego trigramu jest addytywna, nigdy wykluczająca).
  LEFT JOIN public.profile_embeddings pe
    ON qv.v IS NOT NULL AND pe.profile_id = p.id
  WHERE auth.uid() IS NOT NULL
    AND p.discoverable
    AND p.id <> auth.uid()
    AND p.tenant_id = (SELECT pr.tenant_id FROM public.profiles pr WHERE pr.id = auth.uid())
    -- Fraza filtruje trigramowo TYLKO gdy nie ma wektora zapytania: przy
    -- wyszukiwaniu semantycznym literalny brak frazy w profilu jest normą
    -- (o to w nim chodzi), więc filtr zamieniamy na próg podobieństwa.
    AND (
      q.raw = ''
      OR (qv.v IS NULL AND p.discovery_search LIKE '%' || q.esc || '%')
      OR (qv.v IS NOT NULL AND (
            p.discovery_search LIKE '%' || q.esc || '%'
            OR (pe.profile_id IS NOT NULL AND (1 - (pe.embedding <=> qv.v)) >= 0.62)
          ))
    )
    AND (COALESCE(btrim(p_specialization), '') = ''
         OR lower(btrim(p.specialization)) = lower(btrim(p_specialization)))
    AND (COALESCE(btrim(p_company), '') = ''
         OR lower(btrim(p.current_company)) = lower(btrim(p_company)))
    AND (COALESCE(btrim(p_location), '') = ''
         OR lower(btrim(p.location)) = lower(btrim(p_location)))
    AND (COALESCE(btrim(p_job_title), '') = ''
         OR lower(btrim(p.job_title)) = lower(btrim(p_job_title)))
    AND (NOT COALESCE(p_verified_only, false) OR p.verified_at IS NOT NULL)
    AND (intents.codes IS NULL OR p.open_to && intents.codes)
  ORDER BY
    (q.raw <> '' AND p.discovery_search LIKE q.esc || '%') DESC,
    (
      CASE WHEN q.raw <> '' THEN similarity(p.discovery_search, q.raw) ELSE 0 END
      + COALESCE((1 - (pe.embedding <=> qv.v))::real, 0) * 1.5
      + (COALESCE(p.completeness_score, 0)::real / 500)
    ) DESC,
    lower(COALESCE(
      NULLIF(btrim(p.display_name), ''),
      concat_ws(' ', p.first_name, p.last_name)
    )) ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

COMMENT ON FUNCTION public.search_people(
  text, text, text, text, integer, integer, text, boolean, text[], double precision[]) IS
  'Katalog osób: trigram po discovery_search + fasety (specjalizacja/firma/lokalizacja/rola/weryfikacja/intencja) + opcjonalny blend semantyczny (p_embedding, 768D). Bez wektora zapytania zachowuje się jak v2.';

REVOKE ALL ON FUNCTION public.search_people(
  text, text, text, text, integer, integer, text, boolean, text[], double precision[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_people(
  text, text, text, text, integer, integer, text, boolean, text[], double precision[])
  TO authenticated, service_role;
