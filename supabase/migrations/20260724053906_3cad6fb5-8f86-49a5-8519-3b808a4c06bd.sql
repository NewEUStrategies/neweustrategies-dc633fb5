-- 1) crm_companies: restrict SELECT to CRM staff only (tenant-scoped)
DROP POLICY IF EXISTS crm_companies_tenant_read ON public.crm_companies;
CREATE POLICY crm_companies_staff_read ON public.crm_companies
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'super_admin'::app_role)
      OR public.has_role(auth.uid(), 'editor'::app_role)
    )
  );

-- 2) profiles: drop the anon row-level policy that exposed email/phone
--    Public author data remains available via the public.profiles_public view.
DROP POLICY IF EXISTS "Profiles anon public authors" ON public.profiles;