-- events-harness: include
-- ============================================================================
-- WYDARZENIA: SKANER - WYJATEK R4 TYLKO DLA POTWIERDZONEGO CZASU SKANU (F4).
--
-- CZESC 1/3 poprawek po koncowym przegladzie skanera. F5 (kolejnosc
-- synchronizacji) - 20261012150100, klucz obcy klubu dyskusji (B2) -
-- 20261012150200.
--
-- PROBLEM (F4; przeglad: medium, weryfikator: low - przyjmujemy LOW, bo
-- atak wymaga zywego, uprawnionego poswiadczenia urzadzenia, a tozsamosc na
-- stoisku i tak wymaga zgody partnerskiej NA TO wydarzenie):
--   R4 (20261012111200) traktowal skan Z KOLEJKI kodu zastapionego jako skan
--   kodu waznego, jesli LEAST(device_scanned_at, now()) < superseded_at.
--   `device_scanned_at` i `queued` przychodza z ladunku i nikt ich nie
--   sprawdzal: bramka synchronizacji weryfikuje znacznik kolejki dopiero PO
--   terminie poswiadczenia. Zywe urzadzenie wskrzeszalo wiec kod przedrukowany
--   albo jawnie uniewazniony (zgubiony identyfikator), wysylajac queued:true
--   i stary czas:
--     * stoisko: lead zapisany i - przy zgodzie partnerskiej - imie,
--       nazwisko, e-mail i telefon w odpowiedzi; czas mogl byc dowolnie stary
--       (lead nie mial granicy 7 dni), sprzed startu wydarzenia, a nawet
--       sprzed wydania kodu;
--     * bramka: outcome granted, admit true i obecnosc (attended_at) do
--       7 dni wstecz.
--
-- ZMIANA:
--   * `event_superseded_codes.issued_at` - chwila wydania ZASTAPIONEGO kodu
--     (OLD.qr_issued_at / OLD.badge_issued_at); trigger
--     `_tg_event_registrations_supersede_codes` (cialo z 20261012110000)
--     zapisuje ja przy kazdym zastapieniu. Wiersze sprzed tej migracji maja
--     NULL - dla nich ta jedna granica nie dziala (pozostale tak);
--   * `_event_scanner_code_lookup` (cialo z 20261012111000) oddaje dodatkowo
--     `issued_at` kodu. RETURNS TABLE sie zmienia: DROP + CREATE, ACL
--     odtworzony (wylacznie service_role);
--   * NOWA `_event_scanner_scan_time_corroborated(...)` - czas skanu z kolejki
--     jest potwierdzony, gdy:
--       - ladunek niesie WAZNY znacznik kolejki TEGO urzadzenia
--         (`_event_scanner_queue_marker_at`; klient stempluje pozycje
--         znacznikiem aktualnym w chwili kolejkowania), a czas skanu lezy
--         w [wydanie znacznika - 15 min, wydanie + 24 h] - to samo okno, co
--         scisla regula bramki synchronizacji po terminie;
--       - czas skanu nie jest wczesniejszy niz: 7 dni przed teraz, wydanie
--         poswiadczenia urzadzenia (created_at - 15 min zegara), wydanie
--         zastapionego kodu (issued_at - 15 min zegara, gdy znane) i start
--         wydarzenia - 1 dzien (recepcja otwarta dzien wczesniej);
--   * `event_checkin_record` i `event_lead_scan_record` (ciala
--     z 20261012111200): wyjatek R4 wymaga potwierdzonego czasu skanu.
--     Inaczej - jak przed R4: code_superseded bez wiersza i bez tozsamosci;
--     bramka, ktora wpuscila offline, dostaje wiersz denied_code_superseded
--     (konflikt admitted_offline), nigdy zgode;
--   * `event_lead_scan_record`: lead z kolejki z czasem skanu starszym niz
--     7 dni konczy sie `device_time_out_of_range` - ta sama granica co
--     odprawa w `_event_checkin_write` (klient traktuje te glowe jako odmowe
--     trwala). Skan na zywo nie niesie czasu, ktorego baza by uzyla.
--
-- CZEGO TO NIE ZAMYKA (swiadomie, opisane w ustaleniu przez weryfikatora):
--   urzadzenie, ktore ZACHOWALO znacznik wydany w ciagu 24 h przed
--   zastapieniem kodu, nadal moze zadeklarowac czas skanu tuz przed
--   zastapieniem - takiego skanu nie da sie odroznic od prawdziwego skanu bez
--   sieci. Granice wyzej zamykaja czasy NIEMOZLIWE (sprzed wydania kodu,
--   poswiadczenia, wydarzenia; podrobione albo cudze znaczniki); posiadacz
--   zywego poswiadczenia jest i tak zaufany co do czasu skanu kodow waznych
--   (do 7 dni wstecz). Stary klient bez znacznika (sciezka przejsciowa R0/R11)
--   traci wyjatek R4: jego wpuszczenie offline kodu zastapionego po skanie
--   wraca jako konflikt admitted_offline do przegladu, nie jako zgoda.
--
-- IDEMPOTENTNA: ADD COLUMN IF NOT EXISTS, DROP FUNCTION IF EXISTS + CREATE,
-- CREATE OR REPLACE.
-- DOWOD: scripts/events-harness/runtime_test.d/57_scanner_final_fixes.sql
-- (sekcja F4) oraz zaktualizowana sekcja R4 w 56_scanner_review_fixes.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) CHWILA WYDANIA ZASTAPIONEGO KODU
-- ----------------------------------------------------------------------------
ALTER TABLE public.event_superseded_codes
  ADD COLUMN IF NOT EXISTS issued_at timestamptz;

COMMENT ON COLUMN public.event_superseded_codes.issued_at IS
  'Chwila wydania TEGO (zastapionego) kodu: qr_issued_at albo badge_issued_at zapisu sprzed zmiany. Dolna granica czasu skanu z kolejki, ktory ma uchodzic za skan sprzed zastapienia (R4/F4) - kod nie mogl zostac zeskanowany, zanim istnial. NULL dla wierszy sprzed 20261012150000 i kodow bez stempla wydania.';

-- Cialo z 20261012110000; jedyna zmiana: issued_at (OLD.*_issued_at) w obu
-- wstawieniach i w ON CONFLICT.
CREATE OR REPLACE FUNCTION public._tg_event_registrations_supersede_codes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF OLD.qr_token_hash IS NOT NULL
     AND OLD.qr_token_hash IS DISTINCT FROM NEW.qr_token_hash THEN
    INSERT INTO public.event_superseded_codes (
      tenant_id, event_id, registration_id, code_hash, credential, reason, superseded_at, issued_at
    ) VALUES (
      NEW.tenant_id, NEW.event_id, NEW.id, OLD.qr_token_hash, 'ticket',
      CASE WHEN NEW.qr_token_hash IS NULL THEN 'revoked' ELSE 'reissued' END, now(),
      OLD.qr_issued_at
    )
    ON CONFLICT (tenant_id, code_hash) DO UPDATE
    SET event_id = EXCLUDED.event_id,
        registration_id = EXCLUDED.registration_id,
        credential = EXCLUDED.credential,
        reason = EXCLUDED.reason,
        superseded_at = EXCLUDED.superseded_at,
        issued_at = EXCLUDED.issued_at;
  END IF;

  IF OLD.badge_token_hash IS NOT NULL
     AND OLD.badge_token_hash IS DISTINCT FROM NEW.badge_token_hash THEN
    INSERT INTO public.event_superseded_codes (
      tenant_id, event_id, registration_id, code_hash, credential, reason, superseded_at, issued_at
    ) VALUES (
      NEW.tenant_id, NEW.event_id, NEW.id, OLD.badge_token_hash, 'badge',
      CASE WHEN NEW.badge_token_hash IS NULL THEN 'revoked' ELSE 'reissued' END, now(),
      OLD.badge_issued_at
    )
    ON CONFLICT (tenant_id, code_hash) DO UPDATE
    SET event_id = EXCLUDED.event_id,
        registration_id = EXCLUDED.registration_id,
        credential = EXCLUDED.credential,
        reason = EXCLUDED.reason,
        superseded_at = EXCLUDED.superseded_at,
        issued_at = EXCLUDED.issued_at;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._tg_event_registrations_supersede_codes() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._tg_event_registrations_supersede_codes() IS
  'Stary skrot biletu albo identyfikatora trafia do event_superseded_codes przy kazdej zmianie (reissued przy nowym kodzie, revoked przy wyczyszczeniu) razem z chwila jego wydania (issued_at). Jedno miejsce zamiast edycji kazdej funkcji rotujacej kod.';

-- ----------------------------------------------------------------------------
-- 2) KOD -> ZAPIS: TAKZE CHWILA WYDANIA KODU
--
-- Cialo z 20261012111000; jedyna zmiana: kolumna issued_at (bilet:
-- qr_issued_at, identyfikator: badge_issued_at, kod zastapiony: issued_at
-- z rejestru). RETURNS TABLE sie zmienia, wiec DROP + CREATE.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._event_scanner_code_lookup(uuid, text);
CREATE OR REPLACE FUNCTION public._event_scanner_code_lookup(_tenant uuid, _code text)
RETURNS TABLE (
  registration_id uuid,
  event_id uuid,
  person_id uuid,
  credential text,
  superseded boolean,
  superseded_at timestamptz,
  superseded_reason text,
  issued_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
  WITH h AS (
    SELECT encode(digest(btrim(COALESCE(_code, '')), 'sha256'), 'hex') AS hash
  )
  SELECT x.registration_id, x.event_id, x.person_id, x.credential,
         x.superseded, x.superseded_at, x.superseded_reason, x.issued_at
  FROM (
    SELECT r.id AS registration_id, r.event_id, r.person_id,
           'ticket'::text AS credential, false AS superseded,
           NULL::timestamptz AS superseded_at, NULL::text AS superseded_reason,
           r.qr_issued_at AS issued_at, 1 AS rank
    FROM public.event_registrations r
    CROSS JOIN h
    WHERE r.tenant_id = _tenant AND r.qr_token_hash = h.hash
    UNION ALL
    SELECT r.id, r.event_id, r.person_id, 'badge'::text,
           r.status IN ('cancelled', 'rejected'),
           CASE WHEN r.status IN ('cancelled', 'rejected')
             THEN COALESCE(r.cancelled_at, r.decided_at, r.updated_at)
           END,
           CASE WHEN r.status IN ('cancelled', 'rejected') THEN 'revoked' END,
           r.badge_issued_at,
           2
    FROM public.event_registrations r
    CROSS JOIN h
    WHERE r.tenant_id = _tenant AND r.badge_token_hash = h.hash
    UNION ALL
    SELECT s.registration_id, s.event_id, r.person_id, s.credential, true, s.superseded_at, s.reason,
           s.issued_at, 3
    FROM public.event_superseded_codes s
    JOIN public.event_registrations r
      ON r.tenant_id = s.tenant_id AND r.id = s.registration_id
    CROSS JOIN h
    WHERE s.tenant_id = _tenant AND s.code_hash = h.hash
  ) x
  ORDER BY x.rank
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public._event_scanner_code_lookup(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_scanner_code_lookup(uuid, text) TO service_role;

COMMENT ON FUNCTION public._event_scanner_code_lookup(uuid, text) IS
  'Kod uczestnika -> zapis: wazny bilet (credential ticket), wazny identyfikator (badge) albo kod zastapiony (superseded = true, z chwila i powodem). Identyfikator zapisu anulowanego / odrzuconego jest zastapiony (revoked). issued_at: chwila wydania TEGO kodu, gdy znana. Brak wiersza = kod naprawde nieznany.';

-- ----------------------------------------------------------------------------
-- 3) POTWIERDZONY CZAS SKANU Z KOLEJKI
--
-- Jedno zrodlo prawdy dla bramki i stoiska. Znacznik i jego sekret czyta
-- funkcja - wolajacy podaje tylko najemce i urzadzenie z POSWIADCZENIA.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_scanner_scan_time_corroborated(
  _tenant uuid,
  _device_id uuid,
  _device_at timestamptz,
  _marker text,
  _code_issued_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  -- Tolerancja zegara urzadzenia wobec zegara serwera: ta sama, co dolna
  -- granica okna znacznika w bramce synchronizacji.
  v_skew constant interval := interval '15 minutes';
  v_device public.event_scanner_devices;
  v_marker_at timestamptz;
  v_starts_at timestamptz;
BEGIN
  IF _device_at IS NULL THEN
    RETURN false;
  END IF;

  SELECT d.* INTO v_device
  FROM public.event_scanner_devices d
  WHERE d.tenant_id = _tenant AND d.id = _device_id;

  IF v_device.id IS NULL THEN
    RETURN false;
  END IF;

  -- NULL: brak znacznika, zly ksztalt, obcy podpis albo inne urzadzenie.
  v_marker_at := public._event_scanner_queue_marker_at(
    v_device.id, v_device.queue_secret, _marker
  );
  IF v_marker_at IS NULL THEN
    RETURN false;
  END IF;

  SELECT e.starts_at INTO v_starts_at
  FROM public.events e
  WHERE e.tenant_id = v_device.tenant_id AND e.id = v_device.event_id;

  RETURN _device_at >= v_marker_at - v_skew
    AND _device_at <= v_marker_at + interval '24 hours'
    AND _device_at >= now() - interval '7 days'
    AND _device_at >= v_device.created_at - v_skew
    AND (_code_issued_at IS NULL OR _device_at >= _code_issued_at - v_skew)
    AND (v_starts_at IS NULL OR _device_at >= v_starts_at - interval '1 day');
END;
$$;

REVOKE ALL ON FUNCTION public._event_scanner_scan_time_corroborated(uuid, uuid, timestamptz, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_scanner_scan_time_corroborated(uuid, uuid, timestamptz, text, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public._event_scanner_scan_time_corroborated(uuid, uuid, timestamptz, text, timestamptz) IS
  'Czy czas skanu z kolejki jest potwierdzony (warunek wyjatku R4 - kod zastapiony PO chwili skanu): wazny znacznik kolejki TEGO urzadzenia i czas skanu w [wydanie znacznika - 15 min, wydanie + 24 h], nie wczesniej niz 7 dni temu, niz wydanie poswiadczenia i wydanie kodu (z 15 min tolerancji zegara) i niz start wydarzenia - 1 dzien. Sam czas z ladunku nigdy nie wystarcza.';

-- ----------------------------------------------------------------------------
-- 4) ZAPIS ODPRAWY Z URZADZENIA
--
-- Cialo z 20261012111200; jedyna zmiana: wyjatek R4 wymaga potwierdzonego
-- czasu skanu (_event_scanner_scan_time_corroborated).
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
  v_locked boolean := false;
  v_queue_locked boolean := false;
  v_source text;
  v_client_uid text := NULLIF(btrim(COALESCE(p_payload->>'client_scan_uid', '')), '');
  v_device_at timestamptz := NULLIF(p_payload->>'device_scanned_at', '')::timestamptz;
  v_marker text := NULLIF(btrim(COALESCE(p_payload->>'queue_marker', '')), '');
  v_offline_outcome text := NULLIF(lower(btrim(COALESCE(p_payload->>'offline_outcome', ''))), '');
  v_offline_admitted boolean;
  v_offline_denied text;
  v_code_denied text;
  v_roster_at timestamptz := NULLIF(p_payload->>'roster_generated_at', '')::timestamptz;
  -- Skan z decyzja offline zawsze pochodzi z kolejki.
  v_queued boolean := lower(COALESCE(p_payload->>'queued', '')) IN ('true', 't', '1')
    OR NULLIF(btrim(COALESCE(p_payload->>'offline_outcome', '')), '') IS NOT NULL;
  v_result jsonb;
BEGIN
  -- Okno 72 h, znacznik kolejki i blokada kolejki dotycza tylko skanu
  -- z kolejki: bramka synchronizacji rozpoznaje go po czasie urzadzenia
  -- (skan z kolejki bez czasu = chwila synchronizacji).
  v_device := public._event_scanner_device_auth_sync(
    p_payload->>'device_token', 'checkin',
    CASE WHEN v_queued THEN COALESCE(v_device_at, now()) END,
    CASE WHEN v_queued THEN v_marker END
  );

  IF v_code = '' THEN
    RAISE EXCEPTION 'invalid_payload: code is required';
  END IF;

  IF v_offline_outcome IS NOT NULL AND v_offline_outcome NOT IN (
    'granted', 'denied_direction', 'denied_registration_status', 'unknown_code', 'repeat',
    'denied_already_inside'
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

  SELECT l.* INTO v_reg
  FROM public._event_scanner_code_lookup(v_device.tenant_id, v_code) l;

  IF v_reg.registration_id IS NULL THEN
    IF v_queued THEN
      -- Skan z kolejki: wlasne okno i wlasna blokada (R12) - skanowanie na
      -- zywo dziala dalej, wiec device_locked zostaje false.
      v_queue_locked := public._event_scanner_device_note_queue_failure(v_device.id);
    ELSE
      v_locked := public._event_scanner_device_note_failure(v_device.id);
    END IF;
    RETURN jsonb_build_object(
      'outcome', 'unknown_code',
      'admit', false,
      'result', NULL,
      'device_locked', v_locked,
      'queue_locked', v_queue_locked,
      'person', NULL
    ) || public._event_scanner_queue_marker_reply(v_device.id, v_device.queue_secret, v_device.expires_at);
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
    ) || public._event_scanner_queue_marker_reply(v_device.id, v_device.queue_secret, v_device.expires_at);
  END IF;

  IF v_reg.superseded THEN
    IF v_queued AND v_device_at IS NOT NULL
       AND LEAST(v_device_at, now()) < v_reg.superseded_at
       AND public._event_scanner_scan_time_corroborated(
         v_device.tenant_id, v_device.id, v_device_at, v_marker, v_reg.issued_at
       ) THEN
      -- R4: w chwili SKANU kod byl wazny (zastapiono go pozniej, np.
      -- przedruk w trakcie pracy bramki bez sieci) - zapis jak kazdy inny.
      -- F4: tylko przy czasie skanu potwierdzonym znacznikiem kolejki TEGO
      -- urzadzenia i granicami (wydanie kodu, poswiadczenia, start
      -- wydarzenia, 7 dni) - sam czas z ladunku nie wskrzesza kodu.
      NULL;
    ELSIF v_queued AND v_offline_admitted IS TRUE THEN
      -- R4: bramka wpuscila offline kod martwy juz w chwili skanu (albo
      -- czasu skanu nie da sie potwierdzic): wiersz z prawdziwa odmowa
      -- serwera i offline_admitted = true (konflikt admitted_offline), nie
      -- cichy powrot bez sladu i nigdy zgoda.
      v_code_denied := 'denied_code_superseded';
      UPDATE public.event_scanner_devices
      SET superseded_scan_count = superseded_scan_count + 1
      WHERE tenant_id = v_device.tenant_id AND id = v_device.id;
    ELSE
      -- Kod zastapiony: rozpoznany, wiec poza oknem blokady; bez wiersza
      -- w dzienniku (jak nieznany kod). Imie i nazwisko tylko w terminie
      -- poswiadczenia - okno 72 h nie oddaje danych osoby.
      RETURN public._event_scanner_superseded_reply(
        v_device.tenant_id, v_device.id, v_reg.person_id, v_reg.credential,
        v_reg.superseded_reason, v_reg.superseded_at, v_device.expires_at > now()
      ) || public._event_scanner_queue_marker_reply(v_device.id, v_device.queue_secret, v_device.expires_at);
    END IF;
  END IF;

  UPDATE public.event_scanner_devices
  SET scan_count = scan_count + 1
  WHERE tenant_id = v_device.tenant_id AND id = v_device.id;

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
    v_offline_denied,
    false,
    v_code_denied
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

  RETURN v_result
    || jsonb_build_object('credential', v_reg.credential)
    || CASE
      WHEN v_code_denied IS NULL THEN '{}'::jsonb
      ELSE jsonb_build_object('superseded', jsonb_build_object(
        'credential', v_reg.credential,
        'reason', v_reg.superseded_reason,
        'superseded_at', v_reg.superseded_at
      ))
    END
    || public._event_scanner_queue_marker_reply(v_device.id, v_device.queue_secret, v_device.expires_at);
END;
$$;

REVOKE ALL ON FUNCTION public.event_checkin_record(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_checkin_record(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_checkin_record(jsonb) IS
  'Zapis odprawy z urzadzenia. Payload: {device_token, code, checkpoint_id?, direction?, client_scan_uid?, device_scanned_at?, self_service?, queued?, queue_marker?, offline_admitted?, offline_outcome?, roster_generated_at?}. Wejsciem jest TOKEN (bilet albo identyfikator), nigdy person_id. Kod zastapiony: code_superseded, poza oknem blokady - chyba ze skan z kolejki byl sprzed zastapienia, a jego czas potwierdza znacznik kolejki tego urzadzenia i granice _event_scanner_scan_time_corroborated (zapis jak kodu waznego), albo bramka wpuscila offline kod juz martwy lub bez potwierdzonego czasu (wiersz denied_code_superseded, konflikt). Idempotencja: client_scan_uid plus okno punktu. Wygasle poswiadczenie przyjmuje skan z kolejki sprzed terminu przez 72 h (ze znacznikiem kolejki, gdy urzadzenie go zadeklarowalo; bez karty osoby). Nieznane kody z kolejki: queue_locked (blokada samej kolejki). Odpowiedz: reentry, reentry_previous_at, reentry_override, credential, queue_marker.';

-- ----------------------------------------------------------------------------
-- 5) ZAPIS LEADU NA STOISKU
--
-- Cialo z 20261012111200; zmiany: wyjatek R4 wymaga potwierdzonego czasu
-- skanu i lead z kolejki starszy niz 7 dni jest odrzucany
-- (device_time_out_of_range, jak odprawa).
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
  v_marker text := NULLIF(btrim(COALESCE(p_payload->>'queue_marker', '')), '');
  v_queued boolean := lower(COALESCE(p_payload->>'queued', '')) IN ('true', 't', '1');
  v_reg record;
  v_person public.event_people;
  v_consent_at timestamptz;
  v_lead_id uuid;
  v_count integer;
  v_locked boolean := false;
  v_queue_locked boolean := false;
  v_grace boolean;
BEGIN
  v_device := public._event_scanner_device_auth_sync(
    p_payload->>'device_token', 'lead',
    CASE WHEN v_queued THEN COALESCE(v_device_at, now()) END,
    CASE WHEN v_queued THEN v_marker END
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

  SELECT l.* INTO v_reg
  FROM public._event_scanner_code_lookup(v_device.tenant_id, v_code) l;

  IF v_reg.registration_id IS NULL THEN
    IF v_queued THEN
      v_queue_locked := public._event_scanner_device_note_queue_failure(v_device.id);
    ELSE
      v_locked := public._event_scanner_device_note_failure(v_device.id);
    END IF;
    RETURN jsonb_build_object(
      'outcome', 'unknown_code', 'device_locked', v_locked, 'queue_locked', v_queue_locked,
      'person', NULL
    ) || public._event_scanner_queue_marker_reply(v_device.id, v_device.queue_secret, v_device.expires_at);
  END IF;

  IF v_reg.event_id <> v_device.event_id THEN
    RETURN jsonb_build_object(
      'outcome', 'wrong_event', 'device_locked', false, 'person', NULL
    ) || public._event_scanner_queue_marker_reply(v_device.id, v_device.queue_secret, v_device.expires_at);
  END IF;

  -- R4: lead zeskanowany z kolejki ZANIM kod zastapiono jest leadem kodu
  -- waznego - F4: tylko przy czasie skanu potwierdzonym znacznikiem kolejki
  -- TEGO urzadzenia i granicami. Kazdy inny skan kodu zastapionego: bez
  -- leada i BEZ tozsamosci (na stoisku tozsamosc wymaga zgody partnerskiej,
  -- a kod zastapiony nie jest okazja, zeby ja ominac).
  IF v_reg.superseded AND NOT (
    v_queued AND v_device_at IS NOT NULL
    AND LEAST(v_device_at, now()) < v_reg.superseded_at
    AND public._event_scanner_scan_time_corroborated(
      v_device.tenant_id, v_device.id, v_device_at, v_marker, v_reg.issued_at
    )
  ) THEN
    RETURN public._event_scanner_superseded_reply(
      v_device.tenant_id, v_device.id, v_reg.person_id, v_reg.credential,
      v_reg.superseded_reason, v_reg.superseded_at, false
    ) || public._event_scanner_queue_marker_reply(v_device.id, v_device.queue_secret, v_device.expires_at);
  END IF;

  -- F4: lead z kolejki starszy niz 7 dni - ta sama granica co odprawa
  -- (_event_checkin_write). Skan na zywo nie niesie czasu, ktorego baza by
  -- uzyla (lead stempluje czas serwera).
  IF v_queued AND v_device_at IS NOT NULL AND v_device_at < now() - interval '7 days' THEN
    RAISE EXCEPTION 'device_time_out_of_range: the scan time is more than 7 days in the past';
  END IF;

  SELECT p.* INTO v_person
  FROM public.event_people p
  WHERE p.tenant_id = v_device.tenant_id AND p.id = v_reg.person_id;

  -- OPS-01: zgoda udzielona NA TO wydarzenie w zgloszeniu, niewycofana -
  -- nie globalny stempel osoby z dowolnego wydarzenia.
  v_consent_at := public._event_partner_consent_at(
    v_device.tenant_id, v_device.event_id, v_reg.person_id
  );

  INSERT INTO public.event_lead_scans (
    tenant_id, event_id, sponsor_id, person_id, registration_id,
    checkpoint_id, device_id, first_scanned_at, last_scanned_at, scan_count,
    note, interest_rating, consent_snapshot_at
  ) VALUES (
    v_device.tenant_id, v_device.event_id, v_device.sponsor_id, v_reg.person_id, v_reg.registration_id,
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
  ) || public._event_scanner_queue_marker_reply(v_device.id, v_device.queue_secret, v_device.expires_at);
END;
$$;

REVOKE ALL ON FUNCTION public.event_lead_scan_record(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_lead_scan_record(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_lead_scan_record(jsonb) IS
  'Skan leada na stoisku. Payload: {device_token, code, note?, interest_rating?, device_scanned_at?, queued?, queue_marker?}. Wlasciciel leada pochodzi z POSWIADCZENIA (event_scanner_devices.sponsor_id). Zgoda: _event_partner_consent_at - zgoda NA TO wydarzenie; bez niej potwierdza zapis, ale NIE oddaje tozsamosci. Kod zastapiony: code_superseded bez leada i bez tozsamosci - chyba ze skan z kolejki byl sprzed zastapienia, a jego czas potwierdza znacznik kolejki tego urzadzenia i granice _event_scanner_scan_time_corroborated (lead kodu waznego). Lead z kolejki starszy niz 7 dni: device_time_out_of_range. Wygasle poswiadczenie przyjmuje skan z kolejki sprzed terminu przez 72 h (ze znacznikiem kolejki, gdy urzadzenie go zadeklarowalo) - bez danych osoby w odpowiedzi. Nieznane kody z kolejki: queue_locked (blokada samej kolejki).';
