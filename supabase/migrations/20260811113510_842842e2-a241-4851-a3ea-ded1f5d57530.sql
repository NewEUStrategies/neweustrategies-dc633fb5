-- 1) UPDATE policies: WITH CHECK must mirror USING (role/ownership), not only tenant.

DROP POLICY IF EXISTS "templates_update_tenant" ON public.builder_templates;
CREATE POLICY "templates_update_tenant"
ON public.builder_templates
FOR UPDATE
TO authenticated
USING (
  tenant_id = current_tenant_id()
  AND (
    auth.uid() = created_by
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'editor'::app_role)
  )
)
WITH CHECK (
  tenant_id = current_tenant_id()
  AND (
    auth.uid() = created_by
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'editor'::app_role)
  )
);

DROP POLICY IF EXISTS "ldv_staff_update" ON public.legal_document_versions;
CREATE POLICY "ldv_staff_update"
ON public.legal_document_versions
FOR UPDATE
TO authenticated
USING (
  tenant_id = current_tenant_id()
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'editor'::app_role)
  )
)
WITH CHECK (
  tenant_id = current_tenant_id()
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'editor'::app_role)
  )
);

DROP POLICY IF EXISTS "newsletter staff update" ON public.newsletter_subscribers;
CREATE POLICY "newsletter staff update"
ON public.newsletter_subscribers
FOR UPDATE
TO authenticated
USING (
  tenant_id = current_tenant_id()
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'editor'::app_role)
  )
)
WITH CHECK (
  tenant_id = current_tenant_id()
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'editor'::app_role)
  )
);

DROP POLICY IF EXISTS "design_tokens staff update tenant" ON public.site_design_tokens;
CREATE POLICY "design_tokens staff update tenant"
ON public.site_design_tokens
FOR UPDATE
TO authenticated
USING (
  tenant_id = current_tenant_id()
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'editor'::app_role)
  )
)
WITH CHECK (
  tenant_id = current_tenant_id()
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'editor'::app_role)
  )
);

-- 2) Pin search_path on the remaining project-owned functions.
ALTER FUNCTION public.nes_profile_open_to_catalog() SET search_path = public;
ALTER FUNCTION public.nes_profile_completeness_row(
  text, text, text, text, text, text, text, text, text, text, text[], text, text, integer, integer, integer
) SET search_path = public;