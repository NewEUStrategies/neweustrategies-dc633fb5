
-- 1. Phone normalization + dedup on crm_leads
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS phone_norm text;

CREATE OR REPLACE FUNCTION public.crm_normalize_phone(_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _phone IS NULL OR length(trim(_phone)) = 0 THEN NULL
    ELSE nullif(
      CASE WHEN left(trim(_phone), 1) = '+' THEN '+' ELSE '' END
      || regexp_replace(_phone, '[^0-9]', '', 'g'),
    '')
  END
$$;

-- Backfill
UPDATE public.crm_leads SET phone_norm = public.crm_normalize_phone(phone)
 WHERE phone IS NOT NULL AND phone_norm IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS crm_leads_tenant_phone_norm_uniq
  ON public.crm_leads (tenant_id, phone_norm)
  WHERE phone_norm IS NOT NULL;

-- 2. Replace upsert function with dedup-by-email-or-phone
CREATE OR REPLACE FUNCTION public.crm_upsert_lead(
  _tenant uuid, _email text, _first_name text, _last_name text,
  _phone text, _company text, _newsletter boolean, _marketing boolean)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := coalesce(_tenant, public.public_tenant_id());
  v_norm text;
  v_phone_norm text := public.crm_normalize_phone(_phone);
  v_id uuid;
BEGIN
  IF _email IS NULL OR length(trim(_email)) = 0 THEN RETURN NULL; END IF;
  v_norm := lower(trim(_email));

  -- Find existing by email OR phone (within tenant)
  SELECT id INTO v_id FROM public.crm_leads
   WHERE tenant_id = v_tenant
     AND (email_norm = v_norm OR (v_phone_norm IS NOT NULL AND phone_norm = v_phone_norm))
   ORDER BY (email_norm = v_norm) DESC, last_activity_at DESC
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.crm_leads SET
      email      = coalesce(email, _email),
      email_norm = coalesce(email_norm, v_norm),
      first_name = coalesce(_first_name, first_name),
      last_name  = coalesce(_last_name, last_name),
      phone      = coalesce(phone, _phone),
      phone_norm = coalesce(phone_norm, v_phone_norm),
      company    = coalesce(_company, company),
      newsletter_status = coalesce(
        CASE WHEN _newsletter THEN 'pending' ELSE NULL END,
        newsletter_status),
      marketing_consent = marketing_consent OR coalesce(_marketing, false),
      source_count = source_count + 1,
      last_activity_at = now()
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.crm_leads (
    tenant_id, email_norm, email, first_name, last_name, phone, phone_norm, company,
    newsletter_status, marketing_consent, source_count, last_activity_at
  ) VALUES (
    v_tenant, v_norm, _email, _first_name, _last_name, _phone, v_phone_norm, _company,
    CASE WHEN _newsletter THEN 'pending' ELSE NULL END,
    coalesce(_marketing, false), 1, now()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END $$;

-- Keep phone_norm in sync on direct updates
CREATE OR REPLACE FUNCTION public.crm_leads_sync_phone_norm()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.phone_norm := public.crm_normalize_phone(NEW.phone);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS crm_leads_sync_phone_norm_trg ON public.crm_leads;
CREATE TRIGGER crm_leads_sync_phone_norm_trg
  BEFORE INSERT OR UPDATE OF phone ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.crm_leads_sync_phone_norm();

-- 3. Consent mapping on crm_integrations
ALTER TABLE public.crm_integrations
  ADD COLUMN IF NOT EXISTS consent_mapping jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.crm_integrations.consent_mapping IS
  'Array of {source_key, source_label, merydian_field, merydian_category, required} mapping form-consent keys to Merydian fields/categories.';
