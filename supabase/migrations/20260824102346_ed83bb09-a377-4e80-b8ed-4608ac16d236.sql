DROP FUNCTION IF EXISTS public.event_lead_scan_record(jsonb);
CREATE OR REPLACE FUNCTION public.event_lead_scan_record(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_device public.event_scanner_devices;
  v_code text := btrim(COALESCE(p_payload->>'code', ''));
  v_note text := NULLIF(btrim(COALESCE(p_payload->>'note', '')), '');
  v_rating smallint := NULLIF(p_payload->>'interest_rating', '')::smallint;
  v_reg record;
  v_person public.event_people;
  v_consent_at timestamptz;
  v_lead_id uuid;
  v_count integer;
  v_locked boolean;
BEGIN
  v_device := public._event_scanner_device_auth(p_payload->>'device_token', 'lead');

  IF v_code = '' THEN
    RAISE EXCEPTION 'invalid_payload: code is required';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 2000 THEN
    RAISE EXCEPTION 'invalid_payload: note is longer than 2000 characters';
  END IF;
  IF v_rating IS NOT NULL AND v_rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'invalid_payload: interest_rating must be between 1 and 5';
  END IF;

  SELECT r.id, r.event_id, r.person_id INTO v_reg
  FROM public.event_registrations r
  WHERE r.tenant_id = v_device.tenant_id
    AND r.qr_token_hash = encode(digest(v_code, 'sha256'), 'hex');

  IF v_reg.id IS NULL THEN
    v_locked := public._event_scanner_device_note_failure(v_device.id);
    RETURN jsonb_build_object(
      'outcome', 'unknown_code', 'device_locked', v_locked, 'person', NULL
    );
  END IF;

  IF v_reg.event_id <> v_device.event_id THEN
    RETURN jsonb_build_object(
      'outcome', 'wrong_event', 'device_locked', false, 'person', NULL
    );
  END IF;

  SELECT p.* INTO v_person
  FROM public.event_people p
  WHERE p.tenant_id = v_device.tenant_id AND p.id = v_reg.person_id;

  v_consent_at := CASE
    WHEN v_person.consent_partner_sharing_at IS NOT NULL
      AND v_person.consent_withdrawn_at IS NULL
    THEN v_person.consent_partner_sharing_at
    ELSE NULL
  END;

  INSERT INTO public.event_lead_scans (
    tenant_id, event_id, sponsor_id, person_id, registration_id,
    checkpoint_id, device_id, first_scanned_at, last_scanned_at, scan_count,
    note, interest_rating, consent_snapshot_at
  ) VALUES (
    v_device.tenant_id, v_device.event_id, v_device.sponsor_id, v_reg.person_id, v_reg.id,
    v_device.checkpoint_id, v_device.id, now(), now(), 1,
    v_note, v_rating, v_consent_at
  )
  ON CONFLICT (tenant_id, sponsor_id, person_id) DO UPDATE
  SET last_scanned_at = now(),
      scan_count = event_lead_scans.scan_count + 1,
      note = COALESCE(EXCLUDED.note, event_lead_scans.note),
      interest_rating = COALESCE(EXCLUDED.interest_rating, event_lead_scans.interest_rating),
      consent_snapshot_at = EXCLUDED.consent_snapshot_at,
      registration_id = COALESCE(EXCLUDED.registration_id, event_lead_scans.registration_id)
  RETURNING id, scan_count INTO v_lead_id, v_count;

  RETURN jsonb_build_object(
    'outcome', 'saved',
    'lead_id', v_lead_id,
    'scan_count', v_count,
    'consent', (v_consent_at IS NOT NULL),
    'person', CASE
      WHEN v_consent_at IS NULL THEN NULL
      ELSE jsonb_build_object(
        'first_name', v_person.first_name,
        'last_name', v_person.last_name,
        'company', COALESCE(
          NULLIF(btrim(v_person.company_text), ''),
          (SELECT co.name FROM public.crm_companies co
            WHERE co.tenant_id = v_person.tenant_id AND co.id = v_person.company_id)
        ),
        'job_title', v_person.job_title,
        'email', v_person.email,
        'phone', v_person.phone
      )
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_lead_scan_record(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_lead_scan_record(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_lead_scan_record(jsonb) IS
  'Skan leada na stoisku. Payload: {device_token, code, note?, interest_rating?}. Wlasciciel leada pochodzi z POSWIADCZENIA (event_scanner_devices.sponsor_id) - nie ma pola, ktorym mozna wskazac innego sponsora. Bez zgody uczestnika potwierdza zapis, ale NIE oddaje tozsamosci.';

DROP FUNCTION IF EXISTS public.event_lead_scans_list(jsonb);
CREATE OR REPLACE FUNCTION public.event_lead_scans_list(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_device public.event_scanner_devices;
  v_limit integer := LEAST(GREATEST(COALESCE(NULLIF(p_payload->>'limit', '')::integer, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(NULLIF(p_payload->>'offset', '')::integer, 0), 0);
  v_rows jsonb;
  v_total integer;
  v_with_consent integer;
BEGIN
  SELECT d.* INTO v_device
  FROM public.event_scanner_devices d
  WHERE d.token_hash = encode(digest(btrim(COALESCE(p_payload->>'device_token', '')), 'sha256'), 'hex');

  IF v_device.id IS NULL
     OR v_device.revoked_at IS NOT NULL
     OR NOT v_device.is_active
     OR v_device.expires_at <= now()
     OR (v_device.locked_until IS NOT NULL AND v_device.locked_until > now())
     OR NOT ('lead' = ANY (v_device.scopes)) THEN
    RAISE EXCEPTION 'invalid_device_token: scanner credential is not valid for lead retrieval';
  END IF;

  SELECT count(*)::integer,
         count(*) FILTER (
           WHERE p.consent_partner_sharing_at IS NOT NULL AND p.consent_withdrawn_at IS NULL
         )::integer
    INTO v_total, v_with_consent
  FROM public.event_lead_scans l
  JOIN public.event_people p ON p.tenant_id = l.tenant_id AND p.id = l.person_id
  WHERE l.tenant_id = v_device.tenant_id
    AND l.sponsor_id = v_device.sponsor_id;

  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'lead_id', l.id,
      'first_scanned_at', l.first_scanned_at,
      'last_scanned_at', l.last_scanned_at,
      'scan_count', l.scan_count,
      'note', l.note,
      'interest_rating', l.interest_rating,
      'consent', (p.consent_partner_sharing_at IS NOT NULL AND p.consent_withdrawn_at IS NULL),
      'first_name', CASE WHEN p.consent_partner_sharing_at IS NOT NULL
                          AND p.consent_withdrawn_at IS NULL THEN p.first_name END,
      'last_name', CASE WHEN p.consent_partner_sharing_at IS NOT NULL
                         AND p.consent_withdrawn_at IS NULL THEN p.last_name END,
      'company', CASE WHEN p.consent_partner_sharing_at IS NOT NULL
                       AND p.consent_withdrawn_at IS NULL
                  THEN COALESCE(NULLIF(btrim(p.company_text), ''), co.name) END,
      'job_title', CASE WHEN p.consent_partner_sharing_at IS NOT NULL
                         AND p.consent_withdrawn_at IS NULL THEN p.job_title END,
      'email', CASE WHEN p.consent_partner_sharing_at IS NOT NULL
                     AND p.consent_withdrawn_at IS NULL THEN p.email END,
      'phone', CASE WHEN p.consent_partner_sharing_at IS NOT NULL
                     AND p.consent_withdrawn_at IS NULL THEN p.phone END
    ) AS x
    FROM public.event_lead_scans l
    JOIN public.event_people p ON p.tenant_id = l.tenant_id AND p.id = l.person_id
    LEFT JOIN public.crm_companies co
      ON co.tenant_id = p.tenant_id AND co.id = p.company_id
    WHERE l.tenant_id = v_device.tenant_id
      AND l.sponsor_id = v_device.sponsor_id
    ORDER BY l.last_scanned_at DESC
    LIMIT v_limit OFFSET v_offset
  ) src;

  RETURN jsonb_build_object(
    'total_count', v_total,
    'with_consent_count', v_with_consent,
    'rows', v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_lead_scans_list(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_lead_scans_list(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_lead_scans_list(jsonb) IS
  'Leady WLASNEGO sponsora urzadzenia. Payload: {device_token, limit?, offset?}. Nie przyjmuje sponsor_id - wlasciciel jest tozsamoscia poswiadczenia. Tozsamosc i kontakt uczestnika sa oddawane WYLACZNIE przy zywej zgodzie (nadanie bez wycofania); wiersz bez zgody zostaje policzony, ale bez danych.';