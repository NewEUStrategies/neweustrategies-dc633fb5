-- events-harness: include
-- ============================================================================
-- ZAPISY NA WYDARZENIA - PRZEGLAD R67: WYCOFANIE SMS/E-MAIL ZAWSZE MOZLIWE,
-- ZGODA ZWIAZANA Z FAKTYCZNYM ADRESEM SMS, ZGODA NA NUMER, KTORY POKAZANO
-- (REG-10, REG-17).
--
-- DEFEKT
--   1. `event_registration_set_channels` (cialo 20261012131100:133-277) kluczem
--      samoobslugi odmawial KAZDEJ zmiany na zgloszeniu zamknietym
--      (`already_closed`) i po koncu wydarzenia (`manage_expired`) - takze
--      WYLACZENIA. Gosc bez konta, ktory wlaczyl SMS kluczem i zrezygnowal
--      z oplaconego zgloszenia, nie mial jak wycofac zgody, a SMS o zwrocie
--      (`readChannels` czyta tylko notify_sms i stempel) nadal wychodzil.
--      Tekst zgody obiecuje: „Zgode wycofasz, wylaczajac SMS".
--   2. Trigger `event_people_phone_revokes_sms` (20261012131100:119-125)
--      porownywal SAME CYFRY numeru. `normalizePhone`
--      (src/lib/notify/sms.server.ts) zamienia goly numer 9-cyfrowy na +48,
--      wiec '+601234567' -> '601234567' zmienia ADRESATA SMS-a (z +601234567
--      na +48601234567, inny abonent), a cyfry - i zgoda - zostaja.
--   3. TOCTOU zgody: okno zgody pokazuje trzy ostatnie cyfry numeru
--      (`phone_hint` z `event_registration_preferences`), a set_channels
--      stemplowal zgode dla numeru, jaki osoba ma w chwili zapisu. Rownolegla
--      zmiana numeru (wlasciciel, organizator) miedzy oknem a „Zgadzam sie"
--      dawala zgode na numer, ktorego uczestnik nie widzial.
--
-- ZMIANA
--   A. `_event_phone_sms_destination(text)` - lustro `normalizePhone` w SQL
--      (bez spacji, myslnikow i nawiasow; 00 -> +; goly numer 9-cyfrowy ->
--      +48; inaczej NULL - na taki numer SMS i tak nie wyjdzie).
--   B. Trigger: zgoda znika, gdy zmienia sie ZNORMALIZOWANY adresat. Gdy po
--      obu stronach adresata nie ma (numer, na ktory nie da sie wyslac),
--      decyduja cyfry - jak dotad, wiec regula nie jest slabsza od starej.
--      Warunek WHEN to juz tylko `OLD.phone IS DISTINCT FROM NEW.phone`
--      (operator wbudowany); normalizacje liczy funkcja triggera (SECURITY
--      DEFINER), wiec pomocnik nie potrzebuje grantow dla rol klienta.
--   C. `event_registration_set_channels`:
--      * klucz z werdyktem `closed` albo `expired` przechodzi dla zadania,
--        ktore WYLACZNIE wylacza: kazdy obecny przelacznik = false i brak
--        `sms_consent: true`. Kazde wlaczenie (takze „true" bez zmiany) nadal
--        dostaje already_closed / manage_expired;
--      * nowy, opcjonalny klucz `phone_hint` (napis albo null) - podpowiedz,
--        ktora pokazalo okno zgody. Przy wlaczaniu SMS niezgodnosc z biezaca
--        podpowiedzia (trzy ostatnie cyfry, ta sama regula co
--        `event_registration_preferences`) -> `phone_changed`. Brak klucza
--        (stary front) - bez porownania;
--      * numer przy wlaczaniu czytany z blokada wiersza osoby (FOR SHARE
--        NOWAIT): zmiana numeru W LOCIE (niezacommitowana) dawala dotad
--        zgode na stary numer, a trigger zmiany - uruchomiony przed stemplem -
--        nie mial czego zdjac. Teraz wiersz w trakcie zmiany -> `phone_changed`
--        (bez czekania, wiec bez zakleszczenia z triggerem, ktory blokuje
--        osobe przed zgloszeniem); zmiana po stemplu czeka na commit zgody
--        i trigger ja zdejmuje.
--
-- CZEGO TO NIE ZAMYKA. Podpowiedz ma trzy cyfry: zmiana numeru z tym samym
-- koncem miedzy oknem a zgoda przechodzi porownanie. Rownolegla zmiana
-- INNEJ kolumny osoby w chwili zgody daje falszywe `phone_changed`
-- (ponowienie pomaga). Nie ma weryfikacji wlasnosci numeru (OTP). Wycofanie
-- po kluczu nie zmienia `remind_email` (glowny przelacznik notify_email
-- wystarcza - przypomnienia go czytaja).
--
-- KOLEJNOSC WDROZENIA: dowolna. Stary front nie wysyla `phone_hint` (brak
-- porownania) i nie oferuje wycofania na zamknietym zgloszeniu (dostaje
-- teraz sukces zamiast odmowy). Nowy front na starej bazie: wycofanie na
-- zamknietym/wygaslym kluczu dostaje dotychczasowa odmowe (zdanie z mapy
-- `channelErrorKey`), `phone_hint` jest ignorowany.
-- IDEMPOTENTNA: CREATE OR REPLACE, DROP TRIGGER IF EXISTS + CREATE,
-- bezstanowe REVOKE/GRANT, COMMENT ON.
-- DOWOD: supabase/tests/event_sms_scanner_r67_test.sql,
-- scripts/events-harness/runtime_test.d/16_sms_consent_reminder_gates.sql
-- (sekcja R67), 17_sms_consent_phone_race.sql (dwie sesje: zmiana numeru
-- w locie i po zgodzie).
-- ============================================================================

-- A) ADRESAT SMS-A - LUSTRO `normalizePhone` --------------------------------------
-- Ta sama regula co src/lib/notify/sms.server.ts:normalizePhone. Klasa
-- `[[:space:]\u00a0...\ufeff]` to `\s` z JS: biale znaki ASCII i jawnie
-- wyliczone unikodowe (twarda spacja, waskie spacje, separatory linii, BOM) -
-- `[[:space:]]` sam zalezy od lokalizacji bazy. Cyfry tylko ASCII, jak `\d`.
-- LOCKS: none.
CREATE OR REPLACE FUNCTION public._event_phone_sms_destination(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN v = '' THEN NULL
    WHEN v ~ '^\+[1-9][0-9]{7,14}$' THEN v
    WHEN v ~ '^00[1-9][0-9]{7,14}$' THEN '+' || substr(v, 3)
    WHEN v ~ '^[0-9]{9}$' THEN '+48' || v
    ELSE NULL
  END
  FROM (SELECT regexp_replace(
                 COALESCE(p_phone, ''),
                 '[[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff()-]',
                 '', 'g') AS v) s;
$$;

REVOKE ALL ON FUNCTION public._event_phone_sms_destination(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_phone_sms_destination(text) TO service_role;

COMMENT ON FUNCTION public._event_phone_sms_destination(text) IS
  'R67 (REG-10): adresat SMS-a w E.164 - lustro normalizePhone (src/lib/notify/sms.server.ts): bez spacji, myslnikow i nawiasow; +E.164 bez zmian; 00 -> +; goly numer 9-cyfrowy -> +48; inaczej NULL. Pomocnicza triggera event_people_phone_revokes_sms.';

-- B) ZGODA ZWIAZANA Z ADRESATEM ------------------------------------------------------
-- Cialo z 20261012131100:95-112. ZMIANA 20261012 (R67, REG-10): warunek
-- przeniesiony z WHEN (porownanie cyfr) do ciala (porownanie adresata).
-- LOCKS: event_registrations (UPDATE zgloszen osoby).
CREATE OR REPLACE FUNCTION public._tg_event_people_phone_revokes_sms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_dest text := public._event_phone_sms_destination(OLD.phone);
  v_new_dest text := public._event_phone_sms_destination(NEW.phone);
BEGIN
  -- Ten sam adresat (sama zmiana formatu, '0048…' -> '+48…') zgode zostawia.
  -- Bez adresata po obu stronach decyduja cyfry, jak przed ta zmiana.
  IF v_old_dest IS NOT DISTINCT FROM v_new_dest
     AND (v_old_dest IS NOT NULL
          OR regexp_replace(COALESCE(OLD.phone, ''), '[^0-9]', '', 'g')
             = regexp_replace(COALESCE(NEW.phone, ''), '[^0-9]', '', 'g')) THEN
    RETURN NULL;
  END IF;

  UPDATE public.event_registrations r
     SET notify_sms = false,
         remind_sms = false,
         remind_sms_consent_at = NULL,
         remind_sms_consent_via = NULL
   WHERE r.tenant_id = NEW.tenant_id
     AND r.person_id = NEW.id
     AND (r.notify_sms OR r.remind_sms OR r.remind_sms_consent_at IS NOT NULL);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._tg_event_people_phone_revokes_sms() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._tg_event_people_phone_revokes_sms() IS
  'REG-10 (D12, przeglad R67): zmiana ADRESATA SMS-a osoby (_event_phone_sms_destination, lustro normalizePhone; bez adresata po obu stronach - zmiana cyfr) zdejmuje zgode na SMS (notify_sms, remind_sms, stempel) na wszystkich jej zgloszeniach w najemcy. Trigger event_people_phone_revokes_sms.';

DROP TRIGGER IF EXISTS event_people_phone_revokes_sms ON public.event_people;
CREATE TRIGGER event_people_phone_revokes_sms
  AFTER UPDATE OF phone ON public.event_people
  FOR EACH ROW
  WHEN (OLD.phone IS DISTINCT FROM NEW.phone)
  EXECUTE FUNCTION public._tg_event_people_phone_revokes_sms();

-- C) PISARZ PREFERENCJI ----------------------------------------------------------------
-- Cialo z 20261012131100:133-277. Zmiany (ZMIANA 20261012, przeglad R67):
-- wycofanie po kluczu zamknietym/wygaslym, `phone_hint` przy wlaczaniu SMS,
-- blokada wiersza osoby przy odczycie numeru.
-- LOCKS: event_registrations (FOR UPDATE OF r jednego zgloszenia), przy
-- wlaczaniu SMS event_people (FOR SHARE NOWAIT osoby zgloszenia - bez
-- czekania, wiec odwrotna kolejnosc triggera numeru nie zakleszcza).
CREATE OR REPLACE FUNCTION public.event_registration_set_channels(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
-- `extensions` zostaje (kontrakt extensions_search_path_contract_test), choc
-- hash klucza liczy teraz resolver.
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_token text;
  v_reg_id uuid;
  v_key_id uuid;
  v_key_verdict text;
  v_via text;
  v_key text;
  v_notify_email boolean;
  v_notify_sms boolean;
  v_remind_email boolean;
  v_remind_push boolean;
  v_remind_sms boolean;
  v_remind_sessions boolean;
  v_consent boolean;
  v_enabling_sms boolean;
  v_withdraw_only boolean;
  v_hint_sent boolean;
  v_hint text;
  v_phone_digits text;
  v_row public.event_registrations;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'invalid_tenant: unknown host';
  END IF;
  IF jsonb_typeof(v_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_payload: payload must be an object';
  END IF;

  -- ZMIANA 20261012: kazdy obecny przelacznik MUSI byc boolean JSON. Stare
  -- `::boolean` na tekscie przyjmowalo 'true'/'t'/'1' i rzucalo 22P02 na
  -- reszte - zgoda na SMS nie moze zalezec od tego, jak klient zapisal napis.
  FOREACH v_key IN ARRAY ARRAY[
    'notify_email', 'notify_sms', 'remind_email', 'remind_push',
    'remind_sms', 'remind_sessions', 'sms_consent'
  ] LOOP
    IF v_payload ? v_key AND jsonb_typeof(v_payload->v_key) <> 'boolean' THEN
      RAISE EXCEPTION 'invalid_payload: % must be boolean', v_key;
    END IF;
  END LOOP;

  -- ZMIANA 20261012 (R67): podpowiedz numeru, ktora pokazalo okno zgody -
  -- napis albo jawny null („okno nie pokazalo cyfr"). Brak klucza = stary
  -- front, bez porownania.
  v_hint_sent := v_payload ? 'phone_hint';
  IF v_hint_sent AND jsonb_typeof(v_payload->'phone_hint') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION 'invalid_payload: phone_hint must be a string';
  END IF;
  v_hint := v_payload->>'phone_hint';

  v_notify_email := (v_payload->'notify_email')::boolean;
  v_notify_sms := (v_payload->'notify_sms')::boolean;
  v_remind_email := (v_payload->'remind_email')::boolean;
  v_remind_push := (v_payload->'remind_push')::boolean;
  v_remind_sms := (v_payload->'remind_sms')::boolean;
  v_remind_sessions := (v_payload->'remind_sessions')::boolean;
  v_consent := (v_payload->'sms_consent')::boolean;

  -- Sama zgoda niczego nie zmienia - to dodatek do wlaczenia SMS.
  IF v_notify_email IS NULL AND v_notify_sms IS NULL AND v_remind_email IS NULL
     AND v_remind_push IS NULL AND v_remind_sms IS NULL AND v_remind_sessions IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: nothing to change';
  END IF;

  -- ZMIANA 20261012 (R67, REG-10/REG-17): zadanie, ktore TYLKO wylacza -
  -- kazdy obecny przelacznik false i bez zgody. „true" bez zmiany stanu to
  -- tez nie wycofanie: regula nie zalezy od tego, co akurat jest w wierszu.
  v_withdraw_only := v_notify_email IS NOT TRUE AND v_notify_sms IS NOT TRUE
    AND v_remind_email IS NOT TRUE AND v_remind_push IS NOT TRUE
    AND v_remind_sms IS NOT TRUE AND v_remind_sessions IS NOT TRUE
    AND v_consent IS NOT TRUE;

  v_token := NULLIF(btrim(COALESCE(v_payload->>'manage_token', '')), '');
  v_reg_id := CASE
    WHEN COALESCE(v_payload->>'registration_id', '') ~ '^[0-9a-fA-F-]{36}$'
      THEN (v_payload->>'registration_id')::uuid
    ELSE NULL
  END;

  IF v_token IS NOT NULL THEN
    -- ZMIANA 20261012 (REG-17): klucz przez jedna regule A1 (cel 'act').
    SELECT k.registration_id, k.verdict INTO v_key_id, v_key_verdict
      FROM public._event_manage_token_resolve(v_tenant, v_token, 'act') k;
    -- ZMIANA 20261012 (R67): wycofanie zgody jest mozliwe ZAWSZE - takze po
    -- rezygnacji i po koncu wydarzenia (zwrot po anulowaniu nadal wysyla
    -- SMS, a tekst zgody obiecuje wycofanie przelacznikiem). Kazde wlaczenie
    -- dostaje dotychczasowa odmowe.
    IF v_key_verdict IN ('expired', 'closed') AND v_withdraw_only THEN
      NULL;
    ELSIF v_key_verdict = 'expired' THEN
      RAISE EXCEPTION 'manage_expired: this management link expired when the event ended';
    ELSIF v_key_verdict = 'closed' THEN
      RAISE EXCEPTION 'already_closed: this registration is already closed';
    ELSIF v_key_verdict IS DISTINCT FROM 'ok' THEN
      RAISE EXCEPTION 'not_found: registration does not exist';
    END IF;

    SELECT r.* INTO v_row
      FROM public.event_registrations r
     WHERE r.tenant_id = v_tenant AND r.id = v_key_id
     FOR UPDATE OF r;
    v_via := 'token';
  ELSIF v_reg_id IS NOT NULL AND v_uid IS NOT NULL THEN
    SELECT r.* INTO v_row
      FROM public.event_registrations r
      JOIN public.event_people pe ON pe.id = r.person_id AND pe.tenant_id = r.tenant_id
     WHERE r.tenant_id = v_tenant AND r.id = v_reg_id AND pe.user_id = v_uid
     FOR UPDATE OF r;
    v_via := 'account';
  ELSE
    RAISE EXCEPTION 'auth_required: registration_id with session or manage_token is required';
  END IF;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: registration does not exist';
  END IF;

  -- ZMIANA 20261012 (REG-10, D12): SMS tylko za jawna zgoda NA TEN numer.
  -- Kazde przejscie false -> true pyta od nowa - zgoda nie wraca sama po
  -- wylaczeniu ani po zmianie numeru (trigger zdejmuje stempel).
  v_enabling_sms := (v_notify_sms IS TRUE AND NOT v_row.notify_sms)
                 OR (v_remind_sms IS TRUE AND NOT v_row.remind_sms);
  IF v_enabling_sms THEN
    IF v_consent IS NOT TRUE THEN
      RAISE EXCEPTION 'sms_consent_required: enabling SMS needs explicit consent';
    END IF;
    -- ZMIANA 20261012 (R67): numer czytany z blokada wiersza osoby. Zmiana
    -- numeru zacommitowana PO zgodzie czeka na nia, a jej trigger zdejmuje
    -- stempel; zmiana W LOCIE (wiersz zablokowany) to numer, ktorego okno nie
    -- pokazalo - odmowa bez czekania (NOWAIT: trigger numeru blokuje osobe,
    -- potem zgloszenie, czyli odwrotnie niz ta funkcja).
    BEGIN
      SELECT regexp_replace(pe.phone, '[^0-9]', '', 'g') INTO v_phone_digits
        FROM public.event_people pe
       WHERE pe.tenant_id = v_tenant
         AND pe.id = v_row.person_id
         AND NULLIF(btrim(COALESCE(pe.phone, '')), '') IS NOT NULL
         FOR SHARE OF pe NOWAIT;
    EXCEPTION WHEN lock_not_available THEN
      RAISE EXCEPTION 'phone_changed: the phone number changed since the consent was shown';
    END;
    IF v_phone_digits IS NULL THEN
      RAISE EXCEPTION 'phone_required: registration has no phone number';
    END IF;
    -- ZMIANA 20261012 (R67): zgoda dotyczy numeru, ktory POKAZALO okno -
    -- ta sama podpowiedz co `event_registration_preferences` (trzy ostatnie
    -- cyfry, krocej - brak podpowiedzi).
    IF v_hint_sent AND v_hint IS DISTINCT FROM
       (CASE WHEN char_length(v_phone_digits) >= 3 THEN right(v_phone_digits, 3) END) THEN
      RAISE EXCEPTION 'phone_changed: the phone number changed since the consent was shown';
    END IF;
  END IF;

  UPDATE public.event_registrations r
     SET notify_email = COALESCE(v_notify_email, r.notify_email),
         notify_sms = COALESCE(v_notify_sms, r.notify_sms),
         remind_email = COALESCE(v_remind_email, r.remind_email),
         remind_push = COALESCE(v_remind_push, r.remind_push),
         remind_sms = COALESCE(v_remind_sms, r.remind_sms),
         remind_sessions = COALESCE(v_remind_sessions, r.remind_sessions),
         remind_sms_consent_at = CASE WHEN v_enabling_sms THEN now() ELSE r.remind_sms_consent_at END,
         remind_sms_consent_via = CASE WHEN v_enabling_sms THEN v_via ELSE r.remind_sms_consent_via END,
         updated_at = now()
   WHERE r.id = v_row.id AND r.tenant_id = v_tenant
   RETURNING r.* INTO v_row;

  RETURN jsonb_build_object(
    'registration_id', v_row.id,
    'notify_email', v_row.notify_email,
    'notify_sms', v_row.notify_sms,
    'remind_email', v_row.remind_email,
    'remind_push', v_row.remind_push,
    'remind_sms', v_row.remind_sms,
    'remind_sessions', v_row.remind_sessions,
    'sms_consent_at', v_row.remind_sms_consent_at,
    'sms_consent_via', v_row.remind_sms_consent_via
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_registration_set_channels(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_registration_set_channels(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_registration_set_channels(jsonb) IS
  'Kanaly i przypomnienia JEDNEGO zgloszenia: zalogowany wlasciciel (registration_id + auth.uid()) albo klucz samoobslugi (resolver, cel act). Klucz zamkniety (already_closed) albo po koncu wydarzenia (manage_expired) przyjmuje WYLACZNIE wycofanie: kazdy obecny przelacznik false, bez sms_consent (przeglad R67). Klucze notify_email, notify_sms, remind_email, remind_push, remind_sms, remind_sessions, sms_consent - tylko boolean JSON; phone_hint (napis albo null) - podpowiedz z okna zgody. REG-10: wlaczenie SMS wymaga sms_consent = true i numeru (sms_consent_required / phone_required), przy phone_hint niezgodnym z biezacym numerem phone_changed; stempluje zgode. Sciezka z `extensions` (kontrakt pgcrypto).';
