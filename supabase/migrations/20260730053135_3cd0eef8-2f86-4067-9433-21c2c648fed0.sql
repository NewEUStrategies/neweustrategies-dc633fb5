DROP POLICY IF EXISTS crm_companies_tenant_insert ON public.crm_companies;

CREATE POLICY crm_companies_staff_insert
ON public.crm_companies
FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND created_by = auth.uid()
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'editor'::app_role)
  )
);