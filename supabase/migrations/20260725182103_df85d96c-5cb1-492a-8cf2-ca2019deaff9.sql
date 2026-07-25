-- Fix crm_tasks tenant default (was public_tenant_id, causing staff inserts to fail RLS)
ALTER TABLE public.crm_tasks ALTER COLUMN tenant_id SET DEFAULT current_tenant_id();

-- Normalize crm_leads: email_norm is NOT NULL and required by unique index,
-- phone_norm feeds a partial unique index.
CREATE OR REPLACE FUNCTION public.crm_normalize_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.email_norm := lower(trim(NEW.email));
  IF NEW.phone IS NOT NULL AND length(trim(NEW.phone)) > 0 THEN
    NEW.phone_norm := lower(regexp_replace(trim(NEW.phone), '[^0-9+]', '', 'g'));
  ELSE
    NEW.phone_norm := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_leads_normalize_trg ON public.crm_leads;
CREATE TRIGGER crm_leads_normalize_trg
  BEFORE INSERT OR UPDATE ON public.crm_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.crm_normalize_lead();

-- Backfill existing rows so the unique (tenant_id, email_norm) index stays valid
UPDATE public.crm_leads
SET email_norm = lower(trim(email))
WHERE email_norm IS NULL OR email_norm = '';

UPDATE public.crm_leads
SET phone_norm = lower(regexp_replace(trim(phone), '[^0-9+]', '', 'g'))
WHERE phone IS NOT NULL AND phone <> '' AND (phone_norm IS NULL OR phone_norm = '');