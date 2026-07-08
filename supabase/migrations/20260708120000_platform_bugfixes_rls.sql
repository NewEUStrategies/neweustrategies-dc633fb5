-- Platform bug fixes: close cross-tenant / anon holes in the CRM and builder
-- surfaces. All three issues are regressions where a later hardening pass missed
-- one object (an ACL, a policy, or a duplicate residual policy).
--
--   1. crm_upsert_from_form(..., jsonb) — the 11-arg overload was created
--      SECURITY DEFINER but never REVOKE-d from PUBLIC, so anon/authenticated
--      could write into ANY tenant's CRM (the 10-arg sibling is locked down).
--   2. crm_companies RLS checked only the caller's role, never the row's tenant,
--      so any staff member could read/write every tenant's company data.
--   3. Duplicate builder migrations left permissive residual policies
--      (USING(true) / status-only) that OR-combine with — and defeat — the
--      tenant-scoped policies added in 20260703052115.

-- 1) Lock the jsonb overload down to service_role, matching the 10-arg sibling.
REVOKE ALL ON FUNCTION public.crm_upsert_from_form(
  uuid, text, text, text, text, text, text, text, text, text, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_upsert_from_form(
  uuid, text, text, text, text, text, text, text, text, text, jsonb
) FROM anon;
REVOKE ALL ON FUNCTION public.crm_upsert_from_form(
  uuid, text, text, text, text, text, text, text, text, text, jsonb
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.crm_upsert_from_form(
  uuid, text, text, text, text, text, text, text, text, text, jsonb
) TO service_role;

-- 2) Scope crm_companies to the caller's own tenant (mirror crm_leads).
DROP POLICY IF EXISTS crm_companies_staff_read ON public.crm_companies;
CREATE POLICY crm_companies_staff_read ON public.crm_companies
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'super_admin')
      OR public.has_role(auth.uid(), 'editor')
    )
  );

DROP POLICY IF EXISTS crm_companies_admin_write ON public.crm_companies;
CREATE POLICY crm_companies_admin_write ON public.crm_companies
  FOR ALL TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  );

-- 3) Drop the residual permissive builder policies. The tenant-scoped
--    replacements created in 20260703052115 ("global widgets public read",
--    "popups public read active", "experiment events public insert") remain and
--    keep the public site working, now correctly confined to one tenant.
DROP POLICY IF EXISTS "bgw_public_read" ON public.builder_global_widgets;
DROP POLICY IF EXISTS "popups_public_read_active" ON public.builder_popups;
DROP POLICY IF EXISTS "bxe_insert_public" ON public.builder_experiment_events;
