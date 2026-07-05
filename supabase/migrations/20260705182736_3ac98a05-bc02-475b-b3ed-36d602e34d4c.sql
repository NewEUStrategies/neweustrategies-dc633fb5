
-- Auto-log RODO consents into crm_consent_log for contact form and newsletter submissions

CREATE OR REPLACE FUNCTION public.contact_messages_to_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

  -- Upsert lead (always forwards phone/company when present on NEW.*)
  PERFORM public.crm_upsert_lead(
    NEW.tenant_id, NEW.email,
    v_first, v_last,
    NEW.phone, NEW.company,
    NEW.newsletter_opt_in, NEW.consent
  );

  -- Map form_type to consent-log source_type
  v_source_type := CASE
    WHEN NEW.form_type = 'newsletter' THEN 'newsletter'::crm_source_type
    ELSE 'contact_form'::crm_source_type
  END;

  -- 1) Rich consents captured on the form (array of {key,text,version,given,lang})
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

  -- 2) Fallback: RODO / newsletter flags (only if not already logged via consents[])
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


CREATE OR REPLACE FUNCTION public.newsletter_to_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item jsonb;
  v_ua   text;
  v_ip   text;
BEGIN
  PERFORM public.crm_upsert_lead(
    NEW.tenant_id, NEW.email, NEW.first_name, NEW.last_name,
    NULL, NULL, true, true
  );
  UPDATE public.crm_leads
     SET newsletter_status = NEW.status
   WHERE tenant_id = NEW.tenant_id AND email_norm = lower(NEW.email);

  -- Only log consents on INSERT or when status flips to confirmed
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'confirmed') THEN
    v_ua := NEW.user_agent;
    v_ip := CASE WHEN NEW.ip IS NULL THEN NULL ELSE host(NEW.ip) END;

    -- Rich consents payload
    IF NEW.consents IS NOT NULL AND jsonb_typeof(NEW.consents) = 'array' THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.consents)
      LOOP
        IF (v_item ? 'key') AND (v_item ? 'text') THEN
          INSERT INTO public.crm_consent_log (
            tenant_id, email, source_type, source_id, form_id, form_name,
            consent_key, consent_text, consent_version, given, ip, user_agent, lang
          ) VALUES (
            NEW.tenant_id, NEW.email, 'newsletter'::crm_source_type, NEW.id,
            NEW.source_form_id, NEW.source_form_name,
            v_item->>'key',
            v_item->>'text',
            NULLIF(v_item->>'version',''),
            COALESCE((v_item->>'given')::boolean, true),
            v_ip, v_ua, COALESCE(v_item->>'lang', NEW.language)
          );
        END IF;
      END LOOP;
    END IF;

    -- Fallback: implicit newsletter subscription consent when nothing rich was captured
    IF (NEW.consents IS NULL OR jsonb_typeof(NEW.consents) <> 'array' OR jsonb_array_length(NEW.consents) = 0) THEN
      INSERT INTO public.crm_consent_log (
        tenant_id, email, source_type, source_id, form_id, form_name,
        consent_key, consent_text, given, ip, user_agent, lang
      ) VALUES (
        NEW.tenant_id, NEW.email, 'newsletter'::crm_source_type, NEW.id,
        NEW.source_form_id, NEW.source_form_name,
        'newsletter',
        'Zapisuję się do newslettera i akceptuję otrzymywanie wiadomości marketingowych.',
        true, v_ip, v_ua, NEW.language
      );
    END IF;
  END IF;

  RETURN NEW;
END $function$;
