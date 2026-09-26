-- Tryb offline skanera: lista uczestnikow na urzadzeniu (skroty SHA-256), pola
-- decyzji offline w dzienniku odpraw, okno synchronizacji 72 h, poprawka zegara
-- urzadzenia, panel (zgoda per urzadzenie, konflikty) i sygnal obecnosci do CRM.
-- Blizniak: supabase/migrations/20260926150000_event_scanner_offline.sql.

-- ----------------------------------------------------------------------------
-- 1) URZADZENIE: ZGODA NA LISTE OFFLINE I JEJ HISTORIA
-- ----------------------------------------------------------------------------
ALTER TABLE public.event_scanner_devices
  ADD COLUMN IF NOT EXISTS offline_roster boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS roster_downloaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS roster_download_count integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.event_scanner_devices'::regclass
       AND conname = 'event_scanner_devices_roster_count_nonneg'
  ) THEN
    ALTER TABLE public.event_scanner_devices
      ADD CONSTRAINT event_scanner_devices_roster_count_nonneg
      CHECK (roster_download_count >= 0);
  END IF;
END
$$;

GRANT SELECT (offline_roster, roster_downloaded_at, roster_download_count)
  ON public.event_scanner_devices TO authenticated;

COMMENT ON COLUMN public.event_scanner_devices.offline_roster IS
  'Zgoda administratora, zeby TO urzadzenie pobralo liste biletow wydarzenia (skroty SHA-256 + minimum danych osoby) do decyzji bez sieci. Domyslnie false; wymaga zakresu checkin.';
COMMENT ON COLUMN public.event_scanner_devices.roster_downloaded_at IS
  'Start ostatniego PELNEGO pobrania listy offline. Dlawik (30 s) i punkt odniesienia dla pobran przyrostowych.';
COMMENT ON COLUMN public.event_scanner_devices.roster_download_count IS
  'Ile razy urzadzenie pobralo pelna liste offline. Kazde pobranie emituje tez event_scanner_device.roster_downloaded.v1.';

-- ----------------------------------------------------------------------------
-- 2) DZIENNIK ODPRAW: CO URZADZENIE ZDECYDOWALO BEZ SIECI
-- ----------------------------------------------------------------------------
ALTER TABLE public.event_checkins
  ADD COLUMN IF NOT EXISTS offline_admitted boolean,
  ADD COLUMN IF NOT EXISTS offline_outcome text,
  ADD COLUMN IF NOT EXISTS roster_generated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.event_checkins'::regclass
       AND conname = 'event_checkins_offline_outcome_values'
  ) THEN
    ALTER TABLE public.event_checkins
      ADD CONSTRAINT event_checkins_offline_outcome_values
      CHECK (offline_outcome IN ('granted', 'denied_direction', 'denied_registration_status', 'unknown_code', 'repeat'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.event_checkins'::regclass
       AND conname = 'event_checkins_offline_pair'
  ) THEN
    ALTER TABLE public.event_checkins
      ADD CONSTRAINT event_checkins_offline_pair
      CHECK ((offline_admitted IS NULL) = (offline_outcome IS NULL));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS event_checkins_offline_idx
  ON public.event_checkins (tenant_id, event_id, occurred_at DESC)
  WHERE offline_admitted IS NOT NULL;

COMMENT ON COLUMN public.event_checkins.offline_admitted IS
  'Decyzja urzadzenia BEZ SIECI (z listy offline): true = wpuscilo. NULL = decyzja online. Konflikt = true przy odmowie serwera; liczy go admin_event_checkins_list.';
COMMENT ON COLUMN public.event_checkins.offline_outcome IS
  'Lokalny wynik urzadzenia offline: granted | denied_direction | denied_registration_status | unknown_code | repeat.';
COMMENT ON COLUMN public.event_checkins.roster_generated_at IS
  'Chwila wygenerowania listy offline, z ktorej urzadzenie podjelo decyzje (wersja listy).';

-- ----------------------------------------------------------------------------
-- 3) BRAMKA SYNCHRONIZACJI: WYGASLE POSWIADCZENIE Z OKNEM 72 H
--
-- Kopia `_event_scanner_device_auth` z JEDNA roznica: termin. Skan, ktory
-- zapadl przed terminem (`_device_at < expires_at`), przechodzi jeszcze przez
-- 72 godziny po terminie. Bez czasu skanu (NULL) okna nie ma. Osobna
-- funkcja zamiast trzeciego argumentu z DEFAULT, bo zmiana listy argumentow
-- starej zostawilaby dwie przeciazone wersje.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_scanner_device_auth_sync(
  _token text,
  _scope text,
  _device_at timestamptz
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

  IF v_device.expires_at <= now() AND NOT (
    _device_at IS NOT NULL
    AND _device_at < v_device.expires_at
    AND now() <= v_device.expires_at + interval '72 hours'
  ) THEN
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
      fail_window_count = CASE WHEN locked_until <= now() THEN 0 ELSE fail_window_count END
  WHERE id = v_device.id;

  RETURN v_device;
END;
$$;

REVOKE ALL ON FUNCTION public._event_scanner_device_auth_sync(text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_scanner_device_auth_sync(text, text, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public._event_scanner_device_auth_sync(text, text, timestamptz) IS
  'Bramka SYNCHRONIZACJI plaszczyzny urzadzenia: jak _event_scanner_device_auth, ale wygasle poswiadczenie przyjmuje skan sprzed terminu jeszcze przez 72 godziny. Uniewaznienie, pauza, blokada i brak zakresu zostaja twarda odmowa.';

-- ----------------------------------------------------------------------------
-- 4) ZAPIS ODPRAWY: ZEGAR URZADZENIA
--
-- Cialo z 20260824102000 znak w znak, z DWIEMA zmianami w miejscu, gdzie
-- liczony jest `v_at`: skan starszy niz 7 dni odbija sie TRWALYM kodem,
-- a do dziennika idzie `LEAST(czas urzadzenia, now())` zamiast surowej
-- wartosci. Sygnatura bez zmian, wiec CREATE OR REPLACE (ACL zostaje).
-- ----------------------------------------------------------------------------
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

    IF _device_at IS NOT NULL AND _device_at < now() - interval '7 days' THEN
      RAISE EXCEPTION 'device_time_out_of_range: the scan time is more than 7 days in the past';
    END IF;

    v_at := LEAST(COALESCE(_device_at, now()), now());

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
          v_dir, v_result, _source, now(),
          CASE WHEN _device_at IS NULL THEN NULL ELSE v_at END,
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
  'Jedyna droga do dziennika odpraw, wspolna dla plaszczyzny urzadzenia i panelu. Blokada wiersza punktu, wynik, limit obecnosci, okno idempotencji, wstawienie z ograniczeniem EXCLUDE jako bramka wyscigu. Czas urzadzenia przyciety do now(), skan starszy niz 7 dni odrzucony kodem device_time_out_of_range. Zgoda na wejscie stempluje event_registrations.attended_at.';

-- ----------------------------------------------------------------------------
-- 5) KONFIGURACJA SKANERA: ZEGAR SERWERA I STAN LISTY OFFLINE
--
-- Cialo z 20260824102151 z trzema dodatkowymi polami odpowiedzi.
-- ----------------------------------------------------------------------------
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
    'server_now', now(),
    'offline_roster', v_device.offline_roster,
    'roster_downloaded_at', v_device.roster_downloaded_at,
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
  'Konfiguracja skanera po sparowaniu: wydarzenie, dostepne punkty odprawy, zakresy uprawnien, termin waznosci tokenu, zegar serwera (server_now) i stan listy offline. Payload: {device_token}. Bramka: hasz tokenu urzadzenia.';

-- ----------------------------------------------------------------------------
-- 6) ZAPIS ODPRAWY Z URZADZENIA: POLA OFFLINE, OKNO 72 H, KOLEJKA
--
-- Cialo z 20260824102151; zmiany: bramka synchronizacji z czasem skanu,
-- walidacja i utrwalenie pol offline (dopisanie eskalujace, patrz naglowek),
-- nieznany kod ze skanu z kolejki podnosi tylko licznik monotoniczny.
-- ----------------------------------------------------------------------------
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
  v_roster_at timestamptz := NULLIF(p_payload->>'roster_generated_at', '')::timestamptz;
  v_queued boolean := lower(COALESCE(p_payload->>'queued', '')) IN ('true', 't', '1');
  v_result jsonb;
BEGIN
  v_device := public._event_scanner_device_auth_sync(
    p_payload->>'device_token', 'checkin', v_device_at
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
    v_queued := true;
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
    IF v_queued THEN
      -- Skan z kolejki: tylko licznik monotoniczny (naglowek, Z3).
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
    NULL
  );

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
  'Zapis odprawy z urzadzenia. Payload: {device_token, code, checkpoint_id?, direction?, client_scan_uid?, device_scanned_at?, self_service?, queued?, offline_admitted?, offline_outcome?, roster_generated_at?}. Wejsciem jest TOKEN, nigdy person_id. Idempotencja: client_scan_uid plus okno punktu. Wygasle poswiadczenie przyjmuje skan sprzed terminu przez 72 h. Pola offline dopisywane eskalujaco do zwroconego wiersza.';

-- ----------------------------------------------------------------------------
-- 7) ZAPIS LEADU: OKNO 72 H I KOLEJKA
--
-- Cialo z 20260824102346; zmiany: bramka synchronizacji z czasem skanu
-- (`device_scanned_at`) i licznik monotoniczny dla nieznanego kodu z kolejki.
-- Czas w tabeli leadow zostaje czasem serwera - jak dotad.
-- ----------------------------------------------------------------------------
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
BEGIN
  v_device := public._event_scanner_device_auth_sync(
    p_payload->>'device_token', 'lead', v_device_at
  );

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
  'Skan leada na stoisku. Payload: {device_token, code, note?, interest_rating?, device_scanned_at?, queued?}. Wlasciciel leada pochodzi z POSWIADCZENIA (event_scanner_devices.sponsor_id). Bez zgody uczestnika potwierdza zapis, ale NIE oddaje tozsamosci. Wygasle poswiadczenie przyjmuje skan sprzed terminu przez 72 h.';

-- ----------------------------------------------------------------------------
-- 8) LISTA OFFLINE (plaszczyzna urzadzenia)
--
-- Payload: {device_token, since?, after?, limit?}.
--   * bez `since` - PELNA lista aktywnych zapisow z tokenem; pierwsza strona
--     (bez `after`) to start pobrania: dlawik 30 s, licznik, zdarzenie
--     audytowe; kolejne strony tylko do 10 min od startu;
--   * z `since` (wartosc `generated_at` z poprzedniej odpowiedzi, nie
--     starsza niz ostatnie pelne pobranie) - zapisy zmienione od tej chwili
--     (z zakladka 1 min na transakcje w locie): aktywne w `rows`, anulowane,
--     odrzucone albo bez tokenu w `removed`.
-- Wiersz: r (id zapisu), h (sha256 tokenu), s (status), fn, ln, co (firma),
-- t_pl/t_en (bilet), g_pl/g_en/gc (grupa i kolor), bp (identyfikator wydany).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_scanner_roster(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_device public.event_scanner_devices;
  v_since timestamptz := NULLIF(p_payload->>'since', '')::timestamptz;
  v_after uuid := NULLIF(p_payload->>'after', '')::uuid;
  v_limit integer := LEAST(GREATEST(COALESCE(NULLIF(p_payload->>'limit', '')::integer, 2000), 1), 2000);
  v_full boolean := NULLIF(p_payload->>'since', '') IS NULL;
  v_started uuid;
  v_rows jsonb;
  v_removed jsonb;
  v_count integer;
  v_next uuid;
  v_total integer;
BEGIN
  v_device := public._event_scanner_device_auth(p_payload->>'device_token', 'checkin');

  IF NOT v_device.offline_roster THEN
    RAISE EXCEPTION 'roster_disabled: the offline roster is not enabled for this scanner credential';
  END IF;

  IF v_full AND v_after IS NULL THEN
    UPDATE public.event_scanner_devices d
    SET roster_downloaded_at = now(),
        roster_download_count = d.roster_download_count + 1
    WHERE d.tenant_id = v_device.tenant_id
      AND d.id = v_device.id
      AND (d.roster_downloaded_at IS NULL OR d.roster_downloaded_at <= now() - interval '30 seconds')
    RETURNING d.id INTO v_started;

    IF v_started IS NULL THEN
      RAISE EXCEPTION 'roster_throttled: wait before downloading the full roster again';
    END IF;
  ELSIF v_full THEN
    IF v_device.roster_downloaded_at IS NULL
       OR v_device.roster_downloaded_at < now() - interval '10 minutes' THEN
      RAISE EXCEPTION 'roster_resync_required: start a new full roster download';
    END IF;
  ELSIF v_device.roster_downloaded_at IS NULL
     OR v_since < v_device.roster_downloaded_at - interval '1 second' THEN
    RAISE EXCEPTION 'roster_resync_required: the delta cursor is older than the last full download';
  END IF;

  WITH base AS (
    SELECT
      r.id,
      r.qr_token_hash,
      r.status,
      p.first_name,
      p.last_name,
      COALESCE(NULLIF(btrim(p.company_text), ''), co.name) AS company,
      tt.name_pl AS t_pl,
      tt.name_en AS t_en,
      COALESCE(g.name_pl, dg.name_pl) AS g_pl,
      COALESCE(g.name_en, dg.name_en) AS g_en,
      COALESCE(g.color, dg.color) AS gc,
      (bp.printed_at IS NOT NULL) AS bp,
      (r.status IN ('cancelled', 'rejected') OR r.qr_token_hash IS NULL) AS gone,
      GREATEST(r.updated_at, p.updated_at, tt.updated_at, g.updated_at, dg.updated_at, bp.printed_at)
        AS changed_at
    FROM public.event_registrations r
    JOIN public.event_people p
      ON p.tenant_id = r.tenant_id AND p.id = r.person_id
    LEFT JOIN public.crm_companies co
      ON co.tenant_id = p.tenant_id AND co.id = p.company_id
    LEFT JOIN public.event_ticket_types tt
      ON tt.tenant_id = r.tenant_id AND tt.id = r.ticket_type_id
    LEFT JOIN public.event_groups g
      ON g.tenant_id = r.tenant_id AND g.id = r.group_id
    LEFT JOIN LATERAL (
      SELECT dgr.name_pl, dgr.name_en, dgr.color, dgr.updated_at
      FROM public.event_groups dgr
      WHERE dgr.tenant_id = r.tenant_id
        AND dgr.event_id = r.event_id
        AND dgr.is_default
      ORDER BY dgr.id
      LIMIT 1
    ) dg ON true
    LEFT JOIN LATERAL (
      SELECT max(bpr.printed_at) AS printed_at
      FROM public.event_badge_prints bpr
      WHERE bpr.tenant_id = r.tenant_id
        AND bpr.event_id = r.event_id
        AND bpr.person_id = r.person_id
    ) bp ON true
    WHERE r.tenant_id = v_device.tenant_id
      AND r.event_id = v_device.event_id
  ),
  page AS (
    SELECT b.*
    FROM base b
    WHERE (v_after IS NULL OR b.id > v_after)
      AND CASE
        WHEN v_full THEN NOT b.gone
        ELSE b.changed_at > v_since - interval '1 minute'
      END
    ORDER BY b.id
    LIMIT v_limit
  )
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'r', pg.id,
          'h', pg.qr_token_hash,
          's', pg.status,
          'fn', pg.first_name,
          'ln', pg.last_name,
          'co', pg.company,
          't_pl', pg.t_pl,
          't_en', pg.t_en,
          'g_pl', pg.g_pl,
          'g_en', pg.g_en,
          'gc', pg.gc,
          'bp', pg.bp
        ) ORDER BY pg.id
      ) FILTER (WHERE NOT pg.gone),
      '[]'::jsonb
    ),
    COALESCE(jsonb_agg(to_jsonb(pg.id) ORDER BY pg.id) FILTER (WHERE pg.gone), '[]'::jsonb),
    count(*)::integer,
    (array_agg(pg.id ORDER BY pg.id DESC))[1]
  INTO v_rows, v_removed, v_count, v_next
  FROM page pg;

  IF v_count < v_limit THEN
    v_next := NULL;
  END IF;

  IF v_started IS NOT NULL THEN
    SELECT count(*)::integer INTO v_total
    FROM public.event_registrations r
    WHERE r.tenant_id = v_device.tenant_id
      AND r.event_id = v_device.event_id
      AND r.qr_token_hash IS NOT NULL
      AND r.status NOT IN ('cancelled', 'rejected');

    PERFORM public.emit_domain_event(
      v_device.tenant_id,
      'event_scanner_device',
      v_device.id::text,
      'event_scanner_device.roster_downloaded.v1',
      jsonb_build_object(
        'event_id', v_device.event_id,
        'device_id', v_device.id,
        'label', v_device.label,
        'token_prefix', v_device.token_prefix,
        'rows', v_total
      ),
      NULL::uuid
    );
  END IF;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'full', v_full,
    'total', v_total,
    'next_after', v_next,
    'rows', v_rows,
    'removed', v_removed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_scanner_roster(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_scanner_roster(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_scanner_roster(jsonb) IS
  'Lista offline skanera: skroty SHA-256 tokenow biletow wydarzenia plus minimum danych osoby (bez e-maila, telefonu i stanowiska). Payload: {device_token, since?, after?, limit?<=2000}. Wymaga zgody administratora (offline_roster) i zakresu checkin; pelne pobranie co najmniej co 30 s, z audytem event_scanner_device.roster_downloaded.v1; delta od ostatniego pelnego pobrania z usunietymi zapisami w removed.';

-- ----------------------------------------------------------------------------
-- 9) PANEL: WYDANIE POSWIADCZENIA Z LISTA OFFLINE
--
-- Cialo z 20260825055113; zmiany: `offline_roster` z ladunku (tylko razem
-- z zakresem checkin), w zapisie, odpowiedzi i zdarzeniu; bramka modulu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_scanner_device_issue(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_label text := btrim(COALESCE(p_payload->>'label', ''));
  v_checkpoint_id uuid := NULLIF(p_payload->>'checkpoint_id', '')::uuid;
  v_sponsor_id uuid := NULLIF(p_payload->>'sponsor_id', '')::uuid;
  v_scopes text[];
  v_expires timestamptz := NULLIF(p_payload->>'expires_at', '')::timestamptz;
  v_offline boolean := lower(COALESCE(p_payload->>'offline_roster', '')) IN ('true', 't', '1');
  v_event public.events;
  v_token text;
  v_id uuid;
BEGIN
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id is required';
  END IF;

  SELECT e.* INTO v_event
  FROM public.events e
  WHERE e.tenant_id = v_tenant AND e.id = v_event_id;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist in this organisation';
  END IF;

  IF char_length(v_label) < 2 THEN
    RAISE EXCEPTION 'invalid_label: the label must have at least 2 characters';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT lower(btrim(s))), ARRAY['checkin']::text[])
  INTO v_scopes
  FROM jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(p_payload->'scopes') = 'array' THEN p_payload->'scopes'
      ELSE '["checkin"]'::jsonb
    END
  ) AS t(s)
  WHERE lower(btrim(s)) IN ('checkin', 'lead', 'badge_print');

  IF array_length(v_scopes, 1) IS NULL THEN
    RAISE EXCEPTION 'invalid_scopes: at least one known scope is required';
  END IF;

  IF v_checkpoint_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_checkpoints cp
    WHERE cp.tenant_id = v_tenant AND cp.event_id = v_event_id AND cp.id = v_checkpoint_id
  ) THEN
    RAISE EXCEPTION 'checkpoint_not_in_event: the checkpoint belongs to another event';
  END IF;

  IF 'lead' = ANY (v_scopes) THEN
    IF v_sponsor_id IS NULL THEN
      RAISE EXCEPTION 'sponsor_required: a lead-retrieval credential must name its sponsor';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.event_sponsors sp
      WHERE sp.tenant_id = v_tenant AND sp.event_id = v_event_id AND sp.id = v_sponsor_id
    ) THEN
      RAISE EXCEPTION 'sponsor_not_in_event: the sponsor belongs to another event';
    END IF;
  ELSE
    v_sponsor_id := NULL;
  END IF;

  -- Lista offline sluzy wylacznie odprawie - bez zakresu checkin nie ma
  -- czemu sluzyc, a dane osob nie jada na urzadzenie "na zapas".
  v_offline := v_offline AND 'checkin' = ANY (v_scopes);

  IF v_expires IS NULL THEN
    v_expires := COALESCE(v_event.ends_at, v_event.starts_at, now()) + interval '24 hours';
    IF v_expires <= now() THEN
      v_expires := now() + interval '48 hours';
    END IF;
  END IF;

  IF v_expires <= now() THEN
    RAISE EXCEPTION 'invalid_expiry: the credential must expire in the future';
  END IF;

  v_token := public._event_new_scanner_token();

  INSERT INTO public.event_scanner_devices (
    tenant_id, event_id, checkpoint_id, sponsor_id, label,
    token_hash, token_prefix, scopes, is_active, expires_at, created_by, offline_roster
  ) VALUES (
    v_tenant, v_event_id, v_checkpoint_id, v_sponsor_id, v_label,
    encode(digest(v_token, 'sha256'), 'hex'), left(v_token, 8), v_scopes,
    true, v_expires, auth.uid(), v_offline
  )
  RETURNING id INTO v_id;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_scanner_device',
    v_id::text,
    'event_scanner_device.issued.v1',
    jsonb_build_object(
      'event_id', v_event_id,
      'device_id', v_id,
      'label', v_label,
      'token_prefix', left(v_token, 8),
      'scopes', to_jsonb(v_scopes),
      'expires_at', v_expires,
      'offline_roster', v_offline
    ),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'device_id', v_id,
    'label', v_label,
    'token', v_token,
    'token_prefix', left(v_token, 8),
    'scopes', to_jsonb(v_scopes),
    'expires_at', v_expires,
    'checkpoint_id', v_checkpoint_id,
    'sponsor_id', v_sponsor_id,
    'offline_roster', v_offline
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_scanner_device_issue(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_scanner_device_issue(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_scanner_device_issue(jsonb) IS
  'Wydanie poswiadczenia urzadzenia skanujacego. Payload: {event_id, label, scopes[], checkpoint_id?, sponsor_id?, expires_at?, offline_roster?}. TOKEN JAWNY WRACA DOKLADNIE RAZ. Lista offline tylko z zakresem checkin. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 10) PANEL: WLACZENIE / WYLACZENIE LISTY OFFLINE NA URZADZENIU
--
-- Wylaczenie dziala przy nastepnym kontakcie urzadzenia z baza: pobranie
-- listy konczy sie `roster_disabled:`, a klient kasuje swoja kopie.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_scanner_device_set_offline(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'device_id', '')::uuid;
  v_enabled boolean := lower(COALESCE(p_payload->>'offline_roster', '')) IN ('true', 't', '1');
  v_row public.event_scanner_devices;
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: device_id is required';
  END IF;

  SELECT d.* INTO v_row
  FROM public.event_scanner_devices d
  WHERE d.id = v_id AND d.tenant_id = v_tenant
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: scanner credential does not exist in this organisation';
  END IF;

  IF v_enabled AND v_row.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'device_revoked: a revoked credential cannot receive the offline roster';
  END IF;

  IF v_enabled AND NOT ('checkin' = ANY (v_row.scopes)) THEN
    RAISE EXCEPTION 'invalid_scopes: the offline roster requires the checkin scope';
  END IF;

  IF v_row.offline_roster IS DISTINCT FROM v_enabled THEN
    UPDATE public.event_scanner_devices
    SET offline_roster = v_enabled
    WHERE id = v_id AND tenant_id = v_tenant;

    PERFORM public.emit_domain_event(
      v_tenant,
      'event_scanner_device',
      v_row.id::text,
      'event_scanner_device.offline_changed.v1',
      jsonb_build_object(
        'event_id', v_row.event_id,
        'device_id', v_row.id,
        'label', v_row.label,
        'token_prefix', v_row.token_prefix,
        'offline_roster', v_enabled
      ),
      auth.uid()
    );
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_scanner_device_set_offline(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_scanner_device_set_offline(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_scanner_device_set_offline(jsonb) IS
  'Zgoda na liste offline na urzadzeniu (wlaczenie / wylaczenie). Payload: {device_id, offline_roster}. Wlaczenie wymaga zakresu checkin i nie dziala na uniewaznionym poswiadczeniu. Zmiana emituje event_scanner_device.offline_changed.v1. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 11) PANEL: LISTA URZADZEN Z KOLUMNAMI LISTY OFFLINE
--
-- Cialo z 20260825055113 plus trzy kolumny; RETURNS TABLE sie zmienia,
-- wiec DROP + CREATE (ACL odtworzony nizej).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_scanner_devices_list(uuid);
CREATE OR REPLACE FUNCTION public.admin_event_scanner_devices_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  label text,
  token_prefix text,
  scopes text[],
  checkpoint_id uuid,
  checkpoint_name_pl text,
  checkpoint_name_en text,
  sponsor_id uuid,
  sponsor_name text,
  state text,
  is_active boolean,
  expires_at timestamptz,
  revoked_at timestamptz,
  locked_until timestamptz,
  last_seen_at timestamptz,
  scan_count integer,
  failed_scan_count integer,
  last_failed_scan_at timestamptz,
  fail_window_count integer,
  checkins_count integer,
  lead_scans_count integer,
  created_at timestamptz,
  offline_roster boolean,
  roster_downloaded_at timestamptz,
  roster_download_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  RETURN QUERY
  SELECT
    d.id, d.event_id, d.label, d.token_prefix, d.scopes,
    d.checkpoint_id, cp.name_pl, cp.name_en,
    d.sponsor_id, sp.snapshot_name,
    CASE
      WHEN d.revoked_at IS NOT NULL THEN 'revoked'
      WHEN d.locked_until IS NOT NULL AND d.locked_until > now() THEN 'locked'
      WHEN d.expires_at <= now() THEN 'expired'
      WHEN NOT d.is_active THEN 'paused'
      ELSE 'active'
    END,
    d.is_active, d.expires_at, d.revoked_at, d.locked_until, d.last_seen_at,
    d.scan_count, d.failed_scan_count, d.last_failed_scan_at, d.fail_window_count,
    COALESCE(ci.cnt, 0)::integer,
    COALESCE(ls.cnt, 0)::integer,
    d.created_at,
    d.offline_roster, d.roster_downloaded_at, d.roster_download_count
  FROM public.event_scanner_devices d
  LEFT JOIN public.event_checkpoints cp
    ON cp.tenant_id = d.tenant_id AND cp.id = d.checkpoint_id
  LEFT JOIN public.event_sponsors sp
    ON sp.tenant_id = d.tenant_id AND sp.id = d.sponsor_id
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_checkins c
    WHERE c.tenant_id = d.tenant_id AND c.device_id = d.id
  ) ci ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_lead_scans l
    WHERE l.tenant_id = d.tenant_id AND l.device_id = d.id
  ) ls ON true
  WHERE d.tenant_id = v_tenant
    AND d.event_id = p_event_id
  ORDER BY d.revoked_at NULLS FIRST, d.label;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_scanner_devices_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_scanner_devices_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_scanner_devices_list(uuid) IS
  'Poswiadczenia urzadzen wydarzenia: stan liczony z czterech kolumn i daty, liczniki skanow i NIEUDANYCH rozpoznan, prefiks tokenu, zgoda na liste offline i ostatnie jej pobranie. HASZA NIE ODDAJE. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 12) PANEL: DZIENNIK ODPRAW Z KOLUMNAMI OFFLINE I KONFLIKTEM
--
-- Cialo z 20260825055347 plus kolumny offline, wyliczony `conflict`
-- (urzadzenie wpuscilo bez sieci, serwer odmawia wedlug trybu punktu)
-- i filtr `p_conflicts_only`. Zmienia sie lista argumentow, wiec stara
-- 10-argumentowa wersja jest usuwana.
-- ----------------------------------------------------------------------------
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
  p_offset integer DEFAULT 0,
  p_conflicts_only boolean DEFAULT false
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
  offline_admitted boolean,
  offline_outcome text,
  roster_generated_at timestamptz,
  conflict boolean,
  total_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_q text := NULLIF(btrim(COALESCE(p_q, '')), '');
  v_conflicts boolean := COALESCE(p_conflicts_only, false);
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
    c.offline_admitted, c.offline_outcome, c.roster_generated_at,
    (
      COALESCE(c.offline_admitted, false)
      AND NOT (
        c.result = 'granted'
        OR (cp.access_mode = 'track'
            AND c.result IN ('denied_not_registered', 'denied_registration_status'))
      )
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
    AND (
      NOT v_conflicts
      OR (
        COALESCE(c.offline_admitted, false)
        AND NOT (
          c.result = 'granted'
          OR (cp.access_mode = 'track'
              AND c.result IN ('denied_not_registered', 'denied_registration_status'))
        )
      )
    )
  ORDER BY c.occurred_at DESC, c.id
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_checkins_list(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, integer, integer, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_checkins_list(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, integer, integer, boolean
) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_checkins_list(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, integer, integer, boolean
) IS
  'Dziennik odpraw dla panelu: filtry (punkt, kierunek, wynik, zrodlo, fraza, zakres czasu, tylko konflikty), paginacja i licznik calosci w funkcji okna. Kolumny offline i wyliczony conflict (wpuszczony bez sieci, odmowa serwera wedlug trybu punktu). Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 13) CRM: SYGNAL OBECNOSCI
--
-- Pierwsze ostemplowanie `attended_at` (NULL -> NOT NULL) wzbogaca ISTNIEJACY
-- kontakt CRM osoby: tag `attended:<slug>` i wpis osi czasu. Most f0 w trybie
-- `p_create => false` - obecnosc nie jest podstawa do zalozenia kontaktu.
-- Wewnetrzny blok EXCEPTION: nic, co dzieje sie tutaj, nie cofnie odprawy.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_event_registrations_attended_crm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.events;
BEGIN
  BEGIN
    SELECT e.* INTO v_event
    FROM public.events e
    WHERE e.tenant_id = NEW.tenant_id AND e.id = NEW.event_id;

    PERFORM public._event_person_crm_sync(
      NEW.tenant_id,
      NEW.person_id,
      'event_participant',
      'event:' || COALESCE(v_event.slug, NEW.event_id::text) || ':checkin',
      ARRAY['attended:' || COALESCE(v_event.slug, NEW.event_id::text)],
      '{}'::jsonb,
      false,
      'event.checkin.attended',
      jsonb_build_object(
        'event_id', NEW.event_id,
        'event_slug', v_event.slug,
        'event_title_pl', v_event.title_pl,
        'event_title_en', v_event.title_en,
        'summary_pl', 'Odprawa na wydarzeniu: ' || COALESCE(v_event.title_pl, v_event.title_en, ''),
        'summary_en', 'Checked in at the event: ' || COALESCE(v_event.title_en, v_event.title_pl, ''),
        'registration_id', NEW.id,
        'attended_at', NEW.attended_at
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_event_registrations_attended_crm() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.tg_event_registrations_attended_crm() IS
  'Obecnosc na wydarzeniu -> kontakt CRM (tylko aktualizacja istniejacego): tag attended:<slug> i wpis osi czasu event.checkin.attended przez _event_person_crm_sync(p_create => false). Nigdy nie cofa odprawy.';

DROP TRIGGER IF EXISTS event_registrations_attended_crm ON public.event_registrations;
CREATE TRIGGER event_registrations_attended_crm
  AFTER UPDATE OF attended_at ON public.event_registrations
  FOR EACH ROW
  WHEN (OLD.attended_at IS NULL AND NEW.attended_at IS NOT NULL)
  EXECUTE FUNCTION public.tg_event_registrations_attended_crm();
