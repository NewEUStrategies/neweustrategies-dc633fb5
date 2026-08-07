-- ============================================================================
-- DISCUSSION CLUB - ETAP A6: ODKRYWALNOSC
--
-- To jest moment, w ktorym modul SPLACA LUKE #1 Z AUDYTU. Tresc klubowa jest
-- gesta, czlonkowska i tematyczna - czyli dokladnie ten material, na ktorym
-- wyszukiwanie semantyczne daje przewage. Infrastruktura pgvector juz stoi
-- i jest oplacona (768 wymiarow, HNSW, kolejka indeksera); dokladamy DRUGA
-- tabele wektorow tym samym wzorcem, co profile_embeddings i post_embeddings.
--
-- DWIE WARSTWY WYSZUKIWANIA, KAZDA ODPOWIADA NA INNE PYTANIE:
--   * FTS (nes_polish)  - "gdzie padlo slowo CBAM"
--   * semantyczna       - "gdzie rozmawiano o granicznym podatku weglowym"
-- Pierwsza jest tania i dokladna, druga droga i trafna. Nie zastepuja sie
-- wzajemnie, wiec zostaja obie.
--
-- OBIE respektuja widocznosc klubu, i to PRZED rankingiem. Filtr po rankingu
-- zwracalby mniej wynikow niz limit, a przy okazji zdradzalby, ze cos tam
-- bylo - licznik "znaleziono 12" przy trzech widocznych to takze wyciek.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Wektory semantyczne tematow
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_thread_embeddings (
  thread_id   uuid PRIMARY KEY REFERENCES public.club_threads(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  embedding   extensions.vector(768),
  -- Hash zrodla: indekser pomija temat, ktorego tresc sie nie zmienila.
  -- Bez tego kazdy przebieg placilby za przeliczenie calego archiwum.
  source_hash text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS club_thread_embeddings_hnsw_idx
  ON public.club_thread_embeddings
  USING hnsw (embedding extensions.vector_cosine_ops);
CREATE INDEX IF NOT EXISTS club_thread_embeddings_tenant_idx
  ON public.club_thread_embeddings (tenant_id);

COMMENT ON TABLE public.club_thread_embeddings IS
  'Wektory tematow (768D, HNSW). Druga tabela w gotowej infrastrukturze pgvector - splata luki #1 z audytu 2026-08-07 na tresci klubowej.';

ALTER TABLE public.club_thread_embeddings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_thread_embeddings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.club_thread_embeddings TO service_role;

-- ----------------------------------------------------------------------------
-- 2) Zrodlo tekstu do embeddingu
--
-- Tytul + tresc + nazwa klubu i grupy. Kontekst klubu jest czescia znaczenia:
-- "stanowisko" w klubie o energetyce znaczy co innego niz w klubie o migracji,
-- a wektor bez tego kontekstu myli oba.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_thread_embedding_source(p_thread_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT concat_ws(E'\n',
    c.name_pl,
    g.name_pl,
    t.title,
    left(t.body, 4000)   -- limit wejscia modelu; ogon dlugiego wpisu i tak
                         -- nie zmienia wektora na tyle, zeby placic za tokeny
  )
  FROM public.club_threads t
  JOIN public.club_groups g ON g.id = t.group_id
  JOIN public.clubs c ON c.id = t.club_id
  WHERE t.id = p_thread_id
$$;

REVOKE EXECUTE ON FUNCTION public.club_thread_embedding_source(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_thread_embedding_source(uuid) TO service_role;

-- Kolejka indeksera: tematy bez wektora albo ze zmieniona trescia.
DROP FUNCTION IF EXISTS public.club_threads_needing_embeddings(integer);

CREATE FUNCTION public.club_threads_needing_embeddings(p_limit integer DEFAULT 50)
RETURNS TABLE (thread_id uuid, tenant_id uuid, source text, source_hash text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT t.id, t.tenant_id,
           public.club_thread_embedding_source(t.id) AS src
      FROM public.club_threads t
     WHERE t.status IN ('open', 'resolved', 'dormant', 'locked')
     ORDER BY t.updated_at DESC
     LIMIT GREATEST(COALESCE(p_limit, 50), 1) * 4
  )
  SELECT c.id, c.tenant_id, c.src, md5(c.src)
    FROM candidates c
    LEFT JOIN public.club_thread_embeddings e ON e.thread_id = c.id
   WHERE c.src IS NOT NULL
     AND (e.thread_id IS NULL OR e.source_hash IS DISTINCT FROM md5(c.src))
   LIMIT GREATEST(COALESCE(p_limit, 50), 1)
$$;

COMMENT ON FUNCTION public.club_threads_needing_embeddings(integer) IS
  'Kolejka indeksera: tematy bez wektora albo ze zmienionym source_hash. Ten sam wzorzec, co profiles_needing_embeddings.';

REVOKE EXECUTE ON FUNCTION public.club_threads_needing_embeddings(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_threads_needing_embeddings(integer) TO service_role;

-- Sprzatanie wektorow po usunietych tematach. ON DELETE CASCADE zalatwia
-- wiekszosc, ale temat przeniesiony do 'deleted' nie znika z tabeli - a jego
-- wektor nie ma prawa dalej wyplywac w wyszukiwaniu.
CREATE OR REPLACE FUNCTION public.club_prune_thread_embeddings()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.club_thread_embeddings e
   WHERE NOT EXISTS (
     SELECT 1 FROM public.club_threads t
      WHERE t.id = e.thread_id
        AND t.status IN ('open', 'resolved', 'dormant', 'locked')
   );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_prune_thread_embeddings()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_prune_thread_embeddings() TO service_role;

-- ----------------------------------------------------------------------------
-- 3) Wyszukiwanie pelnotekstowe
--
-- Widocznosc filtrujemy PRZED rankingiem - patrz naglowek.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_search(text, uuid, integer);

CREATE FUNCTION public.club_search(
  p_query   text,
  p_club_id uuid DEFAULT NULL,
  p_limit   integer DEFAULT 20
)
RETURNS TABLE (
  thread_id uuid, club_id uuid, club_slug text, club_name_pl text, club_name_en text,
  thread_slug text, title text, snippet text, kind text,
  reply_count integer, last_reply_at timestamptz, rank real
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH q AS (
    SELECT websearch_to_tsquery('public.nes_polish', btrim(COALESCE(p_query, ''))) AS ts
  ),
  visible AS (
    SELECT t.*, c.slug AS c_slug, c.name_pl AS c_pl, c.name_en AS c_en
      FROM public.club_threads t
      JOIN public.clubs c ON c.id = t.club_id
      CROSS JOIN LATERAL public.club_capabilities(t.club_id, t.group_id, auth.uid()) cap
     WHERE cap.can_read
       AND t.status IN ('open', 'resolved', 'dormant', 'locked')
       AND (p_club_id IS NULL OR t.club_id = p_club_id)
  )
  SELECT
    v.id, v.club_id, v.c_slug, v.c_pl, v.c_en,
    v.slug, v.title,
    -- Fragment z podswietleniem: uzytkownik ma zobaczyc, DLACZEGO wynik pasuje.
    ts_headline('public.nes_polish', left(v.body, 2000), q.ts,
                'MaxWords=30, MinWords=15, ShortWord=3, MaxFragments=1') AS snippet,
    v.kind, v.reply_count, v.last_reply_at,
    ts_rank(v.search_vector, q.ts) AS rank
  FROM visible v, q
  WHERE q.ts IS NOT NULL
    AND btrim(COALESCE(p_query, '')) <> ''
    AND v.search_vector @@ q.ts
  ORDER BY ts_rank(v.search_vector, q.ts) DESC, v.last_reply_at DESC NULLS LAST, v.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
$$;

COMMENT ON FUNCTION public.club_search(text, uuid, integer) IS
  'Wyszukiwanie pelnotekstowe w tematach. Widocznosc filtrowana PRZED rankingiem - filtr po rankingu zdradzalby istnienie wynikow z klubow zamknietych.';

REVOKE EXECUTE ON FUNCTION public.club_search(text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_search(text, uuid, integer)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) Wyszukiwanie semantyczne
--
-- Przyjmuje GOTOWY wektor zapytania: model liczy go po stronie aplikacji
-- (ta sama sciezka, co dla postow i profili), a baza tylko szuka sasiadow.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_semantic_search(double precision[], uuid, integer, real);

-- Wektor wchodzi jako double precision[], nie jako extensions.vector: PostgREST
-- nie serializuje typu wektorowego, wiec kazda funkcja semantyczna w tym
-- repozytorium przyjmuje tablice i rzutuje ja w srodku (wzorzec
-- semantic_search_profiles). Kontrakt klienta jest przez to zwyklym JSON-em.
CREATE FUNCTION public.club_semantic_search(
  p_embedding double precision[],
  p_club_id   uuid DEFAULT NULL,
  p_limit     integer DEFAULT 20,
  p_threshold real DEFAULT 0.25
)
RETURNS TABLE (
  thread_id uuid, club_id uuid, club_slug text, club_name_pl text, club_name_en text,
  thread_slug text, title text, kind text,
  reply_count integer, last_reply_at timestamptz, similarity real
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH q AS (
    SELECT (p_embedding::extensions.vector(768)) AS v
     WHERE p_embedding IS NOT NULL AND array_length(p_embedding, 1) = 768
  )
  SELECT
    t.id, t.club_id, c.slug, c.name_pl, c.name_en,
    t.slug, t.title, t.kind, t.reply_count, t.last_reply_at,
    (1 - (e.embedding <=> q.v))::real AS similarity
  FROM public.club_thread_embeddings e
  CROSS JOIN q
  JOIN public.club_threads t ON t.id = e.thread_id
  JOIN public.clubs c ON c.id = t.club_id
  CROSS JOIN LATERAL public.club_capabilities(t.club_id, t.group_id, auth.uid()) cap
  WHERE cap.can_read
    AND t.status IN ('open', 'resolved', 'dormant', 'locked')
    AND (p_club_id IS NULL OR t.club_id = p_club_id)
    -- Prog podobienstwa odsiewa "najblizszych z dalekich": bez niego kazde
    -- zapytanie zwraca limit wynikow, takze wtedy, gdy zaden nie pasuje.
    AND (1 - (e.embedding <=> q.v)) >= COALESCE(p_threshold, 0.25)
  ORDER BY e.embedding <=> q.v, t.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
$$;

COMMENT ON FUNCTION public.club_semantic_search(double precision[], uuid, integer, real) IS
  'Wyszukiwanie semantyczne po wektorze zapytania policzonym w aplikacji. Prog podobienstwa odsiewa "najblizszych z dalekich" - bez niego kazde zapytanie zwraca pelny limit.';

REVOKE EXECUTE ON FUNCTION public.club_semantic_search(double precision[], uuid, integer, real)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_semantic_search(double precision[], uuid, integer, real)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5) Zapis wektora (dla indeksera po stronie serwera)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_upsert_thread_embedding(
  p_thread_id uuid, p_embedding double precision[], p_source_hash text
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF p_embedding IS NULL OR array_length(p_embedding, 1) IS DISTINCT FROM 768 THEN
    RAISE EXCEPTION 'clubs: embedding must have 768 dimensions' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.club_thread_embeddings (thread_id, tenant_id, embedding, source_hash, updated_at)
  SELECT t.id, t.tenant_id, p_embedding::extensions.vector(768), p_source_hash, now()
    FROM public.club_threads t WHERE t.id = p_thread_id
  ON CONFLICT (thread_id) DO UPDATE
    SET embedding = EXCLUDED.embedding,
        source_hash = EXCLUDED.source_hash,
        updated_at = now();
  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_upsert_thread_embedding(uuid, double precision[], text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_upsert_thread_embedding(uuid, double precision[], text)
  TO service_role;

-- ----------------------------------------------------------------------------
-- 6) Karta "dyskutowane w klubach" dla dossier i wpisu
--
-- To jest powierzchnia POZA modulem, ktora czyni z klubu czesc platformy,
-- a nie osobna wyspe: dossier pokazuje "3 watki w klubach dyskutuja ten plik".
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_threads_for_anchor(text, text, integer);

CREATE FUNCTION public.club_threads_for_anchor(
  p_anchor_type text, p_anchor_id text, p_limit integer DEFAULT 5
)
RETURNS TABLE (
  thread_id uuid, thread_slug text, title text, kind text,
  club_slug text, club_name_pl text, club_name_en text,
  reply_count integer, last_reply_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id, t.slug, t.title, t.kind,
    c.slug, c.name_pl, c.name_en,
    t.reply_count, t.last_reply_at
  FROM public.club_threads t
  JOIN public.clubs c ON c.id = t.club_id
  CROSS JOIN LATERAL public.club_capabilities(t.club_id, t.group_id, auth.uid()) cap
  WHERE t.anchor_type = p_anchor_type
    AND t.anchor_id = p_anchor_id
    AND cap.can_read
    AND t.status IN ('open', 'resolved', 'locked')
  ORDER BY t.last_reply_at DESC NULLS LAST, t.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 20)
$$;

COMMENT ON FUNCTION public.club_threads_for_anchor(text, text, integer) IS
  'Watki zakotwiczone w dossier, wpisie albo wydarzeniu. Powierzchnia poza modulem - to ona czyni z klubu czesc platformy, a nie osobna wyspe.';

REVOKE EXECUTE ON FUNCTION public.club_threads_for_anchor(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_threads_for_anchor(text, text, integer)
  TO anon, authenticated, service_role;
