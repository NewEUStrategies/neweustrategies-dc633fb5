-- events-harness: include
-- ============================================================================
-- REJESTR ZGOD UCZESTNIKOW WYDARZEN, CZESC 2: JEDYNE FUNKCJE ZAPISU ZGOD
-- (REG-02 / REG-14).
--
-- DEFEKT: stemple zgod w `event_people` pisaly trzy rozne funkcje, kazda po
--   swojemu (`event_register` 20261007140400:534-552, `_event_cfp_resolve_person`
--   20260927000101:292-370, `event_package_invite_accept`
--   20260827221214:657-665), bez dowodu, bez tekstu i z `consent_withdrawn_at =
--   NULL` przy kazdym zapisie. Wycofania nie pisal nikt, a CRM nigdy go nie
--   dostawal (`crm_leads.marketing_consent` tylko rosl).
--
-- ZMIANA - piec funkcji wewnetrznych (SECURITY DEFINER, search_path z
--   `extensions`, REVOKE od PUBLIC/anon/authenticated, EXECUTE dla service_role;
--   sygnatury sa kontraktem miedzy jednostkami - REG_DESIGN §2/A2):
--   * `_event_person_consents_confirm` - JEDYNE udzielenie zgody: wpis
--     'confirmed' w ksiedze + projekcja w `event_people` (blokada wiersza
--     osoby). Udzielenie marketingu/partnerow przy GLOBALNYM wycofaniu
--     (`consent_withdrawn_at`) wymaga DOI: kanal `verified_account` dostaje
--     `consent_withdrawn_requires_reconfirmation` (ta sama "lepka" regula
--     wycofania co w naborze, 42_cfp.sql:812-827). DOI zdejmuje wycofanie,
--     ale zeruje cele, ktorych link NIE potwierdzil - nic nie zmartwychwstaje.
--   * `_event_consent_issue_confirmation` - wpisy 'pending' + nowy link DOI
--     (w bazie tylko sha256; jawny token wraca raz, do wysylki mailem),
--     zastepuje poprzedni otwarty link osoby.
--   * `_event_person_consents_withdraw` - JEDYNE wycofanie: wpisy 'withdrawn',
--     zerowanie kolumn celow, `consent_withdrawn_at`, gdy po tym wpisie oba cele
--     (marketing i partnerzy) sa w ksiedze wycofane, zastapienie otwartych
--     linkow DOI obejmujacych wycofywane cele i - dla marketingu - wycofanie
--     w CRM.
--   * `_event_person_consent_crm_withdraw` - `crm_leads.marketing_consent =
--     false` + ZAWSZE wiersz `crm_consent_log` given=false (takze bez kontaktu:
--     przyszly most zobaczy wycofanie) + wpis osi czasu kontaktu.
--   * `_event_consent_withdraw_by_email` - wejscie dla linku wypisu (osoba po
--     adresie w najemcy, wycofanie marketingu).
--
-- CZEGO TO NIE ZAMYKA: przepiecie dzisiejszych pisarzy (`event_register` -
--   B1a, `_event_cfp_resolve_person` - B3, `event_package_invite_accept` - B2)
--   i RPC dla klienta (potwierdzenie DOI, wycofanie, stan zgod - B3; wypis
--   z maila - wlasciciel `email_unsubscribe_by_token`). Zgody na przetwarzanie
--   danych (`data_processing`) nie da sie tu wycofac - to podstawa obslugi
--   zapisu, jej koniec to rezygnacja albo usuniecie danych.
--
-- KOLEJNOSC WDROZENIA: po 20261012100100 (tabele). Kod TS jeszcze tego nie
--   wola - dowolna wzgledem kodu.
-- IDEMPOTENTNA: CREATE OR REPLACE, bezstanowe REVOKE/GRANT, COMMENT.
-- DOWOD: supabase/tests/event_consent_ledger_test.sql,
--   supabase/tests/event_consent_writers_test.sql,
--   scripts/events-harness/runtime_test.d/23_consent_ledger.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) UDZIELENIE ZGODY
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_person_consents_confirm(
  p_tenant uuid,
  p_person uuid,
  p_purposes text[],
  p_evidence text,
  p_event uuid,
  p_registration uuid,
  p_confirmation uuid,
  p_text_version integer,
  p_lang text,
  p_ip_subject text,
  p_user_agent text,
  p_actor uuid,
  p_source text,
  p_project boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_purposes text[];
  v_purpose text;
  v_person public.event_people%ROWTYPE;
  v_conf public.event_consent_confirmations%ROWTYPE;
  v_event uuid := p_event;
  v_reg_event uuid;
  v_version integer := p_text_version;
  v_lang text := p_lang;
  v_user_agent text := left(NULLIF(btrim(COALESCE(p_user_agent, '')), ''), 400);
  v_source text := left(NULLIF(btrim(COALESCE(p_source, '')), ''), 200);
  v_grants boolean;
BEGIN
  IF p_tenant IS NULL OR p_person IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: tenant and person are required';
  END IF;
  IF p_purposes IS NULL OR cardinality(p_purposes) = 0 OR EXISTS (
       SELECT 1 FROM unnest(p_purposes) AS u(x)
        WHERE u.x IS NULL OR u.x NOT IN ('data_processing', 'marketing', 'partner_sharing')
     ) THEN
    RAISE EXCEPTION 'invalid_consent_purpose: purposes must be data_processing, marketing or partner_sharing';
  END IF;
  v_purposes := ARRAY(SELECT DISTINCT u.x FROM unnest(p_purposes) AS u(x) ORDER BY 1);
  -- Udzielic mozna tylko tymi kanalami. Formularz (`registration_form`)
  -- przechodzi te bramke, ale ksiega przyjmie go WYLACZNIE dla
  -- `data_processing` - CHECK `event_consent_records_verified_grant` odrzuci
  -- marketing i partnerow z formularza niezaleznie od tego, kto wola.
  -- Spadek (`legacy_single_opt_in`) pisze tylko migracja.
  IF p_evidence IS NULL OR p_evidence NOT IN ('registration_form', 'verified_account', 'email_double_opt_in') THEN
    RAISE EXCEPTION 'invalid_consent_evidence: % cannot grant a consent', COALESCE(p_evidence, 'NULL');
  END IF;
  IF p_ip_subject IS NOT NULL AND p_ip_subject !~ '^ip:[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'invalid_payload: probe subject must be a salted address hash';
  END IF;

  -- DOI: dowodem jest link z maila, wiec musi istniec w tym najemcy, nalezec do
  -- tej osoby, byc juz ostemplowany jako potwierdzony (RPC potwierdzenia
  -- stempluje go przed wywolaniem) i obejmowac kazdy udzielany cel. Tekst
  -- i jezyk wpisu bierzemy z linku - to on byl pokazany przy wydaniu.
  IF p_evidence = 'email_double_opt_in' THEN
    SELECT c.* INTO v_conf
      FROM public.event_consent_confirmations c
     WHERE c.tenant_id = p_tenant AND c.id = p_confirmation;
    IF NOT FOUND
       OR v_conf.person_id <> p_person
       OR v_conf.confirmed_at IS NULL
       OR NOT (v_purposes <@ v_conf.purposes) THEN
      RAISE EXCEPTION 'invalid_payload: double opt-in requires a confirmed link of this person covering every purpose';
    END IF;
    IF v_version IS NULL AND v_lang IS NULL THEN
      v_version := v_conf.text_version;
      v_lang := v_conf.text_lang;
    ELSIF v_version IS DISTINCT FROM v_conf.text_version OR v_lang IS DISTINCT FROM v_conf.text_lang THEN
      RAISE EXCEPTION 'invalid_payload: double opt-in text differs from the confirmed link';
    END IF;
  END IF;

  FOREACH v_purpose IN ARRAY v_purposes LOOP
    PERFORM public._event_consent_text_check(v_purpose, v_version, v_lang);
  END LOOP;

  -- Blokada wiersza osoby: projekcja i decyzja o wycofaniu na jednym obrazie
  -- (rownolegle wycofanie czeka albo widzi juz nasz wpis).
  SELECT p.* INTO v_person
    FROM public.event_people p
   WHERE p.tenant_id = p_tenant AND p.id = p_person
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: person does not exist';
  END IF;
  IF v_person.email_norm IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: person has no e-mail address';
  END IF;

  -- Zgloszenie musi nalezec do tej osoby, a wydarzenie - do zgloszenia: wpis
  -- ksiegi nie moze wskazywac cudzego zapisu jako okolicznosci zgody.
  IF p_registration IS NOT NULL THEN
    SELECT r.event_id INTO v_reg_event
      FROM public.event_registrations r
     WHERE r.tenant_id = p_tenant AND r.id = p_registration AND r.person_id = p_person;
    IF NOT FOUND OR (v_event IS NOT NULL AND v_event <> v_reg_event) THEN
      RAISE EXCEPTION 'invalid_payload: registration does not belong to the person';
    END IF;
    v_event := v_reg_event;
  END IF;

  v_grants := v_purposes && ARRAY['marketing', 'partner_sharing']::text[];

  -- Marketing i partnerzy zawsze z projekcja: wpis 'confirmed' bez stempla
  -- w kartotece rozjechalby ksiege z tym, co czytaja sponsorzy i most CRM.
  -- Pominiecie projekcji ma sens wylacznie dla zgody na przetwarzanie danych.
  IF v_grants AND NOT COALESCE(p_project, true) THEN
    RAISE EXCEPTION 'invalid_payload: marketing and partner consents are always projected';
  END IF;

  -- LEPKIE WYCOFANIE. Osoba, ktora wycofala wszystko, odzyskuje zgode
  -- marketingu/partnerow tylko klikajac link z maila. Zaznaczenie pola przez
  -- zalogowanego wlasciciela nie wystarcza - wolajacy sprawdza stan wczesniej
  -- i wydaje link DOI zamiast tego wywolania.
  IF v_grants AND p_evidence = 'verified_account' AND v_person.consent_withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'consent_withdrawn_requires_reconfirmation: this person withdrew consents; only the e-mail confirmation link can restore them';
  END IF;

  INSERT INTO public.event_consent_records (
    tenant_id, person_id, event_id, registration_id, confirmation_id, email_norm,
    purpose, status, evidence, text_version, text_lang, ip_subject, user_agent,
    actor_user_id, source
  )
  SELECT p_tenant, p_person, v_event, p_registration, p_confirmation, v_person.email_norm,
         u.x, 'confirmed', p_evidence, v_version, v_lang, p_ip_subject, v_user_agent,
         p_actor, v_source
    FROM unnest(v_purposes) AS u(x)
   ORDER BY u.x;

  -- PROJEKCJA. `p_project = false` zostawia sam wpis ksiegi - tak wolajacy
  -- zapisuje zgode na przetwarzanie danych osoby, ktorej kartoteki nie wolno mu
  -- zmieniac (niezweryfikowany zapis na istniejaca osobe, REG-02 / D4).
  IF COALESCE(p_project, true) THEN
    -- Wyjscie z GLOBALNEGO wycofania dociera tu wylacznie z DOI (kanal konta
    -- odpada wyzej, formularz nie przejdzie CHECK-a ksiegi). Cele spoza linku
    -- zostaja wyzerowane: stary stempel sprzed wycofania nie wraca.
    UPDATE public.event_people p SET
      consent_data_processing_at = CASE
        WHEN 'data_processing' = ANY (v_purposes) THEN COALESCE(p.consent_data_processing_at, now())
        ELSE p.consent_data_processing_at
      END,
      consent_marketing_at = CASE
        WHEN v_grants AND p.consent_withdrawn_at IS NOT NULL THEN
          CASE WHEN 'marketing' = ANY (v_purposes) THEN now() END
        WHEN 'marketing' = ANY (v_purposes) THEN COALESCE(p.consent_marketing_at, now())
        ELSE p.consent_marketing_at
      END,
      consent_partner_sharing_at = CASE
        WHEN v_grants AND p.consent_withdrawn_at IS NOT NULL THEN
          CASE WHEN 'partner_sharing' = ANY (v_purposes) THEN now() END
        WHEN 'partner_sharing' = ANY (v_purposes) THEN COALESCE(p.consent_partner_sharing_at, now())
        ELSE p.consent_partner_sharing_at
      END,
      consent_withdrawn_at = CASE
        WHEN v_grants AND p_evidence = 'email_double_opt_in' THEN NULL
        ELSE p.consent_withdrawn_at
      END
     WHERE p.tenant_id = p_tenant AND p.id = p_person;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._event_person_consents_confirm(
  uuid, uuid, text[], text, uuid, uuid, uuid, integer, text, text, text, uuid, text, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_person_consents_confirm(
  uuid, uuid, text[], text, uuid, uuid, uuid, integer, text, text, text, uuid, text, boolean
) TO service_role;

COMMENT ON FUNCTION public._event_person_consents_confirm(
  uuid, uuid, text[], text, uuid, uuid, uuid, integer, text, text, text, uuid, text, boolean
) IS
  'Wewnetrzna (service_role i funkcje SECURITY DEFINER). Jedyne udzielenie zgody uczestnika: wpis confirmed w event_consent_records na kazdy cel + projekcja w event_people (p_project = false: sam wpis). Kanaly: registration_form (wylacznie data_processing - CHECK ksiegi), verified_account (wolajacy sprawdzil potwierdzony adres konta = adres osoby; przy consent_withdrawn_at RAISE consent_withdrawn_requires_reconfirmation), email_double_opt_in (potwierdzony link tej osoby; zdejmuje wycofanie i zeruje cele spoza linku). Tozsamosc i adres IP wylacznie z argumentow serwera, nigdy z ladunku.';

-- ----------------------------------------------------------------------------
-- 2) LINK DOUBLE OPT-IN
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_consent_issue_confirmation(
  p_tenant uuid,
  p_person uuid,
  p_purposes text[],
  p_event uuid,
  p_registration uuid,
  p_text_version integer,
  p_lang text,
  p_ip_subject text,
  p_user_agent text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_purposes text[];
  v_purpose text;
  v_person public.event_people%ROWTYPE;
  v_event uuid := p_event;
  v_reg_event uuid;
  v_user_agent text := left(NULLIF(btrim(COALESCE(p_user_agent, '')), ''), 400);
  v_token text;
  v_confirmation uuid;
BEGIN
  IF p_tenant IS NULL OR p_person IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: tenant and person are required';
  END IF;
  -- Link potwierdza wylacznie zgody, ktore wymagaja zweryfikowanego kanalu.
  IF p_purposes IS NULL OR cardinality(p_purposes) = 0 OR EXISTS (
       SELECT 1 FROM unnest(p_purposes) AS u(x)
        WHERE u.x IS NULL OR u.x NOT IN ('marketing', 'partner_sharing')
     ) THEN
    RAISE EXCEPTION 'invalid_consent_purpose: a confirmation link covers only marketing and partner_sharing';
  END IF;
  v_purposes := ARRAY(SELECT DISTINCT u.x FROM unnest(p_purposes) AS u(x) ORDER BY 1);
  IF p_ip_subject IS NOT NULL AND p_ip_subject !~ '^ip:[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'invalid_payload: probe subject must be a salted address hash';
  END IF;
  FOREACH v_purpose IN ARRAY v_purposes LOOP
    PERFORM public._event_consent_text_check(v_purpose, p_text_version, p_lang);
  END LOOP;

  SELECT p.* INTO v_person
    FROM public.event_people p
   WHERE p.tenant_id = p_tenant AND p.id = p_person
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: person does not exist';
  END IF;
  IF v_person.email_norm IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: person has no e-mail address';
  END IF;

  IF p_registration IS NOT NULL THEN
    SELECT r.event_id INTO v_reg_event
      FROM public.event_registrations r
     WHERE r.tenant_id = p_tenant AND r.id = p_registration AND r.person_id = p_person;
    IF NOT FOUND OR (v_event IS NOT NULL AND v_event <> v_reg_event) THEN
      RAISE EXCEPTION 'invalid_payload: registration does not belong to the person';
    END IF;
    v_event := v_reg_event;
  END IF;

  -- Jeden otwarty link na osobe: poprzedni przestaje dzialac w tej samej
  -- transakcji, w ktorej powstaje nowy (indeks czesciowo-unikalny i tak
  -- odrzucilby drugi otwarty).
  UPDATE public.event_consent_confirmations c
     SET superseded_at = now()
   WHERE c.tenant_id = p_tenant
     AND c.person_id = p_person
     AND c.confirmed_at IS NULL
     AND c.superseded_at IS NULL;

  -- 24 losowe bajty w base64url = 32 znaki (ksztalt klucza samoobslugi).
  -- W bazie zostaje wylacznie sha256 - wyciek tabeli nie daje linkow.
  v_token := public._event_new_qr_token();

  INSERT INTO public.event_consent_confirmations (
    tenant_id, person_id, event_id, registration_id, email_norm, token_hash,
    purposes, text_version, text_lang, requested_ip_subject, requested_user_agent
  ) VALUES (
    p_tenant, p_person, v_event, p_registration, v_person.email_norm,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    v_purposes, p_text_version, p_lang, p_ip_subject, v_user_agent
  )
  RETURNING id INTO v_confirmation;

  INSERT INTO public.event_consent_records (
    tenant_id, person_id, event_id, registration_id, confirmation_id, email_norm,
    purpose, status, evidence, text_version, text_lang, ip_subject, user_agent, source
  )
  SELECT p_tenant, p_person, v_event, p_registration, v_confirmation, v_person.email_norm,
         u.x, 'pending', 'registration_form', p_text_version, p_lang, p_ip_subject, v_user_agent,
         'registration_form'
    FROM unnest(v_purposes) AS u(x)
   ORDER BY u.x;

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public._event_consent_issue_confirmation(
  uuid, uuid, text[], uuid, uuid, integer, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_consent_issue_confirmation(
  uuid, uuid, text[], uuid, uuid, integer, text, text, text
) TO service_role;

COMMENT ON FUNCTION public._event_consent_issue_confirmation(
  uuid, uuid, text[], uuid, uuid, integer, text, text, text
) IS
  'Wewnetrzna (service_role i funkcje SECURITY DEFINER). Wydaje link double opt-in na zgody marketing/partner_sharing: wpisy pending (registration_form) w ksiedze, nowe potwierdzenie (sha256 tokenu, 7 dni) i zastapienie poprzedniego otwartego linku osoby. Zwraca JAWNY token (32 znaki) - wolajacy wysyla go mailem na adres osoby i nigdy nie oddaje przegladarce.';

-- ----------------------------------------------------------------------------
-- 3) WYCOFANIE W CRM
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_person_consent_crm_withdraw(
  p_tenant uuid,
  p_person uuid,
  p_evidence text,
  p_ip_subject text,
  p_user_agent text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_email text;
  v_email_norm text;
  v_lead uuid;
  v_was boolean;
BEGIN
  IF p_tenant IS NULL OR p_person IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: tenant and person are required';
  END IF;
  IF p_evidence IS NULL OR p_evidence NOT IN ('manage_token', 'account_settings', 'unsubscribe_link') THEN
    RAISE EXCEPTION 'invalid_consent_evidence: % cannot withdraw a consent', COALESCE(p_evidence, 'NULL');
  END IF;
  IF p_ip_subject IS NOT NULL AND p_ip_subject !~ '^ip:[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'invalid_payload: probe subject must be a salted address hash';
  END IF;

  SELECT NULLIF(btrim(COALESCE(p.email, '')), ''), p.email_norm
    INTO v_email, v_email_norm
    FROM public.event_people p
   WHERE p.tenant_id = p_tenant AND p.id = p_person;
  -- Bez adresu nie ma czego szukac w CRM (kontakt to adres).
  IF v_email_norm IS NULL THEN
    RETURN;
  END IF;

  -- Ta sama blokada doradcza co w `_event_person_crm_sync`: wycofanie
  -- i rownolegly most nie przeplataja odczytu i zapisu zgody kontaktu.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_tenant::text || ':event_person_crm:' || p_person::text, 0)
  );

  SELECT l.id, l.marketing_consent INTO v_lead, v_was
    FROM public.crm_leads l
   WHERE l.tenant_id = p_tenant AND l.email_norm = v_email_norm
   FOR UPDATE;

  IF v_lead IS NOT NULL AND v_was THEN
    UPDATE public.crm_leads l
       SET marketing_consent = false,
           updated_at = now()
     WHERE l.id = v_lead AND l.tenant_id = p_tenant;
  END IF;

  -- ZAWSZE wiersz rejestru zgod, takze bez kontaktu i przy zgodzie juz
  -- zgaszonej: to on zatrzymuje most (i kazdy przyszly import), gdyby kontakt
  -- powstal albo zgoda wrocila z innego zrodla starszego niz to wycofanie.
  INSERT INTO public.crm_consent_log (
    tenant_id, email, source_type, source_id, form_id, form_name,
    consent_key, consent_text, consent_version, given, ip, user_agent, lang
  ) VALUES (
    p_tenant, v_email, 'event'::public.crm_source_type, p_person,
    'event_consent:' || p_evidence, 'evidence:' || p_evidence,
    'marketing',
    format('Organizer marketing consent withdrawn by the event participant via %s.', p_evidence),
    NULL, false, p_ip_subject, left(NULLIF(btrim(COALESCE(p_user_agent, '')), ''), 400), NULL
  );

  IF v_lead IS NOT NULL THEN
    INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
    VALUES (
      p_tenant,
      auth.uid(),
      'event.consent.withdrawn',
      'crm_lead',
      v_lead,
      jsonb_build_object(
        'person_id', p_person,
        'evidence', p_evidence,
        'marketing_consent_was', v_was,
        'summary_pl', 'Wycofanie zgody marketingowej uczestnika wydarzenia',
        'summary_en', 'Event participant withdrew marketing consent'
      )
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._event_person_consent_crm_withdraw(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_person_consent_crm_withdraw(uuid, uuid, text, text, text)
  TO service_role;

COMMENT ON FUNCTION public._event_person_consent_crm_withdraw(uuid, uuid, text, text, text) IS
  'Wewnetrzna (wola ja _event_person_consents_withdraw). Wycofanie zgody marketingowej osoby w CRM: crm_leads.marketing_consent = false dla kontaktu o adresie osoby, ZAWSZE wiersz crm_consent_log given=false (form_id event_consent:<kanal>; zatrzymuje _event_person_crm_sync) i wpis osi czasu event.consent.withdrawn, gdy kontakt istnieje.';

-- ----------------------------------------------------------------------------
-- 4) WYCOFANIE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_person_consents_withdraw(
  p_tenant uuid,
  p_person uuid,
  p_purposes text[],
  p_evidence text,
  p_ip_subject text,
  p_user_agent text,
  p_actor uuid,
  p_source text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_purposes text[];
  v_person public.event_people%ROWTYPE;
  v_user_agent text := left(NULLIF(btrim(COALESCE(p_user_agent, '')), ''), 400);
  v_source text := left(NULLIF(btrim(COALESCE(p_source, '')), ''), 200);
  v_changed boolean;
  v_both boolean;
  v_superseded integer;
BEGIN
  IF p_tenant IS NULL OR p_person IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: tenant and person are required';
  END IF;
  IF p_purposes IS NULL OR cardinality(p_purposes) = 0 OR EXISTS (
       SELECT 1 FROM unnest(p_purposes) AS u(x)
        WHERE u.x IS NULL OR u.x NOT IN ('marketing', 'partner_sharing')
     ) THEN
    RAISE EXCEPTION 'invalid_consent_purpose: only marketing and partner_sharing can be withdrawn';
  END IF;
  v_purposes := ARRAY(SELECT DISTINCT u.x FROM unnest(p_purposes) AS u(x) ORDER BY 1);
  IF p_evidence IS NULL OR p_evidence NOT IN ('manage_token', 'account_settings', 'unsubscribe_link') THEN
    RAISE EXCEPTION 'invalid_consent_evidence: % cannot withdraw a consent', COALESCE(p_evidence, 'NULL');
  END IF;
  IF p_ip_subject IS NOT NULL AND p_ip_subject !~ '^ip:[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'invalid_payload: probe subject must be a salted address hash';
  END IF;

  SELECT p.* INTO v_person
    FROM public.event_people p
   WHERE p.tenant_id = p_tenant AND p.id = p_person
   FOR UPDATE;
  -- Wycofanie nigdy nie rzuca z braku osoby: link wypisu i klucz samoobslugi
  -- moga przezyc kartoteke (usuniecie danych). Nie ma czego wycofac.
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_changed := ('marketing' = ANY (v_purposes) AND v_person.consent_marketing_at IS NOT NULL)
            OR ('partner_sharing' = ANY (v_purposes) AND v_person.consent_partner_sharing_at IS NOT NULL);
  IF 'marketing' = ANY (v_purposes) AND v_person.email_norm IS NOT NULL THEN
    v_changed := v_changed OR EXISTS (
      SELECT 1 FROM public.crm_leads l
       WHERE l.tenant_id = p_tenant AND l.email_norm = v_person.email_norm AND l.marketing_consent
    );
  END IF;

  -- Wycofanie zapisujemy ZAWSZE, takze gdy nic nie bylo aktywne: to dowod
  -- zadania osoby i punkt odciecia dla mostu CRM.
  INSERT INTO public.event_consent_records (
    tenant_id, person_id, email_norm, purpose, status, evidence,
    ip_subject, user_agent, actor_user_id, source
  )
  SELECT p_tenant, p_person, v_person.email_norm, u.x, 'withdrawn', p_evidence,
         p_ip_subject, v_user_agent, p_actor, v_source
    FROM unnest(v_purposes) AS u(x)
   ORDER BY u.x;

  -- GLOBALNE WYCOFANIE (`consent_withdrawn_at`) = po tym wpisie NAJNOWSZY
  -- rozstrzygajacy wpis obu celow to 'withdrawn'. Liczy sie stan ksiegi, nie
  -- sam zakres tego zadania: "wypisz z marketingu" dzis i "nie udostepniaj
  -- partnerom" jutro to tez wycofanie wszystkiego. Cel, na ktory osoba nigdy
  -- sie nie zgodzila, nie ma wpisu - wycofanie samego marketingu go nie
  -- dotyka i nie blokuje pozniejszej zgody kanalem konta.
  v_both := NOT EXISTS (
    SELECT 1
      FROM unnest(ARRAY['marketing', 'partner_sharing']::text[]) AS g(purpose)
     WHERE COALESCE((
             SELECT r.status
               FROM public.event_consent_records r
              WHERE r.tenant_id = p_tenant
                AND r.person_id = p_person
                AND r.purpose = g.purpose
                AND r.status IN ('confirmed', 'withdrawn')
              ORDER BY r.seq DESC
              LIMIT 1
           ), 'none') <> 'withdrawn'
  );

  UPDATE public.event_people p SET
    consent_marketing_at = CASE
      WHEN 'marketing' = ANY (v_purposes) THEN NULL
      ELSE p.consent_marketing_at
    END,
    consent_partner_sharing_at = CASE
      WHEN 'partner_sharing' = ANY (v_purposes) THEN NULL
      ELSE p.consent_partner_sharing_at
    END,
    consent_withdrawn_at = CASE
      WHEN v_both THEN COALESCE(p.consent_withdrawn_at, now())
      ELSE p.consent_withdrawn_at
    END
   WHERE p.tenant_id = p_tenant AND p.id = p_person;

  -- Otwarty link DOI, ktory obejmuje choc jeden wycofywany cel, przestaje
  -- dzialac w calosci: stary mail nie moze cofnac swiezego wycofania.
  UPDATE public.event_consent_confirmations c
     SET superseded_at = now()
   WHERE c.tenant_id = p_tenant
     AND c.person_id = p_person
     AND c.confirmed_at IS NULL
     AND c.superseded_at IS NULL
     AND c.purposes && v_purposes;
  GET DIAGNOSTICS v_superseded = ROW_COUNT;

  IF 'marketing' = ANY (v_purposes) THEN
    PERFORM public._event_person_consent_crm_withdraw(
      p_tenant, p_person, p_evidence, p_ip_subject, v_user_agent
    );
  END IF;

  RETURN v_changed OR v_superseded > 0;
END;
$$;

REVOKE ALL ON FUNCTION public._event_person_consents_withdraw(uuid, uuid, text[], text, text, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_person_consents_withdraw(uuid, uuid, text[], text, text, text, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public._event_person_consents_withdraw(uuid, uuid, text[], text, text, text, uuid, text) IS
  'Wewnetrzna (service_role i funkcje SECURITY DEFINER). Jedyne wycofanie zgod marketing/partner_sharing: wpisy withdrawn (kanaly manage_token, account_settings, unsubscribe_link), zerowanie kolumn celow w event_people, consent_withdrawn_at gdy oba cele sa w ksiedze wycofane, zastapienie otwartych linkow DOI z tymi celami, dla marketingu _event_person_consent_crm_withdraw. Zwraca true, gdy cos bylo aktywne (projekcja, zgoda w CRM albo otwarty link); false, gdy osoby nie ma albo nic nie bylo aktywne. Wolajacy nie ujawnia wyniku klientowi.';

-- ----------------------------------------------------------------------------
-- 5) WYCOFANIE PO ADRESIE (link wypisu z maila)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_consent_withdraw_by_email(p_tenant uuid, p_email text, p_channel text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_email_norm text := NULLIF(lower(btrim(COALESCE(p_email, ''))), '');
  v_person uuid;
BEGIN
  IF p_tenant IS NULL OR v_email_norm IS NULL THEN
    RETURN false;
  END IF;
  SELECT p.id INTO v_person
    FROM public.event_people p
   WHERE p.tenant_id = p_tenant AND p.email_norm = v_email_norm;
  IF v_person IS NULL THEN
    RETURN false;
  END IF;
  RETURN public._event_person_consents_withdraw(
    p_tenant, v_person, ARRAY['marketing']::text[], p_channel,
    NULL, NULL, NULL, 'email:' || COALESCE(p_channel, '')
  );
END;
$$;

REVOKE ALL ON FUNCTION public._event_consent_withdraw_by_email(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_consent_withdraw_by_email(uuid, text, text)
  TO service_role;

COMMENT ON FUNCTION public._event_consent_withdraw_by_email(uuid, text, text) IS
  'Wewnetrzna (dla wypisu z maila, np. email_unsubscribe_by_token). Osoba wydarzen po adresie w najemcy -> _event_person_consents_withdraw(ARRAY[marketing], p_channel). false, gdy adres nie nalezy do zadnej osoby. Kanal spoza manage_token/account_settings/unsubscribe_link rzuca invalid_consent_evidence (blad programisty, nie danych).';
