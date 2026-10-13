-- events-harness: include
-- ============================================================================
-- WYDARZENIA: SKANER - STAN "W SRODKU" NIE ZALEZY OD KOLEJNOSCI
-- SYNCHRONIZACJI (F5).
--
-- CZESC 2/3 poprawek po koncowym przegladzie skanera (opis serii -
-- 20261012150000).
--
-- PROBLEM (F5, low): regula R6 (20261012111000/111100) dawala rozny wynik
-- zaleznie od tego, w jakiej kolejnosci dotra skany. Punkt in_out, control,
-- deny, okno 60 s:
--   in -200 s (bramka A, na zywo), out -190 s (wyjscie bez sieci, kolejka),
--   in -175 s (bramka B, na zywo, drugi posiadacz tego samego kodu).
--   * kolejnosc skanow: -175 to NOWE wejscie (wyjscie pomiedzy), wejscie
--     -100 s -> denied_already_inside;
--   * wyjscie dociera PO -175: -175 zlewa sie z wejsciem -200 jako "repeat"
--     (bez skanu przeciwnego pomiedzy), a wiersz pamieta tylko repeat_count
--     i czas SERWERA. Gdy wyjscie dotrze, dziennik czyta "in, out" - osoba
--     jest "na zewnatrz", wejscie -100 s przechodzi (dwie osoby w srodku na
--     jeden kod), obecnosc liczy ja jako nieobecna, a panel nie pokazuje
--     konfliktu double_entry (poprzedni wiersz -100 to wyjscie).
--   Lustrzanie: wyjscie zlane w "repeat" przed spoznionym wejsciem dawalo
--   falszywa odmowe nastepnego wejscia (osoba juz wyszla).
--
-- ZMIANA:
--   * `event_checkins.last_repeat_device_at` - czas URZADZENIA najpozniejszego
--     wchlonietego powtorzenia (tylko pozniejszego niz occurred_at wiersza),
--     CHECK spojny z repeat_count;
--   * `_event_checkin_write` (cialo z 20261012111100, sygnatura i ACL bez
--     zmian): oba miejsca, ktore zlewaja skan w "repeat", zapisuja
--     last_repeat_device_at = GREATEST(dotychczasowy, czas skanu);
--   * zdarzeniami wiersza sa odtad occurred_at ORAZ last_repeat_device_at
--     (ten sam kierunek). Stan osoby = kierunek jej OSTATNIEGO zdarzenia:
--       - `_event_checkin_inside_since` (cialo z 20261012111000): wiersz
--         porzadkowany po swoim ostatnim zdarzeniu nie pozniejszym niz
--         oceniany skan; wejscie powtorzone PO wyjsciu, ktore dotarlo
--         pozniej (powtorzenie "przeciete" skanem przeciwnym), to wejscie
--         z chwila tego powtorzenia - jak nowy wiersz w kolejnosci skanow.
--         Powtorzenie bez skanu przeciwnego pomiedzy to to samo wejscie
--         (chwila wejscia bez zmian). Filtr dnia i okna powtorzen - jak
--         dotad, po occurred_at wiersza;
--       - `_event_checkpoint_occupancy` (cialo z 20260824101803): ostatnie
--         zdarzenie osoby, nie ostatni wiersz;
--       - `admin_event_checkins_list` (cialo z 20261012111300): double_entry
--         patrzy na zdarzenia, nie na wiersze - poprzednie zdarzenie przed
--         wejsciem i pierwsze zdarzenie po OSTATNIM zdarzeniu wejscia.
--     Wiersz bez last_repeat_device_at zachowuje sie dokladnie jak dotad.
--
-- CZEGO TO NIE ZMIENIA: wiersze sprzed migracji nie maja czasu powtorzenia
-- (nie da sie go odtworzyc). Pamietane jest tylko NAJPOZNIEJSZE powtorzenie:
-- przy kilku powtorzeniach przecietych spoznionym skanem chwila wejscia
-- w odpowiedzi (reentry_previous_at) moze wskazac pozniejsze z nich - decyzja
-- (odmowa / zgoda) jest ta sama. `admin_event_checkin_search` dalej pokazuje
-- ostatni WIERSZ osoby (podpowiedz recepcji, nie decyzja).
--
-- IDEMPOTENTNA: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS + ADD,
-- CREATE OR REPLACE (sygnatury i typy wyniku bez zmian).
-- DOWOD: scripts/events-harness/runtime_test.d/57_scanner_final_fixes.sql
-- (sekcja F5: obie kolejnosci synchronizacji, lustro wyjscia, panel).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) CZAS URZADZENIA NAJPOZNIEJSZEGO WCHLONIETEGO POWTORZENIA
-- ----------------------------------------------------------------------------
ALTER TABLE public.event_checkins
  ADD COLUMN IF NOT EXISTS last_repeat_device_at timestamptz;

ALTER TABLE public.event_checkins DROP CONSTRAINT IF EXISTS event_checkins_repeat_device_after_scan;
ALTER TABLE public.event_checkins ADD CONSTRAINT event_checkins_repeat_device_after_scan
  CHECK (last_repeat_device_at IS NULL OR (repeat_count > 0 AND last_repeat_device_at > occurred_at));

COMMENT ON COLUMN public.event_checkins.last_repeat_device_at IS
  'Czas skanu (urzadzenia, przyciety do now()) NAJPOZNIEJSZEGO powtorzenia wchlonietego przez ten wiersz, gdy jest pozniejszy niz occurred_at. Drugie zdarzenie wiersza w tym samym kierunku: gdy skan przeciwny dotrze pozniej i wypadnie pomiedzy, powtorzenie bylo nowym przejsciem - stan "w srodku", obecnosc i konflikt double_entry licza je od tej chwili (F5). last_repeat_at to czas SERWERA.';

-- ----------------------------------------------------------------------------
-- 2) ZAPIS ODPRAWY: POWTORZENIE ZAPISUJE SWOJ CZAS URZADZENIA
--
-- Cialo z 20261012111100; jedyna zmiana: oba UPDATE-y "repeat" ustawiaja
-- last_repeat_device_at (i sa zawezone do najemcy).
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

  -- R8: obejscie odmowy ponownego wejscia zapisuje WYLACZNIE czlowiek przy
  -- stanowisku (operator, bez urzadzenia) - nigdy skaner.
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

    -- R4: kod martwy juz w chwili skanu - odmowa serwera niezaleznie od
    -- stanu osoby (wolajacy wie to z rejestru kodow zastapionych).
    IF _code_denied IS NOT NULL THEN
      v_server := _code_denied;
    END IF;

    -- R8: stanowisko swiadomie wpuszcza osobe "juz w srodku".
    IF COALESCE(_reentry_override, false) AND v_server = 'denied_already_inside' THEN
      v_server := 'granted';
      v_override := true;
    END IF;

    -- Odmowa bramki offline wygrywa ze zgoda serwera (20260926150000,
    -- REGULY KONFLIKTOW): czlowieka odeslano, wiec nie stal sie obecny.
    v_result := CASE
      WHEN _offline_denied IS NOT NULL AND v_server = 'granted' THEN _offline_denied
      ELSE v_server
    END;
    v_reg_id := NULLIF(v_eval->>'registration_id', '')::uuid;

    -- R6: TO SAMO przejscie = wiersz w tym samym kierunku, ktorego okno
    -- obejmuje skan, BEZ skanu zgody w przeciwnym kierunku pomiedzy.
    -- Wejscie po wyjsciu w oknie poprzedniego wejscia jest nowym wejsciem.
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
      -- F5: czas URZADZENIA powtorzenia zostaje - gdy skan przeciwny dotrze
      -- pozniej i wypadnie pomiedzy, to powtorzenie bylo nowym przejsciem.
      UPDATE public.event_checkins
      SET repeat_count = repeat_count + 1,
          last_repeat_at = now(),
          last_repeat_device_at = CASE
            WHEN v_at > occurred_at THEN GREATEST(v_at, last_repeat_device_at)
            ELSE last_repeat_device_at
          END
      WHERE tenant_id = _tenant AND id = v_prev.id
      RETURNING * INTO v_row;

      v_outcome := 'repeat';
      v_done := true;
    END IF;

    IF NOT v_done THEN
      -- R6: okno nowej ZGODY przycina trigger tg_event_checkins_set_dedupe_
      -- range (nie nachodzi na okno zgody INNEGO przejscia), wiec EXCLUDE
      -- odbija tylko druga zgode TEGO SAMEGO przejscia.
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
            -- Okno skanu zachodzi na okno zgody TEGO SAMEGO przejscia (bez
            -- skanu w przeciwnym kierunku pomiedzy): wczesniejszej albo
            -- pozniejszej (skan z kolejki sprzed skanu na zywo, ta sama
            -- osoba przy dwoch urzadzeniach) - powtorzenie tamtego wiersza,
            -- nie blad wyscigu.
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

            -- F5: jak wyzej; powtorzenie sprzed wiersza (skan z kolejki
            -- starszy niz skan na zywo) nie jest pozniejszym zdarzeniem.
            UPDATE public.event_checkins
            SET repeat_count = repeat_count + 1,
                last_repeat_at = now(),
                last_repeat_device_at = CASE
                  WHEN v_at > occurred_at THEN GREATEST(v_at, last_repeat_device_at)
                  ELSE last_repeat_device_at
                END
            WHERE tenant_id = _tenant AND id = v_row.id
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
  -- wiersz pierwotnego skanu): tylko skany nie pozniejsze niz on (R9), z tego
  -- samego dnia czasu wydarzenia (R8), okno punktu.
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
  'Jedyna droga do dziennika odpraw, wspolna dla plaszczyzny urzadzenia i panelu. Blokada wiersza punktu, decyzja na chwile skanu (ponowne wejscie przy reentry_policy = deny: punkt po punkcie, dzien czasu wydarzenia, tylko skany wczesniejsze), limit obecnosci, okno idempotencji (to samo przejscie = bez skanu w przeciwnym kierunku pomiedzy; nowe wejscie po wyjsciu to nowy wiersz z oknem przycietym przez trigger; powtorzenie zapisuje swoj czas urzadzenia w last_repeat_device_at), wstawienie z ograniczeniem EXCLUDE jako bramka wyscigu. Czas urzadzenia przyciety do now(), skan starszy niz 7 dni odrzucony kodem device_time_out_of_range. Zgoda na wejscie stempluje event_registrations.attended_at. _offline_denied: odmowa bramki offline wygrywa ze zgoda serwera. _reentry_override (tylko operator stanowiska): odmowa denied_already_inside staje sie zgoda ze znacznikiem reentry_override. _code_denied = denied_code_superseded: kod martwy w chwili skanu. Odpowiedz: reentry, reentry_previous_at, reentry_override, reentry_policy punktu.';

-- ----------------------------------------------------------------------------
-- 3) STAN "W SRODKU": OSTATNIE ZDARZENIE, NIE OSTATNI WIERSZ
--
-- Cialo z 20261012111000; zmiana: wiersz porzadkowany po swoim ostatnim
-- zdarzeniu nie pozniejszym niz _at (occurred_at albo last_repeat_device_at),
-- a chwila wejscia to powtorzenie, gdy miedzy nim a occurred_at wiersza jest
-- skan zgody w przeciwnym kierunku (przejscie, ktore dotarlo pozniej).
-- Sygnatura bez zmian.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_checkin_inside_since(
  _tenant uuid,
  _checkpoint_id uuid,
  _person_id uuid,
  _at timestamptz,
  _window interval,
  _exclude_id uuid DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH d AS (
    SELECT public._event_checkin_day_start(_tenant, cp.event_id, _at) AS day_start
    FROM public.event_checkpoints cp
    WHERE cp.tenant_id = _tenant AND cp.id = _checkpoint_id
  ),
  last_scan AS (
    SELECT c.direction, c.occurred_at, rp.repeat_at
    FROM public.event_checkins c
    CROSS JOIN d
    CROSS JOIN LATERAL (
      SELECT CASE WHEN c.last_repeat_device_at <= _at THEN c.last_repeat_device_at END AS repeat_at
    ) rp
    WHERE c.tenant_id = _tenant
      AND c.checkpoint_id = _checkpoint_id
      AND c.person_id = _person_id
      AND c.result = 'granted'
      AND (_exclude_id IS NULL OR c.id <> _exclude_id)
      AND c.occurred_at >= d.day_start
      AND c.occurred_at <= _at
      AND NOT (c.direction = 'in' AND c.occurred_at > _at - _window)
    ORDER BY GREATEST(c.occurred_at, rp.repeat_at) DESC, c.id DESC
    LIMIT 1
  )
  SELECT CASE
    WHEN l.repeat_at IS NOT NULL
     AND public._event_checkin_crossed(
       _tenant, _checkpoint_id, _person_id, 'in', l.occurred_at, l.repeat_at
     )
    THEN l.repeat_at
    ELSE l.occurred_at
  END
  FROM last_scan l
  WHERE l.direction = 'in'
$$;

REVOKE ALL ON FUNCTION public._event_checkin_inside_since(uuid, uuid, uuid, timestamptz, interval, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_checkin_inside_since(uuid, uuid, uuid, timestamptz, interval, uuid)
  TO service_role;

COMMENT ON FUNCTION public._event_checkin_inside_since(uuid, uuid, uuid, timestamptz, interval, uuid) IS
  'Czy osoba jest w srodku punktu w chwili _at: ostatnie ZDARZENIE zgody (occurred_at albo wchloniete powtorzenie last_repeat_device_at) w TYM punkcie, z wiersza z tego samego dnia czasu wydarzenia i nie pozniejsze niz _at, bylo wejsciem. Wejscie w oknie powtorzen przed _at to to samo wejscie (pomijane). Zwraca chwile tamtego wejscia (zawsze <= _at; powtorzenie, gdy przed nim jest skan przeciwny, ktory dotarl pozniej) albo NULL. Wynik nie zalezy od kolejnosci synchronizacji.';

-- ----------------------------------------------------------------------------
-- 4) OBECNOSC W PUNKCIE: OSTATNIE ZDARZENIE OSOBY
--
-- Cialo z 20260824101803; jedyna zmiana: porzadek po ostatnim zdarzeniu
-- wiersza (powtorzenie ma ten sam kierunek, wiec kierunek ostatniego
-- zdarzenia osoby = kierunek wiersza z najpozniejszym zdarzeniem).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_checkpoint_occupancy(_tenant uuid, _checkpoint_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT count(*)::integer
  FROM (
    SELECT DISTINCT ON (c.person_id) c.direction
    FROM public.event_checkins c
    WHERE c.tenant_id = _tenant
      AND c.checkpoint_id = _checkpoint_id
      AND c.result = 'granted'
    ORDER BY c.person_id, GREATEST(c.occurred_at, c.last_repeat_device_at) DESC, c.id
  ) last_scan
  WHERE last_scan.direction = 'in';
$$;

REVOKE ALL ON FUNCTION public._event_checkpoint_occupancy(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_checkpoint_occupancy(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_checkpoint_occupancy(uuid, uuid) IS
  'Ile osob jest AKTUALNIE w punkcie (ostatnie zdarzenie zgody osoby - occurred_at albo wchloniete powtorzenie last_repeat_device_at - to wejscie). Liczy z dziennika, nie z kolumny-licznika, ktora dryfuje; wynik nie zalezy od kolejnosci synchronizacji. Liczy, nie rezerwuje - wolajacy trzyma blokade wiersza punktu.';

-- ----------------------------------------------------------------------------
-- 5) DZIENNIK ODPRAW: double_entry PO ZDARZENIACH
--
-- Cialo z 20261012111300; jedyna zmiana: podzapytania double_entry. Poprzednie
-- zdarzenie przed wejsciem c: wiersz pv porzadkowany po swoim ostatnim
-- zdarzeniu nie pozniejszym niz c. Nastepne: pierwsze zdarzenie wiersza nx
-- nie wczesniejsze niz OSTATNIE zdarzenie c (wejscie c moglo zostac
-- powtorzone po wyjsciu, ktore dotarlo pozniej). Sygnatura, typ wyniku i ACL
-- bez zmian.
-- ----------------------------------------------------------------------------
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
  offline_server_result text,
  conflict boolean,
  conflict_kind text,
  reentry_override boolean,
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
  v_tz text;
BEGIN
  -- Granica dnia regul ponownego wejscia: polnoc w strefie wydarzenia.
  SELECT public._event_safe_timezone(e.timezone) INTO v_tz
  FROM public.events e
  WHERE e.tenant_id = v_tenant AND e.id = p_event_id;
  v_tz := COALESCE(v_tz, public._event_safe_timezone(NULL));

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
    c.offline_server_result,
    cf.kind IS NOT NULL,
    cf.kind,
    c.reentry_override,
    count(*) OVER ()::integer
  FROM public.event_checkins c
  JOIN public.event_checkpoints cp
    ON cp.tenant_id = c.tenant_id AND cp.id = c.checkpoint_id
  -- `row_admit`: czy wynik WIERSZA wpuszcza wedlug trybu punktu (przy
  -- wpuszczeniu offline to wynik serwera); `server_admit`: czy wpuscilby
  -- serwer (przy odmowie offline jego wynik jest w offline_server_result).
  CROSS JOIN LATERAL (
    SELECT
      (c.result = 'granted'
        OR (cp.access_mode = 'track'
            AND c.result IN ('denied_not_registered', 'denied_registration_status'))) AS row_admit,
      (COALESCE(c.offline_server_result, c.result) = 'granted'
        OR (cp.access_mode = 'track'
            AND COALESCE(c.offline_server_result, c.result)
              IN ('denied_not_registered', 'denied_registration_status'))) AS server_admit
  ) adm
  -- F5: ostatnie zdarzenie wiersza c (wchloniete powtorzenie jest pozniejsze
  -- niz occurred_at).
  CROSS JOIN LATERAL (
    SELECT GREATEST(c.occurred_at, c.last_repeat_device_at) AS last_at
  ) ce
  -- R9: dwa wejscia tej osoby w punkcie z polityka deny, tego samego dnia
  -- czasu wydarzenia, bez wyjscia pomiedzy - kazde z osobna moglo byc
  -- prawdziwe (skan z kolejki oceniony bez pozniejszego wyjscia, ktore
  -- jeszcze nie dotarlo), ale razem to podwojne wejscie jednego kodu.
  -- Oznaczamy oba wiersze pary; jawne obejscie stanowiska nie jest
  -- konfliktem. F5: porownujemy ZDARZENIA (occurred_at i wchloniete
  -- powtorzenia), wiec wynik nie zalezy od kolejnosci synchronizacji.
  CROSS JOIN LATERAL (
    SELECT (
      c.result = 'granted'
      AND c.direction = 'in'
      AND cp.access_mode = 'control'
      AND cp.reentry_policy = 'deny'
      AND (
        (
          NOT c.reentry_override
          AND (
            SELECT pv.direction
            FROM public.event_checkins pv
            CROSS JOIN LATERAL (
              SELECT GREATEST(
                pv.occurred_at,
                CASE WHEN pv.last_repeat_device_at <= c.occurred_at THEN pv.last_repeat_device_at END
              ) AS at
            ) pe
            WHERE pv.tenant_id = c.tenant_id
              AND pv.checkpoint_id = c.checkpoint_id
              AND pv.person_id = c.person_id
              AND pv.result = 'granted'
              AND pv.id <> c.id
              AND pv.occurred_at <= c.occurred_at
              AND pv.occurred_at >= date_trunc('day', c.occurred_at AT TIME ZONE v_tz) AT TIME ZONE v_tz
            ORDER BY pe.at DESC, pv.id DESC
            LIMIT 1
          ) = 'in'
        )
        OR (
          SELECT nx.direction = 'in' AND NOT nx.reentry_override
          FROM public.event_checkins nx
          CROSS JOIN LATERAL (
            SELECT CASE
              WHEN nx.occurred_at >= ce.last_at THEN nx.occurred_at
              WHEN nx.last_repeat_device_at >= ce.last_at THEN nx.last_repeat_device_at
            END AS at
          ) ne
          WHERE nx.tenant_id = c.tenant_id
            AND nx.checkpoint_id = c.checkpoint_id
            AND nx.person_id = c.person_id
            AND nx.result = 'granted'
            AND nx.id <> c.id
            AND ne.at IS NOT NULL
            AND ne.at < (date_trunc('day', c.occurred_at AT TIME ZONE v_tz) + interval '1 day')
              AT TIME ZONE v_tz
          ORDER BY ne.at, nx.id
          LIMIT 1
        ) IS TRUE
      )
    ) AS double_entry
  ) dbl
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN c.offline_admitted IS TRUE AND NOT adm.row_admit THEN 'admitted_offline'
      WHEN c.offline_admitted IS FALSE AND adm.server_admit THEN 'denied_offline'
      WHEN dbl.double_entry THEN 'double_entry'
    END AS kind
  ) cf
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
    AND (NOT v_conflicts OR cf.kind IS NOT NULL)
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
  'Dziennik odpraw dla panelu: filtry (punkt, kierunek, wynik, zrodlo, fraza, zakres czasu, tylko konflikty), paginacja i licznik calosci w funkcji okna. Kolumny offline i wyliczony conflict z rodzajem conflict_kind: admitted_offline (wpuszczony bez sieci, odmowa serwera wedlug trybu punktu), denied_offline (odeslany bez sieci, serwer by wpuscil) albo double_entry (punkt z polityka deny: dwa wejscia tej osoby tego samego dnia czasu wydarzenia bez wyjscia pomiedzy - oba wiersze pary; liczony przy odczycie po ZDARZENIACH wierszy - occurred_at i wchloniete powtorzenie last_repeat_device_at - wiec nie zalezy od kolejnosci synchronizacji i znika, gdy dotrze wyjscie). reentry_override: jawne obejscie odmowy przez stanowisko (nie jest konfliktem). Bramka: assert_event_admin_tenant().';
