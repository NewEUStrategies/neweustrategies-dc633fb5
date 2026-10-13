CREATE OR REPLACE FUNCTION public._event_scanner_device_auth(_token text, _scope text)
RETURNS public.event_scanner_devices
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_clean text := btrim(COALESCE(_token, ''));
  v_device public.event_scanner_devices;
BEGIN
  IF v_clean !~ '^[A-Za-z0-9_-]{16,128}$' THEN
    RAISE EXCEPTION 'invalid_device_token: scanner token is missing or malformed';
  END IF;

  SELECT d.* INTO v_device
  FROM public.event_scanner_devices d
  WHERE d.token_hash = encode(digest(v_clean, 'sha256'), 'hex');

  IF v_device.id IS NULL THEN
    RAISE EXCEPTION 'invalid_device_token: scanner token is not known';
  END IF;

  IF v_device.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'device_revoked: this scanner credential was revoked';
  END IF;

  IF NOT v_device.is_active THEN
    RAISE EXCEPTION 'device_inactive: this scanner credential is paused';
  END IF;

  IF v_device.expires_at <= now() THEN
    RAISE EXCEPTION 'device_expired: this scanner credential has expired';
  END IF;

  IF v_device.locked_until IS NOT NULL AND v_device.locked_until > now() THEN
    RAISE EXCEPTION 'device_locked: this scanner credential is temporarily locked';
  END IF;

  IF _scope IS NOT NULL AND NOT (_scope = ANY (v_device.scopes)) THEN
    RAISE EXCEPTION 'device_scope_missing: this scanner credential has no % scope', _scope;
  END IF;

  UPDATE public.event_scanner_devices
  SET last_seen_at = now(),
      locked_until = CASE WHEN locked_until <= now() THEN NULL ELSE locked_until END,
      fail_window_count = CASE WHEN locked_until <= now() THEN 0 ELSE fail_window_count END,
      queue_locked_until = CASE
        WHEN queue_locked_until <= now() THEN NULL ELSE queue_locked_until
      END,
      queue_fail_window_count = CASE
        WHEN queue_locked_until <= now() THEN 0 ELSE queue_fail_window_count
      END
  WHERE tenant_id = v_device.tenant_id AND id = v_device.id;

  RETURN v_device;
END;
$$;

REVOKE ALL ON FUNCTION public._event_scanner_device_auth(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_scanner_device_auth(text, text) TO service_role;

COMMENT ON FUNCTION public._event_scanner_device_auth(text, text) IS
  'Bramka plaszczyzny urzadzenia: token jawny -> wiersz poswiadczenia. Najemca i wydarzenie sa WYNIKIEM odszukania po haszu, nie argumentem - nie ma naglowka do podrobienia ani roli do eskalacji. Sprawdza uniewaznienie, pauze, termin, blokade na zywo i zakres. Blokada kolejki (queue_locked_until) NIE zatrzymuje skanowania na zywo. Wygasla blokada zeruje swoje okno nieudanych prob.';

CREATE OR REPLACE FUNCTION public._event_scanner_device_auth_sync(
  _token text,
  _scope text,
  _device_at timestamptz,
  _queue_marker text DEFAULT NULL
)
RETURNS public.event_scanner_devices
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_clean text := btrim(COALESCE(_token, ''));
  v_device public.event_scanner_devices;
  v_queued boolean := _device_at IS NOT NULL;
  v_marker text := NULLIF(btrim(COALESCE(_queue_marker, '')), '');
  v_marker_at timestamptz;
  v_strict boolean;
BEGIN
  IF v_clean !~ '^[A-Za-z0-9_-]{16,128}$' THEN
    RAISE EXCEPTION 'invalid_device_token: scanner token is missing or malformed';
  END IF;

  SELECT d.* INTO v_device
  FROM public.event_scanner_devices d
  WHERE d.token_hash = encode(digest(v_clean, 'sha256'), 'hex');

  IF v_device.id IS NULL THEN
    RAISE EXCEPTION 'invalid_device_token: scanner token is not known';
  END IF;

  IF v_device.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'device_revoked: this scanner credential was revoked';
  END IF;

  IF NOT v_device.is_active THEN
    RAISE EXCEPTION 'device_inactive: this scanner credential is paused';
  END IF;

  IF v_queued AND v_marker IS NOT NULL THEN
    v_marker_at := public._event_scanner_queue_marker_at(
      v_device.id, v_device.queue_secret, v_marker
    );
  END IF;

  IF v_device.expires_at <= now() THEN
    v_strict := v_device.queue_marker_required_at IS NOT NULL OR v_marker IS NOT NULL;

    IF v_strict THEN
      IF NOT (
        v_queued
        AND v_marker_at IS NOT NULL
        AND v_marker_at <= v_device.expires_at
        AND _device_at < v_device.expires_at
        AND _device_at >= v_marker_at - interval '15 minutes'
        AND _device_at <= v_marker_at + interval '24 hours'
        AND now() <= v_device.expires_at + interval '72 hours'
      ) THEN
        RAISE EXCEPTION 'device_expired: this scanner credential has expired';
      END IF;
    ELSIF NOT (
      v_queued
      AND _device_at < v_device.expires_at
      AND now() <= v_device.expires_at + interval '72 hours'
    ) THEN
      RAISE EXCEPTION 'device_expired: this scanner credential has expired';
    END IF;
  END IF;

  IF v_device.locked_until IS NOT NULL AND v_device.locked_until > now() THEN
    RAISE EXCEPTION 'device_locked: this scanner credential is temporarily locked';
  END IF;

  IF v_queued AND v_device.queue_locked_until IS NOT NULL
     AND v_device.queue_locked_until > now() THEN
    RAISE EXCEPTION 'device_locked: queue sync of this scanner credential is temporarily locked after too many unknown codes - live scanning continues';
  END IF;

  IF _scope IS NOT NULL AND NOT (_scope = ANY (v_device.scopes)) THEN
    RAISE EXCEPTION 'device_scope_missing: this scanner credential has no % scope', _scope;
  END IF;

  UPDATE public.event_scanner_devices
  SET last_seen_at = now(),
      locked_until = CASE WHEN locked_until <= now() THEN NULL ELSE locked_until END,
      fail_window_count = CASE WHEN locked_until <= now() THEN 0 ELSE fail_window_count END,
      queue_locked_until = CASE
        WHEN queue_locked_until <= now() THEN NULL ELSE queue_locked_until
      END,
      queue_fail_window_count = CASE
        WHEN queue_locked_until <= now() THEN 0 ELSE queue_fail_window_count
      END,
      queue_marker_required_at = CASE
        WHEN v_marker_at IS NOT NULL THEN COALESCE(queue_marker_required_at, now())
        ELSE queue_marker_required_at
      END
  WHERE tenant_id = v_device.tenant_id AND id = v_device.id;

  RETURN v_device;
END;
$$;

REVOKE ALL ON FUNCTION public._event_scanner_device_auth_sync(text, text, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_scanner_device_auth_sync(text, text, timestamptz, text)
  TO service_role;

COMMENT ON FUNCTION public._event_scanner_device_auth_sync(text, text, timestamptz, text) IS
  'Bramka SYNCHRONIZACJI plaszczyzny urzadzenia (_device_at IS NOT NULL = skan z kolejki). Po terminie: urzadzenie z queue_marker_required_at (albo ladunek ze znacznikiem) przechodzi wylacznie z waznym znacznikiem wydanym przed terminem, czas skanu w [issued_at - 15 min, LEAST(termin, issued_at + 24 h)]; urzadzenie, ktore nigdy nie zadeklarowalo klienta ze znacznikiem - sciezka przejsciowa: czas skanu < termin. Zawsze najpozniej 72 h po terminie. Wazny znacznik ustawia queue_marker_required_at. Blokada kolejki (queue_locked_until) odrzuca tylko kolejke kodem device_locked. Uniewaznienie, pauza, blokada na zywo i brak zakresu zostaja twarda odmowa.';

CREATE OR REPLACE FUNCTION public._event_scanner_device_note_queue_failure(_device_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_window_minutes constant integer := 60;
  v_threshold constant integer := 100;
  v_lock_minutes constant integer := 30;
  v_row public.event_scanner_devices;
  v_locked boolean := false;
BEGIN
  IF _device_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.event_scanner_devices d
  SET failed_scan_count = d.failed_scan_count + 1,
      last_failed_scan_at = now(),
      queue_fail_window_started_at = CASE
        WHEN d.queue_fail_window_started_at IS NULL
          OR d.queue_fail_window_started_at < now() - make_interval(mins => v_window_minutes)
        THEN now()
        ELSE d.queue_fail_window_started_at
      END,
      queue_fail_window_count = CASE
        WHEN d.queue_fail_window_started_at IS NULL
          OR d.queue_fail_window_started_at < now() - make_interval(mins => v_window_minutes)
        THEN 1
        ELSE d.queue_fail_window_count + 1
      END
  WHERE d.id = _device_id
  RETURNING d.* INTO v_row;

  IF v_row.id IS NULL THEN
    RETURN false;
  END IF;

  IF v_row.queue_fail_window_count >= v_threshold
     AND (v_row.queue_locked_until IS NULL OR v_row.queue_locked_until <= now()) THEN
    UPDATE public.event_scanner_devices
    SET queue_locked_until = now() + make_interval(mins => v_lock_minutes)
    WHERE tenant_id = v_row.tenant_id AND id = _device_id;
    v_locked := true;

    PERFORM public.emit_domain_event(
      v_row.tenant_id,
      'event_scanner_device',
      v_row.id::text,
      'event_scanner_device.locked.v1',
      jsonb_build_object(
        'event_id', v_row.event_id,
        'device_id', v_row.id,
        'label', v_row.label,
        'token_prefix', v_row.token_prefix,
        'source', 'queue',
        'scope', 'queue_sync',
        'failures_in_window', v_row.queue_fail_window_count,
        'locked_minutes', v_lock_minutes
      ),
      NULL::uuid
    );
  END IF;

  RETURN v_locked;
END;
$$;

REVOKE ALL ON FUNCTION public._event_scanner_device_note_queue_failure(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_scanner_device_note_queue_failure(uuid) TO service_role;

COMMENT ON FUNCTION public._event_scanner_device_note_queue_failure(uuid) IS
  'Nieznany kod ze skanu Z KOLEJKI: licznik monotoniczny plus osobne okno 60 minut (czas serwera); 100 w oknie blokuje SAMA synchronizacje kolejki na 30 minut (queue_locked_until) i emituje event_scanner_device.locked.v1 ze zrodlem queue i zakresem queue_sync. Skanowanie na zywo dziala dalej (jego okno: 20 w 10 minut). Zwraca true, gdy blokada kolejki wlasnie zapadla.';

DROP FUNCTION IF EXISTS public._event_checkin_write(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, timestamptz, text, text
);
CREATE OR REPLACE FUNCTION public._event_checkin_write(
  _tenant uuid,
  _event_id uuid,
  _checkpoint_id uuid,
  _person_id uuid,
  _direction text,
  _source text,
  _device_id uuid,
  _operator uuid,
  _client_uid text,
  _device_at timestamptz,
  _note text,
  _offline_denied text DEFAULT NULL,
  _reentry_override boolean DEFAULT false,
  _code_denied text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_dir text := lower(btrim(COALESCE(_direction, 'in')));
  v_cp public.event_checkpoints;
  v_eval jsonb;
  v_reg_id uuid;
  v_prev public.event_checkins;
  v_row public.event_checkins;
  v_result text;
  v_server text;
  v_outcome text;
  v_at timestamptz;
  v_window interval;
  v_override boolean := false;
  v_occupancy integer;
  v_admit boolean;
  v_server_admit boolean;
  v_prev_at timestamptz;
  v_reentry_at timestamptz;
  v_done boolean := false;
BEGIN
  IF v_dir NOT IN ('in', 'out') THEN
    RAISE EXCEPTION 'invalid_direction: direction must be in or out';
  END IF;

  IF _source NOT IN ('qr_code', 'manual_entry', 'name_search', 'self_service') THEN
    RAISE EXCEPTION 'invalid_payload: unknown check-in source %', _source;
  END IF;

  IF _offline_denied IS NOT NULL AND _offline_denied NOT IN (
    'denied_not_registered', 'denied_registration_status', 'denied_direction',
    'denied_already_inside'
  ) THEN
    RAISE EXCEPTION 'invalid_payload: unknown offline denial %', _offline_denied;
  END IF;

  IF _code_denied IS NOT NULL AND _code_denied <> 'denied_code_superseded' THEN
    RAISE EXCEPTION 'invalid_payload: unknown code denial %', _code_denied;
  END IF;

  IF COALESCE(_reentry_override, false) AND (_device_id IS NOT NULL OR _operator IS NULL) THEN
    RAISE EXCEPTION 'invalid_payload: a re-entry override is recorded only by a desk operator';
  END IF;

  IF _client_uid IS NOT NULL THEN
    SELECT c.* INTO v_row
    FROM public.event_checkins c
    WHERE c.tenant_id = _tenant
      AND c.event_id = _event_id
      AND c.client_scan_uid = _client_uid;

    IF v_row.id IS NOT NULL THEN
      v_outcome := 'replay';
      v_done := true;
    END IF;
  END IF;

  IF NOT v_done THEN
    SELECT cp.* INTO v_cp
    FROM public.event_checkpoints cp
    WHERE cp.tenant_id = _tenant
      AND cp.event_id = _event_id
      AND cp.id = _checkpoint_id
    FOR UPDATE;

    IF v_cp.id IS NULL THEN
      RAISE EXCEPTION 'checkpoint_not_found: checkpoint does not exist in this event';
    END IF;

    IF _device_at IS NOT NULL AND _device_at < now() - interval '7 days' THEN
      RAISE EXCEPTION 'device_time_out_of_range: the scan time is more than 7 days in the past';
    END IF;

    v_at := LEAST(COALESCE(_device_at, now()), now());
    v_window := make_interval(secs => v_cp.dedupe_window_seconds);

    v_eval := public._event_checkin_evaluate(
      _tenant, _event_id, _checkpoint_id, _person_id, v_dir, v_at
    );
    v_server := v_eval->>'result';

    IF _code_denied IS NOT NULL THEN
      v_server := _code_denied;
    END IF;

    IF COALESCE(_reentry_override, false) AND v_server = 'denied_already_inside' THEN
      v_server := 'granted';
      v_override := true;
    END IF;

    v_result := CASE
      WHEN _offline_denied IS NOT NULL AND v_server = 'granted' THEN _offline_denied
      ELSE v_server
    END;
    v_reg_id := NULLIF(v_eval->>'registration_id', '')::uuid;

    SELECT c.* INTO v_prev
    FROM public.event_checkins c
    WHERE c.tenant_id = _tenant
      AND c.checkpoint_id = _checkpoint_id
      AND c.person_id = _person_id
      AND c.direction = v_dir
      AND c.occurred_at <= v_at
      AND v_at < COALESCE(upper(c.dedupe_range), c.occurred_at + v_window)
      AND NOT public._event_checkin_crossed(
        _tenant, _checkpoint_id, _person_id, v_dir, c.occurred_at, v_at
      )
    ORDER BY c.occurred_at DESC, c.id
    LIMIT 1;

    IF v_prev.id IS NOT NULL AND v_prev.result = v_result THEN
      UPDATE public.event_checkins
      SET repeat_count = repeat_count + 1,
          last_repeat_at = now()
      WHERE id = v_prev.id
      RETURNING * INTO v_row;

      v_outcome := 'repeat';
      v_done := true;
    END IF;

    IF NOT v_done THEN
      BEGIN
        INSERT INTO public.event_checkins (
          tenant_id, event_id, checkpoint_id, person_id, registration_id,
          direction, result, source, scanned_at, device_scanned_at,
          operator_user_id, device_id, client_scan_uid, note,
          offline_server_result, reentry_override
        ) VALUES (
          _tenant, _event_id, _checkpoint_id, _person_id, v_reg_id,
          v_dir, v_result, _source, now(),
          CASE WHEN _device_at IS NULL THEN NULL ELSE v_at END,
          _operator, _device_id, _client_uid, NULLIF(btrim(COALESCE(_note, '')), ''),
          CASE WHEN _offline_denied IS NULL THEN NULL ELSE v_server END,
          v_override
        )
        RETURNING * INTO v_row;

        IF v_result = 'granted' AND v_dir = 'in' AND v_reg_id IS NOT NULL THEN
          UPDATE public.event_registrations
          SET status = CASE WHEN status = 'approved' THEN 'attended' ELSE status END,
              attended_at = COALESCE(attended_at, v_at)
          WHERE tenant_id = _tenant AND id = v_reg_id;
        END IF;

        v_outcome := CASE WHEN v_result = 'granted' THEN 'granted' ELSE v_result END;
      EXCEPTION
        WHEN unique_violation OR exclusion_violation THEN
          v_row := NULL;

          IF _client_uid IS NOT NULL THEN
            SELECT c.* INTO v_row
            FROM public.event_checkins c
            WHERE c.tenant_id = _tenant
              AND c.event_id = _event_id
              AND c.client_scan_uid = _client_uid;
          END IF;

          IF v_row.id IS NOT NULL THEN
            v_outcome := 'replay';
          ELSE
            SELECT c.* INTO v_row
            FROM public.event_checkins c
            WHERE c.tenant_id = _tenant
              AND c.checkpoint_id = _checkpoint_id
              AND c.person_id = _person_id
              AND c.direction = v_dir
              AND c.result = 'granted'
              AND c.dedupe_range && tstzrange(v_at, v_at + v_window, '[)')
              AND NOT public._event_checkin_crossed(
                _tenant, _checkpoint_id, _person_id, v_dir, c.occurred_at, v_at
              )
            ORDER BY (c.occurred_at <= v_at) DESC,
                     abs(extract(epoch FROM (c.occurred_at - v_at))),
                     c.id
            LIMIT 1;

            IF v_row.id IS NULL THEN
              RAISE;
            END IF;

            UPDATE public.event_checkins
            SET repeat_count = repeat_count + 1,
                last_repeat_at = now()
            WHERE id = v_row.id
            RETURNING * INTO v_row;

            v_outcome := 'repeat';
          END IF;
      END;
    END IF;
  END IF;

  SELECT cp.* INTO v_cp
  FROM public.event_checkpoints cp
  WHERE cp.tenant_id = _tenant AND cp.id = v_row.checkpoint_id;

  v_occupancy := public._event_checkpoint_occupancy(_tenant, v_row.checkpoint_id);

  SELECT max(c.occurred_at) INTO v_prev_at
  FROM public.event_checkins c
  WHERE c.tenant_id = _tenant
    AND c.event_id = v_row.event_id
    AND c.person_id = v_row.person_id
    AND c.result = 'granted'
    AND c.id <> v_row.id;

  IF v_row.direction = 'in' AND v_row.result IN ('granted', 'denied_already_inside') THEN
    v_reentry_at := public._event_checkin_inside_since(
      _tenant, v_row.checkpoint_id, v_row.person_id, v_row.occurred_at,
      make_interval(secs => v_cp.dedupe_window_seconds), v_row.id
    );
  END IF;

  v_admit := v_row.result = 'granted'
    OR (
      v_cp.access_mode = 'track'
      AND v_row.result IN ('denied_not_registered', 'denied_registration_status')
    );
  v_server_admit := COALESCE(v_row.offline_server_result, v_row.result) = 'granted'
    OR (
      v_cp.access_mode = 'track'
      AND COALESCE(v_row.offline_server_result, v_row.result)
        IN ('denied_not_registered', 'denied_registration_status')
    );

  RETURN jsonb_build_object(
    'outcome', v_outcome,
    'admit', v_admit,
    'server_admit', v_server_admit,
    'result', v_row.result,
    'checkin_id', v_row.id,
    'direction', v_row.direction,
    'occurred_at', v_row.occurred_at,
    'repeat_count', v_row.repeat_count,
    'previous_checkin_at', v_prev_at,
    'reentry', v_reentry_at IS NOT NULL,
    'reentry_previous_at', v_reentry_at,
    'reentry_override', COALESCE(v_row.reentry_override, false),
    'checkpoint', jsonb_build_object(
      'id', v_cp.id,
      'name_pl', v_cp.name_pl,
      'name_en', v_cp.name_en,
      'kind', v_cp.kind,
      'direction_mode', v_cp.direction_mode,
      'access_mode', v_cp.access_mode,
      'reentry_policy', v_cp.reentry_policy,
      'capacity', v_cp.capacity,
      'occupancy', v_occupancy
    ),
    'person', public._event_onsite_person_card(_tenant, v_row.event_id, v_row.person_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public._event_checkin_write(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, timestamptz, text, text, boolean, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_checkin_write(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, timestamptz, text, text, boolean, text
) TO service_role;

COMMENT ON FUNCTION public._event_checkin_write(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, timestamptz, text, text, boolean, text
) IS
  'Jedyna droga do dziennika odpraw, wspolna dla plaszczyzny urzadzenia i panelu. Blokada wiersza punktu, decyzja na chwile skanu (ponowne wejscie przy reentry_policy = deny: punkt po punkcie, dzien czasu wydarzenia, tylko skany wczesniejsze), limit obecnosci, okno idempotencji (to samo przejscie = bez skanu w przeciwnym kierunku pomiedzy; nowe wejscie po wyjsciu to nowy wiersz z oknem przycietym przez trigger), wstawienie z ograniczeniem EXCLUDE jako bramka wyscigu. Czas urzadzenia przyciety do now(), skan starszy niz 7 dni odrzucony kodem device_time_out_of_range. Zgoda na wejscie stempluje event_registrations.attended_at. _offline_denied: odmowa bramki offline wygrywa ze zgoda serwera. _reentry_override (tylko operator stanowiska): odmowa denied_already_inside staje sie zgoda ze znacznikiem reentry_override. _code_denied = denied_code_superseded: kod martwy w chwili skanu. Odpowiedz: reentry, reentry_previous_at, reentry_override, reentry_policy punktu.';

CREATE OR REPLACE FUNCTION public.admin_event_checkin_manual(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
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
    NULLIF(btrim(COALESCE(p_payload->>'note', '')), ''),
    NULL,
    true,
    NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_checkin_manual(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_checkin_manual(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_checkin_manual(jsonb) IS
  'Odprawa reczna z panelu, przez ta sama funkcje zapisu co skan. Payload: {event_id, checkpoint_id, person_id, direction?, source?, note?, client_scan_uid?}. Zrodlo ograniczone do manual_entry / name_search - redaktor nie moze zapisac odprawy udajacej skan. Odmowe ponownego wejscia (polityka deny) omija JAWNIE: wiersz zgody z operatorem i znacznikiem reentry_override, odpowiedz z reentry_override i reentry_previous_at. Bramka: assert_event_admin_tenant().';