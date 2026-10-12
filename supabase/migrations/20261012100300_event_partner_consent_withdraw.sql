-- events-harness: include
-- ============================================================================
-- WYDARZENIA: WYCOFANIE ZGODY NA PRZEKAZANIE DANYCH PARTNEROM JEST TAK SAMO
-- LATWE JAK JEJ UDZIELENIE (OPS-01, art. 7 ust. 3 RODO).
--
-- PROBLEM. Zgode partnerska uczestnik zaznacza jednym kliknieciem w formularzu
-- zapisu. Wycofac jej nie mial jak: strona samoobslugi zgloszenia
-- (`/events/<slug>/manage?token=...`) umiala tylko odwolac udzial, a panel
-- organizatora nie mial zadnej akcji na zgodzie - prosba mailowa konczyla sie
-- reczna zmiana w bazie albo niczym.
--
-- ZMIANA:
--   A. `event_registration_manage_view(jsonb)` - cialo z 20260830090000
--      z jednym nowym kluczem `partner_consent` (bool, skuteczna zgoda na TO
--      wydarzenie wg `_event_partner_consent_at`). Sama flaga - bez dat i bez
--      danych osoby, jak reszta tej odpowiedzi.
--   B. `event_registration_partner_consent_withdraw(jsonb)` - samoobsluga.
--      Te same drogi dostepu co `event_registration_cancel`: `manage_token`
--      (porownanie po skrocie) albo `registration_id` WLASCICIELA konta.
--      Najemca z `public_tenant_id()`, nigdy z ladunku. Dziala na KAZDYM
--      zgloszeniu tej osoby na to wydarzenie (zgoda dotyczy wydarzenia,
--      a czytelnicy czytaja najnowsze zgloszenie) i takze po odwolaniu udzialu
--      - lead zebrany wczesniej nadal lezy u sponsora. Stempluje
--      `consent_partner_withdrawn_at = now()`; stempla nadania NIE kasuje
--      (dowod potrzebuje obu dat). Powtorzenie jest bezpieczne
--      (`withdrawn = false`, nic sie nie zmienia).
--   C. `admin_event_registration_partner_consent_withdraw(uuid)` - ta sama
--      operacja z panelu organizatora (prosba uczestnika innym kanalem).
--      Bramka `assert_editor_tenant()`, wpis `audit_log` z aktorem - przy
--      wycofaniu w czyims imieniu trzeba umiec wskazac, kto je wpisal.
-- Wycofanie dziala WSTECZ: lista urzadzenia stoiskowego, link sponsora
-- i eksport czytaja zgode przy kazdym odczycie, wiec juz zebrany lead traci
-- dane osoby od nastepnego odczytu.
--
-- GRANTY: A i B - anon, authenticated, service_role (jak `event_registration_
-- cancel`: gosc bez konta ma tylko klucz z maila); C - authenticated
-- i service_role, bramka roli w ciele.
--
-- IDEMPOTENTNA: CREATE OR REPLACE.
-- DOWOD: scripts/events-harness/runtime_test.d/33_partner_consent_per_registration.sql.
-- ============================================================================

-- A) STAN ZGLOSZENIA NA STRONIE SAMOOBSLUGI ------------------------------------
-- Cialo z 20260830090000 z JEDNA zmiana (oznaczona).
CREATE OR REPLACE FUNCTION public.event_registration_manage_view(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_token text := NULLIF(btrim(COALESCE(p_payload->>'manage_token', '')), '');
  v_reg_id uuid := CASE
    WHEN COALESCE(p_payload->>'registration_id', '') ~ '^[0-9a-fA-F-]{36}$'
      THEN (p_payload->>'registration_id')::uuid
    ELSE NULL
  END;
  v_reg public.event_registrations;
  v_ticket public.event_ticket_types;
  v_event public.events;
  v_price integer := 0;
  v_owned boolean := false;
BEGIN
  IF v_tenant IS NULL OR (v_token IS NULL AND v_reg_id IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_token IS NOT NULL THEN
    SELECT r.* INTO v_reg
    FROM public.event_registrations r
    WHERE r.tenant_id = v_tenant
      AND r.manage_token_hash = encode(digest(v_token, 'sha256'), 'hex');
  ELSE
    IF v_uid IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;
    SELECT r.* INTO v_reg
    FROM public.event_registrations r
    LEFT JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
    WHERE r.id = v_reg_id
      AND r.tenant_id = v_tenant
      AND (r.created_by = v_uid OR p.user_id = v_uid);
  END IF;

  IF v_reg.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT * INTO v_event FROM public.events e
  WHERE e.id = v_reg.event_id AND e.tenant_id = v_tenant;

  IF v_reg.ticket_type_id IS NOT NULL THEN
    SELECT * INTO v_ticket FROM public.event_ticket_types t
    WHERE t.id = v_reg.ticket_type_id AND t.tenant_id = v_tenant;
    v_price := COALESCE(public._event_ticket_price_now(
      v_ticket.price_cents, v_ticket.early_bird_price_cents,
      v_ticket.early_bird_until, v_ticket.price_schedule), 0);
  END IF;

  -- Czy TEN zalogowany uzytkownik jest wlascicielem zgloszenia. Front pyta
  -- o to, zeby wiedziec, czy pokazac przycisk „Zaplac", czy zdanie
  -- „platna wejsciowka nalezy do konta - zaloguj sie na nie".
  v_owned := v_uid IS NOT NULL AND (
    v_reg.created_by = v_uid
    OR EXISTS (SELECT 1 FROM public.event_people p
               WHERE p.id = v_reg.person_id AND p.tenant_id = v_tenant AND p.user_id = v_uid)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'registration_id', v_reg.id,
    'event_id', v_reg.event_id,
    'event_slug', v_event.slug,
    'ticket_type_id', v_reg.ticket_type_id,
    'status', v_reg.status,
    'payment_status', v_reg.payment_status,
    'waitlist_position', v_reg.waitlist_position,
    'amount_cents', v_price,
    'currency', v_ticket.currency,
    'owned_by_caller', v_owned,
    -- ZMIANA 20261012100300: czy zgoda na przekazanie danych partnerom TEGO
    -- wydarzenia jest skuteczna - decyduje o przycisku jej wycofania. Sama
    -- flaga, bez dat i bez danych osoby.
    'partner_consent', public._event_partner_consent_at(v_tenant, v_reg.event_id, v_reg.person_id) IS NOT NULL
  );
END;
$$;

COMMENT ON FUNCTION public.event_registration_manage_view(jsonb) IS
  'Stan wlasnego zgloszenia pod kluczem manage_token (gosc) albo pod identyfikatorem (wlasciciel konta). Oddaje MINIMUM potrzebne stronie samoobslugi: status, os pieniedzy, kwote, to, czy zalogowany jest wlascicielem, i flage skutecznej zgody partnerskiej na to wydarzenie. Zadnych danych osobowych.';

REVOKE ALL ON FUNCTION public.event_registration_manage_view(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_registration_manage_view(jsonb) TO anon, authenticated, service_role;

-- B) WYCOFANIE ZGODY PRZEZ UCZESTNIKA ----------------------------------------
CREATE OR REPLACE FUNCTION public.event_registration_partner_consent_withdraw(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_manage text := NULLIF(btrim(COALESCE(p_payload->>'manage_token', '')), '');
  v_reg_id uuid := CASE
    WHEN COALESCE(p_payload->>'registration_id', '') ~ '^[0-9a-fA-F-]{36}$'
      THEN (p_payload->>'registration_id')::uuid
    ELSE NULL
  END;
  v_reg record;
  v_count integer;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'not_found: registration does not exist';
  END IF;

  IF v_reg_id IS NULL AND v_manage IS NULL THEN
    RAISE EXCEPTION 'invalid_request: registration_id or manage_token is required';
  END IF;

  -- Ta sama tozsamosc co przy rezygnacji (`event_registration_cancel`): klucz
  -- z maila albo konto, z ktorym zwiazana jest OSOBA zgloszenia. Zgoda nalezy
  -- do osoby, wiec konto, ktore tylko zalozylo zgloszenie (prowadzacy grupy),
  -- jej nie wycofa.
  SELECT r.id, r.event_id, r.person_id,
         p.user_id AS person_user_id,
         (r.manage_token_hash IS NOT NULL
          AND v_manage IS NOT NULL
          AND r.manage_token_hash = encode(digest(v_manage, 'sha256'), 'hex')) AS token_ok
    INTO v_reg
    FROM public.event_registrations r
    JOIN public.event_people p
      ON p.id = r.person_id AND p.tenant_id = r.tenant_id
   WHERE r.tenant_id = v_tenant
     AND (
       (v_reg_id IS NOT NULL AND r.id = v_reg_id)
       OR (
         v_reg_id IS NULL
         AND r.manage_token_hash = encode(digest(v_manage, 'sha256'), 'hex')
       )
     );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: registration does not exist';
  END IF;

  IF NOT (
    v_reg.token_ok
    OR (v_uid IS NOT NULL AND v_reg.person_user_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'forbidden: this registration belongs to somebody else';
  END IF;

  -- Kazde zgloszenie osoby na TO wydarzenie ze zgoda bez pozniejszego
  -- wycofania. Stempel nadania zostaje - dowod potrzebuje obu dat. Status
  -- zgloszenia nie ma znaczenia: lead zebrany przed odwolaniem udzialu nadal
  -- lezy u sponsora.
  UPDATE public.event_registrations r
     SET consent_partner_withdrawn_at = now()
   WHERE r.tenant_id = v_tenant
     AND r.event_id = v_reg.event_id
     AND r.person_id = v_reg.person_id
     AND r.consent_partner_sharing_at IS NOT NULL
     AND (r.consent_partner_withdrawn_at IS NULL
          OR r.consent_partner_withdrawn_at < r.consent_partner_sharing_at);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'registration_id', v_reg.id,
    'withdrawn', v_count > 0,
    'partner_consent', public._event_partner_consent_at(v_tenant, v_reg.event_id, v_reg.person_id) IS NOT NULL
  );
END;
$function$;

COMMENT ON FUNCTION public.event_registration_partner_consent_withdraw(jsonb) IS
  'Samoobsluga: wycofanie zgody na przekazanie danych partnerom wydarzenia zgloszenia. Payload {manage_token} albo {registration_id} wlasciciela konta. Stempluje consent_partner_withdrawn_at wszystkich zgloszen osoby na to wydarzenie, stempla nadania nie kasuje. Odpowiedz {ok, registration_id, withdrawn, partner_consent}.';

REVOKE ALL ON FUNCTION public.event_registration_partner_consent_withdraw(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_registration_partner_consent_withdraw(jsonb) TO anon, authenticated, service_role;

-- C) WYCOFANIE ZGODY Z PANELU ORGANIZATORA -----------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_registration_partner_consent_withdraw(p_registration_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_reg public.event_registrations;
  v_count integer;
BEGIN
  IF p_registration_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: registration_id is required';
  END IF;

  SELECT * INTO v_reg
    FROM public.event_registrations r
   WHERE r.id = p_registration_id AND r.tenant_id = v_tenant;

  IF v_reg.id IS NULL THEN
    RAISE EXCEPTION 'not_found: registration does not exist in this tenant';
  END IF;

  UPDATE public.event_registrations r
     SET consent_partner_withdrawn_at = now()
   WHERE r.tenant_id = v_tenant
     AND r.event_id = v_reg.event_id
     AND r.person_id = v_reg.person_id
     AND r.consent_partner_sharing_at IS NOT NULL
     AND (r.consent_partner_withdrawn_at IS NULL
          OR r.consent_partner_withdrawn_at < r.consent_partner_sharing_at);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Wycofanie w czyims imieniu: kto je wpisal, musi byc do wskazania.
  IF v_count > 0 THEN
    INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
    VALUES (
      v_tenant,
      auth.uid(),
      'event.registration.partner_consent_withdrawn',
      'event_registration',
      v_reg.id,
      jsonb_build_object(
        'event_id', v_reg.event_id,
        'person_id', v_reg.person_id,
        'registrations', v_count,
        'by', 'organizer'
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'registration_id', v_reg.id,
    'withdrawn', v_count > 0,
    'partner_consent', public._event_partner_consent_at(v_tenant, v_reg.event_id, v_reg.person_id) IS NOT NULL
  );
END;
$function$;

COMMENT ON FUNCTION public.admin_event_registration_partner_consent_withdraw(uuid) IS
  'Panel: wycofanie zgody partnerskiej uczestnika na prosbe zlozona innym kanalem. Te same skutki co samoobsluga (wszystkie zgloszenia osoby na to wydarzenie), plus wpis audit_log z aktorem. Bramka: assert_editor_tenant().';

REVOKE ALL ON FUNCTION public.admin_event_registration_partner_consent_withdraw(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_event_registration_partner_consent_withdraw(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_event_registration_partner_consent_withdraw(uuid) TO authenticated, service_role;
