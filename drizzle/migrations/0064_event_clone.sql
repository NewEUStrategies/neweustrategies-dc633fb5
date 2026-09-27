-- Nowa edycja wydarzenia z poprzedniej (admin_event_clone, podglad, rodowod edycji).
-- Blizniak: supabase/migrations/20260926170000_event_clone.sql (tam pelny naglowek).
-- events-harness: include

-- ----------------------------------------------------------------------------
-- 1) RODOWOD EDYCJI: events.previous_edition_id
-- ----------------------------------------------------------------------------
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS previous_edition_id uuid;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.events'::regclass AND conname = 'events_previous_edition_fk'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_previous_edition_fk
      FOREIGN KEY (tenant_id, previous_edition_id)
      REFERENCES public.events (tenant_id, id)
      ON DELETE SET NULL (previous_edition_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.events'::regclass AND conname = 'events_previous_edition_not_self'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_previous_edition_not_self
      CHECK (previous_edition_id IS NULL OR previous_edition_id <> id);
  END IF;
END
$do$;

CREATE INDEX IF NOT EXISTS events_previous_edition_idx
  ON public.events (tenant_id, previous_edition_id)
  WHERE previous_edition_id IS NOT NULL;

COMMENT ON COLUMN public.events.previous_edition_id IS
  'Poprzednia edycja, z ktorej to wydarzenie sklonowano (admin_event_clone). Skasowanie poprzedniej edycji zeruje kolumne. Czytana przez admin_event_editions, poza grantami kolumnowymi klienta.';

-- ----------------------------------------------------------------------------
-- 2) FUNKCJE CZYSTE: identyfikator kopii, przesuniecie, flaga
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_clone_id(p_new uuid, p_old uuid)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN p_new IS NULL OR p_old IS NULL THEN NULL
    ELSE (
      substr(x.h, 1, 8) || '-' || substr(x.h, 9, 4) || '-4' || substr(x.h, 14, 3)
      || '-8' || substr(x.h, 18, 3) || '-' || substr(x.h, 21, 12)
    )::uuid
  END
  FROM (SELECT md5(p_new::text || ':' || p_old::text) AS h) AS x;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_id(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_id(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public._event_clone_id(uuid, uuid) IS
  'Deterministyczny identyfikator kopii wiersza old w wydarzeniu new (md5 pary w ksztalcie UUID v4). Zastepuje tabele mapowan w pg_temp. Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_shift(
  p_ts timestamptz, p_src_tz text, p_dst_tz text, p_delta interval
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN p_ts IS NULL THEN NULL
    ELSE ((p_ts AT TIME ZONE p_src_tz) + p_delta) AT TIME ZONE p_dst_tz
  END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_shift(timestamptz, text, text, interval)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_shift(timestamptz, text, text, interval)
  TO service_role;
COMMENT ON FUNCTION public._event_clone_shift(timestamptz, text, text, interval) IS
  'Przesuniecie chwili o roznice zegarow lokalnych: czas lokalny w strefie zrodla + delta, zinterpretowany w strefie celu. Odporne na zmiane czasu letniego. Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_shift_schedule(
  p_schedule jsonb, p_src_tz text, p_dst_tz text, p_delta interval
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE((
    SELECT jsonb_agg(
      CASE
        WHEN jsonb_typeof(x.e) <> 'object' THEN x.e
        ELSE x.e
          || CASE
               WHEN COALESCE(x.e->>'from', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
                 jsonb_build_object('from', to_char(
                   public._event_clone_shift((x.e->>'from')::timestamptz, p_src_tz, p_dst_tz, p_delta)
                     AT TIME ZONE 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
               ELSE '{}'::jsonb
             END
          || CASE
               WHEN COALESCE(x.e->>'to', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
                 jsonb_build_object('to', to_char(
                   public._event_clone_shift((x.e->>'to')::timestamptz, p_src_tz, p_dst_tz, p_delta)
                     AT TIME ZONE 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
               ELSE '{}'::jsonb
             END
      END
      ORDER BY x.ord
    )
    FROM jsonb_array_elements(COALESCE(p_schedule, '[]'::jsonb)) WITH ORDINALITY AS x(e, ord)
  ), '[]'::jsonb);
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_shift_schedule(jsonb, text, text, interval)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_shift_schedule(jsonb, text, text, interval)
  TO service_role;
COMMENT ON FUNCTION public._event_clone_shift_schedule(jsonb, text, text, interval) IS
  'Przesuwa pola from/to progow cen (event_ticket_types.price_schedule) i zapisuje je jako ISO w UTC (ksztalt toISOString klienta). Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_flag(p_obj jsonb, p_key text, p_default boolean)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN jsonb_typeof(p_obj -> p_key) = 'boolean' THEN (p_obj ->> p_key)::boolean
    ELSE p_default
  END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_flag(jsonb, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_flag(jsonb, text, boolean) TO service_role;
COMMENT ON FUNCTION public._event_clone_flag(jsonb, text, boolean) IS
  'Flaga z ladunku: wartosc logiczna JSON albo domyslna (zly typ nie wywraca klonu). Pomocnik klonu edycji.';

-- ----------------------------------------------------------------------------
-- 3) USTAWIENIA KLONU: przelaczniki include + opcje, z domyslnymi
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_clone_settings(p_payload jsonb, p_strict boolean)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_inc jsonb := CASE WHEN jsonb_typeof(p_payload->'include') = 'object'
                      THEN p_payload->'include' ELSE '{}'::jsonb END;
  v_opt jsonb := CASE WHEN jsonb_typeof(p_payload->'options') = 'object'
                      THEN p_payload->'options' ELSE '{}'::jsonb END;
  v_include jsonb;
  v_suffix text := NULLIF(upper(btrim(COALESCE(v_opt->>'code_suffix', ''))), '');
  v_due integer := 30;
  v_tasks boolean := public._event_clone_flag(v_opt, 'crm_renewal_tasks', false);
BEGIN
  v_include := jsonb_build_object(
    'agenda', public._event_clone_flag(v_inc, 'agenda', true),
    'speakers', public._event_clone_flag(v_inc, 'speakers', true),
    'registration', public._event_clone_flag(v_inc, 'registration', true),
    'tickets', public._event_clone_flag(v_inc, 'tickets', true),
    'sponsors', public._event_clone_flag(v_inc, 'sponsors', true),
    'sponsor_materials', public._event_clone_flag(v_inc, 'sponsor_materials', false),
    'home_ads', public._event_clone_flag(v_inc, 'home_ads', false),
    'pages', public._event_clone_flag(v_inc, 'pages', true),
    'onsite', public._event_clone_flag(v_inc, 'onsite', true),
    'meetings', public._event_clone_flag(v_inc, 'meetings', true),
    'codes', public._event_clone_flag(v_inc, 'codes', false),
    'cfp', public._event_clone_flag(v_inc, 'cfp', true),
    'seating', public._event_clone_flag(v_inc, 'seating', true),
    'ad_campaigns', public._event_clone_flag(v_inc, 'ad_campaigns', false)
  );

  IF v_suffix IS NOT NULL AND v_suffix !~ '^[A-Z0-9_-]{1,20}$' THEN
    IF p_strict THEN
      RAISE EXCEPTION 'invalid_code_suffix: suffix must have 1-20 letters, digits, dashes or underscores';
    END IF;
    v_suffix := NULL;
  END IF;
  IF (v_include->>'codes')::boolean AND v_suffix IS NULL AND p_strict THEN
    RAISE EXCEPTION 'invalid_code_suffix: copied codes need a suffix, codes are unique in the organisation';
  END IF;

  IF jsonb_typeof(v_opt->'crm_task_due_days') = 'number' THEN
    IF (v_opt->>'crm_task_due_days')::numeric BETWEEN 1 AND 365
       AND (v_opt->>'crm_task_due_days')::numeric = trunc((v_opt->>'crm_task_due_days')::numeric) THEN
      v_due := (v_opt->>'crm_task_due_days')::integer;
    ELSIF p_strict AND v_tasks THEN
      RAISE EXCEPTION 'invalid_task_due_days: due date must be 1-365 days from now';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'include', v_include,
    'options', jsonb_build_object(
      'include_cancelled_sessions', public._event_clone_flag(v_opt, 'include_cancelled_sessions', false),
      'sessions_as_draft', public._event_clone_flag(v_opt, 'sessions_as_draft', false),
      'sponsors_unpublished', public._event_clone_flag(v_opt, 'sponsors_unpublished', true),
      'keep_access_codes', public._event_clone_flag(v_opt, 'keep_access_codes', false),
      'refresh_sponsor_snapshots', public._event_clone_flag(v_opt, 'refresh_sponsor_snapshots', true),
      'crm_renewal_tasks', v_tasks,
      'crm_task_due_days', v_due,
      'cfp_reviewers', public._event_clone_flag(v_opt, 'cfp_reviewers', false),
      'code_suffix', v_suffix
    )
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_settings(jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_settings(jsonb, boolean) TO service_role;
COMMENT ON FUNCTION public._event_clone_settings(jsonb, boolean) IS
  'Rozstrzyga przelaczniki include i opcje klonu z wartosciami domyslnymi. p_strict = odmowa dla zlego przyrostka kodow i terminu zadan CRM (klon); bez niego wartosc jest cicho pomijana (podglad). Pomocnik klonu edycji.';

-- ----------------------------------------------------------------------------
-- 4) ROZSTRZYGNIECIE ZRODLA I PRZESUNIECIA (wspolne dla klonu i podgladu)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_clone_resolve(
  p_tenant uuid, p_payload jsonb, p_require_start boolean
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_src public.events;
  v_src_id uuid;
  v_src_tz text;
  v_tz text := NULLIF(btrim(COALESCE(p_payload->>'timezone', '')), '');
  v_start timestamptz;
  v_end timestamptz;
  v_suggested timestamptz;
  v_delta interval;
  v_days integer;
BEGIN
  BEGIN
    v_src_id := NULLIF(btrim(COALESCE(p_payload->>'source_event_id', '')), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_src_id := NULL;
  END;
  IF v_src_id IS NULL THEN
    RAISE EXCEPTION 'invalid_source: source_event_id must be an event id';
  END IF;

  SELECT * INTO v_src
  FROM public.events e
  WHERE e.id = v_src_id AND e.tenant_id = p_tenant;
  IF v_src.id IS NULL THEN
    RAISE EXCEPTION 'not_found: source event does not exist in this tenant';
  END IF;

  -- Strefa zrodla nie ma CHECK-a w bazie: nieznana nazwa spada do domyslnej
  -- strefy serwisu, tak samo jak w `eventTimeZone()` frontu.
  v_src_tz := CASE
    WHEN EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = v_src.timezone)
      THEN v_src.timezone
    ELSE 'Europe/Warsaw'
  END;
  IF v_tz IS NULL THEN
    v_tz := v_src_tz;
  ELSIF NOT EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = v_tz) THEN
    RAISE EXCEPTION 'invalid_timezone: unknown time zone name';
  END IF;

  -- Podpowiedz: ta sama godzina lokalna rok pozniej, w strefie celu.
  v_suggested := ((v_src.starts_at AT TIME ZONE v_src_tz) + interval '1 year') AT TIME ZONE v_tz;

  BEGIN
    v_start := NULLIF(btrim(COALESCE(p_payload->>'starts_at', '')), '')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN
    RAISE EXCEPTION 'invalid_starts_at: start must be an ISO date';
  END;
  IF v_start IS NULL THEN
    IF p_require_start THEN
      RAISE EXCEPTION 'invalid_starts_at: start date is required';
    END IF;
    v_start := v_suggested;
  END IF;

  BEGIN
    v_end := NULLIF(btrim(COALESCE(p_payload->>'ends_at', '')), '')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN
    RAISE EXCEPTION 'invalid_ends_at: end must be an ISO date';
  END;
  IF v_end IS NOT NULL AND v_end <= v_start THEN
    RAISE EXCEPTION 'invalid_ends_at: end must be after the start';
  END IF;

  v_delta := (v_start AT TIME ZONE v_tz) - (v_src.starts_at AT TIME ZONE v_src_tz);
  v_days := (v_start AT TIME ZONE v_tz)::date - (v_src.starts_at AT TIME ZONE v_src_tz)::date;

  IF v_end IS NULL AND v_src.ends_at IS NOT NULL THEN
    v_end := public._event_clone_shift(v_src.ends_at, v_src_tz, v_tz, v_delta);
    -- Luka czasu letniego potrafi zjesc godzine krotkiego wydarzenia; koniec
    -- nie moze wtedy wypasc przed poczatkiem (CHECK `ends_at > starts_at`).
    IF v_end <= v_start THEN
      v_end := v_start + (v_src.ends_at - v_src.starts_at);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'source_event_id', v_src.id,
    'source_tz', v_src_tz,
    'timezone', v_tz,
    'starts_at', v_start,
    'ends_at', v_end,
    'suggested_starts_at', v_suggested,
    'delta', v_delta::text,
    'day_shift', v_days
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_resolve(uuid, jsonb, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_resolve(uuid, jsonb, boolean) TO service_role;
COMMENT ON FUNCTION public._event_clone_resolve(uuid, jsonb, boolean) IS
  'Waliduje zrodlo (w najemcy wolajacego), strefe, poczatek i koniec klonu i liczy przesuniecie w czasie lokalnym. Wspolne dla admin_event_clone i admin_event_clone_preview. Pomocnik klonu edycji.';

-- Sesje, ktore klon naprawde przeniesie: nieodwolane (albo wszystkie przy
-- `include_cancelled_sessions`) i dzieci wylacznie przenoszonych rodzicow.
CREATE OR REPLACE FUNCTION public._event_clone_session_window(
  p_tenant uuid, p_src uuid, p_res jsonb, p_inc jsonb, p_opt jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_src_tz text := p_res->>'source_tz';
  v_tz text := p_res->>'timezone';
  v_delta interval := (p_res->>'delta')::interval;
  v_start timestamptz := (p_res->>'starts_at')::timestamptz;
  v_end timestamptz := (p_res->>'ends_at')::timestamptz;
  v_all boolean := (p_opt->>'include_cancelled_sessions')::boolean;
  v_first timestamptz;
  v_last timestamptz;
  v_outside integer;
BEGIN
  IF NOT (p_inc->>'agenda')::boolean THEN
    RETURN jsonb_build_object('first_starts_at', NULL, 'last_ends_at', NULL, 'outside', 0);
  END IF;

  SELECT min(x.st), max(x.en),
         count(*) FILTER (WHERE x.st < v_start OR (v_end IS NOT NULL AND x.en > v_end))
    INTO v_first, v_last, v_outside
  FROM (
    SELECT public._event_clone_shift(s.starts_at, v_src_tz, v_tz, v_delta) AS st,
           public._event_clone_shift(s.ends_at, v_src_tz, v_tz, v_delta) AS en
    FROM public.event_sessions s
    LEFT JOIN public.event_sessions p
      ON p.tenant_id = s.tenant_id AND p.event_id = s.event_id AND p.id = s.parent_session_id
    WHERE s.tenant_id = p_tenant
      AND s.event_id = p_src
      AND (v_all OR s.status <> 'cancelled')
      AND (s.parent_session_id IS NULL OR v_all OR p.status <> 'cancelled')
  ) AS x;

  RETURN jsonb_build_object('first_starts_at', v_first, 'last_ends_at', v_last, 'outside', v_outside);
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_session_window(uuid, uuid, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_session_window(uuid, uuid, jsonb, jsonb, jsonb)
  TO service_role;
COMMENT ON FUNCTION public._event_clone_session_window(uuid, uuid, jsonb, jsonb, jsonb) IS
  'Pierwsza i ostatnia przesunieta sesja oraz liczba sesji poza oknem nowego wydarzenia (ta sama regula doboru sesji co klon agendy). Pomocnik klonu edycji.';

-- Slug z tytulu PL (ta sama transliteracja co `_event_slugify`), a przy
-- tytule bez liter - ze sluga zrodla; wolny numer doklejany jak w
-- `admin_event_create`.
CREATE OR REPLACE FUNCTION public._event_clone_slug_candidate(
  p_tenant uuid, p_title_pl text, p_src_slug text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_base text := left(public._event_slugify(p_title_pl), 110);
  v_slug text;
  v_suffix integer := 1;
BEGIN
  IF char_length(v_base) < 3 THEN
    v_base := left(p_src_slug, 110);
  END IF;
  v_slug := v_base;
  WHILE EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = p_tenant AND e.slug = v_slug
  ) LOOP
    v_suffix := v_suffix + 1;
    v_slug := v_base || '-' || v_suffix::text;
  END LOOP;
  RETURN v_slug;
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_slug_candidate(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_slug_candidate(uuid, text, text) TO service_role;
COMMENT ON FUNCTION public._event_clone_slug_candidate(uuid, text, text) IS
  'Wolny slug nowej edycji z tytulu PL (fallback: slug zrodla) z doklejanym numerem. Pomocnik klonu edycji.';

-- ----------------------------------------------------------------------------
-- 5) LICZNIKI, DATY I OSTRZEZENIA (podglad i wynik klonu)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_clone_counts(p_tenant uuid, p_src uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'groups', (SELECT count(*) FROM public.event_groups x WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'rooms', (SELECT count(*) FROM public.event_rooms x WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'tracks', (SELECT count(*) FROM public.event_tracks x WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'sessions', (SELECT count(*) FROM public.event_sessions x
                  WHERE x.tenant_id = p_tenant AND x.event_id = p_src AND x.status <> 'cancelled'),
    'cancelled_sessions', (SELECT count(*) FROM public.event_sessions x
                            WHERE x.tenant_id = p_tenant AND x.event_id = p_src AND x.status = 'cancelled'),
    'session_speakers', (SELECT count(*) FROM public.event_session_speakers x
                          WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'speakers', (SELECT count(*) FROM public.event_speaker_entries x
                  WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'ticket_types', (SELECT count(*) FROM public.event_ticket_types x
                      WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'packages', (SELECT count(*) FROM public.event_ticket_packages x
                  WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'fields', (SELECT count(*) FROM public.event_registration_fields x
                WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'terms', (SELECT count(*) FROM public.event_terms x WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'sponsor_tiers', (SELECT count(*) FROM public.event_sponsor_tiers x
                       WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'sponsors', (SELECT count(*) FROM public.event_sponsors x WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'sponsor_contacts', (SELECT count(*) FROM public.event_sponsor_contacts x
                          WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'sponsor_materials', (SELECT count(*) FROM public.event_sponsor_materials x
                           WHERE x.tenant_id = p_tenant AND x.event_id = p_src)
  ) || jsonb_build_object(
    'home_ads', (SELECT count(*) FROM public.event_home_ads x WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'pages', (SELECT count(*) FROM public.event_pages x WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'page_sections', (SELECT count(*) FROM public.event_page_sections x
                       WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'checkpoints', (SELECT count(*) FROM public.event_checkpoints x
                     WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'badge_templates', (SELECT count(*) FROM public.event_badge_templates x
                         WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'meeting_settings', (SELECT count(*) FROM public.event_meeting_settings x
                          WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'meeting_tables', (SELECT count(*) FROM public.event_meeting_tables x
                        WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'codes', (SELECT count(*) FROM public.b2b_coupons x
               WHERE x.tenant_id = p_tenant AND x.event_ids = ARRAY[p_src]),
    'cfp_settings', (SELECT count(*) FROM public.event_cfp_settings x
                      WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'cfp_fields', (SELECT count(*) FROM public.event_cfp_fields x
                    WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'cfp_reviewers', (SELECT count(*) FROM public.event_cfp_reviewers x
                       WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'seat_maps', (SELECT count(*) FROM public.event_seat_maps x WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'seats', (SELECT count(*) FROM public.event_seats x WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'ad_campaigns', (SELECT count(*) FROM public.event_ad_campaigns x
                      WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'renewal_contacts', (SELECT count(DISTINCT x.lead_id) FROM public.event_sponsor_contacts x
                          WHERE x.tenant_id = p_tenant AND x.event_id = p_src AND x.role = 'primary')
  );
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_counts(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_counts(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public._event_clone_counts(uuid, uuid) IS
  'Liczby wierszy konfiguracji wydarzenia zrodla per sekcja klonu (etykiety przelacznikow podgladu). Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_not_copied(p_tenant uuid, p_src uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'registrations', (SELECT count(*) FROM public.event_registrations x
                       WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'package_orders', (SELECT count(*) FROM public.event_package_orders x
                        WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'checkins', (SELECT count(*) FROM public.event_checkins x WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'lead_scans', (SELECT count(*) FROM public.event_lead_scans x
                    WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'meetings', (SELECT count(*) FROM public.event_meetings x WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'scanner_devices', (SELECT count(*) FROM public.event_scanner_devices x
                         WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'cfp_submissions', (SELECT count(*) FROM public.event_cfp_submissions x
                         WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'seat_assignments', (SELECT count(*) FROM public.event_seat_assignments x
                          WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'invoices', (SELECT count(*) FROM public.event_invoices x WHERE x.tenant_id = p_tenant AND x.event_id = p_src)
  );
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_not_copied(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_not_copied(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public._event_clone_not_copied(uuid, uuid) IS
  'Liczby danych osobowych i transakcyjnych zrodla, ktorych klon z zasady NIE przenosi (zapisy, zamowienia, odprawy, skany, spotkania, urzadzenia, zgloszenia, przydzialy, faktury). Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_dates(p_tenant uuid, p_src uuid, p_res jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_src_tz text := p_res->>'source_tz';
  v_tz text := p_res->>'timezone';
  v_delta interval := (p_res->>'delta')::interval;
  v_days integer := (p_res->>'day_shift')::integer;
  v_rsvp timestamptz;
  v_sales_from timestamptz;
  v_sales_to timestamptz;
  v_cfp_opens timestamptz;
  v_cfp_closes timestamptz;
  v_days_first date;
  v_days_last date;
BEGIN
  SELECT public._event_clone_shift(e.rsvp_opens_at, v_src_tz, v_tz, v_delta) INTO v_rsvp
  FROM public.events e WHERE e.id = p_src AND e.tenant_id = p_tenant;

  SELECT min(public._event_clone_shift(x.sales_from, v_src_tz, v_tz, v_delta)),
         max(public._event_clone_shift(x.sales_to, v_src_tz, v_tz, v_delta))
    INTO v_sales_from, v_sales_to
  FROM (
    SELECT t.sales_from, t.sales_to FROM public.event_ticket_types t
    WHERE t.tenant_id = p_tenant AND t.event_id = p_src
    UNION ALL
    SELECT k.sales_from, k.sales_to FROM public.event_ticket_packages k
    WHERE k.tenant_id = p_tenant AND k.event_id = p_src
  ) AS x;

  SELECT public._event_clone_shift(c.opens_at, v_src_tz, v_tz, v_delta),
         public._event_clone_shift(c.closes_at, v_src_tz, v_tz, v_delta)
    INTO v_cfp_opens, v_cfp_closes
  FROM public.event_cfp_settings c WHERE c.tenant_id = p_tenant AND c.event_id = p_src;

  SELECT min(u.d) + v_days, max(u.d) + v_days INTO v_days_first, v_days_last
  FROM public.event_meeting_settings m
  CROSS JOIN LATERAL unnest(m.meeting_days) AS u(d)
  WHERE m.tenant_id = p_tenant AND m.event_id = p_src;

  RETURN jsonb_build_object(
    'rsvp_opens_at', v_rsvp,
    'sales_from', v_sales_from,
    'sales_to', v_sales_to,
    'cfp_opens_at', v_cfp_opens,
    'cfp_closes_at', v_cfp_closes,
    'meeting_days_first', v_days_first,
    'meeting_days_last', v_days_last
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_dates(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_dates(uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_dates(uuid, uuid, jsonb) IS
  'Kluczowe daty konfiguracji po przesunieciu (otwarcie RSVP, okno sprzedazy, okno naboru, dni gieldy spotkan) do podgladu klonu. Pomocnik klonu edycji.';

-- Ostrzezenie = {code, count}; zero nie jest ostrzezeniem. Te same reguly
-- widzi podglad (przed kliknieciem) i wynik klonu (po nim).
CREATE OR REPLACE FUNCTION public._event_clone_forecast(
  p_tenant uuid, p_src uuid, p_res jsonb, p_inc jsonb, p_opt jsonb, p_url_override boolean
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_src public.events;
  v_src_tz text := p_res->>'source_tz';
  v_tz text := p_res->>'timezone';
  v_delta interval := (p_res->>'delta')::interval;
  v_start timestamptz := (p_res->>'starts_at')::timestamptz;
  v_all boolean := (p_opt->>'include_cancelled_sessions')::boolean;
  v_out jsonb := '[]'::jsonb;
  v_n integer;
BEGIN
  SELECT * INTO v_src FROM public.events e WHERE e.id = p_src AND e.tenant_id = p_tenant;

  IF v_start < now() THEN
    v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'starts_in_past', 'count', 1));
  END IF;

  IF v_src.registration_mode = 'external' AND NOT p_url_override THEN
    v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'external_url_copied', 'count', 1));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.event_types t
    WHERE t.tenant_id = p_tenant AND t.id = v_src.event_type_id AND NOT t.is_active
  ) THEN
    v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'type_inactive', 'count', 1));
  END IF;

  IF public._event_clone_shift(v_src.rsvp_opens_at, v_src_tz, v_tz, v_delta) < now() THEN
    v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'rsvp_opens_in_past', 'count', 1));
  END IF;

  IF (p_inc->>'agenda')::boolean AND NOT v_all THEN
    SELECT count(*) INTO v_n FROM public.event_sessions s
    LEFT JOIN public.event_sessions p
      ON p.tenant_id = s.tenant_id AND p.event_id = s.event_id AND p.id = s.parent_session_id
    WHERE s.tenant_id = p_tenant AND s.event_id = p_src
      AND (s.status = 'cancelled' OR p.status = 'cancelled');
    IF v_n > 0 THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'cancelled_sessions_skipped', 'count', v_n));
    END IF;
  END IF;

  IF (p_inc->>'speakers')::boolean AND NOT (p_inc->>'agenda')::boolean THEN
    SELECT count(*) INTO v_n FROM public.event_session_speakers x
    WHERE x.tenant_id = p_tenant AND x.event_id = p_src;
    IF v_n > 0 THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'cast_needs_agenda', 'count', v_n));
    END IF;
  END IF;

  IF (p_inc->>'tickets')::boolean THEN
    SELECT count(*) INTO v_n FROM (
      SELECT t.sales_to FROM public.event_ticket_types t
      WHERE t.tenant_id = p_tenant AND t.event_id = p_src
      UNION ALL
      SELECT k.sales_to FROM public.event_ticket_packages k
      WHERE k.tenant_id = p_tenant AND k.event_id = p_src
    ) AS x
    WHERE public._event_clone_shift(x.sales_to, v_src_tz, v_tz, v_delta) <= now();
    IF v_n > 0 THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'sales_closed', 'count', v_n));
    END IF;
    IF NOT (p_opt->>'keep_access_codes')::boolean THEN
      SELECT count(*) INTO v_n FROM public.event_ticket_types t
      WHERE t.tenant_id = p_tenant AND t.event_id = p_src AND t.access_code_hash IS NOT NULL;
      IF v_n > 0 THEN
        v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'access_codes_dropped', 'count', v_n));
      END IF;
    END IF;
  END IF;

  SELECT count(*) INTO v_n FROM public.b2b_coupons c
  WHERE c.tenant_id = p_tenant AND c.event_ids = ARRAY[p_src];
  IF v_n > 0 AND NOT (p_inc->>'codes')::boolean THEN
    v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'codes_not_copied', 'count', v_n));
  ELSIF v_n > 0 AND NOT (p_inc->>'tickets')::boolean THEN
    v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'codes_need_tickets', 'count', v_n));
  END IF;

  IF (p_inc->>'onsite')::boolean THEN
    SELECT count(*) INTO v_n FROM public.event_checkpoints c
    LEFT JOIN public.event_sessions s
      ON s.tenant_id = c.tenant_id AND s.event_id = c.event_id AND s.id = c.session_id
    LEFT JOIN public.event_sessions p
      ON p.tenant_id = s.tenant_id AND p.event_id = s.event_id AND p.id = s.parent_session_id
    WHERE c.tenant_id = p_tenant AND c.event_id = p_src
      AND (
        (c.kind = 'company_booth' AND NOT (p_inc->>'sponsors')::boolean)
        OR (c.kind = 'session' AND (
          NOT (p_inc->>'agenda')::boolean
          OR (NOT v_all AND (s.status = 'cancelled' OR p.status = 'cancelled'))
        ))
      );
    IF v_n > 0 THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'checkpoints_without_target', 'count', v_n));
    END IF;
  END IF;

  IF (p_inc->>'pages')::boolean AND v_src.root_page_id IS NOT NULL THEN
    WITH RECURSIVE tree AS (
      SELECT a.id, 1 AS depth FROM public.pages a
      WHERE a.tenant_id = p_tenant AND a.parent_id = v_src.root_page_id AND a.deleted_at IS NULL
      UNION ALL
      SELECT b.id, tree.depth + 1 FROM public.pages b
      JOIN tree ON b.parent_id = tree.id
      WHERE b.tenant_id = p_tenant AND b.deleted_at IS NULL AND tree.depth < 10
    )
    SELECT count(*) INTO v_n FROM tree
    WHERE NOT EXISTS (
      SELECT 1 FROM public.event_pages m
      WHERE m.tenant_id = p_tenant AND m.event_id = p_src AND m.module IS NOT NULL
        AND m.page_id = tree.id
    );
    IF v_n > 0 THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'pages_copied_as_draft', 'count', v_n));
    END IF;
  END IF;

  IF (p_inc->>'sponsors')::boolean AND (p_opt->>'sponsors_unpublished')::boolean THEN
    SELECT count(*) INTO v_n FROM public.event_sponsors s
    WHERE s.tenant_id = p_tenant AND s.event_id = p_src AND s.is_published;
    IF v_n > 0 THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'sponsors_unpublished', 'count', v_n));
    END IF;
  END IF;

  IF (p_inc->>'seating')::boolean THEN
    SELECT count(*) INTO v_n FROM public.event_seats s
    WHERE s.tenant_id = p_tenant AND s.event_id = p_src AND s.status = 'held' AND s.hold_company_id IS NULL;
    IF v_n > 0 THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'seat_holds_cleared', 'count', v_n));
    END IF;
  END IF;

  IF (p_inc->>'cfp')::boolean THEN
    IF EXISTS (
      SELECT 1 FROM public.event_cfp_settings c
      WHERE c.tenant_id = p_tenant AND c.event_id = p_src
        AND public._event_clone_shift(c.closes_at, v_src_tz, v_tz, v_delta) <= now()
    ) THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'cfp_window_in_past', 'count', 1));
    END IF;
    IF NOT (p_opt->>'cfp_reviewers')::boolean THEN
      SELECT count(*) INTO v_n FROM public.event_cfp_reviewers r
      WHERE r.tenant_id = p_tenant AND r.event_id = p_src;
      IF v_n > 0 THEN
        v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'cfp_reviewers_not_copied', 'count', v_n));
      END IF;
    END IF;
  END IF;

  RETURN v_out;
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_forecast(uuid, uuid, jsonb, jsonb, jsonb, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_forecast(uuid, uuid, jsonb, jsonb, jsonb, boolean)
  TO service_role;
COMMENT ON FUNCTION public._event_clone_forecast(uuid, uuid, jsonb, jsonb, jsonb, boolean) IS
  'Ostrzezenia klonu {code, count}: daty w przeszlosci, adres zapisow z poprzedniej edycji, nieaktywny rodzaj, pominiete sesje odwolane, kody i punkty odprawy bez celu, strony jako szkice, sponsorzy nieopublikowani, wyczyszczone rezerwacje miejsc, nabor. Te same w podgladzie i w wyniku. Pomocnik klonu edycji.';

-- ----------------------------------------------------------------------------
-- 6) POMOCNICY MODULOW. Kazdy dostaje (najemca, zrodlo, nowe, kontekst) i
--    oddaje {copied, skipped}. Kontekst: src_tz, tz, delta, day_shift, uid,
--    src_slug, slug, title_pl, title_en, src_title_pl, include, options.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_clone_groups(
  p_tenant uuid, p_src uuid, p_new uuid, p_ctx jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_n integer;
BEGIN
  -- Grupy zasiane wyzwalaczem przy INSERT-cie wydarzenia jeszcze nic nie
  -- wskazuje, wiec mozna je zastapic grupami zrodla (klucze i flagi 1:1).
  DELETE FROM public.event_groups g WHERE g.tenant_id = p_tenant AND g.event_id = p_new;

  INSERT INTO public.event_groups (
    id, tenant_id, event_id, key, name_pl, name_en, description_pl, description_en,
    color, attendee_visibility, can_see_attendees, can_meet, can_chat,
    can_lead_retrieval, can_see_recording, min_tier_rank, sort_order, is_default, is_system
  )
  SELECT public._event_clone_id(p_new, g.id), p_tenant, p_new, g.key, g.name_pl, g.name_en,
         g.description_pl, g.description_en, g.color, g.attendee_visibility,
         g.can_see_attendees, g.can_meet, g.can_chat, g.can_lead_retrieval,
         g.can_see_recording, g.min_tier_rank, g.sort_order, g.is_default, g.is_system
  FROM public.event_groups g
  WHERE g.tenant_id = p_tenant AND g.event_id = p_src;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- Dosiew grup systemowych, ktorych zrodlo nie mialo (domyslna zostaje jedna).
  PERFORM public._event_seed_default_groups(p_tenant, p_new);

  RETURN jsonb_build_object('copied', jsonb_build_object('groups', v_n));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_groups(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_groups(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_groups(uuid, uuid, uuid, jsonb) IS
  'Klon grup uczestnikow (zawsze): zastepuje grupy zasiane przy INSERT-cie grupami zrodla i dosiewa brakujace systemowe. Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_rooms(
  p_tenant uuid, p_src uuid, p_new uuid, p_ctx jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_n integer;
BEGIN
  INSERT INTO public.event_rooms (
    id, tenant_id, event_id, name, capacity, floor, location_note, sort_order, is_active
  )
  SELECT public._event_clone_id(p_new, r.id), p_tenant, p_new, r.name, r.capacity, r.floor,
         r.location_note, r.sort_order, r.is_active
  FROM public.event_rooms r
  WHERE r.tenant_id = p_tenant AND r.event_id = p_src;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('copied', jsonb_build_object('rooms', v_n));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_rooms(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_rooms(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_rooms(uuid, uuid, uuid, jsonb) IS
  'Klon sal wydarzenia (czesc agendy). Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_sponsors(
  p_tenant uuid, p_src uuid, p_new uuid, p_ctx jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := (p_ctx->>'uid')::uuid;
  v_with_sponsors boolean := (p_ctx->'include'->>'sponsors')::boolean;
  v_materials boolean := (p_ctx->'include'->>'sponsor_materials')::boolean;
  v_unpublish boolean := (p_ctx->'options'->>'sponsors_unpublished')::boolean;
  v_refresh boolean := (p_ctx->'options'->>'refresh_sponsor_snapshots')::boolean;
  v_tiers integer;
  v_benefits integer;
  v_sponsors integer := 0;
  v_refreshed integer := 0;
  v_contacts integer := 0;
  v_mats integer := 0;
BEGIN
  -- Poziomy i ich korzysci przechodza ZAWSZE: to cennik partnerstwa, nie umowa.
  INSERT INTO public.event_sponsor_tiers (
    id, tenant_id, event_id, key, name_pl, name_en, description_pl, description_en,
    rank, accent_color, logo_size, max_companies, sort_order, is_active, layout
  )
  SELECT public._event_clone_id(p_new, t.id), p_tenant, p_new, t.key, t.name_pl, t.name_en,
         t.description_pl, t.description_en, t.rank, t.accent_color, t.logo_size,
         t.max_companies, t.sort_order, t.is_active, t.layout
  FROM public.event_sponsor_tiers t
  WHERE t.tenant_id = p_tenant AND t.event_id = p_src;
  GET DIAGNOSTICS v_tiers = ROW_COUNT;

  INSERT INTO public.event_sponsor_tier_benefits (
    id, tenant_id, event_id, tier_id, label_pl, label_en, sort_order
  )
  SELECT public._event_clone_id(p_new, b.id), p_tenant, p_new,
         public._event_clone_id(p_new, b.tier_id), b.label_pl, b.label_en, b.sort_order
  FROM public.event_sponsor_tier_benefits b
  WHERE b.tenant_id = p_tenant AND b.event_id = p_src;
  GET DIAGNOSTICS v_benefits = ROW_COUNT;

  IF v_with_sponsors THEN
    -- Migawka z CRM tylko dla wierszy `snapshot_source = 'crm'` i tylko
    -- wartosciami, ktore przejda ograniczenia migawki (logo i kraj z kartoteki
    -- nie sa w niej walidowane) - reczne nadpisanie redakcji zostaje.
    INSERT INTO public.event_sponsors (
      id, tenant_id, event_id, company_id, tier_id, role, booth_label, sort_order,
      is_published, snapshot_name, snapshot_logo_url, snapshot_description_pl,
      snapshot_description_en, snapshot_website, snapshot_country, snapshot_source,
      snapshot_taken_at, internal_note, created_by, link_mode, link_url
    )
    SELECT public._event_clone_id(p_new, s.id), p_tenant, p_new, s.company_id,
           public._event_clone_id(p_new, s.tier_id), s.role, s.booth_label, s.sort_order,
           s.is_published AND NOT v_unpublish,
           CASE WHEN x.refresh THEN left(btrim(c.name), 200) ELSE s.snapshot_name END,
           CASE
             WHEN NOT x.refresh THEN s.snapshot_logo_url
             WHEN NULLIF(btrim(COALESCE(c.logo_url, '')), '') IS NULL THEN NULL
             WHEN btrim(c.logo_url) ~ '^(https?://|/)' THEN btrim(c.logo_url)
             ELSE s.snapshot_logo_url
           END,
           s.snapshot_description_pl, s.snapshot_description_en,
           CASE WHEN x.refresh THEN public._event_sponsor_web_url(c.website) ELSE s.snapshot_website END,
           CASE
             WHEN NOT x.refresh THEN s.snapshot_country
             WHEN NULLIF(btrim(COALESCE(c.country, '')), '') IS NULL THEN NULL
             WHEN char_length(btrim(c.country)) BETWEEN 2 AND 120 THEN btrim(c.country)
             ELSE s.snapshot_country
           END,
           s.snapshot_source,
           CASE WHEN x.refresh THEN now() ELSE s.snapshot_taken_at END,
           s.internal_note, v_uid, s.link_mode, s.link_url
    FROM public.event_sponsors s
    LEFT JOIN public.crm_companies c ON c.tenant_id = s.tenant_id AND c.id = s.company_id
    CROSS JOIN LATERAL (
      SELECT v_refresh AND s.snapshot_source = 'crm' AND btrim(COALESCE(c.name, '')) <> '' AS refresh
    ) AS x
    WHERE s.tenant_id = p_tenant AND s.event_id = p_src;
    GET DIAGNOSTICS v_sponsors = ROW_COUNT;

    IF v_refresh THEN
      SELECT count(*) INTO v_refreshed
      FROM public.event_sponsors s
      JOIN public.crm_companies c ON c.tenant_id = s.tenant_id AND c.id = s.company_id
      WHERE s.tenant_id = p_tenant AND s.event_id = p_src
        AND s.snapshot_source = 'crm' AND btrim(c.name) <> '';
    END IF;

    INSERT INTO public.event_sponsor_contacts (
      id, tenant_id, event_id, sponsor_id, lead_id, role, sort_order, created_by
    )
    SELECT public._event_clone_id(p_new, k.id), p_tenant, p_new,
           public._event_clone_id(p_new, k.sponsor_id), k.lead_id, k.role, k.sort_order, v_uid
    FROM public.event_sponsor_contacts k
    WHERE k.tenant_id = p_tenant AND k.event_id = p_src;
    GET DIAGNOSTICS v_contacts = ROW_COUNT;

    IF v_materials THEN
      -- Materialy dotycza poprzedniej edycji (prezentacja, oferta) - wracaja
      -- jako nieopublikowane, do przejrzenia.
      INSERT INTO public.event_sponsor_materials (
        id, tenant_id, event_id, sponsor_id, title_pl, title_en, kind, url, sort_order,
        is_published, created_by
      )
      SELECT public._event_clone_id(p_new, m.id), p_tenant, p_new,
             public._event_clone_id(p_new, m.sponsor_id), m.title_pl, m.title_en, m.kind,
             m.url, m.sort_order, false, v_uid
      FROM public.event_sponsor_materials m
      WHERE m.tenant_id = p_tenant AND m.event_id = p_src;
      GET DIAGNOSTICS v_mats = ROW_COUNT;
    END IF;
  END IF;

  RETURN jsonb_build_object('copied', jsonb_build_object(
    'sponsor_tiers', v_tiers,
    'sponsor_benefits', v_benefits,
    'sponsors', v_sponsors,
    'sponsor_snapshots_refreshed', v_refreshed,
    'sponsor_contacts', v_contacts,
    'sponsor_materials', v_mats
  ));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_sponsors(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_sponsors(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_sponsors(uuid, uuid, uuid, jsonb) IS
  'Klon poziomow sponsorskich z korzysciami (zawsze) oraz sponsorow, kontaktow i opcjonalnie materialow; migawka odswiezana z crm_companies. Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_agenda(
  p_tenant uuid, p_src uuid, p_new uuid, p_ctx jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := (p_ctx->>'uid')::uuid;
  v_src_tz text := p_ctx->>'src_tz';
  v_tz text := p_ctx->>'tz';
  v_delta interval := (p_ctx->>'delta')::interval;
  v_all boolean := (p_ctx->'options'->>'include_cancelled_sessions')::boolean;
  v_draft boolean := (p_ctx->'options'->>'sessions_as_draft')::boolean;
  v_tracks integer;
  v_parents integer;
  v_children integer;
  v_total integer;
BEGIN
  INSERT INTO public.event_tracks (
    id, tenant_id, event_id, key, name_pl, name_en, accent_color, sort_order, is_active,
    tagline_pl, tagline_en, description_pl, description_en, cover_url, is_public,
    default_room_id, sponsor_id
  )
  SELECT public._event_clone_id(p_new, t.id), p_tenant, p_new, t.key, t.name_pl, t.name_en,
         t.accent_color, t.sort_order, t.is_active, t.tagline_pl, t.tagline_en,
         t.description_pl, t.description_en, t.cover_url, t.is_public,
         (SELECT r.id FROM public.event_rooms r
           WHERE r.tenant_id = p_tenant AND r.event_id = p_new
             AND r.id = public._event_clone_id(p_new, t.default_room_id)),
         (SELECT sp.id FROM public.event_sponsors sp
           WHERE sp.tenant_id = p_tenant AND sp.event_id = p_new
             AND sp.id = public._event_clone_id(p_new, t.sponsor_id))
  FROM public.event_tracks t
  WHERE t.tenant_id = p_tenant AND t.event_id = p_src;
  GET DIAGNOSTICS v_tracks = ROW_COUNT;

  -- Rodzice przed dziecmi: wyzwalacz `event_sessions_validate` sprawdza
  -- glebokosc na juz zapisanym rodzicu. Sesja odwolana (na zyczenie) wraca
  -- jako szkic BEZ SALI - patrz naglowek.
  INSERT INTO public.event_sessions (
    id, tenant_id, event_id, parent_session_id, track_id, room_id, sponsor_id,
    title_pl, title_en, description_pl, description_en, affiliation_pl, affiliation_en,
    starts_at, ends_at, format, status, capacity, requires_signup, min_tier_rank,
    chatham_house, is_private, allow_overlap, stream_url, recording_url, sort_order,
    published_at, cancelled_at, created_by
  )
  SELECT public._event_clone_id(p_new, s.id), p_tenant, p_new, NULL,
         (SELECT t.id FROM public.event_tracks t
           WHERE t.tenant_id = p_tenant AND t.event_id = p_new
             AND t.id = public._event_clone_id(p_new, s.track_id)),
         CASE WHEN s.status = 'cancelled' THEN NULL ELSE
           (SELECT r.id FROM public.event_rooms r
             WHERE r.tenant_id = p_tenant AND r.event_id = p_new
               AND r.id = public._event_clone_id(p_new, s.room_id))
         END,
         (SELECT sp.id FROM public.event_sponsors sp
           WHERE sp.tenant_id = p_tenant AND sp.event_id = p_new
             AND sp.id = public._event_clone_id(p_new, s.sponsor_id)),
         s.title_pl, s.title_en, s.description_pl, s.description_en,
         s.affiliation_pl, s.affiliation_en,
         public._event_clone_shift(s.starts_at, v_src_tz, v_tz, v_delta),
         public._event_clone_shift(s.ends_at, v_src_tz, v_tz, v_delta),
         s.format, x.status, s.capacity, s.requires_signup, s.min_tier_rank,
         s.chatham_house, s.is_private, s.allow_overlap, NULL, NULL, s.sort_order,
         CASE WHEN x.status = 'published' THEN now() END, NULL, v_uid
  FROM public.event_sessions s
  CROSS JOIN LATERAL (
    SELECT CASE WHEN v_draft OR s.status = 'cancelled' THEN 'draft' ELSE s.status END AS status
  ) AS x
  WHERE s.tenant_id = p_tenant AND s.event_id = p_src
    AND s.parent_session_id IS NULL
    AND (v_all OR s.status <> 'cancelled');
  GET DIAGNOSTICS v_parents = ROW_COUNT;

  INSERT INTO public.event_sessions (
    id, tenant_id, event_id, parent_session_id, track_id, room_id, sponsor_id,
    title_pl, title_en, description_pl, description_en, affiliation_pl, affiliation_en,
    starts_at, ends_at, format, status, capacity, requires_signup, min_tier_rank,
    chatham_house, is_private, allow_overlap, stream_url, recording_url, sort_order,
    published_at, cancelled_at, created_by
  )
  SELECT public._event_clone_id(p_new, s.id), p_tenant, p_new, np.id,
         (SELECT t.id FROM public.event_tracks t
           WHERE t.tenant_id = p_tenant AND t.event_id = p_new
             AND t.id = public._event_clone_id(p_new, s.track_id)),
         CASE WHEN s.status = 'cancelled' THEN NULL ELSE
           (SELECT r.id FROM public.event_rooms r
             WHERE r.tenant_id = p_tenant AND r.event_id = p_new
               AND r.id = public._event_clone_id(p_new, s.room_id))
         END,
         (SELECT sp.id FROM public.event_sponsors sp
           WHERE sp.tenant_id = p_tenant AND sp.event_id = p_new
             AND sp.id = public._event_clone_id(p_new, s.sponsor_id)),
         s.title_pl, s.title_en, s.description_pl, s.description_en,
         s.affiliation_pl, s.affiliation_en,
         public._event_clone_shift(s.starts_at, v_src_tz, v_tz, v_delta),
         public._event_clone_shift(s.ends_at, v_src_tz, v_tz, v_delta),
         s.format, x.status, s.capacity, s.requires_signup, s.min_tier_rank,
         s.chatham_house, s.is_private, s.allow_overlap, NULL, NULL, s.sort_order,
         CASE WHEN x.status = 'published' THEN now() END, NULL, v_uid
  FROM public.event_sessions s
  JOIN public.event_sessions np
    ON np.tenant_id = p_tenant AND np.event_id = p_new
   AND np.id = public._event_clone_id(p_new, s.parent_session_id)
  CROSS JOIN LATERAL (
    SELECT CASE WHEN v_draft OR s.status = 'cancelled' THEN 'draft' ELSE s.status END AS status
  ) AS x
  WHERE s.tenant_id = p_tenant AND s.event_id = p_src
    AND s.parent_session_id IS NOT NULL
    AND (v_all OR s.status <> 'cancelled');
  GET DIAGNOSTICS v_children = ROW_COUNT;

  SELECT count(*) INTO v_total FROM public.event_sessions s
  WHERE s.tenant_id = p_tenant AND s.event_id = p_src;

  RETURN jsonb_build_object(
    'copied', jsonb_build_object('tracks', v_tracks, 'sessions', v_parents + v_children),
    'skipped', jsonb_build_object('sessions', v_total - v_parents - v_children)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_agenda(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_agenda(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_agenda(uuid, uuid, uuid, jsonb) IS
  'Klon sciezek i sesji (rodzice przed dziecmi) z przesunieciem w czasie lokalnym; bez transmisji i nagran, odwolane pomijane albo jako szkic bez sali. Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_speakers(
  p_tenant uuid, p_src uuid, p_new uuid, p_ctx jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_entries integer;
  v_legacy integer;
  v_cast integer := 0;
BEGIN
  INSERT INTO public.event_speaker_entries (id, tenant_id, event_id, speaker_profile_id, sort_order)
  SELECT public._event_clone_id(p_new, en.id), p_tenant, p_new, en.speaker_profile_id, en.sort_order
  FROM public.event_speaker_entries en
  WHERE en.tenant_id = p_tenant AND en.event_id = p_src;
  GET DIAGNOSTICS v_entries = ROW_COUNT;

  -- Legacy rejestr bez tenant_id: zrodlo jest juz sprawdzone w najemcy
  -- wolajacego, a identyfikator wydarzenia jest globalnie unikalny.
  INSERT INTO public.event_speakers (event_id, user_id, sort_order)
  SELECT p_new, es.user_id, es.sort_order
  FROM public.event_speakers es
  WHERE es.event_id = p_src
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_legacy = ROW_COUNT;

  IF (p_ctx->'include'->>'agenda')::boolean THEN
    INSERT INTO public.event_session_speakers (
      id, tenant_id, event_id, session_id, speaker_profile_id, role, sort_order, allow_overlap
    )
    SELECT public._event_clone_id(p_new, c.id), p_tenant, p_new, ns.id, c.speaker_profile_id,
           c.role, c.sort_order, c.allow_overlap
    FROM public.event_session_speakers c
    JOIN public.event_sessions ns
      ON ns.tenant_id = p_tenant AND ns.event_id = p_new
     AND ns.id = public._event_clone_id(p_new, c.session_id)
    WHERE c.tenant_id = p_tenant AND c.event_id = p_src;
    GET DIAGNOSTICS v_cast = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('copied', jsonb_build_object(
    'speakers', v_entries, 'legacy_speakers', v_legacy, 'session_speakers', v_cast
  ));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_speakers(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_speakers(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_speakers(uuid, uuid, uuid, jsonb) IS
  'Klon listy prelegentow (event_speaker_entries i legacy event_speakers) oraz obsady sesji, gdy przechodzi agenda. Profile prelegentow sa wspolne (bez kopii). Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_tickets(
  p_tenant uuid, p_src uuid, p_new uuid, p_ctx jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_src_tz text := p_ctx->>'src_tz';
  v_tz text := p_ctx->>'tz';
  v_delta interval := (p_ctx->>'delta')::interval;
  v_keep boolean := (p_ctx->'options'->>'keep_access_codes')::boolean;
  v_types integer;
  v_packages integer;
BEGIN
  -- Licznik sprzedazy od zera. Bilet z kodem dostepu bez przeniesienia kodu
  -- wraca NIEAKTYWNY - bez kodu bylby otwarty dla kazdego.
  INSERT INTO public.event_ticket_types (
    id, tenant_id, event_id, key, name_pl, name_en, description_pl, description_en,
    price_cents, currency, quota, sold_count, sales_from, sales_to, min_tier_rank,
    requires_approval, group_id, is_active, sort_order, audience, requires_verification,
    max_per_person, access_code_hash, access_code_hint, early_bird_price_cents,
    early_bird_until, waitlist_enabled, benefits_pl, benefits_en, price_schedule,
    is_hidden, show_price_label, price_label_pl, price_label_en,
    group_registration_enabled, tax_mode, group_max_size
  )
  SELECT public._event_clone_id(p_new, t.id), p_tenant, p_new, t.key, t.name_pl, t.name_en,
         t.description_pl, t.description_en, t.price_cents, t.currency, t.quota, 0,
         public._event_clone_shift(t.sales_from, v_src_tz, v_tz, v_delta),
         public._event_clone_shift(t.sales_to, v_src_tz, v_tz, v_delta),
         t.min_tier_rank, t.requires_approval,
         (SELECT g.id FROM public.event_groups g
           WHERE g.tenant_id = p_tenant AND g.event_id = p_new
             AND g.id = public._event_clone_id(p_new, t.group_id)),
         t.is_active AND (v_keep OR t.access_code_hash IS NULL),
         t.sort_order, t.audience, t.requires_verification, t.max_per_person,
         CASE WHEN v_keep THEN t.access_code_hash END,
         CASE WHEN v_keep THEN t.access_code_hint ELSE '' END,
         t.early_bird_price_cents,
         public._event_clone_shift(t.early_bird_until, v_src_tz, v_tz, v_delta),
         t.waitlist_enabled, t.benefits_pl, t.benefits_en,
         public._event_clone_shift_schedule(t.price_schedule, v_src_tz, v_tz, v_delta),
         t.is_hidden, t.show_price_label, t.price_label_pl, t.price_label_en,
         t.group_registration_enabled, t.tax_mode, t.group_max_size
  FROM public.event_ticket_types t
  WHERE t.tenant_id = p_tenant AND t.event_id = p_src;
  GET DIAGNOSTICS v_types = ROW_COUNT;

  INSERT INTO public.event_ticket_packages (
    id, tenant_id, event_id, ticket_type_id, key, name_pl, name_en, description_pl,
    description_en, audience, requires_verification, seats, price_cents, currency, quota,
    sold_count, sales_from, sales_to, min_tier_rank, is_active, sort_order
  )
  SELECT public._event_clone_id(p_new, k.id), p_tenant, p_new,
         public._event_clone_id(p_new, k.ticket_type_id), k.key, k.name_pl, k.name_en,
         k.description_pl, k.description_en, k.audience, k.requires_verification, k.seats,
         k.price_cents, k.currency, k.quota, 0,
         public._event_clone_shift(k.sales_from, v_src_tz, v_tz, v_delta),
         public._event_clone_shift(k.sales_to, v_src_tz, v_tz, v_delta),
         k.min_tier_rank, k.is_active, k.sort_order
  FROM public.event_ticket_packages k
  WHERE k.tenant_id = p_tenant AND k.event_id = p_src;
  GET DIAGNOSTICS v_packages = ROW_COUNT;

  RETURN jsonb_build_object('copied', jsonb_build_object(
    'ticket_types', v_types, 'packages', v_packages
  ));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_tickets(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_tickets(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_tickets(uuid, uuid, uuid, jsonb) IS
  'Klon rodzajow biletow (progi cen, okna sprzedazy i early bird przesuniete, sprzedaz od zera, kod dostepu tylko na zyczenie) i pakietow. Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_registration(
  p_tenant uuid, p_src uuid, p_new uuid, p_ctx jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_fields integer;
  v_terms integer;
BEGIN
  INSERT INTO public.event_registration_fields (
    id, tenant_id, event_id, key, field_type, label_pl, label_en, help_pl, help_en,
    is_required, options, sort_order, is_qualifying, qualify_operator, qualify_value,
    qualify_outcome, is_active, consent_url_pl, consent_url_en
  )
  SELECT public._event_clone_id(p_new, f.id), p_tenant, p_new, f.key, f.field_type,
         f.label_pl, f.label_en, f.help_pl, f.help_en, f.is_required, f.options, f.sort_order,
         f.is_qualifying, f.qualify_operator, f.qualify_value, f.qualify_outcome, f.is_active,
         f.consent_url_pl, f.consent_url_en
  FROM public.event_registration_fields f
  WHERE f.tenant_id = p_tenant AND f.event_id = p_src;
  GET DIAGNOSTICS v_fields = ROW_COUNT;

  -- Wersja regulaminu zostaje: to ten sam dokument, a zgody sa per term_id.
  INSERT INTO public.event_terms (
    id, tenant_id, event_id, key, label_pl, label_en, body_pl, body_en, external_url,
    display, is_required, version, sort_order, is_active
  )
  SELECT public._event_clone_id(p_new, t.id), p_tenant, p_new, t.key, t.label_pl, t.label_en,
         t.body_pl, t.body_en, t.external_url, t.display, t.is_required, t.version,
         t.sort_order, t.is_active
  FROM public.event_terms t
  WHERE t.tenant_id = p_tenant AND t.event_id = p_src;
  GET DIAGNOSTICS v_terms = ROW_COUNT;

  RETURN jsonb_build_object('copied', jsonb_build_object('fields', v_fields, 'terms', v_terms));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_registration(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_registration(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_registration(uuid, uuid, uuid, jsonb) IS
  'Klon pol formularza zapisow i regulaminow (bez akceptacji). Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_pages(
  p_tenant uuid, p_src uuid, p_new uuid, p_ctx jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := (p_ctx->>'uid')::uuid;
  v_src_slug text := p_ctx->>'src_slug';
  v_new_slug text := p_ctx->>'slug';
  v_src_root uuid;
  v_new_root uuid;
  v_modules integer;
  v_pages integer := 0;
  v_links integer;
  v_sections integer;
  v_parent uuid;
  v_tail text;
  v_try integer;
  r record;
BEGIN
  SELECT e.root_page_id INTO v_src_root FROM public.events e
  WHERE e.id = p_src AND e.tenant_id = p_tenant;
  SELECT e.root_page_id INTO v_new_root FROM public.events e
  WHERE e.id = p_new AND e.tenant_id = p_tenant;

  -- Korzen: tytul nowej edycji (zasiew), tresc ze zrodla.
  UPDATE public.pages np
     SET builder_data = CASE WHEN sp.builder_data IS NULL THEN NULL
                        ELSE replace(sp.builder_data::text, p_src::text, p_new::text)::jsonb END,
         content_pl = sp.content_pl, content_en = sp.content_en,
         excerpt_pl = sp.excerpt_pl, excerpt_en = sp.excerpt_en,
         layout_overrides = sp.layout_overrides, header_override = sp.header_override,
         toc_override = sp.toc_override, takeaways_pl = sp.takeaways_pl,
         takeaways_en = sp.takeaways_en, takeaways_variant = sp.takeaways_variant,
         template_id = sp.template_id, template_type = sp.template_type, editor = sp.editor,
         cover_image_url = sp.cover_image_url, seo_title_pl = sp.seo_title_pl,
         seo_title_en = sp.seo_title_en, seo_description_pl = sp.seo_description_pl,
         seo_description_en = sp.seo_description_en, seo_noindex = sp.seo_noindex,
         seo_og_image_url = sp.seo_og_image_url, updated_at = now()
    FROM public.pages sp
   WHERE np.id = v_new_root AND np.tenant_id = p_tenant
     AND sp.id = v_src_root AND sp.tenant_id = p_tenant AND sp.deleted_at IS NULL;

  -- Strony modulowe: tresc, tytul i stan (szkic zostaje szkicem) ze zrodla.
  UPDATE public.pages np
     SET builder_data = CASE WHEN sp.builder_data IS NULL THEN NULL
                        ELSE replace(sp.builder_data::text, p_src::text, p_new::text)::jsonb END,
         title_pl = sp.title_pl, title_en = sp.title_en,
         status = CASE WHEN sp.status = 'published' THEN np.status
                  ELSE 'draft'::public.post_status END,
         content_pl = sp.content_pl, content_en = sp.content_en,
         excerpt_pl = sp.excerpt_pl, excerpt_en = sp.excerpt_en,
         layout_overrides = sp.layout_overrides, header_override = sp.header_override,
         toc_override = sp.toc_override, takeaways_pl = sp.takeaways_pl,
         takeaways_en = sp.takeaways_en, takeaways_variant = sp.takeaways_variant,
         template_id = sp.template_id, template_type = sp.template_type, editor = sp.editor,
         menu_order = sp.menu_order, cover_image_url = sp.cover_image_url,
         seo_title_pl = sp.seo_title_pl, seo_title_en = sp.seo_title_en,
         seo_description_pl = sp.seo_description_pl, seo_description_en = sp.seo_description_en,
         seo_noindex = sp.seo_noindex, seo_og_image_url = sp.seo_og_image_url, updated_at = now()
    FROM public.event_pages sep
    JOIN public.pages sp ON sp.id = sep.page_id AND sp.tenant_id = sep.tenant_id AND sp.deleted_at IS NULL
    JOIN public.event_pages nep
      ON nep.tenant_id = sep.tenant_id AND nep.event_id = p_new AND nep.module = sep.module
   WHERE sep.tenant_id = p_tenant AND sep.event_id = p_src AND sep.module IS NOT NULL
     AND np.id = nep.page_id AND np.tenant_id = p_tenant;

  -- Wyglad pozycji modulowych menu (etykieta, ikona, kolor, kolejnosc, grupy).
  UPDATE public.event_pages nep
     SET menu_label_pl = sep.menu_label_pl, menu_label_en = sep.menu_label_en,
         icon = sep.icon, color = sep.color, in_menu = sep.in_menu, sort_order = sep.sort_order,
         visible_to_groups = ARRAY(
           SELECT g.id FROM unnest(sep.visible_to_groups) WITH ORDINALITY AS u(gid, ord)
           JOIN public.event_groups g
             ON g.tenant_id = p_tenant AND g.event_id = p_new
            AND g.id = public._event_clone_id(p_new, u.gid)
           ORDER BY u.ord
         ),
         updated_at = now()
    FROM public.event_pages sep
   WHERE sep.tenant_id = p_tenant AND sep.event_id = p_src AND sep.module IS NOT NULL
     AND nep.tenant_id = p_tenant AND nep.event_id = p_new AND nep.module = sep.module;
  GET DIAGNOSTICS v_modules = ROW_COUNT;

  -- Pozostale strony poddrzewa korzenia: SZKICE, rodzic przed dzieckiem.
  FOR r IN
    WITH RECURSIVE tree AS (
      SELECT p.id, 1 AS depth FROM public.pages p
      WHERE p.tenant_id = p_tenant AND p.parent_id = v_src_root AND p.deleted_at IS NULL
      UNION ALL
      SELECT c.id, tree.depth + 1 FROM public.pages c
      JOIN tree ON c.parent_id = tree.id
      WHERE c.tenant_id = p_tenant AND c.deleted_at IS NULL AND tree.depth < 10
    )
    SELECT sp.*, tree.depth FROM tree
    JOIN public.pages sp ON sp.id = tree.id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.event_pages m
      WHERE m.tenant_id = p_tenant AND m.event_id = p_src AND m.module IS NOT NULL
        AND m.page_id = sp.id
    )
    ORDER BY tree.depth, sp.menu_order, sp.title_pl
  LOOP
    -- Rodzic: nowy korzen, nowa strona modulowa albo wczesniej skopiowana
    -- strona (glebokosc rosnaco, wiec rodzic juz istnieje).
    v_parent := NULL;
    IF r.parent_id = v_src_root THEN
      v_parent := v_new_root;
    ELSE
      SELECT nep.page_id INTO v_parent
      FROM public.event_pages sep
      JOIN public.event_pages nep
        ON nep.tenant_id = sep.tenant_id AND nep.event_id = p_new AND nep.module = sep.module
      WHERE sep.tenant_id = p_tenant AND sep.event_id = p_src AND sep.module IS NOT NULL
        AND sep.page_id = r.parent_id;
      v_parent := COALESCE(v_parent, public._event_clone_id(p_new, r.parent_id));
    END IF;

    v_tail := CASE
      WHEN left(r.slug, char_length(v_src_slug) + 1) = v_src_slug || '-'
        THEN substr(r.slug, char_length(v_src_slug) + 2)
      ELSE r.slug
    END;

    FOR v_try IN 1..5 LOOP
      BEGIN
        INSERT INTO public.pages (
          id, tenant_id, parent_id, slug, title_pl, title_en, status, editor, template_type,
          menu_order, builder_data, content_pl, content_en, excerpt_pl, excerpt_en,
          layout_overrides, header_override, toc_override, takeaways_pl, takeaways_en,
          takeaways_variant, template_id, cover_image_url, seo_title_pl, seo_title_en,
          seo_description_pl, seo_description_en, seo_noindex, seo_og_image_url, author_id
        ) VALUES (
          public._event_clone_id(p_new, r.id), p_tenant, v_parent,
          public._event_unique_page_slug(p_tenant, v_new_slug || '-' || v_tail),
          r.title_pl, r.title_en, 'draft'::public.post_status, r.editor, r.template_type,
          r.menu_order,
          CASE WHEN r.builder_data IS NULL THEN NULL
               ELSE replace(r.builder_data::text, p_src::text, p_new::text)::jsonb END,
          r.content_pl, r.content_en, r.excerpt_pl, r.excerpt_en, r.layout_overrides,
          r.header_override, r.toc_override, r.takeaways_pl, r.takeaways_en,
          r.takeaways_variant, r.template_id, r.cover_image_url, r.seo_title_pl,
          r.seo_title_en, r.seo_description_pl, r.seo_description_en, r.seo_noindex,
          r.seo_og_image_url, v_uid
        );
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF v_try = 5 THEN RAISE; END IF;
      END;
    END LOOP;
    v_pages := v_pages + 1;
  END LOOP;

  -- Pozycje menu spoza modulow: skopiowana strona poddrzewa albo TA SAMA
  -- strona serwisu (przypieta spoza poddrzewa).
  INSERT INTO public.event_pages (
    id, tenant_id, event_id, page_id, menu_label_pl, menu_label_en, icon, color, in_menu,
    sort_order, visible_to_groups
  )
  SELECT public._event_clone_id(p_new, sep.id), p_tenant, p_new,
         CASE
           WHEN sep.page_id = v_src_root THEN v_new_root
           ELSE COALESCE(
             (SELECT cp.id FROM public.pages cp
               WHERE cp.tenant_id = p_tenant AND cp.id = public._event_clone_id(p_new, sep.page_id)),
             sep.page_id)
         END,
         sep.menu_label_pl, sep.menu_label_en, sep.icon, sep.color, sep.in_menu, sep.sort_order,
         ARRAY(
           SELECT g.id FROM unnest(sep.visible_to_groups) WITH ORDINALITY AS u(gid, ord)
           JOIN public.event_groups g
             ON g.tenant_id = p_tenant AND g.event_id = p_new
            AND g.id = public._event_clone_id(p_new, u.gid)
           ORDER BY u.ord
         )
  FROM public.event_pages sep
  JOIN public.pages sp ON sp.id = sep.page_id AND sp.tenant_id = sep.tenant_id AND sp.deleted_at IS NULL
  WHERE sep.tenant_id = p_tenant AND sep.event_id = p_src AND sep.module IS NULL
  ON CONFLICT (tenant_id, event_id, page_id) DO NOTHING;
  GET DIAGNOSTICS v_links = ROW_COUNT;

  INSERT INTO public.event_page_sections (
    tenant_id, event_id, section_key, is_visible, sort_order, heading_pl, heading_en,
    visibility, min_tier_rank, created_by
  )
  SELECT p_tenant, p_new, s.section_key, s.is_visible, s.sort_order, s.heading_pl,
         s.heading_en, s.visibility, s.min_tier_rank, v_uid
  FROM public.event_page_sections s
  WHERE s.tenant_id = p_tenant AND s.event_id = p_src;
  GET DIAGNOSTICS v_sections = ROW_COUNT;

  RETURN jsonb_build_object('copied', jsonb_build_object(
    'module_pages', v_modules, 'pages', v_pages, 'page_links', v_links, 'page_sections', v_sections
  ));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_pages(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_pages(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_pages(uuid, uuid, uuid, jsonb) IS
  'Klon stron: tresc korzenia i stron modulowych (zasianych), wyglad menu, pozostale strony poddrzewa jako szkice z unikalnym slugiem, pozycje menu i sekcje strony glownej. Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_onsite(
  p_tenant uuid, p_src uuid, p_new uuid, p_ctx jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := (p_ctx->>'uid')::uuid;
  v_checkpoints integer;
  v_total integer;
  v_templates integer;
BEGIN
  -- Punkt sesji bez skopiowanej sesji i stoisko bez skopiowanego sponsora
  -- lamalyby CHECK rodzaju - sa pomijane (i liczone).
  INSERT INTO public.event_checkpoints (
    id, tenant_id, event_id, name_pl, name_en, kind, session_id, room_id, sponsor_id,
    direction_mode, access_mode, capacity, dedupe_window_seconds, is_active, sort_order,
    created_by
  )
  SELECT public._event_clone_id(p_new, c.id), p_tenant, p_new, c.name_pl, c.name_en, c.kind,
         x.session_id,
         (SELECT r.id FROM public.event_rooms r
           WHERE r.tenant_id = p_tenant AND r.event_id = p_new
             AND r.id = public._event_clone_id(p_new, c.room_id)),
         x.sponsor_id, c.direction_mode, c.access_mode, c.capacity, c.dedupe_window_seconds,
         c.is_active, c.sort_order, v_uid
  FROM public.event_checkpoints c
  CROSS JOIN LATERAL (
    SELECT
      (SELECT s.id FROM public.event_sessions s
        WHERE s.tenant_id = p_tenant AND s.event_id = p_new
          AND s.id = public._event_clone_id(p_new, c.session_id)) AS session_id,
      (SELECT sp.id FROM public.event_sponsors sp
        WHERE sp.tenant_id = p_tenant AND sp.event_id = p_new
          AND sp.id = public._event_clone_id(p_new, c.sponsor_id)) AS sponsor_id
  ) AS x
  WHERE c.tenant_id = p_tenant AND c.event_id = p_src
    AND (c.kind <> 'session' OR x.session_id IS NOT NULL)
    AND (c.kind <> 'company_booth' OR x.sponsor_id IS NOT NULL);
  GET DIAGNOSTICS v_checkpoints = ROW_COUNT;

  SELECT count(*) INTO v_total FROM public.event_checkpoints c
  WHERE c.tenant_id = p_tenant AND c.event_id = p_src;

  INSERT INTO public.event_badge_templates (
    id, tenant_id, event_id, name, paper_format, width_mm, height_mm, orientation,
    double_fold, background_color, background_image_url, show_qr, qr_size_mm, elements,
    version, is_default, created_by
  )
  SELECT public._event_clone_id(p_new, b.id), p_tenant, p_new, b.name, b.paper_format,
         b.width_mm, b.height_mm, b.orientation, b.double_fold, b.background_color,
         b.background_image_url, b.show_qr, b.qr_size_mm, b.elements, 1, b.is_default, v_uid
  FROM public.event_badge_templates b
  WHERE b.tenant_id = p_tenant AND b.event_id = p_src;
  GET DIAGNOSTICS v_templates = ROW_COUNT;

  RETURN jsonb_build_object(
    'copied', jsonb_build_object('checkpoints', v_checkpoints, 'badge_templates', v_templates),
    'skipped', jsonb_build_object('checkpoints', v_total - v_checkpoints)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_onsite(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_onsite(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_onsite(uuid, uuid, uuid, jsonb) IS
  'Klon punktow odprawy (bez celu - pominiete) i szablonow identyfikatorow (wersja od 1). Urzadzen skanera nigdy. Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_meetings(
  p_tenant uuid, p_src uuid, p_new uuid, p_ctx jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := (p_ctx->>'uid')::uuid;
  v_src_tz text := p_ctx->>'src_tz';
  v_tz text := p_ctx->>'tz';
  v_delta interval := (p_ctx->>'delta')::interval;
  v_days integer := (p_ctx->>'day_shift')::integer;
  v_settings integer;
  v_tables integer;
  v_rules integer;
BEGIN
  -- Dni gieldy przesuwaja sie o cale dni lokalne; strefa gieldy idzie za
  -- strefa wydarzenia, jesli byla z nia rowna.
  INSERT INTO public.event_meeting_settings (
    id, tenant_id, event_id, is_enabled, slot_minutes, break_minutes, day_start_time,
    day_end_time, meeting_days, timezone, invites_open_at, invites_close_at,
    max_invites_per_person, max_meetings_per_day, invite_expires_after_hours, visibility,
    intro_pl, intro_en, updated_by
  )
  SELECT public._event_clone_id(p_new, m.id), p_tenant, p_new, m.is_enabled, m.slot_minutes,
         m.break_minutes, m.day_start_time, m.day_end_time,
         ARRAY(
           SELECT u.d + v_days FROM unnest(m.meeting_days) WITH ORDINALITY AS u(d, ord)
           ORDER BY u.ord
         ),
         CASE WHEN m.timezone = v_src_tz THEN v_tz ELSE m.timezone END,
         public._event_clone_shift(m.invites_open_at, v_src_tz, v_tz, v_delta),
         public._event_clone_shift(m.invites_close_at, v_src_tz, v_tz, v_delta),
         m.max_invites_per_person, m.max_meetings_per_day, m.invite_expires_after_hours,
         m.visibility, m.intro_pl, m.intro_en, v_uid
  FROM public.event_meeting_settings m
  WHERE m.tenant_id = p_tenant AND m.event_id = p_src;
  GET DIAGNOSTICS v_settings = ROW_COUNT;

  INSERT INTO public.event_meeting_tables (
    id, tenant_id, event_id, label, zone, capacity, room_id, note, is_active, sort_order,
    created_by
  )
  SELECT public._event_clone_id(p_new, t.id), p_tenant, p_new, t.label, t.zone, t.capacity,
         (SELECT r.id FROM public.event_rooms r
           WHERE r.tenant_id = p_tenant AND r.event_id = p_new
             AND r.id = public._event_clone_id(p_new, t.room_id)),
         t.note, t.is_active, t.sort_order, v_uid
  FROM public.event_meeting_tables t
  WHERE t.tenant_id = p_tenant AND t.event_id = p_src;
  GET DIAGNOSTICS v_tables = ROW_COUNT;

  INSERT INTO public.event_meeting_rule_groups (id, tenant_id, event_id, group_id, side)
  SELECT public._event_clone_id(p_new, g.id), p_tenant, p_new,
         public._event_clone_id(p_new, g.group_id), g.side
  FROM public.event_meeting_rule_groups g
  WHERE g.tenant_id = p_tenant AND g.event_id = p_src;
  GET DIAGNOSTICS v_rules = ROW_COUNT;

  RETURN jsonb_build_object('copied', jsonb_build_object(
    'meeting_settings', v_settings, 'meeting_tables', v_tables, 'meeting_rules', v_rules
  ));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_meetings(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_meetings(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_meetings(uuid, uuid, uuid, jsonb) IS
  'Klon ustawien gieldy spotkan (dni i okno zaproszen przesuniete), stolikow i regul grup. Spotkan i dostepnosci nigdy. Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_cfp(
  p_tenant uuid, p_src uuid, p_new uuid, p_ctx jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := (p_ctx->>'uid')::uuid;
  v_src_tz text := p_ctx->>'src_tz';
  v_tz text := p_ctx->>'tz';
  v_delta interval := (p_ctx->>'delta')::interval;
  v_settings integer;
  v_fields integer;
  v_reviewers integer := 0;
BEGIN
  INSERT INTO public.event_cfp_settings (
    id, tenant_id, event_id, status, opens_at, closes_at, intro_pl, intro_en, guidelines_pl,
    guidelines_en, formats, track_ids, max_per_submitter, allow_co_speakers, review_blind,
    score_max, review_criteria, min_reviews, speaker_group_id, speaker_ticket_type_id,
    updated_by
  )
  SELECT public._event_clone_id(p_new, c.id), p_tenant, p_new, 'draft',
         public._event_clone_shift(c.opens_at, v_src_tz, v_tz, v_delta),
         public._event_clone_shift(c.closes_at, v_src_tz, v_tz, v_delta),
         c.intro_pl, c.intro_en, c.guidelines_pl, c.guidelines_en, c.formats,
         ARRAY(
           SELECT t.id FROM unnest(c.track_ids) WITH ORDINALITY AS u(tid, ord)
           JOIN public.event_tracks t
             ON t.tenant_id = p_tenant AND t.event_id = p_new
            AND t.id = public._event_clone_id(p_new, u.tid)
           ORDER BY u.ord
         ),
         c.max_per_submitter, c.allow_co_speakers, c.review_blind, c.score_max,
         c.review_criteria, c.min_reviews,
         (SELECT g.id FROM public.event_groups g
           WHERE g.tenant_id = p_tenant AND g.event_id = p_new
             AND g.id = public._event_clone_id(p_new, c.speaker_group_id)),
         (SELECT t.id FROM public.event_ticket_types t
           WHERE t.tenant_id = p_tenant AND t.event_id = p_new
             AND t.id = public._event_clone_id(p_new, c.speaker_ticket_type_id)),
         v_uid
  FROM public.event_cfp_settings c
  WHERE c.tenant_id = p_tenant AND c.event_id = p_src;
  GET DIAGNOSTICS v_settings = ROW_COUNT;

  INSERT INTO public.event_cfp_fields (
    id, tenant_id, event_id, key, field_type, label_pl, label_en, help_pl, help_en,
    is_required, options, sort_order, is_active
  )
  SELECT public._event_clone_id(p_new, f.id), p_tenant, p_new, f.key, f.field_type,
         f.label_pl, f.label_en, f.help_pl, f.help_en, f.is_required, f.options, f.sort_order,
         f.is_active
  FROM public.event_cfp_fields f
  WHERE f.tenant_id = p_tenant AND f.event_id = p_src;
  GET DIAGNOSTICS v_fields = ROW_COUNT;

  IF (p_ctx->'options'->>'cfp_reviewers')::boolean THEN
    INSERT INTO public.event_cfp_reviewers (
      id, tenant_id, event_id, user_id, track_ids, can_see_identity, is_active, added_by
    )
    SELECT public._event_clone_id(p_new, rv.id), p_tenant, p_new, rv.user_id,
           ARRAY(
             SELECT t.id FROM unnest(rv.track_ids) WITH ORDINALITY AS u(tid, ord)
             JOIN public.event_tracks t
               ON t.tenant_id = p_tenant AND t.event_id = p_new
              AND t.id = public._event_clone_id(p_new, u.tid)
             ORDER BY u.ord
           ),
           rv.can_see_identity, rv.is_active, v_uid
    FROM public.event_cfp_reviewers rv
    WHERE rv.tenant_id = p_tenant AND rv.event_id = p_src;
    GET DIAGNOSTICS v_reviewers = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('copied', jsonb_build_object(
    'cfp_settings', v_settings, 'cfp_fields', v_fields, 'cfp_reviewers', v_reviewers
  ));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_cfp(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_cfp(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_cfp(uuid, uuid, uuid, jsonb) IS
  'Klon ustawien naboru prelegentow (zawsze jako draft, okno przesuniete), pol formularza i opcjonalnie recenzentow. Zgloszen, ocen i materialow nigdy. Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_seating(
  p_tenant uuid, p_src uuid, p_new uuid, p_ctx jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := (p_ctx->>'uid')::uuid;
  v_categories integer;
  v_links integer;
  v_maps integer;
  v_sections integer;
  v_seats integer;
BEGIN
  INSERT INTO public.event_seat_categories (id, tenant_id, event_id, key, name_pl, name_en, color, sort_order)
  SELECT public._event_clone_id(p_new, c.id), p_tenant, p_new, c.key, c.name_pl, c.name_en,
         c.color, c.sort_order
  FROM public.event_seat_categories c
  WHERE c.tenant_id = p_tenant AND c.event_id = p_src;
  GET DIAGNOSTICS v_categories = ROW_COUNT;

  -- Powiazanie kategorii z biletem tylko wtedy, gdy bilet przeszedl.
  INSERT INTO public.event_seat_category_tickets (id, tenant_id, event_id, category_id, ticket_type_id)
  SELECT public._event_clone_id(p_new, l.id), p_tenant, p_new,
         public._event_clone_id(p_new, l.category_id), t.id
  FROM public.event_seat_category_tickets l
  JOIN public.event_ticket_types t
    ON t.tenant_id = p_tenant AND t.event_id = p_new
   AND t.id = public._event_clone_id(p_new, l.ticket_type_id)
  WHERE l.tenant_id = p_tenant AND l.event_id = p_src;
  GET DIAGNOSTICS v_links = ROW_COUNT;

  INSERT INTO public.event_seat_maps (
    id, tenant_id, event_id, room_id, session_id, name, status, width, height, stage_x,
    stage_y, stage_w, stage_h, sort_order, published_at, created_by
  )
  SELECT public._event_clone_id(p_new, m.id), p_tenant, p_new,
         (SELECT r.id FROM public.event_rooms r
           WHERE r.tenant_id = p_tenant AND r.event_id = p_new
             AND r.id = public._event_clone_id(p_new, m.room_id)),
         (SELECT s.id FROM public.event_sessions s
           WHERE s.tenant_id = p_tenant AND s.event_id = p_new
             AND s.id = public._event_clone_id(p_new, m.session_id)),
         m.name, 'draft', m.width, m.height, m.stage_x, m.stage_y, m.stage_w, m.stage_h,
         m.sort_order, NULL, v_uid
  FROM public.event_seat_maps m
  WHERE m.tenant_id = p_tenant AND m.event_id = p_src;
  GET DIAGNOSTICS v_maps = ROW_COUNT;

  INSERT INTO public.event_seat_sections (
    id, tenant_id, event_id, map_id, label, kind, category_id, origin_x, origin_y,
    rotation_deg, rows_count, seats_per_row, row_label_scheme, row_label_start,
    seat_numbering, seat_number_start, seat_pitch, row_pitch, aisle_after, table_shape,
    table_seats, sort_order
  )
  SELECT public._event_clone_id(p_new, s.id), p_tenant, p_new,
         public._event_clone_id(p_new, s.map_id), s.label, s.kind,
         public._event_clone_id(p_new, s.category_id), s.origin_x, s.origin_y, s.rotation_deg,
         s.rows_count, s.seats_per_row, s.row_label_scheme, s.row_label_start,
         s.seat_numbering, s.seat_number_start, s.seat_pitch, s.row_pitch, s.aisle_after,
         s.table_shape, s.table_seats, s.sort_order
  FROM public.event_seat_sections s
  WHERE s.tenant_id = p_tenant AND s.event_id = p_src;
  GET DIAGNOSTICS v_sections = ROW_COUNT;

  -- Blokada zostaje; rezerwacja dla firmy z CRM zostaje; rezerwacje dla
  -- sponsora, zamowienia pakietu i sama notatka sa czyszczone.
  INSERT INTO public.event_seats (
    id, tenant_id, event_id, map_id, section_id, row_label, seat_number, x, y, sort_key,
    category_id, status, block_reason, hold_company_id, hold_sponsor_id,
    hold_package_order_id, hold_note, is_accessible
  )
  SELECT public._event_clone_id(p_new, s.id), p_tenant, p_new,
         public._event_clone_id(p_new, s.map_id), public._event_clone_id(p_new, s.section_id),
         s.row_label, s.seat_number, s.x, s.y, s.sort_key,
         public._event_clone_id(p_new, s.category_id), x.status,
         CASE WHEN x.status = 'blocked' THEN s.block_reason END,
         CASE WHEN x.status = 'held' THEN s.hold_company_id END,
         NULL, NULL,
         CASE WHEN x.status = 'held' THEN s.hold_note END,
         s.is_accessible
  FROM public.event_seats s
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN s.status = 'held' AND s.hold_company_id IS NULL THEN 'available'
      ELSE s.status
    END AS status
  ) AS x
  WHERE s.tenant_id = p_tenant AND s.event_id = p_src;
  GET DIAGNOSTICS v_seats = ROW_COUNT;

  RETURN jsonb_build_object('copied', jsonb_build_object(
    'seat_categories', v_categories, 'seat_category_tickets', v_links, 'seat_maps', v_maps,
    'seat_sections', v_sections, 'seats', v_seats
  ));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_seating(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_seating(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_seating(uuid, uuid, uuid, jsonb) IS
  'Klon planu sali jako draft: kategorie (z biletami, jesli przeszly), sekcje i miejsca; blokady i rezerwacje firm z CRM zostaja, pozostale rezerwacje czyszczone. Przydzialow nigdy. Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_ad_campaigns(
  p_tenant uuid, p_src uuid, p_new uuid, p_ctx jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_n integer;
BEGIN
  INSERT INTO public.event_ad_campaigns (
    id, tenant_id, event_id, platform, match_kind, match_value, label, conversion_action_name,
    created_by
  )
  SELECT public._event_clone_id(p_new, c.id), p_tenant, p_new, c.platform, c.match_kind,
         c.match_value, c.label, c.conversion_action_name, (p_ctx->>'uid')::uuid
  FROM public.event_ad_campaigns c
  WHERE c.tenant_id = p_tenant AND c.event_id = p_src;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('copied', jsonb_build_object('ad_campaigns', v_n));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_ad_campaigns(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_ad_campaigns(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_ad_campaigns(uuid, uuid, uuid, jsonb) IS
  'Klon mapowania kampanii Google Ads na wydarzenie (bez kosztow, zdarzen lejka i atrybucji). Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_home_ads(
  p_tenant uuid, p_src uuid, p_new uuid, p_ctx jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_src_tz text := p_ctx->>'src_tz';
  v_tz text := p_ctx->>'tz';
  v_delta interval := (p_ctx->>'delta')::interval;
  v_unpublish boolean := (p_ctx->'options'->>'sponsors_unpublished')::boolean;
  v_n integer;
BEGIN
  INSERT INTO public.event_home_ads (
    id, tenant_id, event_id, image_url, image_mobile_url, link_url, alt_text, group_ids,
    starts_at, ends_at, is_active, sort_order, created_by, sponsor_id
  )
  SELECT public._event_clone_id(p_new, a.id), p_tenant, p_new, a.image_url, a.image_mobile_url,
         a.link_url, a.alt_text,
         ARRAY(
           SELECT g.id FROM unnest(a.group_ids) WITH ORDINALITY AS u(gid, ord)
           JOIN public.event_groups g
             ON g.tenant_id = p_tenant AND g.event_id = p_new
            AND g.id = public._event_clone_id(p_new, u.gid)
           ORDER BY u.ord
         ),
         public._event_clone_shift(a.starts_at, v_src_tz, v_tz, v_delta),
         public._event_clone_shift(a.ends_at, v_src_tz, v_tz, v_delta),
         a.is_active AND NOT v_unpublish, a.sort_order, (p_ctx->>'uid')::uuid,
         (SELECT sp.id FROM public.event_sponsors sp
           WHERE sp.tenant_id = p_tenant AND sp.event_id = p_new
             AND sp.id = public._event_clone_id(p_new, a.sponsor_id))
  FROM public.event_home_ads a
  WHERE a.tenant_id = p_tenant AND a.event_id = p_src;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('copied', jsonb_build_object('home_ads', v_n));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_home_ads(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_home_ads(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_home_ads(uuid, uuid, uuid, jsonb) IS
  'Klon reklam strony glownej wydarzenia (okno przesuniete, grupy i sponsor remapowane; nieaktywne przy nieopublikowanych sponsorach). Wyswietlen i klikniec nigdy. Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_codes(
  p_tenant uuid, p_src uuid, p_new uuid, p_ctx jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_src_tz text := p_ctx->>'src_tz';
  v_tz text := p_ctx->>'tz';
  v_delta interval := (p_ctx->>'delta')::interval;
  v_suffix text := p_ctx->'options'->>'code_suffix';
  v_total integer;
  v_n integer;
BEGIN
  SELECT count(*) INTO v_total FROM public.b2b_coupons c
  WHERE c.tenant_id = p_tenant AND c.event_ids = ARRAY[p_src];

  -- Tylko kody o zakresie DOKLADNIE tego wydarzenia (kampanie wielu wydarzen
  -- zostaja). Kod jest unikalny w najemcy - kolizja jest pomijana i liczona.
  INSERT INTO public.b2b_coupons (
    tenant_id, code, name, description, discount_kind, discount_percent, discount_cents,
    currency, active, max_redemptions, redemptions_count, valid_from, valid_until, plan_ids,
    campaign_id, grants_tier_key, grants_duration_days, newsletter_segment, metadata,
    created_by, event_ids, ticket_type_ids, package_ids, max_redemptions_per_user,
    applies_discount, reveals_hidden, assigned_company_id, assigned_lead_id,
    lead_score_bonus, organization_id, prefix
  )
  SELECT p_tenant, upper(c.code || v_suffix), c.name, c.description, c.discount_kind,
         c.discount_percent, c.discount_cents, c.currency, c.active, c.max_redemptions, 0,
         public._event_clone_shift(c.valid_from, v_src_tz, v_tz, v_delta),
         public._event_clone_shift(c.valid_until, v_src_tz, v_tz, v_delta),
         c.plan_ids, NULL, c.grants_tier_key, c.grants_duration_days, c.newsletter_segment,
         c.metadata, (p_ctx->>'uid')::uuid, ARRAY[p_new],
         ARRAY(
           SELECT t.id FROM unnest(c.ticket_type_ids) WITH ORDINALITY AS u(tid, ord)
           JOIN public.event_ticket_types t
             ON t.tenant_id = p_tenant AND t.event_id = p_new
            AND t.id = public._event_clone_id(p_new, u.tid)
           ORDER BY u.ord
         ),
         ARRAY(
           SELECT k.id FROM unnest(c.package_ids) WITH ORDINALITY AS u(pid, ord)
           JOIN public.event_ticket_packages k
             ON k.tenant_id = p_tenant AND k.event_id = p_new
            AND k.id = public._event_clone_id(p_new, u.pid)
           ORDER BY u.ord
         ),
         c.max_redemptions_per_user, c.applies_discount, c.reveals_hidden,
         c.assigned_company_id, c.assigned_lead_id, c.lead_score_bonus, c.organization_id,
         c.prefix
  FROM public.b2b_coupons c
  WHERE c.tenant_id = p_tenant AND c.event_ids = ARRAY[p_src]
  ON CONFLICT (tenant_id, code) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object(
    'copied', jsonb_build_object('codes', v_n),
    'skipped', jsonb_build_object('codes', v_total - v_n)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_codes(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_codes(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_codes(uuid, uuid, uuid, jsonb) IS
  'Klon kodow rejestracyjnych wydarzenia z przyrostkiem (licznik od zera, okno przesuniete, bilety i pakiety remapowane, przypisanie do firmy/kontaktu CRM zachowane). Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_crm(
  p_tenant uuid, p_src uuid, p_new uuid, p_ctx jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := (p_ctx->>'uid')::uuid;
  v_title_pl text := p_ctx->>'title_pl';
  v_title_en text := p_ctx->>'title_en';
  v_slug text := p_ctx->>'slug';
  v_task_title text := 'Odnowienie partnerstwa: ' || left(p_ctx->>'title_pl', 180);
  v_due timestamptz := now() + make_interval(days => (p_ctx->'options'->>'crm_task_due_days')::integer);
  v_tasks integer := 0;
  v_audit integer;
BEGIN
  -- Os czasu firmy w CRM: kazdy przeniesiony sponsor (kontrakt metadanych
  -- `src/lib/crm/eventActivity.ts`). Bez sponsorow w kopii - zero wierszy.
  INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  SELECT p_tenant, v_uid, 'event.clone.sponsor_copied', 'crm_company', s.company_id,
         jsonb_build_object(
           'event_id', p_new, 'event_slug', v_slug,
           'event_title_pl', v_title_pl, 'event_title_en', v_title_en,
           'summary_pl', 'Sponsor przeniesiony do nowej edycji: ' || v_title_pl,
           'summary_en', 'Sponsor carried over to the new edition: ' || v_title_en,
           'source_event_id', p_src, 'sponsor_id', s.id
         )
  FROM public.event_sponsors s
  WHERE s.tenant_id = p_tenant AND s.event_id = p_new;
  GET DIAGNOSTICS v_audit = ROW_COUNT;

  -- Zadania odnowienia dla GLOWNYCH kontaktow sponsorow ZRODLA (takze tych,
  -- ktorych organizator nie przeniosl - decyzja o odnowieniu zyje w CRM).
  -- Deduplikacja: jedno otwarte zadanie o tym tytule na kontakt.
  IF (p_ctx->'options'->>'crm_renewal_tasks')::boolean THEN
    INSERT INTO public.crm_tasks (tenant_id, lead_id, title, note, due_at, assignee_id, created_by)
    SELECT DISTINCT ON (k.lead_id)
           p_tenant, k.lead_id, v_task_title,
           'Sponsor poprzedniej edycji (' || (p_ctx->>'src_title_pl') || '): ' || s.snapshot_name
             || '. Nowa edycja: ' || v_title_pl || ' (' || v_slug || ').',
           v_due, COALESCE(l.owner_id, v_uid), v_uid
    FROM public.event_sponsor_contacts k
    JOIN public.event_sponsors s
      ON s.tenant_id = k.tenant_id AND s.event_id = k.event_id AND s.id = k.sponsor_id
    JOIN public.crm_leads l ON l.tenant_id = k.tenant_id AND l.id = k.lead_id
    WHERE k.tenant_id = p_tenant AND k.event_id = p_src AND k.role = 'primary'
      AND NOT EXISTS (
        SELECT 1 FROM public.crm_tasks t
        WHERE t.tenant_id = p_tenant AND t.lead_id = k.lead_id
          AND t.status = 'open' AND t.title = v_task_title
      )
    ORDER BY k.lead_id, s.sort_order, s.snapshot_name;
    GET DIAGNOSTICS v_tasks = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('copied', jsonb_build_object(
    'crm_tasks', v_tasks, 'crm_timeline_entries', v_audit
  ));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_crm(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_crm(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_crm(uuid, uuid, uuid, jsonb) IS
  'Most klonu do CRM: wpis osi czasu firmy dla kazdego przeniesionego sponsora i (opcjonalnie) deduplikowane zadania odnowienia partnerstwa dla glownych kontaktow sponsorow zrodla. Pomocnik klonu edycji.';

-- ----------------------------------------------------------------------------
-- 7) KLON (plaszczyzna panelu)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_clone(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_uid uuid := auth.uid();
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_key text := NULLIF(btrim(COALESCE(v_payload->>'idempotency_key', '')), '');
  v_cmd public.command_idempotency;
  v_set jsonb;
  v_inc jsonb;
  v_opt jsonb;
  v_res jsonb;
  v_src public.events;
  v_title_pl text := btrim(COALESCE(v_payload->>'title_pl', ''));
  v_title_en text := btrim(COALESCE(v_payload->>'title_en', ''));
  v_slug_explicit text := NULLIF(lower(btrim(COALESCE(v_payload->>'slug', ''))), '');
  v_slug text;
  v_external text;
  v_new uuid;
  v_try integer;
  v_window jsonb;
  v_warnings jsonb;
  v_ctx jsonb;
  v_parts jsonb[] := ARRAY[]::jsonb[];
  v_part jsonb;
  v_copied jsonb := '{}'::jsonb;
  v_skipped jsonb := '{}'::jsonb;
  v_result jsonb;
BEGIN
  -- 0. Idempotencja w TEJ SAMEJ transakcji: awaria cofa zajecie klucza,
  --    rownolegly duplikat czeka na kluczu glownym i czyta wynik pierwszego.
  IF v_key IS NOT NULL THEN
    IF char_length(v_key) < 8 OR char_length(v_key) > 200 THEN
      RAISE EXCEPTION 'invalid_idempotency_key: key must have 8-200 characters';
    END IF;
    INSERT INTO public.command_idempotency (tenant_id, idempotency_key, command, actor_id, correlation_id)
    VALUES (v_tenant, v_key, 'event.clone', v_uid, public.request_correlation_id())
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;
    IF NOT FOUND THEN
      SELECT * INTO v_cmd FROM public.command_idempotency c
      WHERE c.tenant_id = v_tenant AND c.idempotency_key = v_key;
      IF v_cmd.actor_id IS DISTINCT FROM v_uid OR v_cmd.command <> 'event.clone' THEN
        RAISE EXCEPTION 'idempotency_conflict: the key belongs to another command or person';
      END IF;
      IF v_cmd.status = 'succeeded' AND v_cmd.result IS NOT NULL THEN
        RETURN v_cmd.result || jsonb_build_object('replayed', true);
      END IF;
      RAISE EXCEPTION 'clone_in_progress: the same copy is still running';
    END IF;
  END IF;

  -- 1. Ustawienia, zrodlo (w najemcy wolajacego) i przesuniecie.
  v_set := public._event_clone_settings(v_payload, true);
  v_inc := v_set->'include';
  v_opt := v_set->'options';
  v_res := public._event_clone_resolve(v_tenant, v_payload, true);

  -- Blokada klucza: zrodla nie da sie skasowac w trakcie kopiowania.
  SELECT * INTO v_src FROM public.events e
  WHERE e.id = (v_res->>'source_event_id')::uuid AND e.tenant_id = v_tenant
  FOR KEY SHARE;

  -- 2. Walidacja pol nowej edycji.
  IF v_title_pl = '' OR v_title_en = ''
     OR char_length(v_title_pl) > 200 OR char_length(v_title_en) > 200 THEN
    RAISE EXCEPTION 'invalid_titles: both titles are required (at most 200 characters)';
  END IF;

  IF v_slug_explicit IS NOT NULL THEN
    IF v_slug_explicit !~ '^[a-z0-9-]{3,120}$' THEN
      RAISE EXCEPTION 'invalid_slug: slug must be 3-120 chars of a-z, 0-9 and dashes';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.slug = v_slug_explicit
    ) THEN
      RAISE EXCEPTION 'slug_taken: another event already uses this address';
    END IF;
  END IF;

  v_external := v_src.external_registration_url;
  IF v_payload ? 'external_registration_url' THEN
    v_external := NULLIF(btrim(COALESCE(v_payload->>'external_registration_url', '')), '');
  END IF;
  IF v_src.registration_mode = 'external' AND v_external IS NULL THEN
    RAISE EXCEPTION 'external_url_required: this mode registers people elsewhere and needs a url';
  END IF;
  IF v_external IS NOT NULL
     AND (v_external !~* '^https://[^[:space:]]+$' OR char_length(v_external) > 2048) THEN
    RAISE EXCEPTION 'external_url_invalid: url must start with https and be under 2048 chars';
  END IF;

  -- 3. Okno wydarzenia kontra przesuniete sesje - PRZED zapisem.
  v_window := public._event_clone_session_window(v_tenant, v_src.id, v_res, v_inc, v_opt);
  IF (v_window->>'outside')::integer > 0 THEN
    RAISE EXCEPTION 'clone_sessions_outside_window: % session(s) would fall outside the new event dates',
      v_window->>'outside';
  END IF;

  v_warnings := public._event_clone_forecast(
    v_tenant, v_src.id, v_res, v_inc, v_opt, v_payload ? 'external_registration_url'
  );

  -- 4. Wiersz wydarzenia (zawsze szkic). Slug generowany ponawia sie po
  --    wyscigu na unikalnosci; slug podany wprost konczy sie `slug_taken`.
  FOR v_try IN 1..5 LOOP
    v_slug := COALESCE(
      v_slug_explicit, public._event_clone_slug_candidate(v_tenant, v_title_pl, v_src.slug)
    );
    BEGIN
      INSERT INTO public.events (
        tenant_id, slug, title_pl, title_en, description_pl, description_en, kind,
        starts_at, ends_at, timezone, location, street_address, city, region, postal_code,
        country, region_id, visibility, min_tier_rank, capacity, status, host_user_id,
        chatham_house, cover_url, created_by, event_type_id, format, registration_mode,
        registration_flow, guest_mode, external_registration_url, branding,
        video_header_platform, video_header_id, social_hashtag, support_email, languages,
        home_design, pages_display_mode, features, rsvp_opens_at, early_rsvp_rank,
        ticket_price_cents, ticket_currency, program_id, discussion_club_id,
        discussion_group_id, previous_edition_id
      ) VALUES (
        v_tenant, v_slug, v_title_pl, v_title_en, v_src.description_pl, v_src.description_en,
        v_src.kind, (v_res->>'starts_at')::timestamptz, (v_res->>'ends_at')::timestamptz,
        v_res->>'timezone', v_src.location, v_src.street_address, v_src.city, v_src.region,
        v_src.postal_code, v_src.country, v_src.region_id, v_src.visibility,
        v_src.min_tier_rank, v_src.capacity, 'draft', v_src.host_user_id,
        v_src.chatham_house, v_src.cover_url, v_uid, v_src.event_type_id, v_src.format,
        v_src.registration_mode, v_src.registration_flow, v_src.guest_mode, v_external,
        v_src.branding, v_src.video_header_platform, v_src.video_header_id,
        v_src.social_hashtag, v_src.support_email, v_src.languages, v_src.home_design,
        v_src.pages_display_mode, v_src.features,
        public._event_clone_shift(
          v_src.rsvp_opens_at, v_res->>'source_tz', v_res->>'timezone', (v_res->>'delta')::interval
        ),
        v_src.early_rsvp_rank, v_src.ticket_price_cents, v_src.ticket_currency,
        v_src.program_id, v_src.discussion_club_id, v_src.discussion_group_id, v_src.id
      )
      RETURNING id INTO v_new;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_slug_explicit IS NOT NULL THEN
        RAISE EXCEPTION 'slug_taken: another event already uses this address';
      END IF;
      IF v_try = 5 THEN RAISE; END IF;
    END;
  END LOOP;

  v_ctx := jsonb_build_object(
    'src_tz', v_res->>'source_tz', 'tz', v_res->>'timezone', 'delta', v_res->>'delta',
    'day_shift', (v_res->>'day_shift')::integer, 'uid', v_uid, 'src_slug', v_src.slug,
    'slug', v_slug, 'title_pl', v_title_pl, 'title_en', v_title_en,
    'src_title_pl', v_src.title_pl, 'include', v_inc, 'options', v_opt
  );

  -- 5. Moduly w porzadku kluczy obcych (grupy i sale przed wszystkim, co je
  --    wskazuje; sponsorzy przed sciezkami i sesjami; sesje przed obsada,
  --    punktami odprawy i planem sali; bilety przed pakietami, kategoriami
  --    miejsc, naborem i kodami).
  v_parts := array_append(v_parts, public._event_clone_groups(v_tenant, v_src.id, v_new, v_ctx));
  IF (v_inc->>'agenda')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_rooms(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  v_parts := array_append(v_parts, public._event_clone_sponsors(v_tenant, v_src.id, v_new, v_ctx));
  IF (v_inc->>'agenda')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_agenda(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'speakers')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_speakers(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'tickets')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_tickets(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'registration')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_registration(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  -- Korzen i piec stron modulowych jak przy `admin_event_create` - takze bez
  -- sekcji "strony" (wydarzenie bez menu byloby zepsute).
  PERFORM public._event_seed_default_pages(v_tenant, v_new);
  IF (v_inc->>'pages')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_pages(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'onsite')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_onsite(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'meetings')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_meetings(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'cfp')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_cfp(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'seating')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_seating(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'ad_campaigns')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_ad_campaigns(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'home_ads')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_home_ads(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'codes')::boolean AND (v_inc->>'tickets')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_codes(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  v_parts := array_append(v_parts, public._event_clone_crm(v_tenant, v_src.id, v_new, v_ctx));

  FOREACH v_part IN ARRAY v_parts LOOP
    v_copied := v_copied || COALESCE(v_part->'copied', '{}'::jsonb);
    v_skipped := v_skipped || COALESCE(v_part->'skipped', '{}'::jsonb);
  END LOOP;

  -- 6. Wynik, zapamietany dla powtorzen, i zdarzenie domenowe.
  v_result := jsonb_build_object(
    'event_id', v_new,
    'slug', v_slug,
    'source_event_id', v_src.id,
    'replayed', false,
    'shift', jsonb_build_object(
      'delta', v_res->>'delta', 'day_shift', (v_res->>'day_shift')::integer,
      'source_tz', v_res->>'source_tz', 'timezone', v_res->>'timezone'
    ),
    'copied', v_copied,
    'skipped', v_skipped || public._event_clone_not_copied(v_tenant, v_src.id),
    'warnings', v_warnings
  );

  IF v_key IS NOT NULL THEN
    UPDATE public.command_idempotency c
       SET status = 'succeeded', result = v_result, completed_at = now()
     WHERE c.tenant_id = v_tenant AND c.idempotency_key = v_key;
  END IF;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event',
    v_new::text,
    'event.cloned.v1',
    jsonb_build_object('event_id', v_new, 'source_event_id', v_src.id),
    auth.uid()
  );

  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_event_clone(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_clone(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_clone(jsonb) IS
  'Nowa edycja wydarzenia z poprzedniej: kopia konfiguracji (grupy, agenda, prelegenci, bilety, formularz, regulaminy, sponsorzy, strony, obsluga na miejscu, gielda spotkan, nabor, plan sali, opcjonalnie kampanie, reklamy i kody) z przesunieciem dat w czasie lokalnym strefy wydarzenia; zawsze szkic, idempotentna po idempotency_key. Nie kopiuje zapisow, zamowien, odpraw, skanow, spotkan, urzadzen, zgloszen, przydzialow ani faktur. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 8) PODGLAD KLONU (bez zapisu)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_clone_preview(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_set jsonb;
  v_inc jsonb;
  v_opt jsonb;
  v_res jsonb;
  v_src public.events;
  v_window jsonb;
  v_title_pl text := btrim(COALESCE(v_payload->>'title_pl', ''));
  v_slug_explicit text := NULLIF(lower(btrim(COALESCE(v_payload->>'slug', ''))), '');
  v_slug text;
  v_slug_valid boolean := true;
  v_slug_available boolean := true;
  v_blockers jsonb := '[]'::jsonb;
BEGIN
  v_set := public._event_clone_settings(v_payload, false);
  v_inc := v_set->'include';
  v_opt := v_set->'options';
  v_res := public._event_clone_resolve(v_tenant, v_payload, false);

  SELECT * INTO v_src FROM public.events e
  WHERE e.id = (v_res->>'source_event_id')::uuid AND e.tenant_id = v_tenant;

  v_window := public._event_clone_session_window(v_tenant, v_src.id, v_res, v_inc, v_opt);
  IF (v_window->>'outside')::integer > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'sessions_outside_window', 'count', (v_window->>'outside')::integer
    ));
  END IF;

  IF v_slug_explicit IS NULL THEN
    v_slug := public._event_clone_slug_candidate(v_tenant, v_title_pl, v_src.slug);
  ELSE
    v_slug := v_slug_explicit;
    v_slug_valid := v_slug ~ '^[a-z0-9-]{3,120}$';
    v_slug_available := NOT EXISTS (
      SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.slug = v_slug
    );
    IF NOT v_slug_valid THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'invalid_slug', 'count', 1));
    ELSIF NOT v_slug_available THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'slug_taken', 'count', 1));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'source', jsonb_build_object(
      'id', v_src.id, 'slug', v_src.slug, 'title_pl', v_src.title_pl,
      'title_en', v_src.title_en, 'starts_at', v_src.starts_at, 'ends_at', v_src.ends_at,
      'timezone', v_res->>'source_tz', 'status', v_src.status,
      'registration_mode', v_src.registration_mode,
      'external_registration_url', v_src.external_registration_url
    ),
    'target', jsonb_build_object(
      'starts_at', v_res->'starts_at', 'ends_at', v_res->'ends_at',
      'timezone', v_res->>'timezone', 'suggested_starts_at', v_res->'suggested_starts_at',
      'slug', v_slug, 'slug_valid', v_slug_valid, 'slug_available', v_slug_available
    ),
    'shift', jsonb_build_object(
      'delta', v_res->>'delta', 'day_shift', (v_res->>'day_shift')::integer,
      'source_tz', v_res->>'source_tz', 'timezone', v_res->>'timezone'
    ),
    'include', v_inc,
    'options', v_opt,
    'counts', public._event_clone_counts(v_tenant, v_src.id),
    'not_copied', public._event_clone_not_copied(v_tenant, v_src.id),
    'dates', public._event_clone_dates(v_tenant, v_src.id, v_res) || jsonb_build_object(
      'first_session_starts_at', v_window->'first_starts_at',
      'last_session_ends_at', v_window->'last_ends_at'
    ),
    'warnings', public._event_clone_forecast(
      v_tenant, v_src.id, v_res, v_inc, v_opt, v_payload ? 'external_registration_url'
    ),
    'blockers', v_blockers
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_event_clone_preview(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_clone_preview(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_clone_preview(jsonb) IS
  'Podglad klonu edycji bez zapisu: zrodlo, daty docelowe (poczatek, koniec, podpowiedz), przesuniecie, liczniki sekcji, dane, ktorych klon nie przeniesie, daty kluczowe po przesunieciu, ostrzezenia i blokady. Te same reguly co admin_event_clone. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 9) LISTA EDYCJI (poprzednie i nastepne)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_editions(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  slug text,
  title_pl text,
  title_en text,
  starts_at timestamptz,
  timezone text,
  status text,
  relation text,
  depth integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = p_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  RETURN QUERY
  WITH RECURSIVE prev AS (
    SELECT e.id AS edition_id, e.previous_edition_id AS parent_id, 1 AS lvl
    FROM public.events e
    WHERE e.tenant_id = v_tenant
      AND e.id = (SELECT x.previous_edition_id FROM public.events x
                   WHERE x.id = p_event_id AND x.tenant_id = v_tenant)
    UNION ALL
    SELECT e.id, e.previous_edition_id, prev.lvl + 1
    FROM public.events e
    JOIN prev ON e.id = prev.parent_id
    WHERE e.tenant_id = v_tenant AND prev.lvl < 20 AND e.id <> p_event_id
  ),
  nxt AS (
    SELECT e.id AS edition_id, 1 AS lvl
    FROM public.events e
    WHERE e.tenant_id = v_tenant AND e.previous_edition_id = p_event_id
    UNION ALL
    SELECT e.id, nxt.lvl + 1
    FROM public.events e
    JOIN nxt ON e.previous_edition_id = nxt.edition_id
    WHERE e.tenant_id = v_tenant AND nxt.lvl < 20 AND e.id <> p_event_id
  ),
  chain AS (
    SELECT prev.edition_id, 'previous'::text AS rel, prev.lvl FROM prev
    UNION ALL
    SELECT nxt.edition_id, 'next'::text, nxt.lvl FROM nxt
  )
  SELECT e.id, e.slug, e.title_pl, e.title_en, e.starts_at, e.timezone, e.status,
         chain.rel, chain.lvl
  FROM chain
  JOIN public.events e ON e.id = chain.edition_id AND e.tenant_id = v_tenant
  ORDER BY e.starts_at, e.id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_event_editions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_editions(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_editions(uuid) IS
  'Edycje wydarzenia z rodowodu previous_edition_id: poprzednie (w gore lancucha) i nastepne (klony tego wydarzenia i ich klony), do 20 poziomow, w najemcy wolajacego. Bramka: assert_event_admin_tenant().';
