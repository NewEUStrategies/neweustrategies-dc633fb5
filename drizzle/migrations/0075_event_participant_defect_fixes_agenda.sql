-- Sekcja 1 z 20260926153200_event_participant_defect_fixes.sql (event_my_agenda, D0-4).
-- Sekcje 2 i 3 (payments_apply_event_ticket_outcome, _event_apply_outcome_to_group)
-- sa juz w bazie w NOWSZEJ wersji z 20260926180000/180002 (gaps_part3), ktora
-- zawiera zmiany D0-2; ponowne wdrozenie cofneloby poprawki gaps_part3.
CREATE OR REPLACE FUNCTION public.event_my_agenda(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'slug','')), '');
  v_event uuid;
  v_tz text;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to see your agenda';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'invalid_tenant: unknown host';
  END IF;
  IF v_slug IS NULL THEN
    RAISE EXCEPTION 'invalid_slug: event slug is required';
  END IF;

  SELECT e.id, public._event_safe_timezone(e.timezone) INTO v_event, v_tz
  FROM public.events e
  WHERE e.tenant_id = v_tenant AND e.slug = v_slug
  LIMIT 1;

  IF v_event IS NULL THEN
    RETURN jsonb_build_object('sessions', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.starts_at NULLS LAST, x.title_pl), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      s.id AS session_id,
      s.title_pl,
      s.title_en,
      s.starts_at,
      s.ends_at,
      s.format,
      r.name AS room_name,
      r.floor AS room_floor,
      r.name AS room_name_pl,
      r.name AS room_name_en,
      s.status AS session_status,
      s.cancelled_at,
      v_tz AS timezone,
      t.id AS track_id,
      t.name_pl AS track_name_pl,
      t.name_en AS track_name_en,
      g.status AS signup_status,
      g.registered_at
    FROM public.event_session_signups g
    JOIN public.event_sessions s
      ON s.id = g.session_id AND s.tenant_id = g.tenant_id
    LEFT JOIN public.event_rooms r
      ON r.id = s.room_id AND r.tenant_id = s.tenant_id
    LEFT JOIN public.event_tracks t
      ON t.id = s.track_id AND t.tenant_id = s.tenant_id
    WHERE g.tenant_id = v_tenant
      AND g.event_id = v_event
      AND g.user_id = v_uid
      AND COALESCE(g.status, 'registered') <> 'cancelled'
      AND s.status IN ('published', 'cancelled')
      AND (s.is_private = false OR g.status IS NOT NULL)
  ) x;

  RETURN jsonb_build_object('sessions', v_rows);
END;
$function$;
COMMENT ON FUNCTION public.event_my_agenda(jsonb) IS
  'Moja agenda na wydarzeniu: sesje, na ktore konto jest zapisane (registered/waitlist). Sala z event_rooms.name/floor, status sesji (odwolane oznaczone, szkice ukryte), strefa wydarzenia; bez stream_url (D0-4).';

REVOKE ALL ON FUNCTION public.event_my_agenda(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_my_agenda(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_my_agenda(jsonb) TO service_role;
