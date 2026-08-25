DROP FUNCTION IF EXISTS public._event_checkin_evaluate(uuid, uuid, uuid, uuid, text);
CREATE OR REPLACE FUNCTION public._event_checkin_evaluate(
  _tenant uuid,
  _event_id uuid,
  _checkpoint_id uuid,
  _person_id uuid,
  _direction text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cp public.event_checkpoints;
  v_reg_id uuid;
  v_status text;
  v_result text;
  v_occupancy integer;
BEGIN
  SELECT cp.* INTO v_cp
  FROM public.event_checkpoints cp
  WHERE cp.tenant_id = _tenant
    AND cp.event_id = _event_id
    AND cp.id = _checkpoint_id;

  IF v_cp.id IS NULL THEN
    RAISE EXCEPTION 'checkpoint_not_found: checkpoint does not exist in this event';
  END IF;

  v_occupancy := public._event_checkpoint_occupancy(_tenant, _checkpoint_id);

  IF NOT v_cp.is_active THEN
    v_result := 'denied_checkpoint_inactive';
  ELSIF (_direction = 'in' AND v_cp.direction_mode = 'out_only')
     OR (_direction = 'out' AND v_cp.direction_mode = 'in_only') THEN
    v_result := 'denied_direction';
  ELSE
    SELECT r.id, r.status INTO v_reg_id, v_status
    FROM public.event_registrations r
    WHERE r.tenant_id = _tenant
      AND r.event_id = _event_id
      AND r.person_id = _person_id
      AND r.status NOT IN ('cancelled', 'rejected');

    IF v_reg_id IS NULL THEN
      v_result := 'denied_not_registered';
    ELSIF v_status NOT IN ('approved', 'attended') THEN
      v_result := 'denied_registration_status';
    ELSIF _direction = 'in' AND v_cp.capacity IS NOT NULL AND v_occupancy >= v_cp.capacity THEN
      v_result := 'denied_capacity';
    ELSE
      v_result := 'granted';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'result', v_result,
    'registration_id', v_reg_id,
    'occupancy', v_occupancy,
    'capacity', v_cp.capacity,
    'access_mode', v_cp.access_mode
  );
END;
$$;

REVOKE ALL ON FUNCTION public._event_checkin_evaluate(uuid, uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_checkin_evaluate(uuid, uuid, uuid, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public._event_checkin_evaluate(uuid, uuid, uuid, uuid, text) IS
  'Jedna definicja decyzji odprawy dla podgladu (event_checkin_resolve) i dla zapisu (_event_checkin_write). Liczy, nie rezerwuje - wiazacy jest tylko wynik policzony pod blokada wiersza punktu.';

DROP FUNCTION IF EXISTS public._event_checkin_write(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, timestamptz, text
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
  _note text
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
  v_outcome text;
  v_at timestamptz;
  v_occupancy integer;
  v_admit boolean;
  v_prev_at timestamptz;
  v_done boolean := false;
BEGIN
  IF v_dir NOT IN ('in', 'out') THEN
    RAISE EXCEPTION 'invalid_direction: direction must be in or out';
  END IF;

  IF _source NOT IN ('qr_code', 'manual_entry', 'name_search', 'self_service') THEN
    RAISE EXCEPTION 'invalid_payload: unknown check-in source %', _source;
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

    v_at := COALESCE(_device_at, now());
    IF v_at > now() THEN
      v_at := now();
    END IF;

    v_eval := public._event_checkin_evaluate(
      _tenant, _event_id, _checkpoint_id, _person_id, v_dir
    );
    v_result := v_eval->>'result';
    v_reg_id := NULLIF(v_eval->>'registration_id', '')::uuid;

    SELECT c.* INTO v_prev
    FROM public.event_checkins c
    WHERE c.tenant_id = _tenant
      AND c.checkpoint_id = _checkpoint_id
      AND c.person_id = _person_id
      AND c.direction = v_dir
      AND c.dedupe_range @> v_at
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
          operator_user_id, device_id, client_scan_uid, note
        ) VALUES (
          _tenant, _event_id, _checkpoint_id, _person_id, v_reg_id,
          v_dir, v_result, _source, now(), _device_at,
          _operator, _device_id, _client_uid, NULLIF(btrim(COALESCE(_note, '')), '')
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
              AND c.dedupe_range @> v_at
            ORDER BY c.occurred_at DESC, c.id
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

  v_admit := v_row.result = 'granted'
    OR (
      v_cp.access_mode = 'track'
      AND v_row.result IN ('denied_not_registered', 'denied_registration_status')
    );

  RETURN jsonb_build_object(
    'outcome', v_outcome,
    'admit', v_admit,
    'result', v_row.result,
    'checkin_id', v_row.id,
    'direction', v_row.direction,
    'occurred_at', v_row.occurred_at,
    'repeat_count', v_row.repeat_count,
    'previous_checkin_at', v_prev_at,
    'checkpoint', jsonb_build_object(
      'id', v_cp.id,
      'name_pl', v_cp.name_pl,
      'name_en', v_cp.name_en,
      'kind', v_cp.kind,
      'direction_mode', v_cp.direction_mode,
      'access_mode', v_cp.access_mode,
      'capacity', v_cp.capacity,
      'occupancy', v_occupancy
    ),
    'person', public._event_onsite_person_card(_tenant, v_row.event_id, v_row.person_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public._event_checkin_write(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_checkin_write(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, timestamptz, text
) TO service_role;

COMMENT ON FUNCTION public._event_checkin_write(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, timestamptz, text
) IS
  'Jedyna droga do dziennika odpraw, wspolna dla plaszczyzny urzadzenia i panelu. Blokada wiersza punktu, wynik, limit obecnosci, okno idempotencji, wstawienie z ograniczeniem EXCLUDE jako bramka wyscigu. Zgoda na wejscie stempluje event_registrations.attended_at.';