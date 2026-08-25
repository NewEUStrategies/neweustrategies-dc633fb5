DROP FUNCTION IF EXISTS public.admin_event_checkins_list(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, integer, integer
);
CREATE OR REPLACE FUNCTION public.admin_event_checkins_list(
  p_event_id uuid,
  p_checkpoint_id uuid DEFAULT NULL,
  p_direction text DEFAULT NULL,
  p_result text DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  occurred_at timestamptz,
  scanned_at timestamptz,
  device_scanned_at timestamptz,
  direction text,
  result text,
  source text,
  repeat_count integer,
  note text,
  checkpoint_id uuid,
  checkpoint_name_pl text,
  checkpoint_name_en text,
  checkpoint_kind text,
  person_id uuid,
  first_name text,
  last_name text,
  company text,
  job_title text,
  registration_id uuid,
  registration_status text,
  ticket_name_pl text,
  ticket_name_en text,
  group_name_pl text,
  group_name_en text,
  device_id uuid,
  device_label text,
  operator_user_id uuid,
  operator_name text,
  total_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_q text := NULLIF(btrim(COALESCE(p_q, '')), '');
BEGIN
  RETURN QUERY
  SELECT
    c.id, c.occurred_at, c.scanned_at, c.device_scanned_at,
    c.direction, c.result, c.source, c.repeat_count, c.note,
    c.checkpoint_id, cp.name_pl, cp.name_en, cp.kind,
    c.person_id, p.first_name, p.last_name,
    COALESCE(NULLIF(btrim(p.company_text), ''), co.name),
    p.job_title,
    c.registration_id, r.status, tt.name_pl, tt.name_en, g.name_pl, g.name_en,
    c.device_id, d.label,
    c.operator_user_id,
    COALESCE(
      NULLIF(btrim(pr.display_name), ''),
      NULLIF(btrim(COALESCE(pr.first_name, '') || ' ' || COALESCE(pr.last_name, '')), '')
    ),
    count(*) OVER ()::integer
  FROM public.event_checkins c
  JOIN public.event_checkpoints cp
    ON cp.tenant_id = c.tenant_id AND cp.id = c.checkpoint_id
  JOIN public.event_people p
    ON p.tenant_id = c.tenant_id AND p.id = c.person_id
  LEFT JOIN public.crm_companies co
    ON co.tenant_id = p.tenant_id AND co.id = p.company_id
  LEFT JOIN public.event_registrations r
    ON r.tenant_id = c.tenant_id AND r.id = c.registration_id
  LEFT JOIN public.event_ticket_types tt
    ON tt.tenant_id = r.tenant_id AND tt.id = r.ticket_type_id
  LEFT JOIN public.event_groups g
    ON g.tenant_id = r.tenant_id AND g.id = r.group_id
  LEFT JOIN public.event_scanner_devices d
    ON d.tenant_id = c.tenant_id AND d.id = c.device_id
  LEFT JOIN public.profiles pr
    ON pr.id = c.operator_user_id AND pr.tenant_id = c.tenant_id
  WHERE c.tenant_id = v_tenant
    AND c.event_id = p_event_id
    AND (p_checkpoint_id IS NULL OR c.checkpoint_id = p_checkpoint_id)
    AND (p_direction IS NULL OR c.direction = p_direction)
    AND (p_result IS NULL OR c.result = p_result)
    AND (p_source IS NULL OR c.source = p_source)
    AND (p_from IS NULL OR c.occurred_at >= p_from)
    AND (p_to IS NULL OR c.occurred_at <= p_to)
    AND (
      v_q IS NULL
      OR p.full_name_norm LIKE '%' || lower(v_q) || '%'
      OR lower(COALESCE(p.company_text, '')) LIKE '%' || lower(v_q) || '%'
    )
  ORDER BY c.occurred_at DESC, c.id
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_checkins_list(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, integer, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_checkins_list(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, integer, integer
) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_checkins_list(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, integer, integer
) IS
  'Dziennik odpraw dla panelu: filtry (punkt, kierunek, wynik, zrodlo, fraza, zakres czasu), paginacja i licznik calosci w funkcji okna. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_checkin_search(jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_checkin_search(p_payload jsonb)
RETURNS TABLE (
  person_id uuid,
  first_name text,
  last_name text,
  company text,
  job_title text,
  registration_id uuid,
  registration_status text,
  ticket_name_pl text,
  ticket_name_en text,
  group_name_pl text,
  group_name_en text,
  badge_printed boolean,
  last_checkin_at timestamptz,
  last_checkin_direction text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_q text := lower(btrim(COALESCE(p_payload->>'q', '')));
  v_limit integer := LEAST(GREATEST(COALESCE(NULLIF(p_payload->>'limit', '')::integer, 25), 1), 25);
BEGIN
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id is required';
  END IF;

  IF char_length(v_q) < 2 THEN
    RAISE EXCEPTION 'query_too_short: at least 2 characters are required';
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.first_name, p.last_name,
    COALESCE(NULLIF(btrim(p.company_text), ''), co.name),
    p.job_title,
    r.id, r.status, tt.name_pl, tt.name_en, g.name_pl, g.name_en,
    (bp.printed_at IS NOT NULL),
    lc.occurred_at, lc.direction
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
  LEFT JOIN LATERAL (
    SELECT bpr.printed_at
    FROM public.event_badge_prints bpr
    WHERE bpr.tenant_id = p.tenant_id AND bpr.event_id = v_event_id AND bpr.person_id = p.id
    ORDER BY bpr.printed_at DESC
    LIMIT 1
  ) bp ON true
  LEFT JOIN LATERAL (
    SELECT c.occurred_at, c.direction
    FROM public.event_checkins c
    WHERE c.tenant_id = p.tenant_id
      AND c.event_id = v_event_id
      AND c.person_id = p.id
      AND c.result = 'granted'
    ORDER BY c.occurred_at DESC
    LIMIT 1
  ) lc ON true
  WHERE p.tenant_id = v_tenant
    AND (
      p.full_name_norm LIKE '%' || v_q || '%'
      OR p.email_norm LIKE v_q || '%'
      OR lower(COALESCE(p.company_text, '')) LIKE '%' || v_q || '%'
    )
    AND (
      r.id IS NOT NULL
      OR lc.occurred_at IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM public.event_registrations r2
        WHERE r2.tenant_id = p.tenant_id AND r2.event_id = v_event_id AND r2.person_id = p.id
      )
    )
  ORDER BY p.last_name, p.first_name
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_checkin_search(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_checkin_search(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_checkin_search(jsonb) IS
  'Poszukiwanie uczestnika po nazwisku, adresie albo firmie przed odprawa reczna. JEDYNE miejsce w module oddajace liste osob z fragmentu tekstu - dlatego wylacznie w panelu i wylacznie w granicach jednego wydarzenia. Payload: {event_id, q, limit?}. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_checkin_manual(jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_checkin_manual(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_checkpoint_id uuid := NULLIF(p_payload->>'checkpoint_id', '')::uuid;
  v_person_id uuid := NULLIF(p_payload->>'person_id', '')::uuid;
  v_direction text := lower(btrim(COALESCE(p_payload->>'direction', 'in')));
  v_source text := lower(btrim(COALESCE(p_payload->>'source', 'manual_entry')));
BEGIN
  IF v_event_id IS NULL OR v_checkpoint_id IS NULL OR v_person_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id, checkpoint_id and person_id are required';
  END IF;

  IF v_source NOT IN ('manual_entry', 'name_search') THEN
    RAISE EXCEPTION 'invalid_source: the panel can only record manual_entry or name_search';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_people p
    WHERE p.tenant_id = v_tenant AND p.id = v_person_id
  ) THEN
    RAISE EXCEPTION 'person_not_found: person does not exist in this organisation';
  END IF;

  RETURN public._event_checkin_write(
    v_tenant,
    v_event_id,
    v_checkpoint_id,
    v_person_id,
    v_direction,
    v_source,
    NULL,
    auth.uid(),
    NULLIF(btrim(COALESCE(p_payload->>'client_scan_uid', '')), ''),
    NULL,
    NULLIF(btrim(COALESCE(p_payload->>'note', '')), '')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_checkin_manual(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_checkin_manual(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_checkin_manual(jsonb) IS
  'Odprawa reczna z panelu, przez ta sama funkcje zapisu co skan. Payload: {event_id, checkpoint_id, person_id, direction?, source?, note?, client_scan_uid?}. Zrodlo ograniczone do manual_entry / name_search - redaktor nie moze zapisac odprawy udajacej skan. Bramka: assert_editor_tenant().';