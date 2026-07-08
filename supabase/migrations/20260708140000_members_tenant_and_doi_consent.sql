-- Two access/consent-integrity fixes.

-- 1) has_content_access: a 'members' (free logged-in tier) gate returned true
--    for ANY authenticated user, so a reader registered on tenant A could read
--    tenant B's members-only content while browsing B. Require the caller to
--    belong to the content's own tenant.
CREATE OR REPLACE FUNCTION public.has_content_access(
  _entity_type access_entity_type,
  _entity_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode access_mode;
  v_plans uuid[];
  v_tenant uuid;
  v_uid uuid := auth.uid();
BEGIN
  SELECT mode, plan_ids, tenant_id INTO v_mode, v_plans, v_tenant
    FROM public.content_access
   WHERE entity_type = _entity_type AND entity_id = _entity_id;

  IF NOT FOUND OR v_mode = 'public' THEN
    RETURN true;
  END IF;

  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  IF v_mode = 'members' THEN
    -- Members must belong to the content's tenant, not merely be logged in.
    RETURN EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = v_uid AND p.tenant_id = v_tenant
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_purchases
     WHERE user_id = v_uid
       AND entity_type = _entity_type
       AND entity_id = _entity_id
       AND status = 'active'
  ) THEN
    RETURN true;
  END IF;

  IF array_length(v_plans, 1) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_subscriptions
     WHERE user_id = v_uid
       AND plan_id = ANY (v_plans)
       AND status = 'active'
       AND (current_period_end IS NULL OR current_period_end > now())
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END $$;

-- 2) newsletter_to_lead: the CRM lead was created with marketing_consent=true
--    even for a pending (unconfirmed) double-opt-in subscriber, defeating the
--    entire purpose of DOI. Grant marketing consent only once the address is
--    actually subscribed. crm_upsert_lead OR-merges the flag, so the later
--    pending->subscribed status flip (which re-fires this trigger) upgrades it.
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
    NULL, NULL, true, (NEW.status = 'subscribed')
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
