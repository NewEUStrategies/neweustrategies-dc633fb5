-- ============================================================================
-- `event_registration_set_channels`: SCIEZKA BEZ `extensions`, A WOLA pgcrypto.
--
-- events-harness: include
--
-- CO JEST ZLE (P1, GOSC BEZ KONTA)
--
-- Funkcja ma PRZYPIETA sciezke `SET search_path TO 'public', 'pg_temp'`
-- (migracja 20260828063423) i wola `digest(v_token, 'sha256')` BEZ
-- kwalifikatora schematu. Na Supabase `pgcrypto` mieszka w schemacie
-- `extensions` (instaluja je jawnie 20260805090000 i 20260805114407), a
-- PRZYPIETA sciezka NADPISUJE sesyjna - wiec nie pomaga nawet poprawnie
-- ustawiona sciezka wolajacego. Wywolanie pada z 42883
-- „function digest(text, unknown) does not exist".
--
-- KOGO TO DOTYKA. Galaz z `digest` obsluguje WYLACZNIE uczestnika BEZ KONTA:
-- to jedyna droga, ktora ma `manage_token` zamiast sesji. Zalogowany
-- przechodzi druga galezia i nie widzi problemu. Czyli: przelacznik „nie
-- pisz do mnie SMS-em" dziala dla zalogowanych i jest MARTWY dla gosci -
-- a to nie jest kosmetyka, tylko sterowanie zgodami na komunikacje.
--
-- DLACZEGO OSOBNA MIGRACJA, A NIE POPRAWKA W 20260828063423. Migracje sa
-- JEDNOKIERUNKOWE. Tamta jest juz wdrozona; edycja pliku nie zmienilaby stanu
-- bazy, a rozjechalaby rejestr z kodem.
--
-- CO ZLAPALO TEN BLAD. Kontrakt pgTAP `extensions_search_path_contract_test`
-- (asercja 1: „zadna funkcja nie wola pgcrypto bez kwalifikatora przy
-- search_path bez `extensions`"). Ta sama bramka powstala po tym, jak
-- `20260808110000` cofnela identyczna naprawe w `club_anonymity_salt` przez
-- `CREATE OR REPLACE` - i wtedy KAZDE utworzenie klubu konczylo sie bledem.
-- Ten wpis jest trzecim wystapieniem tej samej klasy usterki, wiec cialo
-- ponizej jest przepisane ZNAK W ZNAK z oryginalu - zmienia sie WYLACZNIE
-- linia `SET search_path`.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.event_registration_set_channels(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
-- JEDYNA ZMIANA W CALEJ FUNKCJI: `extensions` na sciezce, zeby `digest`
-- w ogole sie rozstrzygnal. `pg_temp` zostaje na koncu, tak jak bylo.
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_reg_id uuid := NULLIF(p_payload->>'registration_id','')::uuid;
  v_token text := NULLIF(btrim(COALESCE(p_payload->>'manage_token','')), '');
  v_hash text;
  v_email boolean;
  v_sms boolean;
  v_row public.event_registrations;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'invalid_tenant: unknown host';
  END IF;
  IF p_payload ? 'notify_email' THEN v_email := (p_payload->>'notify_email')::boolean; END IF;
  IF p_payload ? 'notify_sms' THEN v_sms := (p_payload->>'notify_sms')::boolean; END IF;
  IF v_email IS NULL AND v_sms IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: nothing to change';
  END IF;

  IF v_token IS NOT NULL THEN
    v_hash := encode(digest(v_token, 'sha256'), 'hex');
    SELECT r.* INTO v_row
    FROM public.event_registrations r
    WHERE r.tenant_id = v_tenant AND r.manage_token_hash = v_hash;
  ELSIF v_reg_id IS NOT NULL AND v_uid IS NOT NULL THEN
    SELECT r.* INTO v_row
    FROM public.event_registrations r
    JOIN public.event_people pe ON pe.id = r.person_id AND pe.tenant_id = r.tenant_id
    WHERE r.tenant_id = v_tenant AND r.id = v_reg_id AND pe.user_id = v_uid;
  ELSE
    RAISE EXCEPTION 'auth_required: registration_id with session or manage_token is required';
  END IF;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: registration does not exist';
  END IF;

  UPDATE public.event_registrations r
     SET notify_email = COALESCE(v_email, r.notify_email),
         notify_sms = COALESCE(v_sms, r.notify_sms),
         updated_at = now()
   WHERE r.id = v_row.id
   RETURNING r.* INTO v_row;

  RETURN jsonb_build_object(
    'registration_id', v_row.id,
    'notify_email', v_row.notify_email,
    'notify_sms', v_row.notify_sms
  );
END;
$$;
COMMENT ON FUNCTION public.event_registration_set_channels(jsonb) IS
  'Kanaly powiadomien pojedynczego zgloszenia: identyfikator zalogowanego wlasciciela albo manage_token goscia. Sciezka niesie `extensions`, bo galaz goscia hashuje token przez pgcrypto.';

REVOKE ALL ON FUNCTION public.event_registration_set_channels(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_registration_set_channels(jsonb) TO anon, authenticated, service_role;
