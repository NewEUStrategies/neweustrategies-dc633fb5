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
  LEFT JOIN public.profiles p
    ON p.id = b.user_id AND p.tenant_id = v_tenant
  LEFT JOIN public.event_people pe
    ON pe.id = b.person_id AND pe.tenant_id = v_tenant
  LEFT JOIN public.speaker_profiles sp
    ON sp.id = b.speaker_profile_id AND sp.tenant_id = v_tenant AND sp.is_public
  LEFT JOIN public.author_profiles ap
    ON ap.user_id = b.user_id AND ap.tenant_id = v_tenant AND ap.is_public
  WHERE p.id IS NOT NULL OR pe.id IS NOT NULL
  ORDER BY b.sort_order, lower(COALESCE(p.display_name, pe.last_name, ''))
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.event_speakers_public(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_speakers_public(jsonb)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_speakers_public(jsonb) IS
  'Publiczna lista prelegentow OPUBLIKOWANEGO wydarzenia (payload: event_id albo slug, opcjonalnie limit). UNION event_speaker_entries + legacy event_speakers, LEFT JOIN profiles - osoba BEZ konta bierze nazwisko, zdjecie, stanowisko i firme z kartoteki event_people. BRAMKA BIOGRAFII: bio_pl/bio_en wychodza WYLACZNIE przy PUBLICZNEJ nakladce scenicznej (speaker_profiles.is_public); nazwisko, zdjecie, stanowisko i firma ida bez warunku. Plaszczyzna tresci: public_tenant_id(), zero has_role().';