DROP POLICY IF EXISTS "crm_companies_owner_or_staff_update" ON public.crm_companies;

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
WITH CHECK (
  tenant_id = current_tenant_id()
  AND (
    created_by = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'editor'::app_role)
  )
);