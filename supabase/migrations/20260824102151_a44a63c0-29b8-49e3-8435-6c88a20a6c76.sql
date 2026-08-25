DROP FUNCTION IF EXISTS public.event_scanner_bootstrap(jsonb);
CREATE OR REPLACE FUNCTION public.event_scanner_bootstrap(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_device public.event_scanner_devices;
  v_event public.events;
  v_checkpoints jsonb;
BEGIN
  v_device := public._event_scanner_device_auth(p_payload->>'device_token', NULL);

  SELECT e.* INTO v_event
  FROM public.events e
  WHERE e.tenant_id = v_device.tenant_id AND e.id = v_device.event_id;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'sort_order', x->>'name_pl'), '[]'::jsonb)
  INTO v_checkpoints
  FROM (
    SELECT jsonb_build_object(
      'id', cp.id,
      'name_pl', cp.name_pl,
      'name_en', cp.name_en,
      'kind', cp.kind,
      'direction_mode', cp.direction_mode,
      'access_mode', cp.access_mode,
      'capacity', cp.capacity,
      'dedupe_window_seconds', cp.dedupe_window_seconds,
      'sort_order', cp.sort_order
    ) AS x
    FROM public.event_checkpoints cp
    WHERE cp.tenant_id = v_device.tenant_id
      AND cp.event_id = v_device.event_id
      AND cp.is_active
      AND (v_device.checkpoint_id IS NULL OR cp.id = v_device.checkpoint_id)
  ) src;

  RETURN jsonb_build_object(
    'device_id', v_device.id,
    'label', v_device.label,
    'scopes', to_jsonb(v_device.scopes),
    'expires_at', v_device.expires_at,
    'pinned_checkpoint_id', v_device.checkpoint_id,
    'sponsor_id', v_device.sponsor_id,
    'event', jsonb_build_object(
      'id', v_event.id,
      'slug', v_event.slug,
      'title_pl', v_event.title_pl,
      'title_en', v_event.title_en,
      'starts_at', v_event.starts_at,
      'ends_at', v_event.ends_at,
      'timezone', v_event.timezone
    ),
    'checkpoints', v_checkpoints
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_scanner_bootstrap(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_scanner_bootstrap(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_scanner_bootstrap(jsonb) IS
  'Konfiguracja skanera po sparowaniu: wydarzenie, dostepne punkty odprawy, zakresy uprawnien, termin waznosci tokenu. Payload: {device_token}. Bramka: hasz tokenu urzadzenia.';

DROP FUNCTION IF EXISTS public.event_checkin_resolve(jsonb);
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

DROP FUNCTION IF EXISTS public.event_checkin_record(jsonb);
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

  v_source := CASE
    WHEN lower(COALESCE(p_payload->>'self_service', '')) IN ('true', 't', '1')
      THEN 'self_service'
    ELSE 'qr_code'
  END;

  SELECT r.id, r.event_id, r.person_id INTO v_reg
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

  RETURN public._event_checkin_write(
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
    NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_checkin_record(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_checkin_record(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_checkin_record(jsonb) IS
  'Zapis odprawy z urzadzenia. Payload: {device_token, code, checkpoint_id?, direction?, client_scan_uid?, device_scanned_at?, self_service?}. Wejsciem jest TOKEN, nigdy person_id - token jest jedynym dowodem, ze uczestnik stanal przy bramce. Idempotencja: client_scan_uid plus okno punktu.';