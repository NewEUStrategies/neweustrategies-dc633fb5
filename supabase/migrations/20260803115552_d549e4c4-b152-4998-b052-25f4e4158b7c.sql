DROP POLICY IF EXISTS "Author deletes own notes" ON public.crm_lead_notes;
CREATE POLICY "Author deletes own notes"
ON public.crm_lead_notes
FOR DELETE
USING (
  (
    tenant_id = current_tenant_id()
    AND (author_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  )
  OR is_super_admin()
);

DROP POLICY IF EXISTS "Author edits own notes" ON public.crm_lead_notes;
CREATE POLICY "Author edits own notes"
ON public.crm_lead_notes
FOR UPDATE
USING (
  (tenant_id = current_tenant_id() AND author_id = auth.uid())
  OR is_super_admin()
)
WITH CHECK (
  (tenant_id = current_tenant_id() AND author_id = auth.uid())
  OR is_super_admin()
);

DROP POLICY IF EXISTS user_pending_counters_own_select ON public.user_pending_counters;
CREATE POLICY user_pending_counters_own_select
ON public.user_pending_counters
FOR SELECT
USING (user_id = auth.uid() AND tenant_id = current_tenant_id());