-- ============================================================================
-- PODGLĄD STUDIA: KLIK W PRELEGENTA BEZ KONTA OTWIERA OKNO PROFILU.
--
-- PRZYCZYNA. `speakerRowsFromAdminEntries` (previewLiveData.ts) zerował
-- `bio_pl`, `bio_en`, tematy i języki prelegenta, bo lista panelu
-- (`admin_event_speakers_list`) ich nie oddawała. Reguła
-- `speakerHasProfileToShow` (speakerRow.ts) czyta biogram z wiersza, więc
-- osoba BEZ konta dostawała `personKey = null`, a karta w podglądzie studia
-- rysowała nazwisko jako zwykły napis: klik w prelegenta nic nie robił.
-- Na stronie publicznej to samo okno działa, bo projekcja
-- `event_speakers_public` biogram oddaje.
--
-- CO ROBI
--   `admin_event_speakers_list` dochodzi o siedem pól scenicznych z nakładki
--   (`speaker_profiles`), z tym samym źródłem co projekcja publiczna:
--   biogram łączy nakładkę z kartoteką osoby (`COALESCE(spf.bio_*, pe.bio_*)`
--   przy istniejącej nakładce), tematy i języki mają zbiory zapasowe `{}`,
--   a liczniki wartość zero. Kolumny dochodzą na KOŃCU RETURNS TABLE -
--   kolejność pól dotychczasowych nie zmienia się.
--
-- CZEGO NIE ZMIENIA
--   * projektacji publicznej, grantów tabeli `speaker_profiles` (anon i
--     authenticated nadal nie mają do niej dostępu - nowa treść czytana jest
--     wyłącznie przez funkcję SECURITY DEFINER), bramek najemcy
--     (`assert_event_admin_tenant()`), ani list kolumn na froncie panelu.
--   * Zmiana RETURNS TABLE wymaga DROP + CREATE (42P13 przy CREATE OR REPLACE).
--     Grunty przechodzą przy REVOKE + GRANT 1:1 jak w 20260924140000.
--
-- Idempotentne.
-- ============================================================================
DROP FUNCTION IF EXISTS public.admin_event_speakers_list(uuid);
CREATE FUNCTION public.admin_event_speakers_list(p_event_id uuid)
RETURNS TABLE (
  entry_id uuid,
  speaker_profile_id uuid,
  user_id uuid,
  person_id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  company text,
  email text,
  is_public boolean,
  sort_order integer,
  is_legacy boolean,
  headline_pl text,
  headline_en text,
  card_photo_url text,
  card_cta_label_pl text,
  card_cta_label_en text,
  card_cta_url text,
  card_cta_color text,
  tracks jsonb,
  sessions jsonb,
  bio_pl text,
  bio_en text,
  topics_pl text[],
  topics_en text[],
  languages text[],
  talks_count integer,
  rating numeric,
  reviews_count integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id = p_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'event_speakers: event not found in tenant' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      en.id AS entry_id,
      en.speaker_profile_id,
      sp.user_id,
      sp.person_id,
      sp.is_public,
      en.sort_order,
      false AS is_legacy
    FROM public.event_speaker_entries en
    JOIN public.speaker_profiles sp
      ON sp.id = en.speaker_profile_id AND sp.tenant_id = en.tenant_id
    WHERE en.tenant_id = v_tenant
      AND en.event_id = p_event_id
    UNION ALL
    SELECT
      NULL::uuid AS entry_id,
      sp.id AS speaker_profile_id,
      es.user_id,
      NULL::uuid AS person_id,
      sp.is_public,
      es.sort_order,
      true AS is_legacy
    FROM public.event_speakers es
    LEFT JOIN public.speaker_profiles sp
      ON sp.user_id = es.user_id AND sp.tenant_id = v_tenant
    WHERE es.event_id = p_event_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.event_speaker_entries en2
        JOIN public.speaker_profiles sp2
          ON sp2.id = en2.speaker_profile_id AND sp2.tenant_id = v_tenant
        WHERE en2.tenant_id = v_tenant
          AND en2.event_id = p_event_id
          AND sp2.user_id = es.user_id
      )
  )
  SELECT
    b.entry_id,
    b.speaker_profile_id,
    b.user_id,
    b.person_id,
    COALESCE(
      pr.display_name,
      NULLIF(btrim(COALESCE(pe.first_name, '') || ' ' || COALESCE(pe.last_name, '')), '')
    ) AS display_name,
    COALESCE(pr.avatar_url, pe.photo_url) AS avatar_url,
    COALESCE(ap.job_title, pe.job_title) AS job_title,
    COALESCE(ap.company, pe.company_text) AS company,
    pe.email,
    COALESCE(b.is_public, true) AS is_public,
    b.sort_order,
    b.is_legacy,
    spf.headline_pl,
    spf.headline_en,
    spf.card_photo_url,
    spf.card_cta_label_pl,
    spf.card_cta_label_en,
    spf.card_cta_url,
    spf.card_cta_color,
    public._event_speaker_tracks(v_tenant, p_event_id, b.speaker_profile_id, false) AS tracks,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'session_id', ss.session_id,
          'role', ss.role,
          'sort_order', ss.sort_order
        ) ORDER BY s.starts_at, ss.sort_order
      )
        FROM public.event_session_speakers ss
        JOIN public.event_sessions s
          ON s.tenant_id = ss.tenant_id AND s.event_id = ss.event_id AND s.id = ss.session_id
       WHERE b.speaker_profile_id IS NOT NULL
         AND ss.tenant_id = v_tenant
         AND ss.event_id = p_event_id
         AND ss.speaker_profile_id = b.speaker_profile_id
         AND s.status <> 'cancelled'
    ), '[]'::jsonb) AS sessions,
    CASE WHEN b.speaker_profile_id IS NOT NULL THEN COALESCE(spf.bio_pl, pe.bio_pl) END AS bio_pl,
    CASE WHEN b.speaker_profile_id IS NOT NULL THEN COALESCE(spf.bio_en, pe.bio_en) END AS bio_en,
    COALESCE(spf.topics_pl, '{}') AS topics_pl,
    COALESCE(spf.topics_en, '{}') AS topics_en,
    COALESCE(spf.languages, '{}') AS languages,
    COALESCE(spf.talks_count, 0) AS talks_count,
    COALESCE(spf.rating, 0) AS rating,
    COALESCE(spf.reviews_count, 0) AS reviews_count
  FROM base b
  LEFT JOIN public.profiles pr
    ON pr.id = b.user_id AND pr.tenant_id = v_tenant
  LEFT JOIN public.event_people pe
    ON pe.id = b.person_id AND pe.tenant_id = v_tenant
  LEFT JOIN public.author_profiles ap
    ON ap.user_id = b.user_id AND ap.tenant_id = v_tenant
  LEFT JOIN public.speaker_profiles spf
    ON spf.id = b.speaker_profile_id AND spf.tenant_id = v_tenant
  ORDER BY b.sort_order, lower(COALESCE(pr.display_name, pe.last_name, ''));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_speakers_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_speakers_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_speakers_list(uuid) IS
  'Prelegenci wydarzenia w panelu: rejestr event_speaker_entries + legacy event_speakers, osoba z kontem albo z kartoteki. Oddaje pola karty (card_*), naglowek sceniczny, sciezki wyprowadzone z obsady (tracks, lacznie ze szkicami sesji), obsade wpisu (sessions) oraz tresc sceniczna (bio_*, topics_*, languages, liczniki) - biogram laczy nakladke z kartoteka osoby, jak projekcja publiczna. Bramka: assert_event_admin_tenant().';
