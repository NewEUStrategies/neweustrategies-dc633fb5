CREATE OR REPLACE FUNCTION public._event_scan_is_not_entry_code(p_code text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT regexp_replace(
           COALESCE(p_code, ''),
           '^[[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+'
           '|[[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
           '', 'g')
         ~* '^(https?://|NES-[0-9A-HJ-NP-Z]{4}-[0-9A-HJ-NP-Z]{4}$)';
$$;

REVOKE ALL ON FUNCTION public._event_scan_is_not_entry_code(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_scan_is_not_entry_code(text) TO service_role;

COMMENT ON FUNCTION public._event_scan_is_not_entry_code(text) IS
  'R67 (REG-12): czy zeskanowany napis to numer potwierdzenia NES-XXXX-XXXX albo adres http(s) - nigdy kod biletu. Lustro classifyScannedCode (src/lib/events/ticketCode.ts). Pomocnicza RPC skanera (SECURITY DEFINER): wynik not_entry_code bez licznika blokady urzadzenia.';

CREATE OR REPLACE FUNCTION public.event_checkin_record(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_device public.event_scanner_devices;
  v_code text := btrim(COALESCE(p_payload->>'code', ''));
  v_checkpoint_id uuid;
  v_cp public.event_checkpoints;
  v_direction text;
  v_reg record;
  v_locked boolean;
  v_source text;
  v_client_uid text := NULLIF(btrim(COALESCE(p_payload->>'client_scan_uid', '')), '');
  v_device_at timestamptz := NULLIF(p_payload->>'device_scanned_at', '')::timestamptz;
  v_offline_outcome text := NULLIF(lower(btrim(COALESCE(p_payload->>'offline_outcome', ''))), '');
  v_offline_admitted boolean;
  v_offline_denied text;
  v_roster_at timestamptz := NULLIF(p_payload->>'roster_generated_at', '')::timestamptz;
  v_queued boolean := lower(COALESCE(p_payload->>'queued', '')) IN ('true', 't', '1')
    OR NULLIF(btrim(COALESCE(p_payload->>'offline_outcome', '')), '') IS NOT NULL;
  v_result jsonb;
BEGIN
  v_device := public._event_scanner_device_auth_sync(
    p_payload->>'device_token', 'checkin', CASE WHEN v_queued THEN v_device_at END
  );

  IF v_code = '' THEN
    RAISE EXCEPTION 'invalid_payload: code is required';
  END IF;

  IF v_offline_outcome IS NOT NULL AND v_offline_outcome NOT IN (
    'granted', 'denied_direction', 'denied_registration_status', 'unknown_code', 'repeat'
  ) THEN
    RAISE EXCEPTION 'invalid_payload: unknown offline_outcome %', v_offline_outcome;
  END IF;
  IF v_offline_outcome IS NOT NULL THEN
    v_offline_admitted := lower(COALESCE(p_payload->>'offline_admitted', '')) IN ('true', 't', '1');
    IF NOT v_offline_admitted AND v_offline_outcome IN ('granted', 'repeat') THEN
      RAISE EXCEPTION 'invalid_payload: offline_outcome % requires offline_admitted', v_offline_outcome;
    END IF;
    IF NOT v_offline_admitted THEN
      v_offline_denied := CASE v_offline_outcome
        WHEN 'unknown_code' THEN 'denied_not_registered'
        ELSE v_offline_outcome
      END;
    END IF;
  END IF;

  v_checkpoint_id := COALESCE(
    NULLIF(p_payload->>'checkpoint_id', '')::uuid,
    v_device.checkpoint_id
  );
  IF v_checkpoint_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: checkpoint_id is required for a device without a pinned checkpoint';
  END IF;
  IF v_device.checkpoint_id IS NOT NULL AND v_checkpoint_id <> v_device.checkpoint_id THEN
    RAISE EXCEPTION 'device_checkpoint_mismatch: this credential is pinned to another checkpoint';
  END IF;

  SELECT cp.* INTO v_cp
  FROM public.event_checkpoints cp
  WHERE cp.tenant_id = v_device.tenant_id
    AND cp.event_id = v_device.event_id
    AND cp.id = v_checkpoint_id;
  IF v_cp.id IS NULL THEN
    RAISE EXCEPTION 'checkpoint_not_found: checkpoint does not exist in this event';
  END IF;

  v_direction := lower(btrim(COALESCE(
    p_payload->>'direction',
    CASE v_cp.direction_mode WHEN 'out_only' THEN 'out' ELSE 'in' END
  )));

  v_source := CASE
    WHEN lower(COALESCE(p_payload->>'self_service', '')) IN ('true', 't', '1')
      THEN 'self_service'
    ELSE 'qr_code'
  END;

  IF public._event_scan_is_not_entry_code(v_code) THEN
    RETURN jsonb_build_object(
      'outcome', 'not_entry_code',
      'admit', false,
      'result', NULL,
      'device_locked', false,
      'person', NULL
    );
  END IF;

  SELECT r.id, r.event_id, r.person_id INTO v_reg
  FROM public.event_registrations r
  WHERE r.tenant_id = v_device.tenant_id
    AND r.qr_token_hash = encode(digest(v_code, 'sha256'), 'hex');

  IF v_reg.id IS NULL THEN
    IF v_queued THEN
      UPDATE public.event_scanner_devices
      SET failed_scan_count = failed_scan_count + 1,
          last_failed_scan_at = now()
      WHERE tenant_id = v_device.tenant_id AND id = v_device.id;
      v_locked := false;
    ELSE
      v_locked := public._event_scanner_device_note_failure(v_device.id);
    END IF;
    RETURN jsonb_build_object(
      'outcome', 'unknown_code',
      'admit', false,
      'result', NULL,
      'device_locked', v_locked,
      'person', NULL
    );
  END IF;

  IF v_reg.event_id <> v_device.event_id THEN
    RETURN jsonb_build_object(
      'outcome', 'wrong_event',
      'admit', false,
      'result', NULL,
      'device_locked', false,
      'other_event', (
        SELECT jsonb_build_object('title_pl', e.title_pl, 'title_en', e.title_en)
        FROM public.events e
        WHERE e.tenant_id = v_device.tenant_id AND e.id = v_reg.event_id
      ),
      'person', NULL
    );
  END IF;

  UPDATE public.event_scanner_devices
  SET scan_count = scan_count + 1
  WHERE id = v_device.id;

  v_result := public._event_checkin_write(
    v_device.tenant_id,
    v_device.event_id,
    v_checkpoint_id,
    v_reg.person_id,
    v_direction,
    v_source,
    v_device.id,
    NULL,
    v_client_uid,
    v_device_at,
    NULL,
    v_offline_denied
  );

  IF v_device.expires_at <= now() THEN
    v_result := jsonb_set(v_result, '{person}', 'null'::jsonb);
  END IF;

  IF v_offline_outcome IS NOT NULL THEN
    UPDATE public.event_checkins c
    SET offline_admitted = CASE
          WHEN c.offline_admitted IS TRUE THEN true
          ELSE v_offline_admitted
        END,
        offline_outcome = COALESCE(c.offline_outcome, v_offline_outcome),
        roster_generated_at = COALESCE(c.roster_generated_at, v_roster_at)
    WHERE c.tenant_id = v_device.tenant_id
      AND c.event_id = v_device.event_id
      AND c.id = (v_result->>'checkin_id')::uuid;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.event_checkin_record(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_checkin_record(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_checkin_record(jsonb) IS
  'Zapis odprawy z urzadzenia. Payload: {device_token, code, checkpoint_id?, direction?, client_scan_uid?, device_scanned_at?, self_service?, queued?, offline_admitted?, offline_outcome?, roster_generated_at?}. Wejsciem jest TOKEN, nigdy person_id. Idempotencja: client_scan_uid plus okno punktu. Wygasle poswiadczenie przyjmuje skan z kolejki sprzed terminu przez 72 h (bez karty osoby w odpowiedzi). Pola offline dopisywane eskalujaco do zwroconego wiersza; odmowa offline nie staje sie obecnoscia.';

CREATE OR REPLACE FUNCTION public.event_checkin_resolve(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_device public.event_scanner_devices;
  v_code text := btrim(COALESCE(p_payload->>'code', ''));
  v_checkpoint_id uuid;
  v_cp public.event_checkpoints;
  v_direction text;
  v_reg record;
  v_eval jsonb;
  v_locked boolean;
  v_prev_at timestamptz;
BEGIN
  v_device := public._event_scanner_device_auth(p_payload->>'device_token', 'checkin');

  IF v_code = '' THEN
    RAISE EXCEPTION 'invalid_payload: code is required';
  END IF;

  v_checkpoint_id := COALESCE(
    NULLIF(p_payload->>'checkpoint_id', '')::uuid,
    v_device.checkpoint_id
  );
  IF v_checkpoint_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: checkpoint_id is required for a device without a pinned checkpoint';
  END IF;
  IF v_device.checkpoint_id IS NOT NULL AND v_checkpoint_id <> v_device.checkpoint_id THEN
    RAISE EXCEPTION 'device_checkpoint_mismatch: this credential is pinned to another checkpoint';
  END IF;

  SELECT cp.* INTO v_cp
  FROM public.event_checkpoints cp
  WHERE cp.tenant_id = v_device.tenant_id
    AND cp.event_id = v_device.event_id
    AND cp.id = v_checkpoint_id;
  IF v_cp.id IS NULL THEN
    RAISE EXCEPTION 'checkpoint_not_found: checkpoint does not exist in this event';
  END IF;

  v_direction := lower(btrim(COALESCE(
    p_payload->>'direction',
    CASE v_cp.direction_mode WHEN 'out_only' THEN 'out' ELSE 'in' END
  )));
  IF v_direction NOT IN ('in', 'out') THEN
    RAISE EXCEPTION 'invalid_direction: direction must be in or out';
  END IF;

  IF public._event_scan_is_not_entry_code(v_code) THEN
    RETURN jsonb_build_object(
      'outcome', 'not_entry_code',
      'admit', false,
      'result', NULL,
      'device_locked', false,
      'checkpoint', jsonb_build_object(
        'id', v_cp.id, 'name_pl', v_cp.name_pl, 'name_en', v_cp.name_en,
        'kind', v_cp.kind, 'direction_mode', v_cp.direction_mode,
        'access_mode', v_cp.access_mode
      ),
      'person', NULL
    );
  END IF;

  SELECT r.id, r.event_id, r.person_id, r.status INTO v_reg
  FROM public.event_registrations r
  WHERE r.tenant_id = v_device.tenant_id
    AND r.qr_token_hash = encode(digest(v_code, 'sha256'), 'hex');

  IF v_reg.id IS NULL THEN
    v_locked := public._event_scanner_device_note_failure(v_device.id);
    RETURN jsonb_build_object(
      'outcome', 'unknown_code',
      'admit', false,
      'result', NULL,
      'device_locked', v_locked,
      'checkpoint', jsonb_build_object(
        'id', v_cp.id, 'name_pl', v_cp.name_pl, 'name_en', v_cp.name_en,
        'kind', v_cp.kind, 'direction_mode', v_cp.direction_mode,
        'access_mode', v_cp.access_mode
      ),
      'person', NULL
    );
  END IF;

  IF v_reg.event_id <> v_device.event_id THEN
    RETURN jsonb_build_object(
      'outcome', 'wrong_event',
      'admit', false,
      'result', NULL,
      'device_locked', false,
      'other_event', (
        SELECT jsonb_build_object('title_pl', e.title_pl, 'title_en', e.title_en)
        FROM public.events e
        WHERE e.tenant_id = v_device.tenant_id AND e.id = v_reg.event_id
      ),
      'checkpoint', jsonb_build_object(
        'id', v_cp.id, 'name_pl', v_cp.name_pl, 'name_en', v_cp.name_en,
        'kind', v_cp.kind, 'direction_mode', v_cp.direction_mode,
        'access_mode', v_cp.access_mode
      ),
      'person', NULL
    );
  END IF;

  v_eval := public._event_checkin_evaluate(
    v_device.tenant_id, v_device.event_id, v_checkpoint_id, v_reg.person_id, v_direction
  );

  SELECT max(c.occurred_at) INTO v_prev_at
  FROM public.event_checkins c
  WHERE c.tenant_id = v_device.tenant_id
    AND c.event_id = v_device.event_id
    AND c.person_id = v_reg.person_id
    AND c.result = 'granted';

  RETURN jsonb_build_object(
    'outcome', v_eval->>'result',
    'admit', (
      (v_eval->>'result') = 'granted'
      OR (
        (v_eval->>'access_mode') = 'track'
        AND (v_eval->>'result') IN ('denied_not_registered', 'denied_registration_status')
      )
    ),
    'result', v_eval->>'result',
    'direction', v_direction,
    'device_locked', false,
    'previous_checkin_at', v_prev_at,
    'checkpoint', jsonb_build_object(
      'id', v_cp.id, 'name_pl', v_cp.name_pl, 'name_en', v_cp.name_en,
      'kind', v_cp.kind, 'direction_mode', v_cp.direction_mode,
      'access_mode', v_cp.access_mode,
      'capacity', v_cp.capacity,
      'occupancy', (v_eval->>'occupancy')::integer
    ),
    'person', public._event_onsite_person_card(
      v_device.tenant_id, v_device.event_id, v_reg.person_id
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_checkin_resolve(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_checkin_resolve(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_checkin_resolve(jsonb) IS
  'Rozpoznanie kodu QR: token wejsciowy -> JEDNA osoba plus decyzja, BEZ wiersza w dzienniku. Payload: {device_token, code, checkpoint_id?, direction?}. Kod nieznany podnosi licznik nieudanych rozpoznan urzadzenia. Zwraca minimum danych operatora - bez adresu poczty i telefonu.';

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
  v_device_at timestamptz := NULLIF(p_payload->>'device_scanned_at', '')::timestamptz;
  v_queued boolean := lower(COALESCE(p_payload->>'queued', '')) IN ('true', 't', '1');
  v_reg record;
  v_person public.event_people;
  v_consent_at timestamptz;
  v_lead_id uuid;
  v_count integer;
  v_locked boolean;
  v_grace boolean;
BEGIN
  v_device := public._event_scanner_device_auth_sync(
    p_payload->>'device_token', 'lead', CASE WHEN v_queued THEN v_device_at END
  );
  v_grace := v_device.expires_at <= now();

  IF v_code = '' THEN
    RAISE EXCEPTION 'invalid_payload: code is required';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 2000 THEN
    RAISE EXCEPTION 'invalid_payload: note is longer than 2000 characters';
  END IF;
  IF v_rating IS NOT NULL AND v_rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'invalid_payload: interest_rating must be between 1 and 5';
  END IF;

  IF public._event_scan_is_not_entry_code(v_code) THEN
    RETURN jsonb_build_object(
      'outcome', 'not_entry_code', 'device_locked', false, 'person', NULL
    );
  END IF;

  SELECT r.id, r.event_id, r.person_id INTO v_reg
  FROM public.event_registrations r
  WHERE r.tenant_id = v_device.tenant_id
    AND r.qr_token_hash = encode(digest(v_code, 'sha256'), 'hex');

  IF v_reg.id IS NULL THEN
    IF v_queued THEN
      UPDATE public.event_scanner_devices
      SET failed_scan_count = failed_scan_count + 1,
          last_failed_scan_at = now()
      WHERE tenant_id = v_device.tenant_id AND id = v_device.id;
      v_locked := false;
    ELSE
      v_locked := public._event_scanner_device_note_failure(v_device.id);
    END IF;
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
      WHEN v_consent_at IS NULL OR v_grace THEN NULL
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
  'Skan leada na stoisku. Payload: {device_token, code, note?, interest_rating?, device_scanned_at?, queued?}. Wlasciciel leada pochodzi z POSWIADCZENIA (event_scanner_devices.sponsor_id). Bez zgody uczestnika potwierdza zapis, ale NIE oddaje tozsamosci. Wygasle poswiadczenie przyjmuje skan z kolejki sprzed terminu przez 72 h - bez danych osoby w odpowiedzi.';

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

  IF public._event_scan_is_not_entry_code(v_code) THEN
    RETURN jsonb_build_object('outcome', 'not_entry_code', 'device_locked', false);
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