-- MODUŁ ON-SITE: generator identyfikatorów (QR), eksport leadów, statystyki live.
--
-- QR JEST WYDAWANY, NIE ODCZYTYWANY. Baza trzyma wyłącznie SHA-256 kodu, więc
-- wydruk identyfikatora MUSI wystawić nowy token - stary przestaje działać i to
-- jest cecha, nie usterka: identyfikator zgubiony przed przedrukiem nie wpuszcza.
CREATE OR REPLACE FUNCTION public.admin_event_badge_batch(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_template_id uuid := NULLIF(p_payload->>'template_id', '')::uuid;
  v_ids uuid[];
  v_row record;
  v_token text;
  v_out jsonb := '[]'::jsonb;
BEGIN
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id is required';
  END IF;

  SELECT array_agg(value::uuid) INTO v_ids
  FROM jsonb_array_elements_text(COALESCE(p_payload->'person_ids', '[]'::jsonb)) AS value;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: person_ids is required';
  END IF;

  IF array_length(v_ids, 1) > 200 THEN
    RAISE EXCEPTION 'invalid_payload: at most 200 badges per batch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = v_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this organisation';
  END IF;

  IF v_template_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_badge_templates t
    WHERE t.tenant_id = v_tenant AND t.id = v_template_id AND t.event_id = v_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: badge template does not belong to this event';
  END IF;

  FOR v_row IN
    SELECT
      p.id AS person_id,
      p.first_name,
      p.last_name,
      p.job_title,
      COALESCE(NULLIF(btrim(p.company_text), ''), co.name) AS company,
      r.id AS registration_id,
      r.status AS registration_status,
      tt.name_pl AS ticket_name_pl,
      tt.name_en AS ticket_name_en,
      COALESCE(g.name_pl, dg.name_pl) AS group_name_pl,
      COALESCE(g.name_en, dg.name_en) AS group_name_en,
      COALESCE(g.color, dg.color) AS group_color
    FROM public.event_people p
    LEFT JOIN public.crm_companies co
      ON co.tenant_id = p.tenant_id AND co.id = p.company_id
    LEFT JOIN public.event_registrations r
      ON r.tenant_id = p.tenant_id
     AND r.event_id = v_event_id
     AND r.person_id = p.id
     AND r.status NOT IN ('cancelled', 'rejected')
    LEFT JOIN public.event_ticket_types tt
      ON tt.tenant_id = r.tenant_id AND tt.id = r.ticket_type_id
    LEFT JOIN public.event_groups g
      ON g.tenant_id = r.tenant_id AND g.id = r.group_id
    LEFT JOIN public.event_groups dg
      ON dg.tenant_id = p.tenant_id AND dg.event_id = v_event_id AND dg.is_default
    WHERE p.tenant_id = v_tenant
      AND p.id = ANY(v_ids)
    ORDER BY p.last_name, p.first_name
  LOOP
    v_token := NULL;

    IF v_row.registration_id IS NOT NULL THEN
      v_token := public._event_new_qr_token();
      UPDATE public.event_registrations
         SET qr_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
             qr_issued_at = now()
       WHERE tenant_id = v_tenant AND id = v_row.registration_id;
    END IF;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'person_id', v_row.person_id,
      'first_name', v_row.first_name,
      'last_name', v_row.last_name,
      'job_title', v_row.job_title,
      'company', v_row.company,
      'registration_id', v_row.registration_id,
      'registration_status', v_row.registration_status,
      'ticket_name_pl', v_row.ticket_name_pl,
      'ticket_name_en', v_row.ticket_name_en,
      'group_name_pl', v_row.group_name_pl,
      'group_name_en', v_row.group_name_en,
      'group_color', v_row.group_color,
      'qr_code', v_token
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'event_id', v_event_id,
    'template_id', v_template_id,
    'issued_at', now(),
    'badges', v_out
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_event_badge_batch(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_event_badge_batch(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_event_badge_batch(jsonb) TO service_role;

-- STATYSTYKI WEJŚĆ NA ŻYWO: per sesja i per sala.
CREATE OR REPLACE FUNCTION public.admin_event_onsite_live_stats(
  p_event_id uuid,
  p_window_minutes integer DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_window integer := LEAST(GREATEST(COALESCE(p_window_minutes, 60), 5), 720);
  v_since timestamptz;
  v_sessions jsonb;
  v_rooms jsonb;
BEGIN
  v_since := now() - make_interval(mins => v_window);

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = p_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this organisation';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'session_id', x.session_id,
    'title_pl', x.title_pl,
    'title_en', x.title_en,
    'starts_at', x.starts_at,
    'ends_at', x.ends_at,
    'room_id', x.room_id,
    'room_name', x.room_name,
    'capacity', x.capacity,
    'granted_in', x.granted_in,
    'granted_out', x.granted_out,
    'denied', x.denied,
    'inside', GREATEST(x.granted_in - x.granted_out, 0),
    'unique_people', x.unique_people,
    'recent_in', x.recent_in,
    'last_checkin_at', x.last_at
  ) ORDER BY x.starts_at NULLS LAST, x.title_pl), '[]'::jsonb) INTO v_sessions
  FROM (
    SELECT
      s.id AS session_id,
      s.title_pl,
      s.title_en,
      s.starts_at,
      s.ends_at,
      s.room_id,
      rm.name AS room_name,
      COALESCE(s.capacity, max(cp.capacity)) AS capacity,
      count(*) FILTER (WHERE c.result = 'granted' AND c.direction = 'in')::integer AS granted_in,
      count(*) FILTER (WHERE c.result = 'granted' AND c.direction = 'out')::integer AS granted_out,
      count(*) FILTER (WHERE c.result <> 'granted')::integer AS denied,
      count(DISTINCT c.person_id) FILTER (WHERE c.result = 'granted')::integer AS unique_people,
      count(*) FILTER (
        WHERE c.result = 'granted' AND c.direction = 'in' AND c.occurred_at >= v_since
      )::integer AS recent_in,
      max(c.occurred_at) AS last_at
    FROM public.event_sessions s
    LEFT JOIN public.event_rooms rm
      ON rm.tenant_id = s.tenant_id AND rm.id = s.room_id
    LEFT JOIN public.event_checkpoints cp
      ON cp.tenant_id = s.tenant_id AND cp.event_id = s.event_id AND cp.session_id = s.id
    LEFT JOIN public.event_checkins c
      ON c.tenant_id = cp.tenant_id AND c.checkpoint_id = cp.id
    WHERE s.tenant_id = v_tenant
      AND s.event_id = p_event_id
      AND s.cancelled_at IS NULL
    GROUP BY s.id, s.title_pl, s.title_en, s.starts_at, s.ends_at, s.room_id, rm.name, s.capacity
  ) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'room_id', y.room_id,
    'name', y.name,
    'floor', y.floor,
    'capacity', y.capacity,
    'granted_in', y.granted_in,
    'granted_out', y.granted_out,
    'denied', y.denied,
    'inside', GREATEST(y.granted_in - y.granted_out, 0),
    'unique_people', y.unique_people,
    'recent_in', y.recent_in,
    'last_checkin_at', y.last_at
  ) ORDER BY y.name), '[]'::jsonb) INTO v_rooms
  FROM (
    SELECT
      rm.id AS room_id,
      rm.name,
      rm.floor,
      rm.capacity,
      count(*) FILTER (WHERE c.result = 'granted' AND c.direction = 'in')::integer AS granted_in,
      count(*) FILTER (WHERE c.result = 'granted' AND c.direction = 'out')::integer AS granted_out,
      count(*) FILTER (WHERE c.result <> 'granted')::integer AS denied,
      count(DISTINCT c.person_id) FILTER (WHERE c.result = 'granted')::integer AS unique_people,
      count(*) FILTER (
        WHERE c.result = 'granted' AND c.direction = 'in' AND c.occurred_at >= v_since
      )::integer AS recent_in,
      max(c.occurred_at) AS last_at
    FROM public.event_rooms rm
    LEFT JOIN public.event_checkpoints cp
      ON cp.tenant_id = rm.tenant_id
     AND cp.event_id = rm.event_id
     AND (
       cp.room_id = rm.id
       OR cp.session_id IN (
         SELECT s2.id FROM public.event_sessions s2
         WHERE s2.tenant_id = rm.tenant_id AND s2.event_id = rm.event_id AND s2.room_id = rm.id
       )
     )
    LEFT JOIN public.event_checkins c
      ON c.tenant_id = cp.tenant_id AND c.checkpoint_id = cp.id
    WHERE rm.tenant_id = v_tenant
      AND rm.event_id = p_event_id
    GROUP BY rm.id, rm.name, rm.floor, rm.capacity
  ) y;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'window_minutes', v_window,
    'sessions', v_sessions,
    'rooms', v_rooms
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_event_onsite_live_stats(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_event_onsite_live_stats(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_event_onsite_live_stats(uuid, integer) TO service_role;

-- EKSPORT LEADÓW WYSTAWCY: kontakt wychodzi wyłącznie ze zgodą.
CREATE OR REPLACE FUNCTION public.admin_event_lead_scans_export(
  p_event_id uuid,
  p_sponsor_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  sponsor_name text,
  first_name text,
  last_name text,
  company text,
  job_title text,
  email text,
  phone text,
  consent boolean,
  consent_snapshot_at timestamptz,
  interest_rating smallint,
  note text,
  scan_count integer,
  first_scanned_at timestamptz,
  last_scanned_at timestamptz,
  device_label text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY
  SELECT
    sp.snapshot_name,
    p.first_name,
    p.last_name,
    COALESCE(NULLIF(btrim(p.company_text), ''), co.name),
    p.job_title,
    CASE WHEN p.consent_partner_sharing_at IS NOT NULL AND p.consent_withdrawn_at IS NULL
         THEN p.email END,
    CASE WHEN p.consent_partner_sharing_at IS NOT NULL AND p.consent_withdrawn_at IS NULL
         THEN p.phone END,
    (p.consent_partner_sharing_at IS NOT NULL AND p.consent_withdrawn_at IS NULL),
    l.consent_snapshot_at,
    l.interest_rating,
    l.note,
    l.scan_count,
    l.first_scanned_at,
    l.last_scanned_at,
    d.label
  FROM public.event_lead_scans l
  JOIN public.event_sponsors sp ON sp.tenant_id = l.tenant_id AND sp.id = l.sponsor_id
  JOIN public.event_people p ON p.tenant_id = l.tenant_id AND p.id = l.person_id
  LEFT JOIN public.crm_companies co ON co.tenant_id = p.tenant_id AND co.id = p.company_id
  LEFT JOIN public.event_scanner_devices d ON d.tenant_id = l.tenant_id AND d.id = l.device_id
  WHERE l.tenant_id = v_tenant
    AND l.event_id = p_event_id
    AND (p_sponsor_id IS NULL OR l.sponsor_id = p_sponsor_id)
  ORDER BY sp.snapshot_name, l.last_scanned_at DESC
  LIMIT 20000;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_event_lead_scans_export(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_event_lead_scans_export(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_event_lead_scans_export(uuid, uuid) TO service_role;