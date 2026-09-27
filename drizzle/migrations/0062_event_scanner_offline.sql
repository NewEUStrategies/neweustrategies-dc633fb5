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
  ADD COLUMN IF NOT EXISTS roster_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS offline_server_result text;

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
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.event_checkins'::regclass
       AND conname = 'event_checkins_offline_server_result_values'
  ) THEN
    ALTER TABLE public.event_checkins
      ADD CONSTRAINT event_checkins_offline_server_result_values
      CHECK (offline_server_result IN (
        'granted', 'denied_not_registered', 'denied_registration_status',
        'denied_direction', 'denied_capacity', 'denied_checkpoint_inactive'
      ));
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
COMMENT ON COLUMN public.event_checkins.offline_server_result IS
  'Wynik serwera dla skanu, ktoremu urzadzenie BEZ SIECI odmowilo wejscia. Gdy serwer by wpuscil (granted), result trzyma odmowe bramki, obecnosc nie jest stemplowana, a admin_event_checkins_list pokazuje konflikt denied_offline. NULL = decyzja online albo wpuszczenie offline (wtedy result jest wynikiem serwera).';

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
-- 4) ZAPIS ODPRAWY: ZEGAR URZADZENIA I ODMOWA OFFLINE
--
-- Cialo z 20260824102000 z TRZEMA zmianami. (a) Tam, gdzie liczony jest
-- `v_at`: skan starszy niz 7 dni odbija sie TRWALYM kodem, a do dziennika
-- idzie `LEAST(czas urzadzenia, now())` zamiast surowej wartosci.
-- (b) 12. argument `_offline_denied` (DEFAULT NULL): odmowa, ktora urzadzenie
-- BEZ SIECI dalo czlowiekowi przy bramce (denied_not_registered dla kodu
-- spoza listy, denied_registration_status, denied_direction). Gdy serwer
-- ocenia `granted`, wiersz dostaje te odmowe zamiast zgody - bez stempla
-- `attended_at` (a wiec bez tagu CRM i certyfikatu obecnosci) i bez wplywu
-- na oblozenie punktu, ktore liczy wylacznie zgody. Wynik serwera zostaje
-- w `offline_server_result`. (c) Odpowiedz niesie `server_admit` - co
-- zrobilby serwer - zeby urzadzenie wykrylo konflikt "odeslany offline".
-- Lista argumentow sie zmienia, wiec stara 11-argumentowa wersja jest
-- usuwana (dwie przeciazone z DEFAULT-em bylyby niejednoznaczne); panel
-- (`admin_event_checkin_manual`) wola 11 argumentow i trafia w DEFAULT.
-- ----------------------------------------------------------------------------
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
  _note text,
  _offline_denied text DEFAULT NULL
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
  v_occupancy integer;
  v_admit boolean;
  v_server_admit boolean;
  v_prev_at timestamptz;
  v_done boolean := false;
BEGIN
  IF v_dir NOT IN ('in', 'out') THEN
    RAISE EXCEPTION 'invalid_direction: direction must be in or out';
  END IF;

  IF _source NOT IN ('qr_code', 'manual_entry', 'name_search', 'self_service') THEN
    RAISE EXCEPTION 'invalid_payload: unknown check-in source %', _source;
  END IF;

  IF _offline_denied IS NOT NULL AND _offline_denied NOT IN (
    'denied_not_registered', 'denied_registration_status', 'denied_direction'
  ) THEN
    RAISE EXCEPTION 'invalid_payload: unknown offline denial %', _offline_denied;
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
    v_server := v_eval->>'result';
    -- Odmowa bramki offline wygrywa ze zgoda serwera (naglowek, REGULY
    -- KONFLIKTOW): czlowieka odeslano, wiec nie stal sie obecny.
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
          operator_user_id, device_id, client_scan_uid, note,
          offline_server_result
        ) VALUES (
          _tenant, _event_id, _checkpoint_id, _person_id, v_reg_id,
          v_dir, v_result, _source, now(),
          CASE WHEN _device_at IS NULL THEN NULL ELSE v_at END,
          _operator, _device_id, _client_uid, NULLIF(btrim(COALESCE(_note, '')), ''),
          CASE WHEN _offline_denied IS NULL THEN NULL ELSE v_server END
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
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, timestamptz, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_checkin_write(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, timestamptz, text, text
) TO service_role;

COMMENT ON FUNCTION public._event_checkin_write(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, timestamptz, text, text
) IS
  'Jedyna droga do dziennika odpraw, wspolna dla plaszczyzny urzadzenia i panelu. Blokada wiersza punktu, wynik, limit obecnosci, okno idempotencji, wstawienie z ograniczeniem EXCLUDE jako bramka wyscigu. Czas urzadzenia przyciety do now(), skan starszy niz 7 dni odrzucony kodem device_time_out_of_range. Zgoda na wejscie stempluje event_registrations.attended_at. _offline_denied: odmowa bramki offline wygrywa ze zgoda serwera (bez stempla obecnosci; wynik serwera w offline_server_result).';

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
-- Cialo z 20260824102151; zmiany: bramka synchronizacji z czasem skanu
-- (tylko skan z kolejki), walidacja i utrwalenie pol offline (dopisanie
-- eskalujace, patrz naglowek), odmowa offline przekazana do zapisu
-- (`_offline_denied`), nieznany kod ze skanu z kolejki podnosi tylko licznik
-- monotoniczny, a skan przyjety wylacznie dzieki oknu 72 h nie oddaje karty
-- osoby.
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
  v_offline_denied text;
  v_roster_at timestamptz := NULLIF(p_payload->>'roster_generated_at', '')::timestamptz;
  -- Skan z decyzja offline zawsze pochodzi z kolejki.
  v_queued boolean := lower(COALESCE(p_payload->>'queued', '')) IN ('true', 't', '1')
    OR NULLIF(btrim(COALESCE(p_payload->>'offline_outcome', '')), '') IS NOT NULL;
  v_result jsonb;
BEGIN
  -- Okno 72 h tylko dla skanu z kolejki: skan na zywo nie ma czego
  -- synchronizowac, wiec wygasle poswiadczenie odbija sie od razu.
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
    -- Zgoda i powtorzenie to z definicji wpuszczenie (`decideOffline`);
    -- "zgoda, ale nie wpuscilem" to ladunek sprzeczny, nie decyzja.
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
    NULL,
    v_offline_denied
  );

  -- Poswiadczenie po terminie przeszlo WYLACZNIE dzieki oknu synchronizacji:
  -- zapis zostaje, ale karta osoby nie wraca na wygasle urzadzenie.
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

-- ----------------------------------------------------------------------------
-- 7) ZAPIS LEADU: OKNO 72 H I KOLEJKA
--
-- Cialo z 20260824102346; zmiany: bramka synchronizacji z czasem skanu
-- (`device_scanned_at`, tylko skan z kolejki), licznik monotoniczny dla
-- nieznanego kodu z kolejki i BRAK danych osoby, gdy poswiadczenie przeszlo
-- wylacznie dzieki oknu 72 h (lead zapisany, flaga zgody zostaje, e-mail
-- i telefon nie wracaja na wygasle urzadzenie stoiska). Czas w tabeli
-- leadow zostaje czasem serwera - jak dotad.
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

-- migration-split: part 1/2 of 0062_event_scanner_offline.sql
-- CIAG DALSZY: 0062_event_scanner_offline_part2.sql .. 0062_event_scanner_offline_part2.sql
-- (scripts/split-migration.ts, limit wdrozenia Lovable). SQL wykonywalny
-- czesci 1..2 sklejonych po kolei == SQL tej migracji sprzed podzialu.
