-- Publiczna agenda: prelegenci BEZ konta (kartoteka `event_people`).
--
-- BLIZNIAK drizzle/migrations/0046_event_agenda_people_without_accounts.sql.
-- Tamten plik zastosowano na hostowanej bazie z panelu Lovable i trafil
-- WYLACZNIE do pasa drizzle. Pas supabase (z niego stawia baze `supabase db
-- start`, pgTAP i harness wydarzen, a czytaja go wszystkie bramki `check:sql-*`)
-- zostawal wiec z cialem `event_agenda` z 20260923120000, ktore dolacza obsade
-- przez `JOIN public.profiles` - osoba bez konta znikala z programu na kazdym
-- swiezym srodowisku, a na produkcji byla widoczna. Ten plik niesie TEN SAM
-- SQL wykonywalny (pilnuje tego `src/lib/ci/migrationLaneParity.ts`).
--
-- CO ZMIENIA
--   * obsada sesji dolacza `profiles` ORAZ `event_people` LEFT JOIN-em, a wiersz
--     wymaga jednego z nich (CHECK `speaker_profiles_subject_xor` gwarantuje, ze
--     wypelnione jest dokladnie jedno z `user_id` / `person_id`);
--   * osoba z kartoteki dostaje nazwe z imienia i nazwiska, zdjecie z
--     `photo_url` i - w braku naglowka scenicznego - stanowisko `job_title`
--     (identyfikacja osoby, jak w `event_speakers_public`);
--   * klucz `user_id` w obsadzie niesie `profiles.id` ALBO `event_people.id`;
--     front uzywa go wylacznie jako klucza wiersza, nie jako odnosnika do konta.
--
-- CZEGO NIE ZMIENIA
--   * bramki `speaker_profiles.is_public` (nakladka niepubliczna nadal nie
--     wchodzi do obsady), statusu sesji, prywatnosci sesji ani izolacji najemcy;
--   * NIE wystawia `event_people.email` ani `.phone` - tych kolumn nie ma
--     w obsadzie i ta migracja ich tam nie dodaje;
--   * sygnatury i RETURNS TABLE z 20260923120000 - `CREATE OR REPLACE` bez
--     zmiany kolumn, wiec `check:rpc-contract` i typy klienta zostaja bez zmian.

CREATE OR REPLACE FUNCTION public.event_agenda(p_slug text)
 RETURNS TABLE(id uuid, event_id uuid, parent_session_id uuid, title_pl text, title_en text, description_pl text, description_en text, affiliation_pl text, affiliation_en text, starts_at timestamp with time zone, ends_at timestamp with time zone, timezone text, format text, status text, sort_order integer, chatham_house boolean, min_tier_rank integer, requires_signup boolean, capacity integer, registered_count integer, seats_left integer, track_id uuid, track_key text, track_name_pl text, track_name_en text, track_accent_color text, track_sponsor_id uuid, track_sponsor_name text, track_sponsor_logo_url text, track_sponsor_role text, room_id uuid, room_name text, room_floor text, session_sponsor_id uuid, session_sponsor_name text, session_sponsor_logo_url text, session_sponsor_role text, has_stream boolean, has_recording boolean, my_signup_status text, access_state text, speakers jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_rank integer := public.current_tier_rank();
  v_event_id uuid;
  v_timezone text;
BEGIN
  IF v_tenant IS NULL THEN RETURN; END IF;
  SELECT e.id, e.timezone INTO v_event_id, v_timezone
  FROM public.events e
  WHERE e.tenant_id = v_tenant AND e.slug = p_slug AND e.status = 'published';
  IF v_event_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH mine AS (
    SELECT g.session_id, g.status
    FROM public.event_session_signups g
    WHERE v_uid IS NOT NULL AND g.tenant_id = v_tenant
      AND g.event_id = v_event_id AND g.user_id = v_uid
  )
  SELECT
    s.id, s.event_id, s.parent_session_id,
    s.title_pl, s.title_en, s.description_pl, s.description_en,
    s.affiliation_pl, s.affiliation_en,
    s.starts_at, s.ends_at, v_timezone,
    s.format, s.status, s.sort_order, s.chatham_house, s.min_tier_rank,
    s.requires_signup, s.capacity,
    CASE WHEN s.requires_signup THEN COALESCE(c.registered, 0) ELSE 0 END::integer,
    CASE WHEN s.capacity IS NULL THEN NULL
      ELSE GREATEST(s.capacity - COALESCE(c.registered, 0), 0) END::integer,
    s.track_id, t.key, t.name_pl, t.name_en, t.accent_color,
    ts.id, ts.snapshot_name, ts.snapshot_logo_url, ts.role,
    s.room_id, r.name, r.floor,
    ss.id, ss.snapshot_name, ss.snapshot_logo_url, ss.role,
    (s.stream_url IS NOT NULL), (s.recording_url IS NOT NULL), m.status,
    CASE
      WHEN s.status = 'cancelled' THEN 'cancelled'
      WHEN m.status = 'registered' THEN 'signed_up'
      WHEN m.status = 'waitlist' THEN 'waitlisted'
      WHEN s.min_tier_rank > 0 AND v_rank < s.min_tier_rank THEN 'tier_required'
      WHEN NOT s.requires_signup THEN 'open'
      WHEN s.capacity IS NOT NULL AND COALESCE(c.registered, 0) >= s.capacity THEN 'full'
      ELSE 'signup_required'
    END::text,
    COALESCE(sp.items, '[]'::jsonb)
  FROM public.event_sessions s
  LEFT JOIN mine m ON m.session_id = s.id AND m.status <> 'cancelled'
  LEFT JOIN public.event_tracks t ON t.id = s.track_id AND t.tenant_id = v_tenant
  LEFT JOIN public.event_rooms r ON r.id = s.room_id AND r.tenant_id = v_tenant
  LEFT JOIN public.event_sponsors ts ON ts.tenant_id = t.tenant_id AND ts.event_id = t.event_id AND ts.id = t.sponsor_id AND ts.is_published
  LEFT JOIN public.event_sponsors ss ON ss.tenant_id = s.tenant_id AND ss.event_id = s.event_id AND ss.id = s.sponsor_id AND ss.is_published
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS registered
    FROM public.event_session_signups g0
    WHERE g0.tenant_id = v_tenant AND g0.session_id = s.id AND g0.status = 'registered'
  ) c ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'user_id', COALESCE(pr.id, pe.id),
        'slug', pr.slug,
        'display_name', COALESCE(pr.display_name, NULLIF(btrim(concat_ws(' ', pe.first_name, pe.last_name)), '')),
        'avatar_url', COALESCE(pr.avatar_url, pe.photo_url),
        'headline_pl', COALESCE(spf.headline_pl, pe.job_title),
        'headline_en', COALESCE(spf.headline_en, pe.job_title),
        'role', es.role,
        'sort_order', es.sort_order
      ) ORDER BY es.sort_order, COALESCE(pr.display_name, pe.last_name, pe.first_name)
    ) AS items
    FROM public.event_session_speakers es
    JOIN public.speaker_profiles spf
      ON spf.id = es.speaker_profile_id AND spf.tenant_id = v_tenant AND spf.is_public
    LEFT JOIN public.profiles pr
      ON pr.id = spf.user_id AND pr.tenant_id = v_tenant
    LEFT JOIN public.event_people pe
      ON pe.id = spf.person_id AND pe.tenant_id = v_tenant
    WHERE es.tenant_id = v_tenant AND es.session_id = s.id
      AND (pr.id IS NOT NULL OR pe.id IS NOT NULL)
  ) sp ON true
  WHERE s.tenant_id = v_tenant AND s.event_id = v_event_id
    AND s.status IN ('published', 'cancelled')
    AND (s.is_private = false OR m.status IS NOT NULL)
  ORDER BY s.starts_at, s.sort_order, s.title_pl;
END;
$function$;

REVOKE ALL ON FUNCTION public.event_agenda(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_agenda(text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.event_agenda(text) IS
  'Publiczna agenda opublikowanego wydarzenia. Obsługuje profile kont oraz osoby z kartoteki event_people bez kont użytkowników; nie ujawnia danych kontaktowych.';
