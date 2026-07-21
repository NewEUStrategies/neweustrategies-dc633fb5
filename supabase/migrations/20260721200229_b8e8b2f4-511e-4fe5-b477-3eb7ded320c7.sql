
-- 1) Extend crm_companies with company profile fields
ALTER TABLE public.crm_companies
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS branch text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2) Add current_company_id to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS current_company_id uuid REFERENCES public.crm_companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS profiles_current_company_id_idx
  ON public.profiles(current_company_id);

CREATE INDEX IF NOT EXISTS crm_companies_tenant_name_trgm_idx
  ON public.crm_companies USING gin (name_norm gin_trgm_ops);

-- 3) Rewrite RLS to allow authenticated members of a tenant to search + create
DROP POLICY IF EXISTS "crm_companies_staff_read" ON public.crm_companies;
DROP POLICY IF EXISTS "crm_companies_admin_write" ON public.crm_companies;

CREATE POLICY "crm_companies_tenant_read"
  ON public.crm_companies
  FOR SELECT
  TO authenticated
  USING (tenant_id = current_tenant_id());

CREATE POLICY "crm_companies_tenant_insert"
  ON public.crm_companies
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND created_by = auth.uid()
  );

CREATE POLICY "crm_companies_owner_or_staff_update"
  ON public.crm_companies
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (
      created_by = auth.uid()
      OR has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'super_admin'::app_role)
      OR has_role(auth.uid(), 'editor'::app_role)
    )
  )
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY "crm_companies_staff_delete"
  ON public.crm_companies
  FOR DELETE
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'super_admin'::app_role)
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.crm_companies TO authenticated;
GRANT ALL ON public.crm_companies TO service_role;

-- 4) RPC: link chosen company to current user's profile, tenant-safe
CREATE OR REPLACE FUNCTION public.link_current_company(_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_name text;
  v_profile_tenant uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT tenant_id INTO v_profile_tenant FROM public.profiles WHERE id = v_uid;

  IF _company_id IS NULL THEN
    UPDATE public.profiles
       SET current_company_id = NULL,
           current_company = NULL,
           updated_at = now()
     WHERE id = v_uid;
    RETURN;
  END IF;

  SELECT tenant_id, name INTO v_tenant, v_name
    FROM public.crm_companies
   WHERE id = _company_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'company_not_found';
  END IF;

  IF v_tenant IS DISTINCT FROM v_profile_tenant THEN
    RAISE EXCEPTION 'tenant_mismatch';
  END IF;

  UPDATE public.profiles
     SET current_company_id = _company_id,
         current_company = v_name,
         updated_at = now()
   WHERE id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.link_current_company(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.link_current_company(uuid) TO authenticated;
