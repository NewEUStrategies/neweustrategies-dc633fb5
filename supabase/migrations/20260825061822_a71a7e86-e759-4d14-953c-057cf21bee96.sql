DROP FUNCTION IF EXISTS public._event_badge_print_write(
  uuid, uuid, uuid, uuid, integer, text, uuid, uuid, text
);
CREATE OR REPLACE FUNCTION public._event_badge_print_write(
  _tenant uuid,
  _event_id uuid,
  _person_id uuid,
  _template_id uuid,
  _copies integer,
  _reason text,
  _printed_by uuid,
  _device_id uuid,
  _note text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_template public.event_badge_templates;
  v_reg_id uuid;
  v_prints integer;
  v_reason text;
  v_copies integer := LEAST(GREATEST(COALESCE(_copies, 1), 1), 20);
  v_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.event_people p
    WHERE p.tenant_id = _tenant AND p.id = _person_id
  ) THEN
    RAISE EXCEPTION 'person_not_found: person does not exist in this organisation';
  END IF;

  IF _template_id IS NOT NULL THEN
    SELECT t.* INTO v_template
    FROM public.event_badge_templates t
    WHERE t.tenant_id = _tenant AND t.event_id = _event_id AND t.id = _template_id;

    IF v_template.id IS NULL THEN
      RAISE EXCEPTION 'template_not_in_event: the badge template belongs to another event';
    END IF;
  ELSE
    SELECT t.* INTO v_template
    FROM public.event_badge_templates t
    WHERE t.tenant_id = _tenant AND t.event_id = _event_id AND t.is_default;

    IF v_template.id IS NULL THEN
      RAISE EXCEPTION 'template_missing: this event has no default badge template';
    END IF;
  END IF;

  SELECT r.id INTO v_reg_id
  FROM public.event_registrations r
  WHERE r.tenant_id = _tenant
    AND r.event_id = _event_id
    AND r.person_id = _person_id
    AND r.status NOT IN ('cancelled', 'rejected');

  SELECT count(*)::integer INTO v_prints
  FROM public.event_badge_prints bp
  WHERE bp.tenant_id = _tenant AND bp.event_id = _event_id AND bp.person_id = _person_id;

  v_reason := lower(btrim(COALESCE(_reason, '')));
  IF v_reason NOT IN (
    'first_issue', 'reprint_lost', 'reprint_damaged', 'data_correction', 'bulk_preprint'
  ) THEN
    v_reason := CASE WHEN v_prints > 0 THEN 'reprint_lost' ELSE 'first_issue' END;
  END IF;

  INSERT INTO public.event_badge_prints (
    tenant_id, event_id, person_id, registration_id, template_id, template_version,
    copies, reason, printed_by, device_id, note
  ) VALUES (
    _tenant, _event_id, _person_id, v_reg_id, v_template.id, v_template.version,
    v_copies, v_reason, _printed_by, _device_id,
    NULLIF(btrim(COALESCE(_note, '')), '')
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'print_id', v_id,
    'template_id', v_template.id,
    'template_name', v_template.name,
    'template_version', v_template.version,
    'copies', v_copies,
    'reason', v_reason,
    'previous_prints', v_prints,
    'person', public._event_onsite_person_card(_tenant, _event_id, _person_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public._event_badge_print_write(
  uuid, uuid, uuid, uuid, integer, text, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_badge_print_write(
  uuid, uuid, uuid, uuid, integer, text, uuid, uuid, text
) TO service_role;

COMMENT ON FUNCTION public._event_badge_print_write(
  uuid, uuid, uuid, uuid, integer, text, uuid, uuid, text
) IS
  'Jedyna droga do rejestru wydrukow, wspolna dla panelu i stanowiska samoobslugowego. Szablon domyslny jako wartosc zapasowa, ale zapisany JAWNIE razem z wersja. Brak powodu przy istniejacym wydruku daje reprint_lost, nie first_issue.';

DROP FUNCTION IF EXISTS public.admin_event_badge_print_record(jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_badge_print_record(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_person_id uuid := NULLIF(p_payload->>'person_id', '')::uuid;
BEGIN
  IF v_event_id IS NULL OR v_person_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id and person_id are required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = v_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this organisation';
  END IF;

  RETURN public._event_badge_print_write(
    v_tenant,
    v_event_id,
    v_person_id,
    NULLIF(p_payload->>'template_id', '')::uuid,
    NULLIF(p_payload->>'copies', '')::integer,
    p_payload->>'reason',
    auth.uid(),
    NULL,
    p_payload->>'note'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_badge_print_record(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_badge_print_record(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_badge_print_record(jsonb) IS
  'Zapis wydruku identyfikatora z panelu. Payload: {event_id, person_id, template_id?, copies?, reason?, note?}. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.event_badge_print_record(jsonb);
CREATE OR REPLACE FUNCTION public.event_badge_print_record(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_device public.event_scanner_devices;
  v_code text := btrim(COALESCE(p_payload->>'code', ''));
  v_reg record;
  v_locked boolean;
BEGIN
  v_device := public._event_scanner_device_auth(p_payload->>'device_token', 'badge_print');

  IF v_code = '' THEN
    RAISE EXCEPTION 'invalid_payload: code is required';
  END IF;

  SELECT r.id, r.event_id, r.person_id INTO v_reg
  FROM public.event_registrations r
  WHERE r.tenant_id = v_device.tenant_id
    AND r.qr_token_hash = encode(digest(v_code, 'sha256'), 'hex');

  IF v_reg.id IS NULL THEN
    v_locked := public._event_scanner_device_note_failure(v_device.id);
    RETURN jsonb_build_object('outcome', 'unknown_code', 'device_locked', v_locked);
  END IF;

  IF v_reg.event_id <> v_device.event_id THEN
    RETURN jsonb_build_object('outcome', 'wrong_event', 'device_locked', false);
  END IF;

  RETURN jsonb_build_object('outcome', 'printed') || public._event_badge_print_write(
    v_device.tenant_id,
    v_device.event_id,
    v_reg.person_id,
    NULLIF(p_payload->>'template_id', '')::uuid,
    NULLIF(p_payload->>'copies', '')::integer,
    p_payload->>'reason',
    NULL,
    v_device.id,
    NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_badge_print_record(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_badge_print_record(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_badge_print_record(jsonb) IS
  'Zapis wydruku identyfikatora ze stanowiska samoobslugowego. Payload: {device_token, code, template_id?, copies?, reason?}. Wymaga zakresu badge_print. Wejsciem jest TOKEN uczestnika, nie person_id.';

DROP FUNCTION IF EXISTS public.admin_event_badge_prints_list(uuid, uuid, integer, integer);
CREATE OR REPLACE FUNCTION public.admin_event_badge_prints_list(
  p_event_id uuid,
  p_person_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  printed_at timestamptz,
  person_id uuid,
  first_name text,
  last_name text,
  company text,
  registration_id uuid,
  registration_status text,
  template_id uuid,
  template_name text,
  template_version integer,
  template_current_version integer,
  copies integer,
  reason text,
  note text,
  printed_by uuid,
  printed_by_name text,
  device_id uuid,
  device_label text,
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
BEGIN
  RETURN QUERY
  SELECT
    bp.id, bp.printed_at, bp.person_id, p.first_name, p.last_name,
    COALESCE(NULLIF(btrim(p.company_text), ''), co.name),
    bp.registration_id, r.status,
    bp.template_id, t.name, bp.template_version, t.version,
    bp.copies, bp.reason, bp.note,
    bp.printed_by,
    COALESCE(
      NULLIF(btrim(pr.display_name), ''),
      NULLIF(btrim(COALESCE(pr.first_name, '') || ' ' || COALESCE(pr.last_name, '')), '')
    ),
    bp.device_id, d.label,
    count(*) OVER ()::integer
  FROM public.event_badge_prints bp
  JOIN public.event_people p ON p.tenant_id = bp.tenant_id AND p.id = bp.person_id
  LEFT JOIN public.crm_companies co ON co.tenant_id = p.tenant_id AND co.id = p.company_id
  LEFT JOIN public.event_registrations r ON r.tenant_id = bp.tenant_id AND r.id = bp.registration_id
  LEFT JOIN public.event_badge_templates t ON t.tenant_id = bp.tenant_id AND t.id = bp.template_id
  LEFT JOIN public.profiles pr ON pr.id = bp.printed_by AND pr.tenant_id = bp.tenant_id
  LEFT JOIN public.event_scanner_devices d ON d.tenant_id = bp.tenant_id AND d.id = bp.device_id
  WHERE bp.tenant_id = v_tenant
    AND bp.event_id = p_event_id
    AND (p_person_id IS NULL OR bp.person_id = p_person_id)
  ORDER BY bp.printed_at DESC, bp.id
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_badge_prints_list(uuid, uuid, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_badge_prints_list(uuid, uuid, integer, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_badge_prints_list(uuid, uuid, integer, integer) IS
  'Rejestr wydrukow identyfikatora z wersja szablonu W CHWILI WYDRUKU obok wersji BIEZACEJ - roznica mowi, kogo trzeba przedrukowac. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_lead_scans_list(uuid, uuid, integer, integer);
CREATE OR REPLACE FUNCTION public.admin_event_lead_scans_list(
  p_event_id uuid,
  p_sponsor_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  sponsor_id uuid,
  sponsor_name text,
  person_id uuid,
  first_name text,
  last_name text,
  company text,
  first_scanned_at timestamptz,
  last_scanned_at timestamptz,
  scan_count integer,
  interest_rating smallint,
  note text,
  consent boolean,
  consent_snapshot_at timestamptz,
  device_id uuid,
  device_label text,
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
BEGIN
  RETURN QUERY
  SELECT
    l.id, l.sponsor_id, sp.snapshot_name,
    l.person_id, p.first_name, p.last_name,
    COALESCE(NULLIF(btrim(p.company_text), ''), co.name),
    l.first_scanned_at, l.last_scanned_at, l.scan_count,
    l.interest_rating, l.note,
    (p.consent_partner_sharing_at IS NOT NULL AND p.consent_withdrawn_at IS NULL),
    l.consent_snapshot_at,
    l.device_id, d.label,
    count(*) OVER ()::integer
  FROM public.event_lead_scans l
  JOIN public.event_sponsors sp ON sp.tenant_id = l.tenant_id AND sp.id = l.sponsor_id
  JOIN public.event_people p ON p.tenant_id = l.tenant_id AND p.id = l.person_id
  LEFT JOIN public.crm_companies co ON co.tenant_id = p.tenant_id AND co.id = p.company_id
  LEFT JOIN public.event_scanner_devices d ON d.tenant_id = l.tenant_id AND d.id = l.device_id
  WHERE l.tenant_id = v_tenant
    AND l.event_id = p_event_id
    AND (p_sponsor_id IS NULL OR l.sponsor_id = p_sponsor_id)
  ORDER BY l.last_scanned_at DESC, l.id
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_lead_scans_list(uuid, uuid, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_lead_scans_list(uuid, uuid, integer, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_lead_scans_list(uuid, uuid, integer, integer) IS
  'Przeglad skanow leadow wydarzenia dla organizatora, z flaga ZYWEJ zgody i data dowodu. BEZ danych kontaktowych uczestnika - tu jest odpowiedz o skany, nie o osoby. Bramka: assert_editor_tenant().';