-- events-harness: include
-- ============================================================================
-- WYDARZENIA: SKANER - POPRAWKI PO PRZEGLADZIE UTWARDZENIA (R0..R12).
--
-- CZESC 1/4: SCHEMAT, TRIGGERY I FUNKCJE POMOCNICZE. Bramki urzadzenia
-- i zapis odprawy sa w 20261012111100, plaszczyzna urzadzenia
-- w 20261012111200, panel w 20261012111300 - wdraza sie je PO KOLEI.
--
-- PROBLEM (przeglad 20261012110000 .. 20261012110400, potwierdzone ustalenia):
--   R0/R11 Po terminie poswiadczenia skan z kolejki przechodzil WYLACZNIE ze
--          znacznikiem kolejki, ktorego zaden wdrozony klient nie wysyla -
--          okno 72 h przestalo dzialac dla calej floty.
--   R4  Skan z kolejki kodu zastapionego PO chwili skanu (przedruk w trakcie
--       pracy bramki bez sieci) przepadal bez wiersza; wpuszczenie offline
--       kodu juz martwego nie zostawialo konfliktu.
--   R5  Identyfikator wydrukowany do zapisu bez biletu przezywal anulowanie
--       albo odrzucenie zapisu (trigger patrzyl tylko na czyszczenie biletu).
--   R6  Przy deny wejscie po wyjsciu w oknie powtorzen zlewalo sie
--       z wczesniejszym wejsciem ("repeat") - jeden kod wpuszczal dwie osoby.
--   R7  Klon edycji gubil reentry_policy punktu (wracal do allow).
--   R8  Na bramce tylko-wejscie stan "w srodku" nie zerowal sie nigdy - drugi
--       dzien wydarzenia konczyl sie odmowa, bez obejscia dla stanowiska.
--   R9  Skan z kolejki oceniany wzgledem POZNIEJSZEGO wejscia (wyjscie z tej
--       samej kolejki moglo jeszcze nie dotrzec) dawal falszywy konflikt,
--       a reentry_previous_at wskazywal chwile PO skanie.
--   R10 Klucze obce SET NULL do auth.users kontra CHECK "dokladnie jeden
--       aktor": usuniecie konta pracownika, ktory odprawial, drukowal albo
--       skanowal leady, konczylo sie bledem 23514.
--   R12 Blokada z kolejki (100 nieznanych kodow) blokowala takze skanowanie
--       NA ZYWO na 30 minut zaraz po powrocie sieci.
--
-- ZMIANA (ta czesc):
--   * event_scanner_devices.queue_marker_required_at (R0/R11) - chwila, od
--     ktorej urzadzenie zadeklarowalo klienta przechowujacego znacznik
--     kolejki (client_caps w bootstrapie / liscie) albo przyslalo skan
--     z WAZNYM znacznikiem. Ustawiana raz, nigdy czyszczona;
--   * event_scanner_devices.queue_locked_until (R12) - blokada samej
--     synchronizacji kolejki, osobna od blokady na zywo (locked_until);
--   * actor_deleted_at w event_checkins / event_badge_prints /
--     event_lead_scans + CHECK "jeden aktor ALBO zaden po usunieciu konta"
--     + trigger BEFORE UPDATE, ktory stempluje usuniecie, gdy klucz obcy
--     zeruje aktora (R10). Wiersz historii zostaje;
--   * event_checkins.reentry_override (R8) - jawne, audytowane obejscie
--     odmowy ponownego wejscia przez stanowisko (operator + znacznik);
--   * wynik denied_code_superseded (R4) - prawdziwa odmowa wiersza, gdy
--     bramka wpuscila offline kod martwy juz w chwili skanu;
--   * trigger zz_badge_follows_ticket: identyfikator zdejmowany takze przy
--     przejsciu zapisu w cancelled / rejected (R5) + jednorazowe sprzatanie
--     istniejacych; wyszukiwanie kodu traktuje identyfikator zapisu
--     anulowanego / odrzuconego jako revoked;
--   * trigger okna idempotencji przycina okno ZGODY tak, by nie nachodzilo
--     na okno innego przejscia (R6): nowe wejscie po wyjsciu nie zlewa sie
--     z poprzednim i nie odbija od EXCLUDE;
--   * _event_checkin_inside_since (R6/R8/R9): tylko skany WCZESNIEJSZE niz
--     oceniany, tylko z tego samego dnia czasu wydarzenia, punkt po punkcie;
--   * _event_clone_onsite kopiuje reentry_policy (R7).
--
-- REGULA PONOWNEGO WEJSCIA (jedna, wszedzie - serwer, podpowiedz panelu,
-- klient offline): stan "w srodku" liczy sie OSOBNO dla kazdego punktu
-- (strefy sa niezalezne). Osoba jest w srodku, gdy jej ostatni skan zgody
-- w tym punkcie TEGO SAMEGO DNIA (polnoc w strefie wydarzenia) i NIE
-- POZNIEJSZY niz oceniany skan byl wejsciem. Wyjscie w tym samym punkcie
-- zeruje stan, polnoc czasu wydarzenia tez - na bramce tylko-wejscie to
-- "jedno wejscie dziennie". Wejscie w oknie powtorzen bez wyjscia pomiedzy
-- to TO SAMO wejscie (repeat). Reczna odprawa na stanowisku omija odmowe
-- jawnym, audytowanym obejsciem (reentry_override + operator).
--
-- IDEMPOTENTNA: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS + ADD,
-- DROP TRIGGER IF EXISTS + CREATE, CREATE OR REPLACE; sprzatanie
-- identyfikatorow dotyka tylko wierszy, ktore jeszcze je maja.
-- DOWOD: scripts/events-harness/runtime_test.d/56_scanner_review_fixes.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) URZADZENIE: DEKLARACJA ZNACZNIKA KOLEJKI (R0/R11) I BLOKADA KOLEJKI (R12)
-- ----------------------------------------------------------------------------
ALTER TABLE public.event_scanner_devices
  ADD COLUMN IF NOT EXISTS queue_marker_required_at timestamptz,
  ADD COLUMN IF NOT EXISTS queue_locked_until timestamptz;

GRANT SELECT (queue_marker_required_at, queue_locked_until)
  ON public.event_scanner_devices TO authenticated;

COMMENT ON COLUMN public.event_scanner_devices.queue_marker_required_at IS
  'Od kiedy urzadzenie dziala na kliencie, ktory przechowuje znacznik kolejki (client_caps zawiera queue_marker w bootstrapie albo liscie offline, albo skan z kolejki przyszedl z WAZNYM znacznikiem). Ustawiana raz, nigdy czyszczona - nie da sie jej cofnac podrobionym ladunkiem. NULL = sciezka przejsciowa: po terminie skan z kolejki przechodzi wedlug starej reguly (czas skanu < termin, najpozniej 72 h po terminie).';
COMMENT ON COLUMN public.event_scanner_devices.queue_locked_until IS
  'Blokada SAMEJ synchronizacji kolejki po 100 nieznanych kodach z kolejki w 60 minut (30 minut). Skanowanie na zywo dziala dalej - jego blokada to locked_until (20 w 10 minut).';

-- ----------------------------------------------------------------------------
-- 2) R10: AKTOR USUNIETEGO KONTA
--
-- Klucze obce operator_user_id / printed_by / scanned_by_user_id ->
-- auth.users sa ON DELETE SET NULL, a CHECK wymagal dokladnie jednego
-- aktora - usuniecie konta pracownika odbijalo sie od CHECK-a (23514),
-- a deleteMyAccount zostawal w polowie. Zero aktorow jest dopuszczalne
-- WYLACZNIE z jawnym stemplem actor_deleted_at, ktory stawia trigger
-- BEFORE UPDATE dokladnie wtedy, gdy klucz obcy zeruje aktora-uzytkownika
-- (ta sama technika co event_package_seats_unlinked). Wstawienie wiersza bez
-- aktora nadal jest odrzucane.
-- ----------------------------------------------------------------------------
ALTER TABLE public.event_checkins ADD COLUMN IF NOT EXISTS actor_deleted_at timestamptz;
ALTER TABLE public.event_badge_prints ADD COLUMN IF NOT EXISTS actor_deleted_at timestamptz;
ALTER TABLE public.event_lead_scans ADD COLUMN IF NOT EXISTS actor_deleted_at timestamptz;

ALTER TABLE public.event_checkins DROP CONSTRAINT IF EXISTS event_checkins_actor_exactly_one;
ALTER TABLE public.event_checkins ADD CONSTRAINT event_checkins_actor_exactly_one
  CHECK (CASE
    WHEN actor_deleted_at IS NULL THEN num_nonnulls(operator_user_id, device_id) = 1
    ELSE num_nonnulls(operator_user_id, device_id) = 0
  END);

ALTER TABLE public.event_badge_prints DROP CONSTRAINT IF EXISTS event_badge_prints_actor_exactly_one;
ALTER TABLE public.event_badge_prints ADD CONSTRAINT event_badge_prints_actor_exactly_one
  CHECK (CASE
    WHEN actor_deleted_at IS NULL THEN num_nonnulls(printed_by, device_id) = 1
    ELSE num_nonnulls(printed_by, device_id) = 0
  END);

ALTER TABLE public.event_lead_scans DROP CONSTRAINT IF EXISTS event_lead_scans_actor_exactly_one;
ALTER TABLE public.event_lead_scans ADD CONSTRAINT event_lead_scans_actor_exactly_one
  CHECK (CASE
    WHEN actor_deleted_at IS NULL THEN num_nonnulls(scanned_by_user_id, device_id) = 1
    ELSE num_nonnulls(scanned_by_user_id, device_id) = 0
  END);

COMMENT ON COLUMN public.event_checkins.actor_deleted_at IS
  'Chwila usuniecia konta operatora (ON DELETE SET NULL na operator_user_id). Jedyny stan, w ktorym wiersz nie ma aktora - CHECK actor_exactly_one; stempel stawia trigger event_checkins_actor_deleted.';
COMMENT ON COLUMN public.event_badge_prints.actor_deleted_at IS
  'Chwila usuniecia konta drukujacego (ON DELETE SET NULL na printed_by). Jedyny stan bez aktora - CHECK actor_exactly_one; stempel stawia trigger event_badge_prints_actor_deleted.';
COMMENT ON COLUMN public.event_lead_scans.actor_deleted_at IS
  'Chwila usuniecia konta skanujacego (ON DELETE SET NULL na scanned_by_user_id). Jedyny stan bez aktora - CHECK actor_exactly_one; stempel stawia trigger event_lead_scans_actor_deleted.';

CREATE OR REPLACE FUNCTION public._tg_event_actor_account_deleted()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  NEW.actor_deleted_at := COALESCE(NEW.actor_deleted_at, now());
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._tg_event_actor_account_deleted() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._tg_event_actor_account_deleted() IS
  'Klucz obcy SET NULL wyzerowal aktora-uzytkownika (usuniecie konta): wiersz historii zostaje, a actor_deleted_at mowi, dlaczego nie ma aktora. Wspolna dla event_checkins, event_badge_prints i event_lead_scans.';

DROP TRIGGER IF EXISTS event_checkins_actor_deleted ON public.event_checkins;
CREATE TRIGGER event_checkins_actor_deleted
  BEFORE UPDATE OF operator_user_id ON public.event_checkins
  FOR EACH ROW
  WHEN (OLD.operator_user_id IS NOT NULL AND NEW.operator_user_id IS NULL AND NEW.device_id IS NULL)
  EXECUTE FUNCTION public._tg_event_actor_account_deleted();

DROP TRIGGER IF EXISTS event_badge_prints_actor_deleted ON public.event_badge_prints;
CREATE TRIGGER event_badge_prints_actor_deleted
  BEFORE UPDATE OF printed_by ON public.event_badge_prints
  FOR EACH ROW
  WHEN (OLD.printed_by IS NOT NULL AND NEW.printed_by IS NULL AND NEW.device_id IS NULL)
  EXECUTE FUNCTION public._tg_event_actor_account_deleted();

DROP TRIGGER IF EXISTS event_lead_scans_actor_deleted ON public.event_lead_scans;
CREATE TRIGGER event_lead_scans_actor_deleted
  BEFORE UPDATE OF scanned_by_user_id ON public.event_lead_scans
  FOR EACH ROW
  WHEN (OLD.scanned_by_user_id IS NOT NULL AND NEW.scanned_by_user_id IS NULL AND NEW.device_id IS NULL)
  EXECUTE FUNCTION public._tg_event_actor_account_deleted();

-- ----------------------------------------------------------------------------
-- 3) R8: JAWNE OBEJSCIE ODMOWY PONOWNEGO WEJSCIA; R4: WYNIK KODU ZASTAPIONEGO
-- ----------------------------------------------------------------------------
ALTER TABLE public.event_checkins
  ADD COLUMN IF NOT EXISTS reentry_override boolean NOT NULL DEFAULT false;

-- Obejscie zapisuje WYLACZNIE stanowisko (bez urzadzenia), wylacznie zgode
-- na wejscie i wylacznie ze zrodlem panelu.
ALTER TABLE public.event_checkins DROP CONSTRAINT IF EXISTS event_checkins_reentry_override_desk;
ALTER TABLE public.event_checkins ADD CONSTRAINT event_checkins_reentry_override_desk
  CHECK (NOT reentry_override OR (
    device_id IS NULL
    AND direction = 'in'
    AND result = 'granted'
    AND source IN ('manual_entry', 'name_search')
  ));

COMMENT ON COLUMN public.event_checkins.reentry_override IS
  'Stanowisko odprawy swiadomie wpuscilo osobe, ktora wedlug dziennika byla juz w srodku punktu z polityka deny (admin_event_checkin_manual). Audyt: operator_user_id + ten znacznik. Taki wiersz nie jest konfliktem podwojnego wejscia.';

ALTER TABLE public.event_checkins DROP CONSTRAINT IF EXISTS event_checkins_result_values;
ALTER TABLE public.event_checkins ADD CONSTRAINT event_checkins_result_values
  CHECK (result IN (
    'granted', 'denied_not_registered', 'denied_registration_status', 'denied_direction',
    'denied_capacity', 'denied_checkpoint_inactive', 'denied_already_inside',
    'denied_code_superseded'
  ));

COMMENT ON COLUMN public.event_checkins.result IS
  'granted | denied_not_registered | denied_registration_status | denied_direction | denied_capacity | denied_checkpoint_inactive | denied_already_inside | denied_code_superseded. Odmowa MA wiersz - bez niego nie da sie odpowiedziec, dlaczego kogos nie wpuszczono. denied_code_superseded: bramka bez sieci wpuscila kod, ktory w chwili skanu byl juz zastapiony (konflikt admitted_offline).';

COMMENT ON COLUMN public.event_checkpoints.reentry_policy IS
  'allow | deny. Przy deny (tylko tryb control) wejscie osoby, ktorej ostatni skan zgody w TYM punkcie, tego samego dnia czasu wydarzenia i nie pozniejszy niz oceniany, byl wejsciem, konczy sie wynikiem denied_already_inside. Wyjscie w tym punkcie i polnoc czasu wydarzenia zeruja stan (bramka tylko-wejscie: jedno wejscie dziennie). Powtorzone pikniecie w oknie idempotencji bez wyjscia pomiedzy to nadal to samo wejscie (repeat). Stanowisko moze odmowe jawnie obejsc (reentry_override).';

-- ----------------------------------------------------------------------------
-- 4) R5: IDENTYFIKATOR NIE PRZEZYWA ANULOWANIA ANI ODRZUCENIA ZAPISU
--
-- Dotad trigger reagowal tylko na wyczyszczenie biletu. Zapis bez biletu
-- (oczekujacy, lista rezerwowa, nieoplacony) z wydrukowanym identyfikatorem
-- po anulowaniu zachowywal zywy identyfikator - a gdy ta sama osoba miala
-- potem inny aktywny zapis, stary identyfikator wpuszczal. Teraz kazda
-- aktualizacja zapisu w stanie cancelled / rejected zdejmuje identyfikator;
-- trigger AFTER zz_supersede_codes zapisuje go jako revoked.
-- ----------------------------------------------------------------------------
COMMENT ON FUNCTION public._tg_event_registrations_badge_follows_ticket() IS
  'Wyczyszczenie kodu biletu albo przejscie zapisu w cancelled / rejected zdejmuje kod identyfikatora - identyfikator nie wpuszcza dluzej niz zapis i bilet. Stary kod trafia do event_superseded_codes (revoked) triggerem zz_supersede_codes.';

DROP TRIGGER IF EXISTS event_registrations_zz_badge_follows_ticket ON public.event_registrations;
CREATE TRIGGER event_registrations_zz_badge_follows_ticket
  BEFORE UPDATE ON public.event_registrations
  FOR EACH ROW
  WHEN (NEW.badge_token_hash IS NOT NULL AND (
    (OLD.qr_token_hash IS NOT NULL AND NEW.qr_token_hash IS NULL)
    OR NEW.status IN ('cancelled', 'rejected')
  ))
  EXECUTE FUNCTION public._tg_event_registrations_badge_follows_ticket();

-- Istniejace identyfikatory zapisow juz anulowanych / odrzuconych: zdjete
-- teraz (trigger AFTER zapisuje je jako revoked).
UPDATE public.event_registrations
   SET badge_token_hash = NULL,
       badge_issued_at = NULL
 WHERE status IN ('cancelled', 'rejected')
   AND badge_token_hash IS NOT NULL;

-- Kod -> zapis. Cialo z 20261012110000; jedyna zmiana: identyfikator zapisu
-- anulowanego albo odrzuconego jest kodem zastapionym (revoked) - siatka
-- bezpieczenstwa obok triggera dla wierszy zapisanych z pominieciem
-- UPDATE (import, reczna naprawa). Bilet bez zmian.
CREATE OR REPLACE FUNCTION public._event_scanner_code_lookup(_tenant uuid, _code text)
RETURNS TABLE (
  registration_id uuid,
  event_id uuid,
  person_id uuid,
  credential text,
  superseded boolean,
  superseded_at timestamptz,
  superseded_reason text
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
         x.superseded, x.superseded_at, x.superseded_reason
  FROM (
    SELECT r.id AS registration_id, r.event_id, r.person_id,
           'ticket'::text AS credential, false AS superseded,
           NULL::timestamptz AS superseded_at, NULL::text AS superseded_reason, 1 AS rank
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
           2
    FROM public.event_registrations r
    CROSS JOIN h
    WHERE r.tenant_id = _tenant AND r.badge_token_hash = h.hash
    UNION ALL
    SELECT s.registration_id, s.event_id, r.person_id, s.credential, true, s.superseded_at, s.reason, 3
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
  'Kod uczestnika -> zapis: wazny bilet (credential ticket), wazny identyfikator (badge) albo kod zastapiony (superseded = true, z chwila i powodem). Identyfikator zapisu anulowanego / odrzuconego jest zastapiony (revoked). Brak wiersza = kod naprawde nieznany.';

-- ----------------------------------------------------------------------------
-- 5) R6: OKNO IDEMPOTENCJI NIE NACHODZI NA OKNO INNEGO PRZEJSCIA
--
-- Cialo z 20260824101235. Okno [chwila skanu, + okno punktu) jest nosnikiem
-- ograniczen EXCLUDE (druga ZGODA tej samej osoby, punktu i kierunku w
-- nakladajacych sie oknach). Wejscie PO wyjsciu w oknie poprzedniego wejscia
-- to NOWE wejscie, a nie powtorzenie - EXCLUDE odrzucalby je jako drugie
-- w oknie, a zapis zlewal je z poprzednim ("repeat"). Okno ZGODY jest wiec
-- przycinane do czesci, ktora nie nachodzi na okno zgody INNEGO przejscia
-- (zgoda w tym samym kierunku ze skanem zgody w przeciwnym kierunku
-- pomiedzy); puste, gdy nic nie zostaje. Liczy to trigger, nie wolajacy -
-- podane w INSERT okno jest zawsze nadpisywane, wiec EXCLUDE zostaje
-- ostatnia bramka wyscigu dla TEGO SAMEGO przejscia (bez skanu przeciwnego
-- pomiedzy nic nie jest przycinane).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_event_checkins_set_dedupe_range()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_window integer;
  v_at timestamptz := COALESCE(NEW.device_scanned_at, NEW.scanned_at);
  v_lo timestamptz;
  v_hi timestamptz;
BEGIN
  SELECT cp.dedupe_window_seconds INTO v_window
  FROM public.event_checkpoints cp
  WHERE cp.tenant_id = NEW.tenant_id
    AND cp.event_id = NEW.event_id
    AND cp.id = NEW.checkpoint_id;

  -- Brak punktu jest niemozliwy (klucz obcy zlozony), ale wartosc zapasowa
  -- kosztuje jedna linie i chroni przed wierszem bez okna przy imporcie.
  v_lo := v_at;
  v_hi := v_at + make_interval(secs => COALESCE(v_window, 60));

  IF NEW.result = 'granted' THEN
    -- Wczesniejsze przejscie w tym samym kierunku: okno zaczyna sie po jego oknie.
    SELECT GREATEST(v_lo, max(upper(c.dedupe_range))) INTO v_lo
    FROM public.event_checkins c
    WHERE c.tenant_id = NEW.tenant_id
      AND c.checkpoint_id = NEW.checkpoint_id
      AND c.person_id = NEW.person_id
      AND c.direction = NEW.direction
      AND c.result = 'granted'
      AND c.id <> NEW.id
      AND c.occurred_at <= v_at
      AND c.dedupe_range && tstzrange(v_at, v_hi, '[)')
      AND EXISTS (
        SELECT 1 FROM public.event_checkins o
        WHERE o.tenant_id = NEW.tenant_id
          AND o.checkpoint_id = NEW.checkpoint_id
          AND o.person_id = NEW.person_id
          AND o.result = 'granted'
          AND o.direction <> NEW.direction
          AND o.occurred_at > c.occurred_at
          AND o.occurred_at < v_at
      );

    -- Pozniejsze przejscie (skan z kolejki zsynchronizowany po fakcie):
    -- okno konczy sie przed jego oknem.
    SELECT LEAST(v_hi, min(lower(c.dedupe_range))) INTO v_hi
    FROM public.event_checkins c
    WHERE c.tenant_id = NEW.tenant_id
      AND c.checkpoint_id = NEW.checkpoint_id
      AND c.person_id = NEW.person_id
      AND c.direction = NEW.direction
      AND c.result = 'granted'
      AND c.id <> NEW.id
      AND c.occurred_at > v_at
      AND c.dedupe_range && tstzrange(v_at, v_hi, '[)')
      AND EXISTS (
        SELECT 1 FROM public.event_checkins o
        WHERE o.tenant_id = NEW.tenant_id
          AND o.checkpoint_id = NEW.checkpoint_id
          AND o.person_id = NEW.person_id
          AND o.result = 'granted'
          AND o.direction <> NEW.direction
          AND o.occurred_at > v_at
          AND o.occurred_at < c.occurred_at
      );
  END IF;

  NEW.dedupe_range := CASE
    WHEN v_lo < v_hi THEN tstzrange(v_lo, v_hi, '[)')
    ELSE 'empty'::tstzrange
  END;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.tg_event_checkins_set_dedupe_range() IS
  'Okno idempotencji [occurred_at, occurred_at + okno punktu), dla zgody przyciete tak, by nie nachodzilo na okno zgody INNEGO przejscia (ten sam kierunek, skan zgody w przeciwnym kierunku pomiedzy) - wejscie po wyjsciu w oknie poprzedniego wejscia to nowe wejscie. Liczone zawsze w triggerze: wartosc podana w INSERT jest nadpisywana, wiec EXCLUDE pozostaje bramka wyscigu dla tego samego przejscia.';

-- ----------------------------------------------------------------------------
-- 6) R6/R8/R9: STAN "W SRODKU" - JEDNA REGULA
-- ----------------------------------------------------------------------------

-- Polnoc dnia skanu w strefie czasowej wydarzenia (DST liczy strefa).
CREATE OR REPLACE FUNCTION public._event_checkin_day_start(
  _tenant uuid,
  _event_id uuid,
  _at timestamptz
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT date_trunc('day', _at AT TIME ZONE z.tz) AT TIME ZONE z.tz
  FROM (
    SELECT public._event_safe_timezone(
      (SELECT e.timezone FROM public.events e WHERE e.tenant_id = _tenant AND e.id = _event_id)
    ) AS tz
  ) z
$$;

REVOKE ALL ON FUNCTION public._event_checkin_day_start(uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_checkin_day_start(uuid, uuid, timestamptz) TO service_role;

COMMENT ON FUNCTION public._event_checkin_day_start(uuid, uuid, timestamptz) IS
  'Poczatek dnia (polnoc) chwili _at w strefie czasowej wydarzenia. Granica, na ktorej zeruje sie stan "w srodku" punktu.';

-- Czy miedzy dwiema chwilami (wylacznie) jest skan ZGODY tej osoby w tym
-- punkcie w PRZECIWNYM kierunku. Dwa skany w jednym kierunku z takim skanem
-- pomiedzy to dwa rozne przejscia, nie powtorzone pikniecie.
CREATE OR REPLACE FUNCTION public._event_checkin_crossed(
  _tenant uuid,
  _checkpoint_id uuid,
  _person_id uuid,
  _direction text,
  _a timestamptz,
  _b timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.event_checkins o
    WHERE o.tenant_id = _tenant
      AND o.checkpoint_id = _checkpoint_id
      AND o.person_id = _person_id
      AND o.result = 'granted'
      AND o.direction <> _direction
      AND o.occurred_at > LEAST(_a, _b)
      AND o.occurred_at < GREATEST(_a, _b)
  )
$$;

REVOKE ALL ON FUNCTION public._event_checkin_crossed(uuid, uuid, uuid, text, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_checkin_crossed(uuid, uuid, uuid, text, timestamptz, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public._event_checkin_crossed(uuid, uuid, uuid, text, timestamptz, timestamptz) IS
  'Czy miedzy _a i _b (wylacznie) osoba ma w punkcie skan zgody w kierunku przeciwnym do _direction. Wejscie po wyjsciu (i wyjscie po wejsciu) to nowe przejscie, nie powtorzenie.';

-- Cialo z 20261012110000; zmiany:
--   (R9) tylko skany NIE POZNIEJSZE niz oceniany - galaz "pierwszy skan po
--        _at jest wejsciem" znika: skan z kolejki nie odbija sie od wejscia,
--        ktore nastapilo po nim (wyjscie z tej samej kolejki moglo jeszcze
--        nie dotrzec), a chwila poprzedniego wejscia nigdy nie jest pozniejsza
--        niz oceniany skan. Podwojne wejscie w takim ukladzie pokazuje dziennik
--        panelu (konflikt double_entry), nie odmowa;
--   (R8) tylko skany z tego samego dnia czasu wydarzenia - polnoc zeruje stan;
--   (R6) wejscie w oknie powtorzen PRZED skanem to to samo wejscie i jest
--        pomijane; wyjscie pomiedzy i tak jest pozniejszym skanem, wiec
--        ostatnim skanem jest ono, nie tamto wejscie.
-- Sygnatura bez zmian (_window: okno idempotencji punktu).
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
    SELECT c.direction, c.occurred_at
    FROM public.event_checkins c
    CROSS JOIN d
    WHERE c.tenant_id = _tenant
      AND c.checkpoint_id = _checkpoint_id
      AND c.person_id = _person_id
      AND c.result = 'granted'
      AND (_exclude_id IS NULL OR c.id <> _exclude_id)
      AND c.occurred_at >= d.day_start
      AND c.occurred_at <= _at
      AND NOT (c.direction = 'in' AND c.occurred_at > _at - _window)
    ORDER BY c.occurred_at DESC, c.id DESC
    LIMIT 1
  )
  SELECT l.occurred_at FROM last_scan l WHERE l.direction = 'in'
$$;

REVOKE ALL ON FUNCTION public._event_checkin_inside_since(uuid, uuid, uuid, timestamptz, interval, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_checkin_inside_since(uuid, uuid, uuid, timestamptz, interval, uuid)
  TO service_role;

COMMENT ON FUNCTION public._event_checkin_inside_since(uuid, uuid, uuid, timestamptz, interval, uuid) IS
  'Czy osoba jest w srodku punktu w chwili _at: ostatni skan zgody w TYM punkcie, z tego samego dnia czasu wydarzenia i nie pozniejszy niz _at, byl wejsciem. Wejscie w oknie powtorzen przed _at to to samo wejscie (pomijane). Zwraca chwile tamtego wejscia (zawsze <= _at) albo NULL.';

-- ----------------------------------------------------------------------------
-- 7) R0/R11: DEKLARACJA KLIENTA (client_caps)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_scanner_device_note_caps(
  _tenant uuid,
  _device_id uuid,
  _caps jsonb
)
RETURNS timestamptz
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_at timestamptz;
BEGIN
  IF jsonb_typeof(_caps) = 'array' AND _caps ? 'queue_marker' THEN
    UPDATE public.event_scanner_devices d
       SET queue_marker_required_at = COALESCE(d.queue_marker_required_at, now())
     WHERE d.tenant_id = _tenant AND d.id = _device_id
    RETURNING d.queue_marker_required_at INTO v_at;
  ELSE
    SELECT d.queue_marker_required_at INTO v_at
    FROM public.event_scanner_devices d
    WHERE d.tenant_id = _tenant AND d.id = _device_id;
  END IF;

  RETURN v_at;
END;
$$;

REVOKE ALL ON FUNCTION public._event_scanner_device_note_caps(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_scanner_device_note_caps(uuid, uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public._event_scanner_device_note_caps(uuid, uuid, jsonb) IS
  'client_caps z bootstrapu albo listy offline: tablica z "queue_marker" ustawia (raz, na zawsze) queue_marker_required_at urzadzenia. Oddaje biezaca wartosc.';

-- ----------------------------------------------------------------------------
-- 8) R7: KLON EDYCJI KOPIUJE POLITYKE PONOWNEGO WEJSCIA
--
-- Cialo z 20260927000801; jedyna zmiana: reentry_policy w liscie kolumn.
-- Wiersz zrodlowy spelnia CHECK reentry_needs_control, bo access_mode jest
-- kopiowany razem z polityka.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_clone_onsite(
  p_tenant uuid, p_src uuid, p_new uuid, p_ctx jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := (p_ctx->>'uid')::uuid;
  v_checkpoints integer;
  v_total integer;
  v_templates integer;
BEGIN
  -- Punkt sesji bez skopiowanej sesji i stoisko bez skopiowanego sponsora
  -- lamalyby CHECK rodzaju - sa pomijane (i liczone).
  INSERT INTO public.event_checkpoints (
    id, tenant_id, event_id, name_pl, name_en, kind, session_id, room_id, sponsor_id,
    direction_mode, access_mode, reentry_policy, capacity, dedupe_window_seconds, is_active,
    sort_order, created_by
  )
  SELECT public._event_clone_id(p_new, c.id), p_tenant, p_new, c.name_pl, c.name_en, c.kind,
         x.session_id,
         (SELECT r.id FROM public.event_rooms r
           WHERE r.tenant_id = p_tenant AND r.event_id = p_new
             AND r.id = public._event_clone_id(p_new, c.room_id)),
         x.sponsor_id, c.direction_mode, c.access_mode, c.reentry_policy, c.capacity,
         c.dedupe_window_seconds, c.is_active, c.sort_order, v_uid
  FROM public.event_checkpoints c
  CROSS JOIN LATERAL (
    SELECT
      (SELECT s.id FROM public.event_sessions s
        WHERE s.tenant_id = p_tenant AND s.event_id = p_new
          AND s.id = public._event_clone_id(p_new, c.session_id)) AS session_id,
      (SELECT sp.id FROM public.event_sponsors sp
        WHERE sp.tenant_id = p_tenant AND sp.event_id = p_new
          AND sp.id = public._event_clone_id(p_new, c.sponsor_id)) AS sponsor_id
  ) AS x
  WHERE c.tenant_id = p_tenant AND c.event_id = p_src
    AND (c.kind <> 'session' OR x.session_id IS NOT NULL)
    AND (c.kind <> 'company_booth' OR x.sponsor_id IS NOT NULL);
  GET DIAGNOSTICS v_checkpoints = ROW_COUNT;

  SELECT count(*) INTO v_total FROM public.event_checkpoints c
  WHERE c.tenant_id = p_tenant AND c.event_id = p_src;

  INSERT INTO public.event_badge_templates (
    id, tenant_id, event_id, name, paper_format, width_mm, height_mm, orientation,
    double_fold, background_color, background_image_url, show_qr, qr_size_mm, elements,
    version, is_default, created_by
  )
  SELECT public._event_clone_id(p_new, b.id), p_tenant, p_new, b.name, b.paper_format,
         b.width_mm, b.height_mm, b.orientation, b.double_fold, b.background_color,
         b.background_image_url, b.show_qr, b.qr_size_mm, b.elements, 1, b.is_default, v_uid
  FROM public.event_badge_templates b
  WHERE b.tenant_id = p_tenant AND b.event_id = p_src;
  GET DIAGNOSTICS v_templates = ROW_COUNT;

  RETURN jsonb_build_object(
    'copied', jsonb_build_object('checkpoints', v_checkpoints, 'badge_templates', v_templates),
    'skipped', jsonb_build_object('checkpoints', v_total - v_checkpoints)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_onsite(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_onsite(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_onsite(uuid, uuid, uuid, jsonb) IS
  'Klon punktow odprawy (z polityka ponownego wejscia; bez celu - pominiete) i szablonow identyfikatorow (wersja od 1). Urzadzen skanera nigdy. Pomocnik klonu edycji.';
