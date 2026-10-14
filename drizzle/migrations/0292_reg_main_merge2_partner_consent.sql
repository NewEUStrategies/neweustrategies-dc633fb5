CREATE OR REPLACE FUNCTION public.event_register(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v jsonb;
BEGIN
  v := public._event_register(public.public_tenant_id(), auth.uid(), NULL, NULL, p_payload, false);
  IF v->>'outcome' = 'already_registered' THEN
    RAISE EXCEPTION 'already_registered: this person already has an active registration';
  END IF;
  IF v->>'outcome' IS DISTINCT FROM 'created' THEN
    RETURN v;
  END IF;
  RETURN v - ARRAY['ok', 'outcome', 'verified', 'recipient', 'event', 'consent_confirmation']::text[];
END;
$$;

REVOKE ALL ON FUNCTION public.event_register(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_register(jsonb) TO service_role;

COMMENT ON FUNCTION public.event_register(jsonb) IS
  'Wrapper zgodnosci zapisu na wydarzenie - TYLKO service_role (od 20261012140100; dotad anon). Najemca z hosta, konto z JWT, bez skrotu adresu i bez kubelka; ten sam rdzen _event_register. already_registered jako wyjatek, pudlo kodu jako {ok:false,error}. Przegladarka zapisuje przez submitEventRegistration -> event_register_for_client. Zgoda partnerska per zgloszenie (OPS-01) przez rejestr zgod (_event_person_consents_confirm) - tylko kanalem zweryfikowanym (D5). Unia 20261013900700.';


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
  IF p_evidence IS NULL OR p_evidence NOT IN ('registration_form', 'verified_account', 'email_double_opt_in') THEN
    RAISE EXCEPTION 'invalid_consent_evidence: % cannot grant a consent', COALESCE(p_evidence, 'NULL');
  END IF;
  IF p_ip_subject IS NOT NULL AND p_ip_subject !~ '^ip:[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'invalid_payload: probe subject must be a salted address hash';
  END IF;

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

  SELECT p.* INTO v_person
    FROM public.event_people p
   WHERE p.tenant_id = p_tenant AND p.id = p_person
   FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: person does not exist';
  END IF;
  IF v_person.email_norm IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: person has no e-mail address';
  END IF;

  IF p_evidence = 'email_double_opt_in'
     AND (v_conf.email_norm <> v_person.email_norm OR v_conf.confirmed_at > v_conf.expires_at) THEN
    RAISE EXCEPTION 'invalid_payload: double opt-in link was issued for another address or confirmed after expiry';
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

  v_grants := v_purposes && ARRAY['marketing', 'partner_sharing']::text[];

  IF v_grants AND NOT COALESCE(p_project, true) THEN
    RAISE EXCEPTION 'invalid_payload: marketing and partner consents are always projected';
  END IF;

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

  IF COALESCE(p_project, true) THEN
    IF v_grants AND p_evidence = 'email_double_opt_in' AND v_person.consent_withdrawn_at IS NOT NULL THEN
      PERFORM public._event_partner_consent_carry_withdrawal(p_tenant, p_person);
    END IF;

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

    IF 'partner_sharing' = ANY (v_purposes) AND p_registration IS NOT NULL THEN
      UPDATE public.event_registrations r
         SET consent_partner_sharing_at = CASE
               WHEN r.consent_partner_sharing_at IS NOT NULL
                AND (r.consent_partner_withdrawn_at IS NULL
                     OR r.consent_partner_withdrawn_at < r.consent_partner_sharing_at)
               THEN r.consent_partner_sharing_at
               ELSE now()
             END
       WHERE r.tenant_id = p_tenant
         AND r.id = p_registration
         AND r.person_id = p_person;
    END IF;
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
  'Wewnetrzna (service_role i funkcje SECURITY DEFINER). Jedyne udzielenie zgody uczestnika: wpis confirmed w event_consent_records na kazdy cel + projekcja w event_people (p_project = false: sam wpis). Kanaly: registration_form (wylacznie data_processing - CHECK ksiegi), verified_account (wolajacy sprawdzil potwierdzony adres konta = adres osoby; przy consent_withdrawn_at RAISE consent_withdrawn_requires_reconfirmation), email_double_opt_in (link tej osoby potwierdzony przed wygasnieciem, wydany na jej obecny adres; zdejmuje wycofanie - najpierw przenosi je na zgloszenia (_event_partner_consent_carry_withdrawal) - i zeruje cele spoza linku). Zgoda partner_sharing stempluje consent_partner_sharing_at zgloszenia p_registration (OPS-01; zgoda juz skuteczna zachowuje date). Tozsamosc i adres IP wylacznie z argumentow serwera, nigdy z ladunku. Unia 20261013900700.';


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
  v_reg_withdrawn integer := 0;
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
   FOR NO KEY UPDATE;
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

  INSERT INTO public.event_consent_records (
    tenant_id, person_id, email_norm, purpose, status, evidence,
    ip_subject, user_agent, actor_user_id, source
  )
  SELECT p_tenant, p_person, v_person.email_norm, u.x, 'withdrawn', p_evidence,
         p_ip_subject, v_user_agent, p_actor, v_source
    FROM unnest(v_purposes) AS u(x)
   ORDER BY u.x;

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

  IF 'partner_sharing' = ANY (v_purposes) THEN
    UPDATE public.event_registrations r
       SET consent_partner_withdrawn_at = now()
     WHERE r.tenant_id = p_tenant
       AND r.person_id = p_person
       AND r.consent_partner_sharing_at IS NOT NULL
       AND (r.consent_partner_withdrawn_at IS NULL
            OR r.consent_partner_withdrawn_at < r.consent_partner_sharing_at);
    GET DIAGNOSTICS v_reg_withdrawn = ROW_COUNT;
  END IF;

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

  RETURN v_changed OR v_superseded > 0 OR v_reg_withdrawn > 0;
END;
$$;

REVOKE ALL ON FUNCTION public._event_person_consents_withdraw(uuid, uuid, text[], text, text, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_person_consents_withdraw(uuid, uuid, text[], text, text, text, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public._event_person_consents_withdraw(uuid, uuid, text[], text, text, text, uuid, text) IS
  'Wewnetrzna (service_role i funkcje SECURITY DEFINER). Jedyne wycofanie zgod marketing/partner_sharing: wpisy withdrawn (kanaly manage_token, account_settings, unsubscribe_link), zerowanie kolumn celow w event_people, consent_withdrawn_at gdy oba cele sa w ksiedze wycofane, zastapienie otwartych linkow DOI z tymi celami, dla marketingu _event_person_consent_crm_withdraw, dla partner_sharing consent_partner_withdrawn_at na kazdym zgloszeniu osoby ze skuteczna zgoda (OPS-01). Zwraca true, gdy cos bylo aktywne (projekcja, zgoda w CRM, zgoda zgloszenia albo otwarty link); false, gdy osoby nie ma albo nic nie bylo aktywne. Wolajacy nie ujawnia wyniku klientowi. Unia 20261013900700.';