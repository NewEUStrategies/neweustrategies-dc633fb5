-- migrations-mirror: supabase/migrations/20261025090000_adopt_event_speaker_panel_bio.sql
-- WYGENEROWANE przez `bun run migrations:mirror` z pliku wyzej - NIE EDYTUJ RECZNIE.
-- Zrodlo prawdy schematu: supabase/migrations. Ten plik to kopia dostawcza dla
-- migratora Drizzle platformy Lovable (drizzle.config.ts); bramka
-- check:migration-lanes pilnuje, ze jego SQL wykonywalny == zrodlo.

-- ============================================================================
-- ADOPCJA SCHEMATU, KTÓRY ISTNIAŁ WYŁĄCZNIE W DZIENNIKU DRIZZLE (1/2):
-- `admin_event_speakers_list` Z TREŚCIĄ SCENICZNĄ (0148).
--
-- DEFEKT
--   `supabase/migrations` jest jedynym źródłem prawdy o schemacie, a dziennik
--   drizzle - generowanym nośnikiem wdrożenia. Wpis dziennika dopisany
--   z panelu Lovable, `drizzle/migrations/0148_event_speaker_panel_bio.sql`
--   (2026-10-12), dał `admin_event_speakers_list(uuid)` osiem kolumn na KOŃCU
--   RETURNS TABLE: bio_pl, bio_en, topics_pl, topics_en, languages,
--   talks_count, rating, reviews_count. Ostatnia definicja w tym pasie
--   (20260924140000_event_speaker_card_tracks.sql) ma 21 kolumn, więc baza
--   zbudowana z `supabase/migrations` (pgTAP, harnessy, `db reset`) różniła
--   się od produkcji: podgląd studia (`speakerRowsFromAdminEntries`,
--   previewLiveData.ts) dostawał tu pusty biogram, a
--   `src/integrations/supabase/types.ts` (generowany z produkcji) zna już
--   29 kolumn.
--
-- ZMIANA
--   Ciało, RETURNS TABLE, granty i komentarz 1:1 jak w 0148 (jedyna różnica
--   wobec 20260924140000 poza nowymi kolumnami: `sp2.tenant_id = v_tenant`
--   zamiast `= en2.tenant_id` - równoważne, bo `en2.tenant_id = v_tenant`).
--   Zmiana RETURNS TABLE wymaga DROP (42P13 przy CREATE OR REPLACE), ale
--   DROP jest tu WARUNKOWY: wykonuje się tylko wtedy, gdy funkcja ma inny
--   kształt wyniku niż docelowy - czyli na bazie z tego pasa. Na produkcji,
--   gdzie 0148 już działa, blok nic nie robi, a `CREATE OR REPLACE`
--   podmienia identyczne ciało: OID, granty i zależności zostają.
--   Gdyby tekst `pg_get_function_result` różnił się formatem (inna wersja
--   serwera), blok wykona DROP - stan końcowy jest wtedy ten sam co po 0148
--   (DROP + CREATE + te same granty), zmienia się tylko OID.
--   Granty jak w 0148: bez PUBLIC i anon (domyślne uprawnienia platformy
--   nadają anon EXECUTE jawnie, więc samo FROM PUBLIC by nie wystarczyło),
--   EXECUTE dla authenticated (panel woła RPC z przeglądarki; bramką jest
--   `assert_event_admin_tenant()`, najemca z sesji, nigdy z ładunku)
--   i service_role.
--
-- CZEGO NIE ZMIENIA
--   * Schematu z 0392 (indeksy i komentarz kolumny kuponu, z którego powstało
--     nadanie członkostwa): adoptuje go osobny plik
--     20261025090010_adopt_membership_coupon_source_indexes.sql. Podział jest
--     celowy. Harness modułu Wydarzeń (scripts/events-harness/run.sh) wybiera
--     ten plik po nazwie funkcji panelu i wykonuje go z ON_ERROR_STOP na bazie
--     atrap, w której tabeli nadań członkostwa jeszcze nie ma - wspólny plik
--     padłby tam na 42P01. Tak asercje runtime 40 i 41 harnessu ćwiczą
--     29-kolumnowy kształt, a plik z indeksami harness pomija.
--   * Wpisu 0148 w dzienniku drizzle (forward-only); w rejestrze
--     MIGRATION_LANES zostaje `drizzleOnly` z adnotacją o tej adopcji.
--
-- IDEMPOTENTNE: drugi przebieg na tej samej bazie (z tego pasa albo na
-- produkcji przez nośnik w dzienniku drizzle) nie zmienia stanu ani OID
-- funkcji.
-- Nośnik w dzienniku drizzle generuje `bun run migrations:mirror` (nagłówek
-- generatora + ten plik bajt w bajt); nikt nie pisze go ręcznie.
-- Test: supabase/tests/drizzle_only_schema_adoption_test.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- admin_event_speakers_list(uuid) - stan z 0148
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_fn regprocedure := to_regprocedure('public.admin_event_speakers_list(uuid)');
BEGIN
  IF v_fn IS NOT NULL
     AND pg_get_function_result(v_fn) IS DISTINCT FROM
       'TABLE(entry_id uuid, speaker_profile_id uuid, user_id uuid, person_id uuid, display_name text, avatar_url text, job_title text, company text, email text, is_public boolean, sort_order integer, is_legacy boolean, headline_pl text, headline_en text, card_photo_url text, card_cta_label_pl text, card_cta_label_en text, card_cta_url text, card_cta_color text, tracks jsonb, sessions jsonb, bio_pl text, bio_en text, topics_pl text[], topics_en text[], languages text[], talks_count integer, rating numeric, reviews_count integer)'
  THEN
    DROP FUNCTION public.admin_event_speakers_list(uuid);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_event_speakers_list(p_event_id uuid)
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
