CREATE OR REPLACE FUNCTION public.event_meeting_directory(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'event_slug', '')), '');
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_q text := NULLIF(btrim(COALESCE(p_payload->>'q', '')), '');
  v_group_id uuid := NULLIF(p_payload->>'group_id', '')::uuid;
  v_limit integer := LEAST(GREATEST(COALESCE(NULLIF(p_payload->>'limit', '')::integer, 24), 1), 100);
  v_offset integer := GREATEST(COALESCE(NULLIF(p_payload->>'offset', '')::integer, 0), 0);
  v_event public.events;
  v_me uuid;
  v_opt_out boolean := false;
  v_enabled boolean;
  v_visibility text;
  v_scope text;
  v_blocked text;
  v_total integer := 0;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to browse the participant list';
  END IF;

  IF v_tenant IS NULL OR (v_slug IS NULL AND v_event_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_payload: event_slug or event_id is required';
  END IF;

  SELECT e.* INTO v_event
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'published'
    AND (
      (v_event_id IS NOT NULL AND e.id = v_event_id)
      OR (v_event_id IS NULL AND e.slug = v_slug)
    );

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  SELECT s.is_enabled, s.visibility INTO v_enabled, v_visibility
  FROM public.event_meeting_settings s
  WHERE s.tenant_id = v_tenant AND s.event_id = v_event.id;

  v_me := public._event_meeting_caller_registration(v_tenant, v_event.id);

  IF v_me IS NOT NULL THEN
    SELECT r.directory_opt_out INTO v_opt_out
    FROM public.event_registrations r
    WHERE r.tenant_id = v_tenant AND r.id = v_me;
  END IF;

  v_blocked := CASE
    WHEN v_visibility IS NULL OR NOT v_enabled THEN 'meetings_disabled'
    WHEN v_visibility = 'disabled' THEN 'exchange_rule_closed'
    WHEN v_me IS NULL THEN 'requester_not_participating'
    ELSE NULL
  END;

  IF v_blocked IS NULL THEN
    v_scope := public._event_meeting_directory_scope(v_tenant, v_event.id, v_me);
    IF v_scope = 'none' THEN
      v_blocked := 'directory_hidden';
    END IF;
  END IF;

  IF v_blocked IS NULL THEN
    WITH candidates AS (
      SELECT
        r.id AS registration_id,
        p.first_name,
        p.last_name,
        p.job_title,
        COALESCE(NULLIF(btrim(p.company_text), ''), co.name) AS company,
        p.user_id,
        p.photo_url,
        p.industry,
        p.specialization,
        co.logo_url AS company_logo_url
      FROM public.event_registrations r
      JOIN public.event_people p
        ON p.id = r.person_id AND p.tenant_id = r.tenant_id
      LEFT JOIN public.crm_companies co
        ON co.tenant_id = p.tenant_id AND co.id = p.company_id
      WHERE r.tenant_id = v_tenant
        AND r.event_id = v_event.id
        AND r.id <> v_me
        AND r.status IN ('approved', 'attended')
        AND r.directory_opt_out = false
        AND public._event_meeting_can_invite(v_tenant, v_event.id, v_me, r.id) IS NULL
        AND (
          v_scope <> 'own_group'
          OR EXISTS (
            SELECT 1
            FROM public._event_meeting_groups(v_tenant, v_event.id, r.id) AS theirs(group_id)
            WHERE theirs.group_id IN (
              SELECT mine.group_id
              FROM public._event_meeting_groups(v_tenant, v_event.id, v_me) AS mine(group_id)
            )
          )
        )
        AND (
          v_group_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public._event_meeting_groups(v_tenant, v_event.id, r.id) AS theirs(group_id)
            WHERE theirs.group_id = v_group_id
          )
        )
        AND (
          v_q IS NULL
          OR p.full_name_norm LIKE '%' || lower(btrim(v_q)) || '%'
          OR lower(COALESCE(NULLIF(btrim(p.company_text), ''), co.name, '')) LIKE
             '%' || lower(btrim(v_q)) || '%'
        )
    ),
    totals AS (
      SELECT count(*)::integer AS n FROM candidates
    ),
    page AS (
      SELECT c.*
      FROM candidates c
      ORDER BY c.last_name, c.first_name, c.registration_id
      LIMIT v_limit OFFSET v_offset
    )
    SELECT
      (SELECT t.n FROM totals t),
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'registration_id', pg.registration_id,
              'first_name', pg.first_name,
              'last_name', pg.last_name,
              'job_title', pg.job_title,
              'company', pg.company,
              'company_logo_url', pg.company_logo_url,
              'user_id', pg.user_id,
              'photo_url', pg.photo_url,
              'industry', pg.industry,
              'specialization', pg.specialization,
              'groups', (
                SELECT COALESCE(jsonb_agg(
                  jsonb_build_object(
                    'id', g.id,
                    'name_pl', g.name_pl,
                    'name_en', g.name_en,
                    'color', g.color
                  ) ORDER BY g.sort_order, g.name_pl
                ), '[]'::jsonb)
                FROM public._event_meeting_groups(v_tenant, v_event.id, pg.registration_id)
                  AS mg(group_id)
                JOIN public.event_groups g ON g.id = mg.group_id AND g.tenant_id = v_tenant
              ),
              'has_availability', EXISTS (
                SELECT 1 FROM public.event_meeting_availability a
                WHERE a.tenant_id = v_tenant
                  AND a.event_id = v_event.id
                  AND a.registration_id = pg.registration_id
                  AND a.is_open
              ),
              'meeting_status', (
                SELECT m.status
                FROM public.event_meetings m
                WHERE m.tenant_id = v_tenant
                  AND m.event_id = v_event.id
                  AND m.pair_low = LEAST(v_me, pg.registration_id)
                  AND m.pair_high = GREATEST(v_me, pg.registration_id)
                  AND m.status IN ('invited', 'accepted')
                ORDER BY m.starts_at
                LIMIT 1
              )
            ) ORDER BY pg.last_name, pg.first_name, pg.registration_id
          )
          FROM page pg
        ),
        '[]'::jsonb
      )
    INTO v_total, v_rows;
  END IF;

  RETURN jsonb_build_object(
    'blocked', v_blocked,
    'visibility', v_visibility,
    'scope', COALESCE(v_scope, 'none'),
    'my_registration_id', v_me,
    'directory_opt_out', v_opt_out,
    'total_count', v_total,
    'rows', v_rows,
    'groups', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', g.id,
          'name_pl', g.name_pl,
          'name_en', g.name_en,
          'color', g.color
        ) ORDER BY g.sort_order, g.name_pl
      ), '[]'::jsonb)
      FROM public.event_groups g
      WHERE g.tenant_id = v_tenant
        AND g.event_id = v_event.id
        AND g.can_meet
    )
  );
END;
$function$;

-- Marka firmy z kartoteki CRM: WYLACZNIE pola wizytowkowe (nazwa, logo,
-- strona, branza). Kontakty, adresy i notatki NIE wychodza ta droga.
CREATE OR REPLACE FUNCTION public.crm_company_brand(p_name text)
RETURNS TABLE (name text, logo_url text, website text, branch text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT c.name, c.logo_url, c.website, c.branch
  FROM public.crm_companies c
  WHERE btrim(COALESCE(p_name, '')) <> ''
    AND c.name_norm = lower(btrim(p_name))
    AND c.tenant_id = COALESCE(public._caller_tenant(), public.public_tenant_id())
  ORDER BY (c.logo_url IS NOT NULL) DESC, c.updated_at DESC
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.crm_company_brand(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_company_brand(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_brand(text) TO anon;