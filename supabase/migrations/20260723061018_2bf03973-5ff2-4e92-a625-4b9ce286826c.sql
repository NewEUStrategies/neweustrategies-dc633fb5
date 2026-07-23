ALTER TABLE public.member_organizations
  ADD COLUMN IF NOT EXISTS crm_company_id uuid
    REFERENCES public.crm_companies(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.member_organizations.crm_company_id IS
  'Kartoteka sprzedażowa tej organizacji (crm_companies). Utrzymywany triggerem po nazwie; NULL po skasowaniu firmy - trigger podepnie ponownie przy kolejnym zapisie.';

CREATE INDEX IF NOT EXISTS idx_member_orgs_crm_company
  ON public.member_organizations (crm_company_id) WHERE crm_company_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tg_member_orgs_sync_crm_company()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.crm_company_id IS NULL AND btrim(COALESCE(NEW.name, '')) <> '' THEN
    INSERT INTO public.crm_companies (tenant_id, name, website, city, country)
    VALUES (NEW.tenant_id, btrim(NEW.name), NEW.website_url, NEW.city, NEW.country)
    ON CONFLICT (tenant_id, name_norm) DO UPDATE
      SET website = COALESCE(public.crm_companies.website, EXCLUDED.website),
          city = COALESCE(public.crm_companies.city, EXCLUDED.city),
          country = COALESCE(public.crm_companies.country, EXCLUDED.country),
          updated_at = now()
    RETURNING id INTO NEW.crm_company_id;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_member_orgs_sync_crm_company ON public.member_organizations;
CREATE TRIGGER trg_member_orgs_sync_crm_company
  BEFORE INSERT OR UPDATE ON public.member_organizations
  FOR EACH ROW EXECUTE FUNCTION public.tg_member_orgs_sync_crm_company();

INSERT INTO public.crm_companies (tenant_id, name, website, city, country)
SELECT DISTINCT ON (mo.tenant_id, lower(btrim(mo.name)))
       mo.tenant_id, btrim(mo.name), mo.website_url, mo.city, mo.country
  FROM public.member_organizations mo
 WHERE mo.crm_company_id IS NULL
   AND btrim(COALESCE(mo.name, '')) <> ''
ON CONFLICT (tenant_id, name_norm) DO NOTHING;

UPDATE public.member_organizations mo
   SET crm_company_id = c.id
  FROM public.crm_companies c
 WHERE mo.crm_company_id IS NULL
   AND btrim(COALESCE(mo.name, '')) <> ''
   AND c.tenant_id = mo.tenant_id
   AND c.name_norm = lower(btrim(mo.name));