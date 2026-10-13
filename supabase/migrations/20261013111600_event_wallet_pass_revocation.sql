-- events-harness: include
-- ============================================================================
-- WYDARZENIA: PRZEPUSTKA GOOGLE WALLET TRACI WAZNOSC RAZEM Z BILETEM (OPS-14).
--
-- CZESC 1/2: SCHEMAT, BACKFILL, TRIGGERY I DZIENNIK WYDAN. Kolejka
-- dezaktywacji (zajecie i rozliczenie dla zadania serwera) jest w czesci
-- 20261013111700 - wdraza sie ja PO tej czesci.
--
-- PROBLEM. `event_wallet_passes` tylko liczyl wydania. Obiekt Google Wallet
-- (`eventTicketObject`) zostawal ACTIVE po anulowaniu albo odrzuceniu
-- zgloszenia, po zwrocie, po odwolaniu wydarzenia i po zmianie kodu biletu
-- (ponowna wysylka biletu - `_event_issue_ticket_codes` - albo jawne
-- uniewaznienie zgubionego kodu w panelu). Uczestnik widzial w telefonie
-- "wazny" bilet, ktorego bramka nie przyjmie. Druk identyfikatora od
-- 20261013110500 NIE zmienia juz kodu biletu (identyfikator ma wlasne
-- poswiadczenie), wiec nie jest tu powodem dezaktywacji.
--
-- ZMIANA:
--   * wiersz `event_wallet_passes` = JEDEN OBIEKT platformy (unikalnosc po
--     najemcy, platformie i identyfikatorze obiektu, a nie po zgloszeniu).
--     Serwer nadaje obiektom Google identyfikator z KODU biletu
--     (`<wystawca>.reg_<zgloszenie>.<12 hex z SHA-256 kodu>`), wiec nowy kod
--     to nowy obiekt, a stary zostaje na zawsze nieaktywny. Dlaczego nie
--     przepisac kodu w starym obiekcie: (1) baza nie trzyma jawnego kodu
--     (tylko skrot), a jawna wartosc istnieje jedynie chwilowo w zadaniu
--     wysylki biletu albo w odpowiedzi panelu dla administratora;
--     (2) obiekt mogl zapisac w swoim koncie Google kazdy, kto mial STARY kod
--     (przekazany mail), a uniewaznienie zgubionego kodu ma mu odebrac
--     wejscie, nie podac nowy kod; (3) zadanie dezaktywacji i ponowne
--     dodanie przez uczestnika nigdy nie pisza do tego samego obiektu, wiec
--     nie ma wyscigu "INACTIVE nadpisuje swiezo dodany bilet";
--   * kolumny stanu obiektu: `code_hash` (skrot kodu, ktory obiekt niesie),
--     `content_hash` (skrot ostatnio zapisanej tresci - trasa pomija PATCH,
--     gdy tresc sie nie zmienila), `revoke_requested_at`/`revoke_reason`,
--     dzierzawa i licznik prob (`revoke_claimed_at`, `revoke_attempts`,
--     `revoke_error`) oraz `revoked_at`;
--   * trigger AFTER UPDATE na `event_registrations` (WHEN: zmiana statusu,
--     statusu platnosci albo skrotu kodu) zglasza dezaktywacje obiektow Google, gdy
--     zgloszenie przestaje dawac przepustke (ten sam predykat co
--     `event_ticket_wallet_payload`) albo gdy zmienia sie kod biletu.
--     DLACZEGO TRIGGER NA ZGLOSZENIU, A NIE NA `event_superseded_codes`:
--     rejestr zastapionych kodow widzi wylacznie zmiane SKROTU, a anulowanie
--     bez wyczyszczenia kodu (np. `no_show`) albo zmiana statusu platnosci
--     skrotu nie rusza. Jeden trigger na zrodle prawdy obejmuje oba
--     przypadki; drugi na rejestrze robilby te sama prace podwojnie;
--   * trigger AFTER UPDATE na `events` (WHEN: przejscie w `cancelled`)
--     zglasza dezaktywacje wszystkich obiektow Google odwolanego wydarzenia;
--   * `_event_wallet_pass_note` (nowa sygnatura: + skrot kodu i skrot tresci)
--     czysci stan dezaktywacji obiektu wydanego ponownie, oznacza starsze
--     obiekty tego zgloszenia jako zastapione (`replaced`) i - gdy kod
--     zmienil sie miedzy odczytem danych przepustki a zapisem dziennika -
--     od razu zglasza dezaktywacje wlasnie zapisanego obiektu. Blokada
--     FOR SHARE na zgloszeniu szereguje ja z triggerem;
--   * `_event_wallet_pass_state` - stan obiektu dla trasy (czy istnieje,
--     czy jest aktywny, skrot zapisanej tresci).
--
-- APPLE WALLET: BEZ DEZAKTYWACJI. Przepustka `.pkpass` jest statyczna
-- (brak `webServiceURL`/`authenticationToken` w `pass.json` i brak uslugi
-- aktualizacji APNs w kodzie), wiec serwer nie ma jak jej zmienic po
-- pobraniu. Anulowany bilet odrzuca bramka; przepustka wyszarza sie po
-- `expirationDate`. CHECK `event_wallet_passes_revoke_google_only` utrwala
-- to w schemacie - wlaczenie uslugi aktualizacji Apple to osobna migracja.
--
-- BACKFILL obiektow Google sprzed tej migracji (bez skrotu kodu):
--   * zgloszenie nie daje juz przepustki -> dezaktywacja (registration_closed
--     albo event_cancelled);
--   * kod wydany PO ostatnim wydaniu przepustki (`qr_issued_at` >
--     `last_issued_at`) -> obiekt niesie stary kod -> code_changed;
--   * w pozostalych przypadkach obiekt niesie biezacy kod -> `code_hash`.
--   Obiekty wydarzen zakonczonych ponad dobe temu pomijamy: Google wygasil je
--   sam (`validTimeInterval` = koniec + 1 dzien).
--
-- BEZPIECZENSTWO: wszystkie nowe funkcje wylacznie dla service_role; triggery
-- SECURITY DEFINER z search_path, bez grantow klienckich. Najemca jest
-- zawsze z wiersza (trigger) albo od serwera, ktory zautoryzowal kod biletu
-- (dziennik), nigdy z danych klienta.
--
-- IDEMPOTENTNA: ADD COLUMN IF NOT EXISTS, wiezy przez DROP IF EXISTS + ADD,
-- CREATE INDEX IF NOT EXISTS, DROP TRIGGER IF EXISTS + CREATE, DROP FUNCTION
-- IF EXISTS starej sygnatury dziennika, backfill tylko wierszy bez stanu.
--
-- Testy: scripts/events-harness/runtime_test.d/55_wallet_pass_revocation.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) KOLUMNY STANU OBIEKTU
-- ----------------------------------------------------------------------------
ALTER TABLE public.event_wallet_passes
  ADD COLUMN IF NOT EXISTS code_hash text,
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS revoke_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoke_reason text,
  ADD COLUMN IF NOT EXISTS revoke_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoke_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revoke_error text,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

ALTER TABLE public.event_wallet_passes
  DROP CONSTRAINT IF EXISTS event_wallet_passes_code_hash_shape,
  DROP CONSTRAINT IF EXISTS event_wallet_passes_content_hash_shape,
  DROP CONSTRAINT IF EXISTS event_wallet_passes_revoke_reason_values,
  DROP CONSTRAINT IF EXISTS event_wallet_passes_revoke_state,
  DROP CONSTRAINT IF EXISTS event_wallet_passes_revoke_google_only,
  DROP CONSTRAINT IF EXISTS event_wallet_passes_revoke_attempts_range,
  DROP CONSTRAINT IF EXISTS event_wallet_passes_revoke_error_len;

ALTER TABLE public.event_wallet_passes
  ADD CONSTRAINT event_wallet_passes_code_hash_shape
    CHECK (code_hash IS NULL OR code_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT event_wallet_passes_content_hash_shape
    CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT event_wallet_passes_revoke_reason_values
    CHECK (revoke_reason IS NULL
           OR revoke_reason IN ('registration_closed', 'code_changed', 'event_cancelled', 'replaced')),
  -- Powod jest zawsze razem ze zgloszeniem; dzierzawa i dezaktywacja tylko po
  -- zgloszeniu.
  ADD CONSTRAINT event_wallet_passes_revoke_state
    CHECK ((revoke_requested_at IS NULL) = (revoke_reason IS NULL)
           AND (revoked_at IS NULL OR revoke_requested_at IS NOT NULL)
           AND (revoke_claimed_at IS NULL OR revoke_requested_at IS NOT NULL)),
  ADD CONSTRAINT event_wallet_passes_revoke_google_only
    CHECK (platform = 'google' OR revoke_requested_at IS NULL),
  ADD CONSTRAINT event_wallet_passes_revoke_attempts_range
    CHECK (revoke_attempts >= 0),
  ADD CONSTRAINT event_wallet_passes_revoke_error_len
    CHECK (revoke_error IS NULL OR char_length(revoke_error) BETWEEN 1 AND 300);

COMMENT ON COLUMN public.event_wallet_passes.code_hash IS
  'SHA-256 (hex) kodu biletu, ktory niesie ten obiekt. NULL = obiekt sprzed 20261013111600, kodu nie da sie ustalic.';
COMMENT ON COLUMN public.event_wallet_passes.content_hash IS
  'SHA-256 (hex) tresci obiektu ostatnio zapisanej na platformie. Trasa pomija zapis, gdy tresc sie nie zmienila i obiekt jest aktywny. NULL = zapisz przy nastepnym dodaniu.';
COMMENT ON COLUMN public.event_wallet_passes.revoke_requested_at IS
  'Chwila zgloszenia dezaktywacji obiektu (trigger zgloszenia, wydarzenia albo dziennik przy zastapieniu). Tylko Google - przepustka Apple jest statyczna.';
COMMENT ON COLUMN public.event_wallet_passes.revoke_reason IS
  'registration_closed (zgloszenie nie daje przepustki), code_changed (nowy kod biletu), event_cancelled (wydarzenie odwolane), replaced (nowszy obiekt tego zgloszenia).';
COMMENT ON COLUMN public.event_wallet_passes.revoke_claimed_at IS
  'Dzierzawa zadania dezaktywacji i zarazem chwila ostatniej proby (podstawa wykladniczego odstepu ponowien).';
COMMENT ON COLUMN public.event_wallet_passes.revoke_attempts IS
  'Liczba zajec do dezaktywacji. Po 8 nieudanych probach wiersz zostaje z revoke_error i nie jest juz zajmowany.';
COMMENT ON COLUMN public.event_wallet_passes.revoke_error IS
  'Ostatni blad dezaktywacji (status HTTP albo rodzaj bledu, bez sekretow).';
COMMENT ON COLUMN public.event_wallet_passes.revoked_at IS
  'Obiekt nie jest juz wazny na platformie: ustawiony jako INACTIVE albo wygasly z validTimeInterval (wydarzenie zakonczone ponad dobe temu).';

-- ----------------------------------------------------------------------------
-- 2) JEDEN WIERSZ = JEDEN OBIEKT
-- ----------------------------------------------------------------------------
-- Dotad (najemca, zgloszenie, platforma). Istniejace dane sa unikalne takze
-- po obiekcie: identyfikator Apple to numer zgloszenia, a Google byl
-- `<wystawca>.reg_<zgloszenie>` - funkcja zgloszenia.
ALTER TABLE public.event_wallet_passes
  DROP CONSTRAINT IF EXISTS event_wallet_passes_registration_platform_unique;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.event_wallet_passes'::regclass
      AND conname = 'event_wallet_passes_object_unique'
  ) THEN
    ALTER TABLE public.event_wallet_passes
      ADD CONSTRAINT event_wallet_passes_object_unique UNIQUE (tenant_id, platform, object_id);
  END IF;
END $$;

-- Wyszukiwanie obiektow zgloszenia (trigger, dziennik) - dotad obslugiwal je
-- zdjety wiaz unikalnosci.
CREATE INDEX IF NOT EXISTS event_wallet_passes_registration_idx
  ON public.event_wallet_passes (tenant_id, registration_id, platform);

-- Kolejka dezaktywacji: wylacznie wiersze czekajace.
CREATE INDEX IF NOT EXISTS event_wallet_passes_revoke_queue_idx
  ON public.event_wallet_passes (revoke_requested_at, id)
  WHERE revoke_requested_at IS NOT NULL AND revoked_at IS NULL;

COMMENT ON TABLE public.event_wallet_passes IS
  'Obiekty Apple Wallet / Google Wallet wydane do zgloszen wydarzenia (jeden wiersz na obiekt platformy) i ich stan: kod, ostatnio zapisana tresc, dezaktywacja. Zapis wylacznie przez funkcje serwera (service_role) i triggery.';

-- ----------------------------------------------------------------------------
-- 3) BACKFILL OBIEKTOW SPRZED MIGRACJI
-- ----------------------------------------------------------------------------
-- Zgloszenie albo wydarzenie nie daje juz przepustki.
UPDATE public.event_wallet_passes w
   SET revoke_requested_at = now(),
       revoke_reason = CASE WHEN e.status = 'cancelled' THEN 'event_cancelled'
                            ELSE 'registration_closed' END
  FROM public.event_registrations r
  JOIN public.events e ON e.id = r.event_id AND e.tenant_id = r.tenant_id
 WHERE r.id = w.registration_id
   AND r.tenant_id = w.tenant_id
   AND w.platform = 'google'
   AND w.code_hash IS NULL
   AND w.revoke_requested_at IS NULL
   AND COALESCE(e.ends_at, e.starts_at) + interval '1 day' > now()
   AND NOT (r.qr_token_hash IS NOT NULL
            AND r.status IN ('approved', 'attended')
            AND r.payment_status IN ('paid', 'partially_refunded', 'not_required')
            AND e.status <> 'cancelled');

-- Kod wydany po ostatnim wydaniu przepustki - obiekt niesie stary kod.
UPDATE public.event_wallet_passes w
   SET revoke_requested_at = now(),
       revoke_reason = 'code_changed'
  FROM public.event_registrations r
  JOIN public.events e ON e.id = r.event_id AND e.tenant_id = r.tenant_id
 WHERE r.id = w.registration_id
   AND r.tenant_id = w.tenant_id
   AND w.platform = 'google'
   AND w.code_hash IS NULL
   AND w.revoke_requested_at IS NULL
   AND COALESCE(e.ends_at, e.starts_at) + interval '1 day' > now()
   AND r.qr_token_hash IS NOT NULL
   AND r.qr_issued_at IS NOT NULL
   AND r.qr_issued_at > w.last_issued_at;

-- Obiekt wydany po biezacym kodzie niesie biezacy kod (obie platformy - skrot
-- jest tez informacja dla administratora).
UPDATE public.event_wallet_passes w
   SET code_hash = r.qr_token_hash
  FROM public.event_registrations r
 WHERE r.id = w.registration_id
   AND r.tenant_id = w.tenant_id
   AND w.code_hash IS NULL
   AND w.revoke_requested_at IS NULL
   AND r.qr_token_hash IS NOT NULL
   AND r.qr_issued_at IS NOT NULL
   AND r.qr_issued_at <= w.last_issued_at;

-- ----------------------------------------------------------------------------
-- 4) TRIGGER ZGLOSZENIA: PRZEPUSTKA IDZIE ZA BILETEM
-- ----------------------------------------------------------------------------
-- Predykat waznosci jest lustrem filtra `event_ticket_wallet_payload`
-- (20260926160000): przyjete albo obecne, oplacone (takze po zwrocie
-- czesciowym) albo bezplatne, z kodem. Odwolanie wydarzenia obsluguje
-- trigger wydarzenia (sekcja 5).
--
-- Zmiana statusu miedzy stanami waznymi (approved -> attended przy wejsciu)
-- NIE dezaktywuje niczego: `code_changed` wymaga zmiany skrotu W TEJ
-- instrukcji, wiec obiekt sprzed migracji bez `code_hash` nie traci waznosci
-- na bramce.
CREATE OR REPLACE FUNCTION public._tg_event_registrations_wallet_revoke()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_valid boolean;
BEGIN
  v_valid := NEW.qr_token_hash IS NOT NULL
    AND NEW.status IN ('approved', 'attended')
    AND NEW.payment_status IN ('paid', 'partially_refunded', 'not_required');

  UPDATE public.event_wallet_passes w
     SET revoke_requested_at = now(),
         revoke_reason = CASE WHEN v_valid THEN 'code_changed' ELSE 'registration_closed' END,
         revoke_claimed_at = NULL,
         revoke_attempts = 0,
         revoke_error = NULL
   WHERE w.tenant_id = NEW.tenant_id
     AND w.registration_id = NEW.id
     AND w.platform = 'google'
     AND w.revoke_requested_at IS NULL
     AND (NOT v_valid
          OR (OLD.qr_token_hash IS DISTINCT FROM NEW.qr_token_hash
              AND w.code_hash IS DISTINCT FROM NEW.qr_token_hash));

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._tg_event_registrations_wallet_revoke() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._tg_event_registrations_wallet_revoke() IS
  'Zglasza dezaktywacje obiektow Google Wallet zgloszenia, gdy przestaje ono dawac przepustke (status, platnosc, wyczyszczony kod - registration_closed) albo gdy zmienia sie kod biletu (code_changed). Zmiana statusu miedzy stanami waznymi niczego nie rusza.';

DROP TRIGGER IF EXISTS event_registrations_zz_wallet_revoke ON public.event_registrations;
-- AFTER UPDATE z warunkiem WHEN, a nie `UPDATE OF kolumny`: lista kolumn
-- patrzy na liste SET instrukcji, wiec kod wyczyszczony przez trigger BEFORE
-- (np. `_tg_event_ticket_code_reset` przy zmianie statusu) albo przez przyszla
-- sciezke bez tych kolumn w SET umknalby. Ten sam wzorzec co
-- `event_registrations_zz_supersede_codes` (20261013110500).
CREATE TRIGGER event_registrations_zz_wallet_revoke
  AFTER UPDATE ON public.event_registrations
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status
        OR OLD.payment_status IS DISTINCT FROM NEW.payment_status
        OR OLD.qr_token_hash IS DISTINCT FROM NEW.qr_token_hash)
  EXECUTE FUNCTION public._tg_event_registrations_wallet_revoke();

-- ----------------------------------------------------------------------------
-- 5) TRIGGER WYDARZENIA: ODWOLANE WYDARZENIE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tg_events_wallet_revoke()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  UPDATE public.event_wallet_passes w
     SET revoke_requested_at = now(),
         revoke_reason = 'event_cancelled',
         revoke_claimed_at = NULL,
         revoke_attempts = 0,
         revoke_error = NULL
   WHERE w.tenant_id = NEW.tenant_id
     AND w.event_id = NEW.id
     AND w.platform = 'google'
     AND w.revoke_requested_at IS NULL;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._tg_events_wallet_revoke() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._tg_events_wallet_revoke() IS
  'Odwolanie wydarzenia zglasza dezaktywacje wszystkich jego obiektow Google Wallet (event_cancelled). Przywrocenie wydarzenia przed zajeciem kolejki zdejmuje zgloszenie w _event_wallet_pass_revocations_claim.';

DROP TRIGGER IF EXISTS events_zz_wallet_revoke ON public.events;
CREATE TRIGGER events_zz_wallet_revoke
  AFTER UPDATE ON public.events
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public._tg_events_wallet_revoke();

-- ----------------------------------------------------------------------------
-- 6) DZIENNIK WYDAN: NOWA SYGNATURA
-- ----------------------------------------------------------------------------
-- Cialo: 20260926160000 (`_event_wallet_pass_note`). Zmiany: skrot kodu
-- i skrot tresci (DEFAULT NULL - stare wywolanie czterema nazwanymi
-- argumentami nadal dziala), unikalnosc po obiekcie, blokada FOR SHARE na
-- zgloszeniu, czyszczenie stanu dezaktywacji, oznaczanie zastapionych
-- obiektow i natychmiastowa dezaktywacja obiektu, ktorego kod zdazyl sie
-- zmienic. Zwraca nadal licznik wydan obiektu.
DROP FUNCTION IF EXISTS public._event_wallet_pass_note(uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION public._event_wallet_pass_note(
  p_tenant uuid,
  p_registration_id uuid,
  p_platform text,
  p_object_id text,
  p_code_hash text DEFAULT NULL,
  p_content_hash text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_platform text := lower(btrim(COALESCE(p_platform, '')));
  v_object text := btrim(COALESCE(p_object_id, ''));
  v_code text := lower(NULLIF(btrim(COALESCE(p_code_hash, '')), ''));
  v_content text := lower(NULLIF(btrim(COALESCE(p_content_hash, '')), ''));
  v_event_id uuid;
  v_qr_hash text;
  v_valid boolean;
  v_event_cancelled boolean;
  v_stale text;
  v_id uuid;
  v_count integer;
BEGIN
  IF v_platform NOT IN ('apple', 'google') THEN
    RAISE EXCEPTION 'invalid_platform: %', v_platform USING ERRCODE = '22023';
  END IF;
  IF char_length(v_object) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid_object_id: object id must have 1-200 characters'
      USING ERRCODE = '22023';
  END IF;
  IF v_code IS NOT NULL AND v_code !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_hash: code hash must be 64 hex characters' USING ERRCODE = '22023';
  END IF;
  IF v_content IS NOT NULL AND v_content !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_hash: content hash must be 64 hex characters' USING ERRCODE = '22023';
  END IF;

  -- FOR SHARE szereguje dziennik ze zmiana zgloszenia: zmiana kodu albo
  -- statusu w toku czeka na zapis dziennika (i jej trigger widzi nowy wiersz),
  -- a dziennik wolany w trakcie zmiany czeka na nia i czyta stan po niej.
  SELECT r.event_id, r.qr_token_hash,
         (r.qr_token_hash IS NOT NULL
          AND r.status IN ('approved', 'attended')
          AND r.payment_status IN ('paid', 'partially_refunded', 'not_required')),
         e.status = 'cancelled'
    INTO v_event_id, v_qr_hash, v_valid, v_event_cancelled
    FROM public.event_registrations r
    JOIN public.events e ON e.id = r.event_id AND e.tenant_id = r.tenant_id
   WHERE r.id = p_registration_id AND r.tenant_id = p_tenant
     FOR SHARE OF r;
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'not_found: registration does not exist in this tenant';
  END IF;

  -- Obiekt Google, ktory przestal byc wazny, zanim dziennik go zobaczyl.
  IF v_platform = 'google' THEN
    v_stale := CASE
      WHEN v_event_cancelled THEN 'event_cancelled'
      WHEN NOT v_valid THEN 'registration_closed'
      WHEN v_code IS NOT NULL AND v_code <> v_qr_hash THEN 'code_changed'
    END;
  END IF;

  INSERT INTO public.event_wallet_passes AS w
    (tenant_id, event_id, registration_id, platform, object_id, code_hash, content_hash,
     revoke_requested_at, revoke_reason)
  VALUES
    (p_tenant, v_event_id, p_registration_id, v_platform, v_object, v_code,
     CASE WHEN v_platform = 'google' THEN v_content END,
     CASE WHEN v_stale IS NOT NULL THEN now() END, v_stale)
  ON CONFLICT (tenant_id, platform, object_id) DO UPDATE
    SET last_issued_at = now(),
        issue_count = w.issue_count + 1,
        code_hash = COALESCE(EXCLUDED.code_hash, w.code_hash),
        content_hash = EXCLUDED.content_hash,
        revoke_requested_at = EXCLUDED.revoke_requested_at,
        revoke_reason = EXCLUDED.revoke_reason,
        revoke_claimed_at = NULL,
        revoke_attempts = 0,
        revoke_error = NULL,
        revoked_at = NULL
    WHERE w.registration_id = EXCLUDED.registration_id
  RETURNING w.id, w.issue_count INTO v_id, v_count;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'object_conflict: object id belongs to another registration'
      USING ERRCODE = '23505';
  END IF;

  -- Jedna aktywna przepustka Google na zgloszenie: starsze obiekty (stary kod,
  -- obiekt sprzed migracji) ida do dezaktywacji.
  IF v_platform = 'google' THEN
    UPDATE public.event_wallet_passes o
       SET revoke_requested_at = now(),
           revoke_reason = 'replaced',
           revoke_claimed_at = NULL,
           revoke_attempts = 0,
           revoke_error = NULL
     WHERE o.tenant_id = p_tenant
       AND o.registration_id = p_registration_id
       AND o.platform = 'google'
       AND o.id <> v_id
       AND o.revoke_requested_at IS NULL;
  END IF;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public._event_wallet_pass_note(uuid, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_wallet_pass_note(uuid, uuid, text, text, text, text)
  TO service_role;

COMMENT ON FUNCTION public._event_wallet_pass_note(uuid, uuid, text, text, text, text) IS
  'Odnotowuje wydanie obiektu Wallet (upsert po najemcy, platformie i obiekcie; licznik i ostatnie wydanie), zapisuje skrot kodu i tresci, czysci stan dezaktywacji obiektu wydanego ponownie, starsze obiekty Google zgloszenia oznacza jako replaced, a obiekt, ktorego kod lub zgloszenie przestaly byc wazne przed zapisem, od razu zglasza do dezaktywacji. Wylacznie service_role: najemca przychodzi od serwera, ktory zautoryzowal kod biletu.';

-- ----------------------------------------------------------------------------
-- 7) STAN OBIEKTU DLA TRASY
-- ----------------------------------------------------------------------------
-- NULL = obiektu nie ma (trasa wstawia od razu, bez PATCH -> 404). `active`
-- = brak zgloszonej dezaktywacji; obiekt nieaktywny trasa zapisuje zawsze
-- (zapis przywraca ACTIVE, a dziennik czysci stan).
CREATE OR REPLACE FUNCTION public._event_wallet_pass_state(
  p_tenant uuid,
  p_platform text,
  p_object_id text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'content_hash', w.content_hash,
    'active', w.revoke_requested_at IS NULL AND w.revoked_at IS NULL
  )
  FROM public.event_wallet_passes w
  WHERE w.tenant_id = p_tenant
    AND w.platform = lower(btrim(COALESCE(p_platform, '')))
    AND w.object_id = btrim(COALESCE(p_object_id, ''));
$$;

REVOKE ALL ON FUNCTION public._event_wallet_pass_state(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_wallet_pass_state(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public._event_wallet_pass_state(uuid, text, text) IS
  'Stan obiektu Wallet dla trasy dodania: {content_hash, active} albo NULL, gdy obiektu nie ma. Trasa pomija zapis obiektu, gdy jest aktywny i jego tresc sie nie zmienila. Wylacznie service_role.';
