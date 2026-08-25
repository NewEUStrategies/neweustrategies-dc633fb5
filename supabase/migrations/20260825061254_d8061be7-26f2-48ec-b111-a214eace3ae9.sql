DROP FUNCTION IF EXISTS public.admin_event_onsite_stats(uuid, integer);
CREATE OR REPLACE FUNCTION public.admin_event_onsite_stats(
  p_event_id uuid,
  p_bucket_minutes integer DEFAULT 15
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_bucket integer := LEAST(GREATEST(COALESCE(p_bucket_minutes, 15), 5), 240);
  v_registered integer;
  v_arrived integer;
  v_arrived_reg integer;
  v_walk_in integer;
  v_denied integer;
  v_repeats integer;
  v_failed integer;
  v_badge_people integer;
  v_badge_copies integer;
  v_leads integer;
  v_leads_consent integer;
  v_denied_breakdown jsonb;
  v_histogram jsonb;
  v_checkpoints jsonb;
  v_devices jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = p_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this organisation';
  END IF;

  SELECT count(*)::integer INTO v_registered
  FROM public.event_registrations r
  WHERE r.tenant_id = v_tenant
    AND r.event_id = p_event_id
    AND r.status IN ('approved', 'attended', 'no_show');

  SELECT
    count(DISTINCT c.person_id)::integer,
    count(DISTINCT c.person_id) FILTER (WHERE c.registration_id IS NOT NULL)::integer,
    count(DISTINCT c.person_id) FILTER (WHERE c.registration_id IS NULL)::integer
  INTO v_arrived, v_arrived_reg, v_walk_in
  FROM public.event_checkins c
  WHERE c.tenant_id = v_tenant
    AND c.event_id = p_event_id
    AND c.result = 'granted'
    AND c.direction = 'in';

  SELECT
    count(*) FILTER (WHERE c.result <> 'granted')::integer,
    COALESCE(sum(c.repeat_count), 0)::integer
  INTO v_denied, v_repeats
  FROM public.event_checkins c
  WHERE c.tenant_id = v_tenant AND c.event_id = p_event_id;

  SELECT COALESCE(jsonb_object_agg(x.result, x.cnt), '{}'::jsonb) INTO v_denied_breakdown
  FROM (
    SELECT c.result, count(*)::integer AS cnt
    FROM public.event_checkins c
    WHERE c.tenant_id = v_tenant AND c.event_id = p_event_id AND c.result <> 'granted'
    GROUP BY c.result
  ) x;

  SELECT COALESCE(sum(d.failed_scan_count), 0)::integer INTO v_failed
  FROM public.event_scanner_devices d
  WHERE d.tenant_id = v_tenant AND d.event_id = p_event_id;

  SELECT count(DISTINCT bp.person_id)::integer, COALESCE(sum(bp.copies), 0)::integer
  INTO v_badge_people, v_badge_copies
  FROM public.event_badge_prints bp
  WHERE bp.tenant_id = v_tenant AND bp.event_id = p_event_id;

  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE p.consent_partner_sharing_at IS NOT NULL AND p.consent_withdrawn_at IS NULL
    )::integer
  INTO v_leads, v_leads_consent
  FROM public.event_lead_scans l
  JOIN public.event_people p ON p.tenant_id = l.tenant_id AND p.id = l.person_id
  WHERE l.tenant_id = v_tenant AND l.event_id = p_event_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'bucket_at', b.bucket_at,
    'granted_in', b.granted_in,
    'granted_out', b.granted_out,
    'denied', b.denied
  ) ORDER BY b.bucket_at), '[]'::jsonb) INTO v_histogram
  FROM (
    SELECT
      to_timestamp(
        floor(extract(epoch FROM c.occurred_at) / (v_bucket * 60)) * (v_bucket * 60)
      ) AS bucket_at,
      count(*) FILTER (WHERE c.result = 'granted' AND c.direction = 'in')::integer AS granted_in,
      count(*) FILTER (WHERE c.result = 'granted' AND c.direction = 'out')::integer AS granted_out,
      count(*) FILTER (WHERE c.result <> 'granted')::integer AS denied
    FROM public.event_checkins c
    WHERE c.tenant_id = v_tenant AND c.event_id = p_event_id
    GROUP BY 1
  ) b;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'checkpoint_id', s.id,
    'name_pl', s.name_pl,
    'name_en', s.name_en,
    'kind', s.kind,
    'access_mode', s.access_mode,
    'capacity', s.capacity,
    'occupancy', s.occupancy,
    'granted', s.granted,
    'denied', s.denied,
    'unique_people', s.unique_people,
    'last_checkin_at', s.last_at
  ) ORDER BY s.sort_order, s.name_pl), '[]'::jsonb) INTO v_checkpoints
  FROM (
    SELECT
      cp.id, cp.name_pl, cp.name_en, cp.kind, cp.access_mode, cp.capacity, cp.sort_order,
      public._event_checkpoint_occupancy(v_tenant, cp.id) AS occupancy,
      COALESCE(a.granted, 0)::integer AS granted,
      COALESCE(a.denied, 0)::integer AS denied,
      COALESCE(a.people, 0)::integer AS unique_people,
      a.last_at
    FROM public.event_checkpoints cp
    LEFT JOIN LATERAL (
      SELECT
        count(*) FILTER (WHERE c.result = 'granted')::integer AS granted,
        count(*) FILTER (WHERE c.result <> 'granted')::integer AS denied,
        count(DISTINCT c.person_id) FILTER (WHERE c.result = 'granted')::integer AS people,
        max(c.occurred_at) AS last_at
      FROM public.event_checkins c
      WHERE c.tenant_id = cp.tenant_id AND c.checkpoint_id = cp.id
    ) a ON true
    WHERE cp.tenant_id = v_tenant AND cp.event_id = p_event_id
  ) s;

  SELECT jsonb_build_object(
    'total', count(*)::integer,
    'active', count(*) FILTER (
      WHERE d.revoked_at IS NULL AND d.is_active AND d.expires_at > now()
        AND (d.locked_until IS NULL OR d.locked_until <= now())
    )::integer,
    'locked', count(*) FILTER (WHERE d.locked_until IS NOT NULL AND d.locked_until > now())::integer,
    'revoked', count(*) FILTER (WHERE d.revoked_at IS NOT NULL)::integer,
    'expired', count(*) FILTER (WHERE d.revoked_at IS NULL AND d.expires_at <= now())::integer
  ) INTO v_devices
  FROM public.event_scanner_devices d
  WHERE d.tenant_id = v_tenant AND d.event_id = p_event_id;

  RETURN jsonb_build_object(
    'event_id', p_event_id,
    'bucket_minutes', v_bucket,
    'registered_total', v_registered,
    'arrived_total', v_arrived,
    'arrived_registered', v_arrived_reg,
    'walk_in_total', v_walk_in,
    'attendance_rate', CASE
      WHEN v_registered > 0
      THEN round((v_arrived_reg::numeric / v_registered::numeric) * 100, 1)
      ELSE NULL
    END,
    'no_show_total', GREATEST(v_registered - v_arrived_reg, 0),
    'denied_total', v_denied,
    'denied_by_reason', v_denied_breakdown,
    'repeat_total', v_repeats,
    'failed_resolve_total', v_failed,
    'badges_printed_people', v_badge_people,
    'badges_printed_copies', v_badge_copies,
    'lead_scans_total', v_leads,
    'lead_scans_with_consent', v_leads_consent,
    'histogram', v_histogram,
    'checkpoints', v_checkpoints,
    'devices', v_devices
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_onsite_stats(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_onsite_stats(uuid, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_onsite_stats(uuid, integer) IS
  'Statystyki na miejscu: frekwencja z DZIENNIKA (nie z deklaracji), rozklad w czasie w koszykach, obciazenie punktow, stan urzadzen, wydruki i leady. Kazda liczba ma za soba wiersz, ktory ja wyprodukowal. Bramka: assert_editor_tenant().';