-- events-harness: include
-- ============================================================================
-- ZAPISY NA WYDARZENIA - FUNDAMENTY NAPRAWY REG-01..REG-17 (A1):
-- WIAZANIE KONTA TYLKO PRZEZ POTWIERDZONY ADRES, JEDNA REGULA KLUCZA
-- SAMOOBSLUGI, DANE DO MAILA PO NAJEMCY Z SERWERA I MIGAWKA CENY ZGLOSZENIA.
--
-- PO CO TA MIGRACJA. Kolejne migracje serii 20261012* przepisuja zapis,
-- zaproszenia, rezygnacje, klucz samoobslugi i konsumentow ceny. Wszystkie
-- stoja na tych samych czterech regulach - i kazda z nich musi istniec RAZ:
-- dwie kopie reguly to rozjazd przy pierwszej poprawce jednej z nich. Ta
-- migracja stawia WYLACZNIE te reguly (funkcje pomocnicze, jedna funkcje
-- serwerowa i trzy kolumny). Nie zmienia ciala zadnej istniejacej funkcji.
--
-- DEFEKT
--   1. REG-01. `event_register` (20261007140400:507-516) wiaze konto
--      wolajacego z osoba o adresie z LADUNKU - bez porownania
--      z `auth.users.email` i bez `email_confirmed_at`. Kazde konto moglo
--      przejac kartoteke osoby (panel uczestnika, rezygnacje, platnosci),
--      podajac jej adres w formularzu.
--   2. REG-17. Klucz samoobslugi (`manage_token`) nie wygasa i nie zna
--      statusu: `event_registration_notify_payload` (20260825223802:87-160,
--      GRANT anon) oddaje adres, imie i NAZWISKO takze dla zgloszenia
--      anulowanego i wydarzenia sprzed roku. Najemca idzie tam
--      z `public_tenant_id()`, czyli z naglowka hosta, ktorego klient
--      z kluczem serwisowym nie niesie (trafilby zawsze w najemce domyslnego).
--   3. REG-16. `event_registrations` nie pamieta ceny z chwili zapisu:
--      odpowiedz zapisu liczy cene teraz (early bird), a panel samoobslugi
--      i kasa - cene z chwili otwarcia (standard). Na granicy early birda
--      uczestnik widzi dwie rozne kwoty za to samo zgloszenie.
--   4. `_require_server_identity` (20261007120600:86) wymaga konta, wiec
--      sciezka serwerowa BEZ konta (zapis goscia) nie ma wspolnej walidacji
--      najemcy i solonego skrotu adresu.
--
-- ZMIANA
--   A. `_event_uid_owns_email(konto, adres)` - konto ma POTWIERDZONY ten adres
--      (decyzja D1). `_event_bind_uid_for_email(najemca, konto, adres)` -
--      JEDYNA droga zapisu `event_people.user_id`: konto z potwierdzonym
--      adresem osoby, ktore nie jest juz dowiazane do INNEJ osoby najemcy.
--   B. `_require_server_probe(najemca, adres)` - odpowiednik
--      `_require_server_identity` dla sciezki bez konta.
--   C. `_event_manage_token_resolve(najemca, klucz, cel)` - jedna regula
--      klucza: ksztalt, najemca, wygasniecie z efektywnym koncem wydarzenia
--      (`_event_effective_end`), zamkniecie po anulowaniu/odrzuceniu dla
--      kazdego celu poza podgladem statusu.
--   D. `event_registration_notify_payload_for_tenant(_tenant_id, p_payload)` -
--      cialo `event_registration_notify_payload` z 20260825223802 z najemca
--      z ARGUMENTU, kluczem przez resolver (cel 'contact') i BEZ kluczy
--      `decision_note` i `last_name`. Tylko `service_role`.
--   E. `quoted_price_cents/quoted_currency/quote_valid_until` + CHECK
--      ksztaltu, `_event_registration_quote_ttl()` (72 h)
--      i `_event_registration_unit_price(zgloszenie, bilet)` - jedna regula
--      ceny zgloszenia: LEAST(oferta, cena biezaca), dopoki oferta wazna
--      i waluta zgodna, inaczej cena biezaca (decyzja D8).
--
-- CZEGO TO NIE ZAMYKA. Sama ta migracja nie zmienia zachowania zadnej
-- istniejacej sciezki: `event_register`, `event_package_invite_accept`,
-- funkcje klucza samoobslugi i konsumenci ceny przechodza na te reguly
-- w kolejnych migracjach serii. Stary `event_registration_notify_payload`
-- zostaje anonimowy, dopoki nie zmieni go jego wlasciciel (wrapper + REVOKE).
-- Istniejace zgloszenia nie dostaja migawki ceny - brak backfillu oznacza
-- dotychczasowe zachowanie (cena biezaca), a nie wymyslona oferte.
--
-- KOLEJNOSC WDROZENIA: dowolna. Zaden kod TS nie wola jeszcze nowych funkcji,
-- a kolumny sa NULL-owalne bez wartosci domyslnej (zmiana samego katalogu,
-- bez przepisywania tabeli). Harness wydarzen musi miec
-- `auth.users.email_confirmed_at` PRZED replayem
-- (scripts/events-harness/harness.sql): funkcje LANGUAGE sql sa walidowane
-- przy CREATE.
--
-- IDEMPOTENTNA: CREATE OR REPLACE, ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT
-- IF EXISTS + ADD, bezstanowe REVOKE/GRANT, COMMENT ON.
-- DOWOD: supabase/tests/reg_foundations_test.sql,
-- scripts/events-harness/runtime_test.d/22_reg_foundations.sql.
-- ============================================================================

-- A) KONTO MA POTWIERDZONY TEN ADRES ------------------------------------------
-- Jedynym dowodem, ze wolajacy kontroluje skrzynke, jest `email_confirmed_at`
-- konta, ktorego adres jest TYM adresem. Adres z ladunku to deklaracja, wiec
-- obie strony porownania przechodza te sama normalizacje co
-- `event_people.email_norm` (lower + btrim, pusty = brak).
--
-- Celowo tylko `email_confirmed_at`: konto anonimowe nie ma adresu, a konto
-- bez potwierdzenia nie dostaje od GoTrue sesji przy wlaczonym potwierdzaniu
-- adresu - warunek wstepny wdrozenia opisany w raporcie REG.
--
-- Wynik to zawsze `true`/`false`, nigdy NULL: wolajacy pisza `IF NOT ...`,
-- a NULL przepuszczalby ich po cichu. SECURITY DEFINER, bo `auth.users` nie
-- jest czytelna dla rol klienta - i dlatego funkcja nie ma grantu klienta.
CREATE OR REPLACE FUNCTION public._event_uid_owns_email(p_uid uuid, p_email text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p_uid IS NOT NULL
     AND NULLIF(lower(btrim(p_email)), '') IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM auth.users u
        WHERE u.id = p_uid
          AND u.email_confirmed_at IS NOT NULL
          AND NULLIF(lower(btrim(u.email)), '') = NULLIF(lower(btrim(p_email)), '')
     );
$$;
REVOKE ALL ON FUNCTION public._event_uid_owns_email(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_uid_owns_email(uuid, text) TO service_role;

COMMENT ON FUNCTION public._event_uid_owns_email(uuid, text) IS
  'REG-01 (D1): true wtedy i tylko wtedy, gdy konto ma POTWIERDZONY (auth.users.email_confirmed_at) adres rowny podanemu po lower+btrim. Brak konta, adresu lub potwierdzenia -> false (nigdy NULL). Pomocnicza: tylko service_role i funkcje SECURITY DEFINER.';

-- Konto -> osoba najemcy. JEDYNA droga zapisu `event_people.user_id`
-- (inwariant D1; wyjatek: jawne, logowane przywrocenie przez administratora).
-- Zwraca konto, gdy:
--   * najemca jest znany,
--   * konto ma potwierdzony adres osoby (`_event_uid_owns_email`),
--   * konto nie jest juz dowiazane do INNEJ osoby tego najemcy (inny
--     `email_norm`). Dowiazanie do tej samej osoby to nie konflikt - zapis
--     `user_id = COALESCE(p.user_id, wynik)` jest wtedy no-opem.
-- Inaczej NULL: wolajacy wstawia/aktualizuje osobe BEZ dowiazania, zamiast
-- wpasc na 23505 z `event_people_tenant_user_uniq`.
CREATE OR REPLACE FUNCTION public._event_bind_uid_for_email(p_tenant uuid, p_uid uuid, p_email_norm text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p_uid
   WHERE p_tenant IS NOT NULL
     AND public._event_uid_owns_email(p_uid, p_email_norm)
     AND NOT EXISTS (
       SELECT 1
         FROM public.event_people p2
        WHERE p2.tenant_id = p_tenant
          AND p2.user_id = p_uid
          AND p2.email_norm IS DISTINCT FROM NULLIF(lower(btrim(p_email_norm)), '')
     );
$$;
REVOKE ALL ON FUNCTION public._event_bind_uid_for_email(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_bind_uid_for_email(uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public._event_bind_uid_for_email(uuid, uuid, text) IS
  'REG-01 (D1): konto do zapisania w event_people.user_id albo NULL. Konto wraca tylko przy potwierdzonym adresie osoby i gdy nie jest dowiazane do innej osoby najemcy. Kazdy zapis event_people.user_id przechodzi przez te funkcje. Pomocnicza: tylko service_role i funkcje SECURITY DEFINER.';

-- B) SCIEZKA SERWEROWA BEZ KONTA ---------------------------------------------------
-- `_require_server_identity` wymaga konta, a zapis goscia go nie ma. Ta sama
-- walidacja bez konta: najemca z zaufanego hosta i SOLONY skrot adresu
-- (`requestRateSubject`), nigdy surowy adres. Brak ktoregos to blad
-- wolajacego (serwera), nie odpowiedz dla klienta - stad wyjatek, ktory nie
-- zjada zadnego kubelka.
CREATE OR REPLACE FUNCTION public._require_server_probe(p_tenant uuid, p_probe_subject text)
RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_tenant IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: tenant is required';
  END IF;
  IF p_probe_subject IS NULL OR p_probe_subject !~ '^ip:[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'invalid_payload: probe subject must be a salted address hash';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._require_server_probe(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._require_server_probe(uuid, text) TO service_role;

COMMENT ON FUNCTION public._require_server_probe(uuid, text) IS
  'Walidacja argumentow tozsamosci sciezki serwerowej BEZ konta: najemca wymagany, adres w ksztalcie ^ip:[0-9a-f]{32}$ (solony skrot z requestRateSubject). Inaczej invalid_payload. Odpowiednik _require_server_identity bez konta.';

-- C) JEDNA REGULA KLUCZA SAMOOBSLUGI ---------------------------------------------
-- Kazda funkcja przyjmujaca `manage_token` pyta TU, zamiast liczyc hash
-- i warunki u siebie. Zawsze DOKLADNIE jeden wiersz (registration_id, verdict):
--   * 'not_found' - pusty najemca, klucz w zlym ksztalcie (bez liczenia hasha:
--     nie ma czego porownywac) albo brak zgloszenia z tym kluczem u TEGO
--     najemcy; registration_id NULL, wiec obcy najemca nie odroznia sie od
--     nieistniejacego klucza;
--   * 'expired'   - `now() >= _event_effective_end(starts_at, ends_at)`. Ta sama
--     granica, od ktorej otwiera sie ankieta (COALESCE(ends, starts + 24 h)),
--     bez okresu laski. Przelozenie wydarzenia na pozniej przywraca waznosc -
--     zamierzone, bo klucz sluzy do udzialu w TYM wydarzeniu;
--   * 'closed'    - zgloszenie anulowane albo odrzucone, a cel inny niz
--     'view'. Podglad statusu po anulowaniu zostaje (link z maila pokazuje
--     „anulowane" zamiast „nie znaleziono"), ale klucz nie otwiera juz zadnej
--     akcji ani danych kontaktowych;
--   * 'ok'.
-- Kolejnosc: wygasniecie przed zamknieciem - po koncu wydarzenia klucz nie
-- dziala dla zadnego celu, wiec 'expired' jest odpowiedzia pelniejsza.
--
-- Cel spoza listy to blad PROGRAMISTY (stala w ciele wolajacego), nie dane
-- klienta - dlatego wyjatek z istniejacym kodem `invalid_payload`, a nie nowy
-- kod wymagajacy tlumaczenia, ktorego zaden uczestnik nigdy nie zobaczy.
-- STABLE: wolajacy, ktory pisze, blokuje wiersz sam (`FOR UPDATE` po id).
CREATE OR REPLACE FUNCTION public._event_manage_token_resolve(_tenant uuid, _token text, _purpose text)
RETURNS TABLE (registration_id uuid, verdict text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_token text := btrim(COALESCE(_token, ''));
  v_reg record;
BEGIN
  IF _purpose IS NULL OR _purpose NOT IN ('view', 'act', 'contact') THEN
    RAISE EXCEPTION 'invalid_payload: manage token purpose must be view, act or contact';
  END IF;

  -- 24 bajty base64url z `_event_new_qr_token()` - zawsze 32 znaki.
  IF _tenant IS NULL OR v_token !~ '^[A-Za-z0-9_-]{32}$' THEN
    registration_id := NULL;
    verdict := 'not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT r.id, r.status, e.starts_at, e.ends_at
    INTO v_reg
    FROM public.event_registrations r
    JOIN public.events e
      ON e.id = r.event_id AND e.tenant_id = r.tenant_id
   WHERE r.tenant_id = _tenant
     AND r.manage_token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex');

  IF NOT FOUND THEN
    registration_id := NULL;
    verdict := 'not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  registration_id := v_reg.id;
  IF now() >= public._event_effective_end(v_reg.starts_at, v_reg.ends_at) THEN
    verdict := 'expired';
  ELSIF _purpose <> 'view' AND v_reg.status IN ('cancelled', 'rejected') THEN
    verdict := 'closed';
  ELSE
    verdict := 'ok';
  END IF;
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public._event_manage_token_resolve(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_manage_token_resolve(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public._event_manage_token_resolve(uuid, text, text) IS
  'REG-17: jedna regula klucza samoobslugi (manage_token). Cel view|act|contact (inny -> invalid_payload). Zawsze jeden wiersz: not_found (zly ksztalt bez hashowania, obcy najemca, brak klucza), expired (now() >= _event_effective_end), closed (cancelled/rejected i cel inny niz view), ok. Tylko service_role i funkcje SECURITY DEFINER.';

-- D) DANE DO MAILA PO KLUCZU, NAJEMCA Z SERWERA ----------------------------------
-- Cialo `event_registration_notify_payload` z 20260825223802:87-160. Zmiany:
--   * najemca z ARGUMENTU. Serwer zna go z zaufanego hosta
--     (`resolveTenantIdForHost`), a klient z kluczem serwisowym nie niesie
--     naglowka hosta, wiec `public_tenant_id()` dalby najemce domyslnego;
--   * klucz przez `_event_manage_token_resolve(..., 'contact')`: po koncu
--     wydarzenia `manage_expired`, po anulowaniu/odrzuceniu `not_found` - adres
--     i imie nie wychodza juz dla zgloszenia, ktorego nie ma po co potwierdzac;
--   * bez `decision_note` (notatka wewnetrzna organizatora, decyzja D10 - i tak
--     bylo tu zawsze NULL) i bez `last_name` (minimalizacja: zaden konsument TS
--     nie czyta nazwiska z tego ladunku - registrationSelfNotify,
--     groupTicketCodes, registrationNotify.server).
-- Tylko `service_role`: wola go funkcja serwerowa, nigdy przegladarka.
CREATE OR REPLACE FUNCTION public.event_registration_notify_payload_for_tenant(_tenant_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_manage text := NULLIF(btrim(COALESCE(p_payload->>'manage_token', '')), '');
  v_key record;
  v_out jsonb;
BEGIN
  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: tenant is required';
  END IF;
  IF v_manage IS NULL THEN
    RAISE EXCEPTION 'invalid_request: manage_token is required';
  END IF;

  SELECT k.registration_id, k.verdict
    INTO v_key
    FROM public._event_manage_token_resolve(_tenant_id, v_manage, 'contact') k;

  IF v_key.verdict = 'expired' THEN
    RAISE EXCEPTION 'manage_expired: this management link expired when the event ended';
  ELSIF v_key.verdict IS DISTINCT FROM 'ok' THEN
    -- 'closed' i 'not_found' celowo tym samym kodem: zamkniete zgloszenie nie
    -- oddaje danych kontaktowych i nie potwierdza, ze klucz kiedys dzialal.
    RAISE EXCEPTION 'not_found: registration does not exist';
  END IF;

  SELECT jsonb_build_object(
    'registration_id', r.id,
    'tenant_id', r.tenant_id,
    'status', r.status,
    'waitlist_position', r.waitlist_position,
    'email', p.email,
    'first_name', p.first_name,
    'lang', COALESCE(
      CASE
        WHEN lower(NULLIF(pr.prefs->>'language', '')) IN ('pl', 'en')
          THEN lower(pr.prefs->>'language')
        WHEN lower(NULLIF(pr.prefs->>'lang', '')) IN ('pl', 'en')
          THEN lower(pr.prefs->>'lang')
        ELSE NULL
      END,
      (
        SELECT lower(ns.language)
        FROM public.newsletter_subscribers ns
        WHERE ns.tenant_id = r.tenant_id
          AND lower(ns.email) = lower(p.email)
          AND lower(ns.language) IN ('pl', 'en')
        LIMIT 1
      ),
      'pl'
    ),
    'event_id', e.id,
    'event_slug', e.slug,
    'event_title_pl', e.title_pl,
    'event_title_en', e.title_en,
    'event_starts_at', e.starts_at,
    'event_timezone', e.timezone,
    'event_location', e.location,
    'ticket_name_pl', tt.name_pl,
    'ticket_name_en', tt.name_en
  )
  INTO v_out
  FROM public.event_registrations r
  JOIN public.event_people p
    ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  JOIN public.events e
    ON e.id = r.event_id AND e.tenant_id = r.tenant_id
  LEFT JOIN public.profiles pr
    ON pr.id = p.user_id AND pr.tenant_id = r.tenant_id
  LEFT JOIN public.event_ticket_types tt
    ON tt.id = r.ticket_type_id AND tt.tenant_id = r.tenant_id
  WHERE r.tenant_id = _tenant_id
    AND r.id = v_key.registration_id;

  IF v_out IS NULL THEN
    RAISE EXCEPTION 'not_found: registration does not exist';
  END IF;

  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.event_registration_notify_payload_for_tenant(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_registration_notify_payload_for_tenant(uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public.event_registration_notify_payload_for_tenant(uuid, jsonb) IS
  'REG-17: dane WLASNEGO zgloszenia do maila po kluczu manage_token, najemca z argumentu (serwer: zaufany host). Klucz przez _event_manage_token_resolve(contact): po koncu wydarzenia manage_expired, po anulowaniu/odrzuceniu not_found. Bez decision_note i last_name. Tylko service_role.';

-- E) MIGAWKA CENY ZGLOSZENIA ------------------------------------------------------
-- Zgloszenie nieoplacone pamieta cene z chwili zapisu. Zapisuje ja rdzen
-- zapisu (osobna migracja serii); tu tylko kolumny, ksztalt i jedna regula
-- odczytu. Bez backfillu: istniejace zgloszenia nie mialy oferty, wiec
-- dostaja cene biezaca - dokladnie jak dotad.
ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS quoted_price_cents integer,
  ADD COLUMN IF NOT EXISTS quoted_currency text,
  ADD COLUMN IF NOT EXISTS quote_valid_until timestamptz;

-- Oferta jest cala albo jej nie ma. Kazda kolumna ma jawne IS NOT NULL:
-- `quoted_price_cents >= 0` dla NULL daje NULL, a CHECK przepuszcza NULL - bez
-- tego (NULL, 'PLN', termin) przechodzilby jako „oferta" bez ceny.
ALTER TABLE public.event_registrations
  DROP CONSTRAINT IF EXISTS event_registrations_quote_shape;
ALTER TABLE public.event_registrations
  ADD CONSTRAINT event_registrations_quote_shape CHECK (
    (quoted_price_cents IS NULL AND quoted_currency IS NULL AND quote_valid_until IS NULL)
    OR (
      quoted_price_cents IS NOT NULL AND quoted_price_cents >= 0
      AND quoted_currency IS NOT NULL AND quoted_currency IN ('PLN', 'EUR')
      AND quote_valid_until IS NOT NULL
    )
  );

COMMENT ON COLUMN public.event_registrations.quoted_price_cents IS
  'REG-16: cena jednostkowa biletu z chwili zapisu (grosze/centy) dla zgloszenia nieoplaconego. Odczyt wylacznie przez _event_registration_unit_price.';
COMMENT ON COLUMN public.event_registrations.quoted_currency IS
  'REG-16: waluta oferty (PLN|EUR). Oferta w innej walucie niz biezaca waluta biletu nie obowiazuje.';
COMMENT ON COLUMN public.event_registrations.quote_valid_until IS
  'REG-16: koniec waznosci oferty (zapis + _event_registration_quote_ttl(), nie dalej niz starts_at). Po nim obowiazuje cena biezaca.';
COMMENT ON CONSTRAINT event_registrations_quote_shape ON public.event_registrations IS
  'REG-16: oferta cala (cena >= 0, waluta PLN|EUR, termin) albo zadna - nigdy czesciowa.';

-- Czas waznosci oferty. Stala w funkcji, nie w ciele kazdego wolajacego:
-- zmiana polityki to jedna linia. 72 h to dosc na przelew i decyzje
-- w firmie, a za malo, zeby oferta early bird trzymala sie tygodniami.
CREATE OR REPLACE FUNCTION public._event_registration_quote_ttl()
RETURNS interval
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $$
  SELECT interval '72 hours';
$$;
REVOKE ALL ON FUNCTION public._event_registration_quote_ttl() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_registration_quote_ttl() TO service_role;

COMMENT ON FUNCTION public._event_registration_quote_ttl() IS
  'REG-16 (D8): czas waznosci oferty cenowej zgloszenia (72 h; wolajacy przycina do starts_at). Pomocnicza: tylko service_role i funkcje SECURITY DEFINER.';

-- Cena jednostkowa zgloszenia - JEDNA regula dla odpowiedzi zapisu, panelu
-- samoobslugi, kontekstu platnosci, kasy, listy „moje zgloszenia" i faktury:
--   * oferta obowiazuje, gdy jest, `now() <= quote_valid_until` i jej waluta
--     jest biezaca waluta biletu - wtedy LEAST(oferta, cena biezaca): obnizka
--     ceny po zapisie przechodzi na uczestnika, podwyzka (koniec early birda)
--     nie;
--   * inaczej cena biezaca (`_event_ticket_price_now`), a bez biletu 0.
-- `quote_valid_until` w wyniku tylko przy zrodle 'quote' - przy cenie
-- biezacej nie ma czego gwarantowac. Bez SECURITY DEFINER: czyta wylacznie
-- argumenty i funkcje ceny. Status platnosci rozstrzyga wolajacy (zgloszenie
-- oplacone ma kwote z zamowienia, nie z tej funkcji).
CREATE OR REPLACE FUNCTION public._event_registration_unit_price(
  p_reg public.event_registrations,
  p_ticket public.event_ticket_types
)
RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  WITH price AS (
    SELECT
      CASE
        WHEN (p_ticket).id IS NULL THEN 0
        ELSE COALESCE(public._event_ticket_price_now(
          (p_ticket).price_cents,
          (p_ticket).early_bird_price_cents,
          (p_ticket).early_bird_until,
          (p_ticket).price_schedule), 0)
      END AS current_cents,
      COALESCE(
        (p_reg).quoted_price_cents IS NOT NULL
        AND (p_reg).quote_valid_until IS NOT NULL
        AND now() <= (p_reg).quote_valid_until
        AND (p_reg).quoted_currency IS NOT NULL
        AND (p_reg).quoted_currency = (p_ticket).currency,
        false) AS quote_live
  )
  SELECT jsonb_build_object(
    'amount_cents', CASE WHEN quote_live
                         THEN LEAST((p_reg).quoted_price_cents, current_cents)
                         ELSE current_cents END,
    'source', CASE WHEN quote_live THEN 'quote' ELSE 'current' END,
    'quote_valid_until', CASE WHEN quote_live THEN (p_reg).quote_valid_until END
  )
  FROM price;
$$;
REVOKE ALL ON FUNCTION public._event_registration_unit_price(public.event_registrations, public.event_ticket_types)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_registration_unit_price(public.event_registrations, public.event_ticket_types)
  TO service_role;

COMMENT ON FUNCTION public._event_registration_unit_price(public.event_registrations, public.event_ticket_types) IS
  'REG-16 (D8): cena jednostkowa zgloszenia {amount_cents, source quote|current, quote_valid_until}. quote = LEAST(oferta, cena biezaca), gdy oferta niepusta, now() <= quote_valid_until i waluta oferty = waluta biletu; inaczej cena biezaca (_event_ticket_price_now), bez biletu 0. Jedyna regula ceny nieoplaconego zgloszenia. Pomocnicza: tylko service_role i funkcje SECURITY DEFINER.';