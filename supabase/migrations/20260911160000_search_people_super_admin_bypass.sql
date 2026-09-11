-- Superadmin widzi w katalogu osob rowniez profile z discoverable=false.
--
-- Powod: superadmin musi moc odnalezc KAZDE konto w swoim tenancie (wsparcie,
-- moderacja, RODO), a zwykly opt-out z katalogu to preferencja widocznosci
-- miedzy uzytkownikami, nie granica bezpieczenstwa wobec administracji.
-- Bramka jest po stronie bazy (is_super_admin(), SECURITY DEFINER), wiec nie da
-- sie jej obejsc z klienta; pozostale filtry (tenant, brak self) bez zmian.

CREATE OR REPLACE FUNCTION public.search_people(
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
    AND (p.discoverable OR public.is_super_admin())
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

