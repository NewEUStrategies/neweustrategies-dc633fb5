-- ============================================================
-- PR #47 residual: 20260708140000_members_tenant_and_doi_consent
-- ============================================================

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

  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'confirmed') THEN
    v_ua := NEW.user_agent;
    v_ip := CASE WHEN NEW.ip IS NULL THEN NULL ELSE host(NEW.ip) END;

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

-- ============================================================
-- PR #48: 20260708150000_web_vitals_tenant_scope
-- ============================================================

ALTER TABLE public.web_vitals
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;

UPDATE public.web_vitals
   SET tenant_id = public.public_tenant_id()
 WHERE tenant_id IS NULL;

ALTER TABLE public.web_vitals ALTER COLUMN tenant_id SET DEFAULT public.public_tenant_id();
ALTER TABLE public.web_vitals ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS web_vitals_tenant_metric_created_idx
  ON public.web_vitals (tenant_id, metric, created_at DESC);

DROP FUNCTION IF EXISTS public.web_vitals_daily_p75(timestamptz);
CREATE OR REPLACE FUNCTION public.web_vitals_daily_p75(p_since timestamptz, p_tenant uuid)
RETURNS TABLE (day date, metric text, p75 double precision, samples bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT
    (created_at AT TIME ZONE 'UTC')::date AS day,
    metric,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75,
    count(*)::bigint AS samples
  FROM public.web_vitals
  WHERE created_at >= p_since
    AND tenant_id = p_tenant
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;

REVOKE ALL ON FUNCTION public.web_vitals_daily_p75(timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.web_vitals_daily_p75(timestamptz, uuid) TO service_role;

-- ============================================================
-- PR #48: 20260708160000_newsletter_email_ci_unique
-- ============================================================

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY tenant_id, lower(email)
      ORDER BY
        (status = 'subscribed') DESC,
        (status = 'pending') DESC,
        created_at ASC
    ) AS rn
  FROM public.newsletter_subscribers
)
DELETE FROM public.newsletter_subscribers ns
USING ranked r
WHERE ns.id = r.id
  AND r.rn > 1;

UPDATE public.newsletter_subscribers
   SET email = lower(email)
 WHERE email <> lower(email);

CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscribers_tenant_email_ci_uniq
  ON public.newsletter_subscribers (tenant_id, lower(email));
