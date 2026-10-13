-- events-harness: include
-- ============================================================================
-- ZAPISY NA WYDARZENIA - REG-09 / REG-10: SMS TYLKO ZA JAWNA ZGODA NA TYM
-- ZGLOSZENIU, ZGODA ZWIAZANA Z NUMEREM, PRZELACZNIKI PRZYPOMNIEN MAJA PISARZA.
--
-- DEFEKT
--   1. REG-10. `event_registrations.notify_sms` ma DEFAULT true
--      (20260828063423:4), a zgody na SMS nikt nigdy nie zbieral: kazde
--      zgloszenie z numerem bylo „zgodne" na SMS o platnosci i awansie.
--      Stempel zgody `remind_sms_consent_at/_via` (20260926153100:105-129)
--      istnieje, ale chroni tylko `remind_sms`, ktorego nikt nie potrafi
--      wlaczyc.
--   2. REG-09. Jedyny pisarz preferencji, `event_registration_set_channels`
--      (cialo 20260830100000:35-98, sciezka 20260830102000), zna tylko
--      `notify_email`/`notify_sms` (:80-85): `remind_*` nie maja pisarza, a
--      galaz SMS przypomnien jest martwa. Wartosci rzutowane `::boolean`
--      przyjmuja napisy ('yes' -> 22P02, 'true' -> true). Klucz samoobslugi
--      liczy hash sam, bez wygasniecia i bez zamkniecia (REG-17, A1).
--   3. Zmiana numeru telefonu nie dotyka zgody: zgoda udzielona dla jednego
--      numeru jechala na kazdy nastepny.
--
-- ZMIANA
--   A. `notify_sms` DEFAULT false; backfill false wszedzie, gdzie nie ma
--      stempla zgody; CHECK `event_registrations_notify_sms_consented`
--      (notify_sms wymaga stempla). Stempel `remind_sms_consent_at/_via` to
--      odtad JEDNA zgoda zgloszenia na SMS transakcyjne i przypomnienia.
--   B. Trigger `event_people_phone_revokes_sms`: zmiana CYFR numeru osoby
--      zdejmuje notify_sms, remind_sms i stempel na wszystkich jej
--      zgloszeniach - niezaleznie od tego, kto pisze numer (zapis, panel,
--      profil wydarzenia). Zmiana samego formatu ('600 100 200' ->
--      '600-100-200') zgode zostawia.
--   C. `event_registration_set_channels` (ta sama sygnatura i granty):
--      klucze notify_email, notify_sms, remind_email, remind_push, remind_sms,
--      remind_sessions, sms_consent - kazdy obecny MUSI byc boolean JSON;
--      klucz samoobslugi przez `_event_manage_token_resolve(..., 'act')`
--      (wygasly -> manage_expired, zamkniete -> already_closed, brak ->
--      not_found), sciezka konta bez zmian; wlaczenie SMS (notify_sms albo
--      remind_sms false -> true) wymaga `sms_consent: true` i numeru, stempluje
--      zgode (via 'token' albo 'account'). Wylaczenie zostawia stempel jako
--      slad ostatniej zgody; ponowne wlaczenie znow pyta o zgode.
--   D. NOWA `event_registration_preferences` - odczyt preferencji jednego
--      zgloszenia dla karty przypomnien (ta sama tozsamosc; klucz przez
--      resolver, cel 'view'; odmowy WARTOSCIA jak
--      `event_registration_cancel_preview`). Numer nigdy nie wychodzi - tylko
--      trzy ostatnie cyfry (`phone_hint`).
--
-- CZEGO TO NIE ZAMYKA. Zgoda nie ma wersji tekstu ani historii (wycofanie
-- widac tylko jako przelaczniki off). Klucz zgloszenia goscia grupy trzyma
-- czesto prowadzacy - zgoda przez 'token' moze wtedy pochodzic od niego.
-- Ustawienie organizatora `reminder_sms_enabled = false` nie odrzuca opt-in
-- uczestnika: jest bramka w chwili wysylki (`_event_reminder_candidates`).
-- Backfill podbija `updated_at` zgloszen z notify_sms = true (trigger touch).
--
-- KOLEJNOSC WDROZENIA: NAJPIERW KOD. Nowy front wysyla `sms_consent` przy
-- wlaczaniu SMS (stara baza go ignoruje) i czyta preferencje przez
-- `event_registration_preferences` (przy PGRST202/42883 karta przypomnien
-- mowi, ze preferencje sa chwilowo niedostepne). Stary front na nowej bazie:
-- wlaczenie SMS dostaje `sms_consent_required` - zamierzone, bo to jedyny
-- dowod zgody w bazie.
-- IDEMPOTENTNA: ALTER COLUMN SET DEFAULT, UPDATE z warunkiem, DROP CONSTRAINT
-- IF EXISTS + ADD, DROP TRIGGER IF EXISTS + CREATE, CREATE OR REPLACE,
-- bezstanowe REVOKE/GRANT, COMMENT ON.
-- DOWOD: supabase/tests/event_registration_sms_consent_test.sql,
-- scripts/events-harness/runtime_test.d/16_sms_consent_reminder_gates.sql.
-- ============================================================================

-- A) JEDNA ZGODA NA SMS, DOMYSLNIE BRAK -------------------------------------------
ALTER TABLE public.event_registrations ALTER COLUMN notify_sms SET DEFAULT false;

-- Zgody nikt nigdy nie zbieral, wiec „true" bez stempla to tylko DEFAULT.
UPDATE public.event_registrations
   SET notify_sms = false
 WHERE notify_sms
   AND remind_sms_consent_at IS NULL;

ALTER TABLE public.event_registrations
  DROP CONSTRAINT IF EXISTS event_registrations_notify_sms_consented;
ALTER TABLE public.event_registrations
  ADD CONSTRAINT event_registrations_notify_sms_consented
  CHECK (NOT notify_sms OR remind_sms_consent_at IS NOT NULL);

COMMENT ON COLUMN public.event_registrations.notify_sms IS
  'REG-10 (D12): glowny przelacznik kanalu SMS zgloszenia (platnosc, awans, przypomnienia). Domyslnie false; true wymaga stempla zgody remind_sms_consent_at (CHECK event_registrations_notify_sms_consented). Wlacza tylko event_registration_set_channels z sms_consent; zmiana numeru osoby go zdejmuje.';
COMMENT ON COLUMN public.event_registrations.notify_email IS
  'REG-09 (D12): glowny przelacznik kanalu e-mail zgloszenia - obejmuje takze przypomnienia (remind_email jest podprzelacznikiem).';
COMMENT ON COLUMN public.event_registrations.remind_sms IS
  'REG-09 (D12): podprzelacznik przypomnien SMS. Przypomnienie wychodzi tylko przy notify_sms AND remind_sms AND stemplu zgody (CHECK event_registrations_remind_sms_consented). Wlacza tylko event_registration_set_channels z sms_consent.';
COMMENT ON COLUMN public.event_registrations.remind_sms_consent_at IS
  'REG-10 (D12): chwila JAWNEJ zgody uczestnika na SMS-y o tym zgloszeniu (transakcyjne i przypomnienia). Stempluje event_registration_set_channels przy kazdym wlaczeniu SMS; kasuje trigger event_people_phone_revokes_sms przy zmianie numeru.';
COMMENT ON COLUMN public.event_registrations.remind_sms_consent_via IS
  'REG-10 (D12): droga zgody na SMS - account (zalogowany wlasciciel) albo token (klucz samoobslugi z maila).';

-- B) ZGODA ZWIAZANA Z NUMEREM ------------------------------------------------------
-- LOCKS: event_registrations (UPDATE zgloszen osoby).
CREATE OR REPLACE FUNCTION public._tg_event_people_phone_revokes_sms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
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
  'REG-10 (D12): zmiana cyfr numeru osoby zdejmuje zgode na SMS (notify_sms, remind_sms, stempel) na wszystkich jej zgloszeniach w najemcy. Trigger event_people_phone_revokes_sms.';

DROP TRIGGER IF EXISTS event_people_phone_revokes_sms ON public.event_people;
CREATE TRIGGER event_people_phone_revokes_sms
  AFTER UPDATE OF phone ON public.event_people
  FOR EACH ROW
  WHEN (regexp_replace(COALESCE(OLD.phone, ''), '[^0-9]', '', 'g')
        IS DISTINCT FROM regexp_replace(COALESCE(NEW.phone, ''), '[^0-9]', '', 'g'))
  EXECUTE FUNCTION public._tg_event_people_phone_revokes_sms();

-- C) PISARZ PREFERENCJI --------------------------------------------------------------
-- Cialo z 20260830100000:35-98 (search_path z 20260830102000). Zmiany
-- (ZMIANA 20261012, REG-09/REG-10/REG-17): klucze remind_* i sms_consent,
-- scisle typy, klucz przez resolver, zgoda i numer przy wlaczaniu SMS,
-- blokada wiersza.
-- LOCKS: event_registrations (FOR UPDATE OF r jednego zgloszenia).
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
    IF v_key_verdict = 'expired' THEN
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
    IF NOT EXISTS (
      SELECT 1 FROM public.event_people pe
       WHERE pe.tenant_id = v_tenant
         AND pe.id = v_row.person_id
         AND NULLIF(btrim(COALESCE(pe.phone, '')), '') IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'phone_required: registration has no phone number';
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
  'Kanaly i przypomnienia JEDNEGO zgloszenia: zalogowany wlasciciel (registration_id + auth.uid()) albo klucz samoobslugi (resolver, cel act: manage_expired po koncu wydarzenia, already_closed po zamknieciu). Klucze notify_email, notify_sms, remind_email, remind_push, remind_sms, remind_sessions, sms_consent - tylko boolean JSON. REG-10: wlaczenie SMS wymaga sms_consent = true i numeru (sms_consent_required / phone_required) i stempluje zgode. Sciezka z `extensions` (kontrakt pgcrypto).';

-- D) ODCZYT PREFERENCJI -------------------------------------------------------------
-- Ta sama tozsamosc co pisarz (cel klucza 'view': podglad dziala takze po
-- zamknieciu zgloszenia, po koncu wydarzenia - nie). Odmowa WARTOSCIA, jak
-- `event_registration_cancel_preview`: nieznany, cudzy i obcego najemcy to
-- ten sam `not_found`.
-- LOCKS: none (read only).
CREATE OR REPLACE FUNCTION public.event_registration_preferences(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
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
  v_row record;
  v_digits text;
  v_settings public.event_participant_settings;
BEGIN
  IF v_tenant IS NULL OR jsonb_typeof(v_payload) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  v_token := NULLIF(btrim(COALESCE(v_payload->>'manage_token', '')), '');
  v_reg_id := CASE
    WHEN COALESCE(v_payload->>'registration_id', '') ~ '^[0-9a-fA-F-]{36}$'
      THEN (v_payload->>'registration_id')::uuid
    ELSE NULL
  END;

  IF v_token IS NOT NULL THEN
    SELECT k.registration_id, k.verdict INTO v_key_id, v_key_verdict
      FROM public._event_manage_token_resolve(v_tenant, v_token, 'view') k;
    IF v_key_verdict = 'expired' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'expired');
    ELSIF v_key_verdict IS DISTINCT FROM 'ok' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;
    v_reg_id := v_key_id;
  ELSIF v_reg_id IS NULL OR v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT r.id, r.event_id, r.status, r.notify_email, r.notify_sms, r.remind_email,
         r.remind_push, r.remind_sms, r.remind_sessions, r.remind_sms_consent_at,
         r.remind_sms_consent_via, e.slug AS event_slug, pe.user_id, pe.phone
    INTO v_row
    FROM public.event_registrations r
    JOIN public.event_people pe ON pe.id = r.person_id AND pe.tenant_id = r.tenant_id
    JOIN public.events e ON e.id = r.event_id AND e.tenant_id = r.tenant_id
   WHERE r.tenant_id = v_tenant
     AND r.id = v_reg_id
     -- Bez klucza dowodem jest konto dowiazane do osoby (D1).
     AND (v_token IS NOT NULL OR pe.user_id = v_uid);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  v_settings := public._event_participant_settings_effective(v_tenant, v_row.event_id);
  -- Numer nie wychodzi nigdy: tylko trzy ostatnie cyfry do zdania o zgodzie.
  v_digits := regexp_replace(COALESCE(v_row.phone, ''), '[^0-9]', '', 'g');

  RETURN jsonb_build_object(
    'ok', true,
    'registration_id', v_row.id,
    'event_id', v_row.event_id,
    'event_slug', v_row.event_slug,
    'status', v_row.status,
    'notify_email', v_row.notify_email,
    'notify_sms', v_row.notify_sms,
    'remind_email', v_row.remind_email,
    'remind_push', v_row.remind_push,
    'remind_sms', v_row.remind_sms,
    'remind_sessions', v_row.remind_sessions,
    'sms_consent_at', v_row.remind_sms_consent_at,
    'sms_consent_via', v_row.remind_sms_consent_via,
    'has_account', v_row.user_id IS NOT NULL,
    'has_phone', NULLIF(btrim(COALESCE(v_row.phone, '')), '') IS NOT NULL,
    'phone_hint', CASE WHEN char_length(v_digits) >= 3 THEN right(v_digits, 3) END,
    'reminders_enabled', COALESCE(v_settings.reminders_enabled, false),
    'reminder_sms_enabled', COALESCE(v_settings.reminder_sms_enabled, false),
    'session_reminders_enabled', COALESCE(v_settings.session_reminders_enabled, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_registration_preferences(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_registration_preferences(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_registration_preferences(jsonb) IS
  'REG-09/REG-10: preferencje kanalow i przypomnien JEDNEGO zgloszenia dla karty przypomnien - zalogowany wlasciciel (registration_id + auth.uid()) albo klucz samoobslugi (resolver, cel view). {ok:false, reason not_found|expired} albo {ok:true, registration_id, event_id, event_slug, status, notify_*, remind_*, sms_consent_at, sms_consent_via, has_account, has_phone, phone_hint (3 ostatnie cyfry, nigdy numer), reminders_enabled, reminder_sms_enabled, session_reminders_enabled}. Najemca z hosta.';
