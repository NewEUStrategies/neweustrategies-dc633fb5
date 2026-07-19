
DROP POLICY IF EXISTS "endorse_read" ON public.profile_skill_endorsements;
CREATE POLICY "endorse_read" ON public.profile_skill_endorsements
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id());
