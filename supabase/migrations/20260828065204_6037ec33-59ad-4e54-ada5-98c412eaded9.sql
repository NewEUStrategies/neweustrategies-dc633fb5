CREATE OR REPLACE FUNCTION public.event_attendee_sessions(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'event_slug','')), '');
  v_event public.events;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_tenant IS NULL OR v_slug IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_slug is required';
  END IF;

  SELECT e.* INTO v_event
  FROM public.events e
  WHERE e.tenant_id = v_tenant AND e.slug = v_slug AND e.status = 'published';

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      sp.user_id,
      pe.id AS person_id,
      COALESCE((
        SELECT jsonb_agg(r.id)
        FROM public.event_registrations r
        WHERE r.tenant_id = v_tenant
          AND r.event_id = v_event.id
          AND pe.id IS NOT NULL
          AND r.person_id = pe.id
      ), '[]'::jsonb) AS registration_ids,
      jsonb_agg(jsonb_build_object(
        'session_id', s.id,
        'title_pl', s.title_pl,
        'title_en', s.title_en,
        'starts_at', s.starts_at,
        'ends_at', s.ends_at,
        'role', ess.role,
        'track_id', s.track_id
      ) ORDER BY s.starts_at NULLS LAST) AS sessions
    FROM public.event_session_speakers ess
    JOIN public.event_sessions s
      ON s.id = ess.session_id AND s.tenant_id = ess.tenant_id
     AND s.status = 'published' AND s.is_private = false AND s.cancelled_at IS NULL
    JOIN public.speaker_profiles sp
      ON sp.id = ess.speaker_profile_id AND sp.tenant_id = ess.tenant_id
    LEFT JOIN public.event_people pe
      ON pe.id = sp.person_id AND pe.tenant_id = sp.tenant_id
    WHERE ess.tenant_id = v_tenant
      AND ess.event_id = v_event.id
      AND (sp.user_id IS NOT NULL OR sp.person_id IS NOT NULL)
    GROUP BY sp.user_id, pe.id
  ) x;

  RETURN jsonb_build_object('speakers', v_rows);
END;
$function$;