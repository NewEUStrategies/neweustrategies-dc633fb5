-- events-harness: include
-- ============================================================================
-- WYDARZENIA: UTWARDZENIE SKANERA - CZESC 2/5: BRAMKI URZADZENIA, DECYZJA
-- I ZAPIS ODPRAWY.
--
-- Opis zmian i uzasadnienie - w naglowku 20261013110500 (czesc 1). Tutaj:
--   * `_event_scanner_device_auth` - cialo z 20260824101803; jedyna zmiana:
--     wygasla blokada zeruje takze okno nieznanych kodow z kolejki;
--   * `_event_scanner_device_auth_sync` - cialo z 20260926150000; NOWY
--     4. argument `_queue_marker` (OPS-12): po terminie skan z kolejki
--     przechodzi tylko z podpisanym znacznikiem kolejki wydanym przed
--     terminem, w granicach jego horyzontu. Lista argumentow sie zmienia,
--     wiec stara 3-argumentowa wersja jest usuwana (ACL odtworzony);
--   * `_event_scanner_device_note_queue_failure` - NOWA: osobne okno dla
--     nieznanych kodow z kolejki (100 w 60 minut -> blokada 30 minut);
--   * `_event_checkin_evaluate` - cialo z 20260824102000; NOWY 6. argument
--     `_at` (DEFAULT NULL = teraz): decyzja liczona na chwile skanu, a nie
--     synchronizacji; polityka `reentry_policy = 'deny'` daje
--     `denied_already_inside` (OPS-08). Stara 5-argumentowa wersja usunieta;
--   * `_event_checkin_write` - cialo z 20260926150000; zmiany: odmowa offline
--     `denied_already_inside`, ocena na chwile skanu, odpowiedz z `reentry`,
--     `reentry_previous_at` i `reentry_policy` punktu. Sygnatura bez zmian.
--
-- IDEMPOTENTNA: DROP FUNCTION IF EXISTS (zmiana argumentow) + CREATE OR REPLACE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) BRAMKA URZADZENIA NA ZYWO
-- ----------------------------------------------------------------------------
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
      queue_fail_window_count = CASE
        WHEN locked_until <= now() THEN 0 ELSE queue_fail_window_count
      END
  WHERE id = v_device.id;

  RETURN v_device;
END;
$$;

REVOKE ALL ON FUNCTION public._event_scanner_device_auth(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_scanner_device_auth(text, text) TO service_role;

COMMENT ON FUNCTION public._event_scanner_device_auth(text, text) IS
  'Bramka plaszczyzny urzadzenia: token jawny -> wiersz poswiadczenia. Najemca i wydarzenie sa WYNIKIEM odszukania po haszu, nie argumentem - nie ma naglowka do podrobienia ani roli do eskalacji. Sprawdza uniewaznienie, pauze, termin, blokade i zakres. Wygasla blokada zeruje oba okna nieudanych prob (na zywo i z kolejki).';

-- ----------------------------------------------------------------------------
-- 2) BRAMKA SYNCHRONIZACJI: OKNO 72 H TYLKO ZE ZNACZNIKIEM KOLEJKI
--
-- Po terminie poswiadczenia skan z kolejki przechodzi, gdy:
--   * znacznik kolejki weryfikuje sie podpisem TEGO urzadzenia,
--   * znacznik wydano najpozniej w chwili terminu (wydaja go tylko funkcje
--     z waznym poswiadczeniem, wiec to jest straznik, nie sciezka),
--   * czas skanu < termin i miesci sie w [issued_at - 15 min,
--     issued_at + 24 h]: 15 minut tolerancji zegara telefonu, 24 godziny
--     horyzontu pracy bez sieci od ostatniego kontaktu z baza (klient
--     odswieza znacznik przy kazdym bootstrapie, pobraniu listy i udanym
--     zapisie, wiec realna kolejka ma znacznik sprzed minut, nie dni),
--   * nadal trwa okno 72 h po terminie.
-- Przechwycone po terminie poswiadczenie z ostatnim znacznikiem dopisze
-- wiec skany co najwyzej z okresu po ostatnim prawdziwym kontakcie
-- urzadzenia - a nie z dowolnej chwili sprzed terminu (do 7 dni wstecz).
-- Przed terminem nic sie nie zmienia: znacznik nie jest wymagany.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._event_scanner_device_auth_sync(text, text, timestamptz);
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
  v_marker_at timestamptz;
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
    v_marker_at := public._event_scanner_queue_marker_at(
      v_device.id, v_device.queue_secret, _queue_marker
    );
    IF NOT (
      _device_at IS NOT NULL
      AND v_marker_at IS NOT NULL
      AND v_marker_at <= v_device.expires_at
      AND _device_at < v_device.expires_at
      AND _device_at >= v_marker_at - interval '15 minutes'
      AND _device_at <= v_marker_at + interval '24 hours'
      AND now() <= v_device.expires_at + interval '72 hours'
    ) THEN
      RAISE EXCEPTION 'device_expired: this scanner credential has expired';
    END IF;
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
      queue_fail_window_count = CASE
        WHEN locked_until <= now() THEN 0 ELSE queue_fail_window_count
      END
  WHERE id = v_device.id;

  RETURN v_device;
END;
$$;

REVOKE ALL ON FUNCTION public._event_scanner_device_auth_sync(text, text, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_scanner_device_auth_sync(text, text, timestamptz, text)
  TO service_role;

COMMENT ON FUNCTION public._event_scanner_device_auth_sync(text, text, timestamptz, text) IS
  'Bramka SYNCHRONIZACJI plaszczyzny urzadzenia: jak _event_scanner_device_auth, ale wygasle poswiadczenie przyjmuje skan z kolejki jeszcze przez 72 godziny - WYLACZNIE ze znacznikiem kolejki (queue_marker) wydanym przed terminem, gdy czas skanu < termin i miesci sie w [issued_at - 15 min, issued_at + 24 h]. Uniewaznienie, pauza, blokada i brak zakresu zostaja twarda odmowa.';

-- ----------------------------------------------------------------------------
-- 3) NIEZNANY KOD Z KOLEJKI: WLASNE OKNO BLOKADY
--
-- Skan z kolejki moze byc stary (urzadzenie godzine bez sieci, 25 biletow
-- z innego systemu), wiec nie wchodzi do okna na zywo (20 w 10 minut).
-- Flage `queued` ustawia jednak klient, wiec bez wlasnego progu kolejka byla
-- nieograniczona sciezka zgadywania kodow. Prog jest piec razy luzniejszy
-- i liczony w oknie szesc razy dluzszym, wedlug czasu SERWERA (czas skanu
-- deklaruje urzadzenie): 100 nieznanych kodow z kolejki w 60 minut blokuje
-- urzadzenie na 30 minut. Kody zastapione (code_superseded) nie licza sie
-- wcale - sa rozpoznane.
-- ----------------------------------------------------------------------------
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
     AND (v_row.locked_until IS NULL OR v_row.locked_until <= now()) THEN
    UPDATE public.event_scanner_devices
    SET locked_until = now() + make_interval(mins => v_lock_minutes)
    WHERE id = _device_id;
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
  'Nieznany kod ze skanu Z KOLEJKI: licznik monotoniczny plus osobne okno 60 minut (czas serwera); 100 w oknie blokuje urzadzenie na 30 minut i emituje event_scanner_device.locked.v1 ze zrodlem queue. Okno na zywo (20 w 10 minut) nietkniete.';

-- ----------------------------------------------------------------------------
-- 4) DECYZJA ODPRAWY: CHWILA SKANU I POLITYKA PONOWNEGO WEJSCIA
--
-- Cialo z 20260824102000; zmiany: 6. argument `_at` (chwila skanu, NULL =
-- teraz, przycieta do now()) i regula `denied_already_inside` (tryb control,
-- `reentry_policy = 'deny'`, osoba w srodku wedlug
-- `_event_checkin_inside_since`). Ocena na chwile SKANU, nie synchronizacji:
-- skan z kolejki sprzed godziny nie moze odbic sie o wejscie, ktore nastapilo
-- po nim, a wyjscie po nim nie moze go wybielic. Kolejnosc: stan punktu,
-- kierunek, zapis, juz w srodku, limit miejsc (osoba w srodku i tak zajmuje
-- miejsce - wynik "juz w srodku" mowi operatorowi wiecej).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._event_checkin_evaluate(uuid, uuid, uuid, uuid, text);
CREATE OR REPLACE FUNCTION public._event_checkin_evaluate(
  _tenant uuid,
  _event_id uuid,
  _checkpoint_id uuid,
  _person_id uuid,
  _direction text,
  _at timestamptz DEFAULT NULL
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
  v_at timestamptz := LEAST(COALESCE(_at, now()), now());
  v_inside_since timestamptz;
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

  IF _direction = 'in' THEN
    v_inside_since := public._event_checkin_inside_since(
      _tenant, _checkpoint_id, _person_id, v_at,
      make_interval(secs => v_cp.dedupe_window_seconds)
    );
  END IF;

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
    ELSIF _direction = 'in'
      AND v_cp.access_mode = 'control'
      AND v_cp.reentry_policy = 'deny'
      AND v_inside_since IS NOT NULL THEN
      v_result := 'denied_already_inside';
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
    'access_mode', v_cp.access_mode,
    'reentry_policy', v_cp.reentry_policy,
    'inside_since', v_inside_since
  );
END;
$$;

REVOKE ALL ON FUNCTION public._event_checkin_evaluate(uuid, uuid, uuid, uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_checkin_evaluate(uuid, uuid, uuid, uuid, text, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public._event_checkin_evaluate(uuid, uuid, uuid, uuid, text, timestamptz) IS
  'Jedna definicja decyzji odprawy dla podgladu (event_checkin_resolve) i dla zapisu (_event_checkin_write), liczona na chwile skanu _at (NULL = teraz). Przy reentry_policy = deny osoba w srodku punktu dostaje denied_already_inside; inside_since mowi, od kiedy. Liczy, nie rezerwuje - wiazacy jest tylko wynik policzony pod blokada wiersza punktu.';

-- ----------------------------------------------------------------------------
-- 5) ZAPIS ODPRAWY: PONOWNE WEJSCIE
--
-- Cialo z 20260926150000; zmiany:
--   (a) `_offline_denied` przyjmuje `denied_already_inside` (bramka bez
--       sieci odeslala osobe, ktora wedlug wlasnego dziennika jest w srodku);
--   (b) decyzja liczona na chwile skanu (`v_at`), nie synchronizacji -
--       zsynchronizowany po fakcie skan wpuszczony offline, ktory wedlug
--       serwera byl drugim wejsciem tego samego kodu, zapisuje sie PRAWDZIWIE:
--       `denied_already_inside` z `offline_admitted = true`, czyli konflikt
--       admitted_offline w dzienniku panelu, a nie ciche "granted x2";
--   (c) odpowiedz niesie `reentry` (osoba byla juz w srodku tego punktu
--       wedlug dziennika - przy polityce allow to zgoda na ponowne wejscie,
--       przy deny powod odmowy), `reentry_previous_at` (chwila tamtego
--       wejscia) i `reentry_policy` w opisie punktu;
--   (d) zgoda, ktorej okno zachodzi na okno POZNIEJSZEJ zgody (skan
--       z kolejki zsynchronizowany po skanie na zywo tej samej osoby), jest
--       powtorzeniem tamtego wiersza, a nie bledem EXCLUDE - ta sama regula
--       "to samo wejscie", ktora ocena stosuje do ponownego wejscia.
-- Powtorzone pikniecie w oknie idempotencji zostaje `repeat`: ocena pomija
-- wejscie, ktorego okno zachodzi na okno skanu, wiec wynik jest ten sam co
-- wiersza w oknie.
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
      _tenant, _event_id, _checkpoint_id, _person_id, v_dir, v_at
    );
    v_server := v_eval->>'result';
    -- Odmowa bramki offline wygrywa ze zgoda serwera (20260926150000,
    -- REGULY KONFLIKTOW): czlowieka odeslano, wiec nie stal sie obecny.
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
              -- Okno skanu zachodzi na okno POZNIEJSZEJ zgody (skan
              -- z kolejki sprzed niej, ta sama osoba przy dwoch
              -- urzadzeniach): to samo wejscie, wiec powtorzenie tamtego
              -- wiersza, nie blad wyscigu.
              SELECT c.* INTO v_row
              FROM public.event_checkins c
              WHERE c.tenant_id = _tenant
                AND c.checkpoint_id = _checkpoint_id
                AND c.person_id = _person_id
                AND c.direction = v_dir
                AND c.result = 'granted'
                AND c.dedupe_range && tstzrange(
                  v_at, v_at + make_interval(secs => v_cp.dedupe_window_seconds), '[)'
                )
              ORDER BY c.occurred_at, c.id
              LIMIT 1;
            END IF;

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

  -- Ponowne wejscie liczone dla ZWROCONEGO wiersza (przy repeat i replay to
  -- wiersz pierwotnego skanu), z jego wlasnym oknem idempotencji.
  IF v_row.direction = 'in' AND v_row.result IN ('granted', 'denied_already_inside') THEN
    v_reentry_at := public._event_checkin_inside_since(
      _tenant, v_row.checkpoint_id, v_row.person_id, v_row.occurred_at,
      upper(v_row.dedupe_range) - lower(v_row.dedupe_range), v_row.id
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
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, timestamptz, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_checkin_write(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, timestamptz, text, text
) TO service_role;

COMMENT ON FUNCTION public._event_checkin_write(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, timestamptz, text, text
) IS
  'Jedyna droga do dziennika odpraw, wspolna dla plaszczyzny urzadzenia i panelu. Blokada wiersza punktu, decyzja na chwile skanu (takze ponowne wejscie przy reentry_policy = deny), limit obecnosci, okno idempotencji, wstawienie z ograniczeniem EXCLUDE jako bramka wyscigu. Czas urzadzenia przyciety do now(), skan starszy niz 7 dni odrzucony kodem device_time_out_of_range. Zgoda na wejscie stempluje event_registrations.attended_at. _offline_denied: odmowa bramki offline wygrywa ze zgoda serwera. Odpowiedz: reentry, reentry_previous_at, reentry_policy punktu.';
