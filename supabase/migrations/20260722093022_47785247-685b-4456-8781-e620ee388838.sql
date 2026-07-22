-- Silniejsza identyfikacja: osoba (profil) ↔ firma ↔ CRM lead.
-- 1) Sync do crm_leads propaguje także current_company_id → crm_leads.company_id.
-- 2) Trigger nasłuchuje na kolumnie current_company_id.
-- 3) Backfill istniejących leadów po e-mailu profilu.

CREATE OR REPLACE FUNCTION public.crm_upsert_lead_from_profile(_profile_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  p RECORD;
  _phone_norm text;
  _safe_phone text;
BEGIN
  SELECT id, email, tenant_id, first_name, last_name, display_name, phone,
         current_company, current_company_id, job_title, linkedin_url, location
    INTO p
    FROM public.profiles WHERE id = _profile_id;
  IF NOT FOUND OR p.email IS NULL OR length(trim(p.email)) = 0 THEN
    RETURN;
  END IF;

  _phone_norm := NULLIF(regexp_replace(COALESCE(p.phone, ''), '\s+', '', 'g'), '');
  _safe_phone := p.phone;
  IF _phone_norm IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.crm_leads
     WHERE tenant_id = COALESCE(p.tenant_id, public_tenant_id())
       AND phone_norm = _phone_norm
       AND email_norm <> lower(trim(p.email))
  ) THEN
    _safe_phone := NULL;
  END IF;

  INSERT INTO public.crm_leads (
    tenant_id, email, email_norm, first_name, last_name, phone, company, company_id, position, linkedin_url, country,
    stage, marketing_consent, last_activity_at
  ) VALUES (
    COALESCE(p.tenant_id, public_tenant_id()),
    p.email, lower(trim(p.email)),
    COALESCE(p.first_name, split_part(COALESCE(p.display_name, ''), ' ', 1)),
    COALESCE(p.last_name, NULLIF(split_part(COALESCE(p.display_name, ''), ' ', 2), '')),
    _safe_phone, p.current_company, p.current_company_id, p.job_title, p.linkedin_url, p.location,
    'new'::crm_stage, false, now()
  )
  ON CONFLICT (tenant_id, email_norm) DO UPDATE
    SET first_name   = COALESCE(EXCLUDED.first_name, public.crm_leads.first_name),
        last_name    = COALESCE(EXCLUDED.last_name, public.crm_leads.last_name),
        phone        = COALESCE(public.crm_leads.phone, EXCLUDED.phone),
        company      = COALESCE(EXCLUDED.company, public.crm_leads.company),
        company_id   = COALESCE(EXCLUDED.company_id, public.crm_leads.company_id),
        position     = COALESCE(EXCLUDED.position, public.crm_leads.position),
        linkedin_url = COALESCE(EXCLUDED.linkedin_url, public.crm_leads.linkedin_url),
        country      = COALESCE(EXCLUDED.country, public.crm_leads.country),
        updated_at   = now();
EXCEPTION WHEN unique_violation THEN
  INSERT INTO public.crm_leads (
    tenant_id, email, email_norm, first_name, last_name, company, company_id, position, linkedin_url, country,
    stage, marketing_consent, last_activity_at
  ) VALUES (
    COALESCE(p.tenant_id, public_tenant_id()),
    p.email, lower(trim(p.email)),
    COALESCE(p.first_name, split_part(COALESCE(p.display_name, ''), ' ', 1)),
    COALESCE(p.last_name, NULLIF(split_part(COALESCE(p.display_name, ''), ' ', 2), '')),
    p.current_company, p.current_company_id, p.job_title, p.linkedin_url, p.location,
    'new'::crm_stage, false, now()
  )
  ON CONFLICT (tenant_id, email_norm) DO NOTHING;
END $function$;

-- Nasłuch również na current_company_id.
DROP TRIGGER IF EXISTS profile_sync_crm_lead ON public.profiles;
CREATE TRIGGER profile_sync_crm_lead
AFTER INSERT OR UPDATE OF email, first_name, last_name, phone, current_company, current_company_id, job_title, linkedin_url, location
ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public._trg_profile_to_crm();

-- Backfill: dopisz company_id do istniejących leadów, dopasowując po e-mailu profilu.
UPDATE public.crm_leads l
   SET company_id = p.current_company_id,
       company    = COALESCE(l.company, p.current_company)
  FROM public.profiles p
 WHERE l.tenant_id = p.tenant_id
   AND l.company_id IS NULL
   AND p.current_company_id IS NOT NULL
   AND l.email_norm = lower(trim(p.email));

-- Backfill po nazwie firmy (dla leadów bez profilu, ale z tekstową firmą pasującą do crm_companies).
UPDATE public.crm_leads l
   SET company_id = c.id
  FROM public.crm_companies c
 WHERE l.company_id IS NULL
   AND l.tenant_id = c.tenant_id
   AND l.company IS NOT NULL
   AND lower(trim(l.company)) = lower(trim(c.name));