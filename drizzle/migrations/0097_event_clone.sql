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