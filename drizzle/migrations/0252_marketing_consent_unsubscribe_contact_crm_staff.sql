CREATE OR REPLACE FUNCTION public.email_unsubscribe_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_token text := btrim(COALESCE(p_token, ''));
  v_email text;
  v_tenant uuid;
  v_global boolean := false;
  v_subscriber uuid;
  v_status text;
  v_claimed boolean := false;
  v_result jsonb;
  v_event_tenant uuid;
BEGIN
  IF v_token = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_token');
  END IF;

  SELECT lower(btrim(t.email)), t.used_at IS NULL
    INTO v_email, v_claimed
    FROM public.email_unsubscribe_tokens t
   WHERE t.token = v_token
   FOR UPDATE;
  v_global := FOUND;

  IF NOT v_global THEN
    SELECT ns.id, lower(btrim(ns.email)), ns.tenant_id, ns.status
      INTO v_subscriber, v_email, v_tenant, v_status
      FROM public.newsletter_subscribers ns
     WHERE ns.unsubscribe_token = v_token
     FOR UPDATE;
    v_claimed := v_subscriber IS NOT NULL AND v_status IS DISTINCT FROM 'unsubscribed';
  END IF;

  IF COALESCE(v_email, '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_token');
  END IF;

  v_tenant := COALESCE(v_tenant, public.email_resolve_tenant_for_address(v_email));
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_tenant');
  END IF;

  IF v_subscriber IS NOT NULL THEN
    IF v_claimed THEN
      UPDATE public.newsletter_subscribers
         SET status = 'unsubscribed',
             unsubscribed_at = now(),
             confirmation_token = NULL,
             confirmation_expires_at = NULL
       WHERE id = v_subscriber;
    END IF;
  ELSE
    UPDATE public.newsletter_subscribers ns
       SET status = 'unsubscribed',
           unsubscribed_at = now(),
           confirmation_token = NULL,
           confirmation_expires_at = NULL
     WHERE ns.tenant_id = v_tenant
       AND lower(ns.email) = v_email
       AND ns.status <> 'unsubscribed';

    IF v_claimed THEN
      UPDATE public.email_unsubscribe_tokens
         SET used_at = now()
       WHERE token = v_token AND used_at IS NULL;
    END IF;
  END IF;

  v_result := public.email_record_suppression(
    p_tenant => v_tenant,
    p_email => v_email,
    p_reason => 'unsubscribe',
    p_source => 'system',
    p_provider => 'self_service',
    p_subscriber => v_subscriber,
    p_meta => jsonb_build_object(
      'channel', 'unsubscribe_link',
      'token_kind', CASE WHEN v_global THEN 'global' ELSE 'newsletter' END)
  );

  IF COALESCE((v_result ->> 'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'suppression_not_recorded: %', COALESCE(v_result ->> 'error', 'unknown')
      USING ERRCODE = 'P0001';
  END IF;

  IF v_global THEN
    FOR v_event_tenant IN
      SELECT DISTINCT p.tenant_id
        FROM public.event_people p
       WHERE p.email_norm = v_email
       ORDER BY p.tenant_id
    LOOP
      PERFORM public._event_consent_withdraw_by_email(v_event_tenant, v_email, 'unsubscribe_link');
    END LOOP;
  ELSE
    PERFORM public._event_consent_withdraw_by_email(v_tenant, v_email, 'unsubscribe_link');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'already_unsubscribed', NOT v_claimed,
    'tenant_id', v_tenant);
END;
$fn$;

COMMENT ON FUNCTION public.email_unsubscribe_by_token(text) IS
  'Wypis jednym kliknieciem (token globalny lub per subskrybent): w JEDNEJ transakcji wypisuje subskrybenta (status + uniewaznienie tokenu potwierdzenia), zuzywa token globalny, stawia blokade unsubscribe w tenancie wlasciciela wiersza i (od 20261012133200, REG-14) wycofuje zgode marketingowa osoby wydarzen o tym adresie (_event_consent_withdraw_by_email, dowod unsubscribe_link: ksiega, projekcja, CRM) - dla tokenu globalnego w KAZDYM najemcy z osoba o tym adresie (R12), dla tokenu subskrybenta w jego najemcy. Nieudana blokada wycofuje calosc. Idempotentny; already_unsubscribed odzwierciedla stan sprzed wywolania.';

REVOKE ALL ON FUNCTION public.email_unsubscribe_by_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_unsubscribe_by_token(text) TO service_role;

CREATE OR REPLACE FUNCTION public.contact_messages_to_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_first text;
  v_last  text;
  v_item  jsonb;
  v_source_type crm_source_type;
BEGIN
  v_first := coalesce(NEW.first_name, nullif(split_part(coalesce(NEW.name, ''), ' ', 1), ''));
  v_last  := coalesce(
    NEW.last_name,
    nullif(substring(NEW.name from position(' ' in coalesce(NEW.name, '')) + 1), ''),
    nullif(NEW.name, v_first)
  );

  PERFORM public.crm_upsert_lead(
    NEW.tenant_id, NEW.email,
    v_first, v_last,
    NEW.phone, NEW.company,
    NEW.newsletter_opt_in, false
  );

  v_source_type := CASE
    WHEN NEW.form_type = 'newsletter' THEN 'newsletter'::crm_source_type
    ELSE 'contact_form'::crm_source_type
  END;

  IF NEW.consents IS NOT NULL AND jsonb_typeof(NEW.consents) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.consents)
    LOOP
      IF (v_item ? 'key') AND (v_item ? 'text') THEN
        INSERT INTO public.crm_consent_log (
          tenant_id, email, source_type, source_id, form_id, form_name,
          consent_key, consent_text, consent_version, given, ip, user_agent, lang
        ) VALUES (
          NEW.tenant_id, NEW.email, v_source_type, NEW.id, NEW.form_id, NEW.form_name,
          v_item->>'key',
          v_item->>'text',
          NULLIF(v_item->>'version',''),
          COALESCE((v_item->>'given')::boolean, true),
          NEW.ip, NEW.user_agent, COALESCE(v_item->>'lang', NEW.lang)
        );
      END IF;
    END LOOP;
  END IF;

  IF NEW.consent = true AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.consents, '[]'::jsonb)) x
     WHERE x->>'key' = 'rodo'
  ) THEN
    INSERT INTO public.crm_consent_log (
      tenant_id, email, source_type, source_id, form_id, form_name,
      consent_key, consent_text, given, ip, user_agent, lang
    ) VALUES (
      NEW.tenant_id, NEW.email, v_source_type, NEW.id, NEW.form_id, NEW.form_name,
      'rodo',
      'Wyrażam zgodę na przetwarzanie moich danych osobowych zgodnie z Polityką prywatności.',
      true, NEW.ip, NEW.user_agent, NEW.lang
    );
  END IF;

  IF NEW.newsletter_opt_in = true AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.consents, '[]'::jsonb)) x
     WHERE x->>'key' = 'newsletter'
  ) THEN
    INSERT INTO public.crm_consent_log (
      tenant_id, email, source_type, source_id, form_id, form_name,
      consent_key, consent_text, given, ip, user_agent, lang
    ) VALUES (
      NEW.tenant_id, NEW.email, v_source_type, NEW.id, NEW.form_id, NEW.form_name,
      'newsletter',
      'Zapisuję się do newslettera i akceptuję otrzymywanie wiadomości marketingowych.',
      true, NEW.ip, NEW.user_agent, NEW.lang
    );
  END IF;

  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.contact_messages_to_lead() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contact_messages_to_lead() TO service_role;

COMMENT ON FUNCTION public.contact_messages_to_lead() IS
  'Trigger contact_messages -> CRM: kontakt (crm_upsert_lead, newsletter_status pending przy zaznaczeniu newslettera) i wiersze crm_consent_log z formularza. Od 20261012180900 (R12) NIE nadaje crm_leads.marketing_consent - formularz jest niezweryfikowany; zgode marketingowa w CRM stawia potwierdzenie double opt-in newslettera (newsletter_to_lead).';

CREATE OR REPLACE FUNCTION public.crm_leads_marketing_consent_withdraw(p_lead_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_count integer;
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden: CRM staff role required';
  END IF;
  IF NOT (public.has_role(v_uid, 'admin') OR public.has_role(v_uid, 'editor')
          OR public.has_role(v_uid, 'super_admin')) THEN
    RAISE EXCEPTION 'forbidden: CRM staff role required';
  END IF;
  IF p_lead_ids IS NULL OR cardinality(p_lead_ids) = 0 THEN
    RETURN 0;
  END IF;
  IF cardinality(p_lead_ids) > 500 THEN
    RAISE EXCEPTION 'invalid_payload: at most 500 contacts at once';
  END IF;

  WITH changed AS (
    UPDATE public.crm_leads l
       SET marketing_consent = false,
           updated_at = now()
     WHERE l.tenant_id = v_tenant
       AND l.id = ANY (p_lead_ids)
    RETURNING l.id, COALESCE(NULLIF(btrim(l.email), ''), l.email_norm) AS email
  )
  INSERT INTO public.crm_consent_log (
    tenant_id, email, source_type, source_id, form_id, form_name,
    consent_key, consent_text, consent_version, given, ip, user_agent, lang
  )
  SELECT v_tenant, c.email, 'other'::public.crm_source_type, c.id,
         'crm_staff:withdraw', 'staff',
         'marketing',
         'Marketing consent withdrawn in the CRM by staff (manual change, e.g. on the contact''s request).',
         NULL, false, NULL, NULL, NULL
    FROM changed c
   WHERE c.email IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_leads_marketing_consent_withdraw(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_leads_marketing_consent_withdraw(uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.crm_leads_marketing_consent_withdraw(uuid[]) IS
  'R12 (REG-14): personel CRM (admin/editor/super_admin w najemcy z profilu) odznacza zgode marketingowa kontaktow ({p_lead_ids}, najwyzej 500): marketing_consent = false i wiersz crm_consent_log given=false (consent_key marketing, form_id crm_staff:withdraw, form_name staff) dla kazdego kontaktu najemcy - most wydarzen nie wskrzesza wtedy zgody. Kontakty innego najemcy pomijane. Zwraca liczbe objetych kontaktow. Najemca z current_tenant_id(), nigdy z ladunku.';