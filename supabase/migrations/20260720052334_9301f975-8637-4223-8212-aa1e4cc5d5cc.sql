-- Tenant-scope RLS on profile_recommendations and user_roles self-view.

DROP POLICY IF EXISTS "prof_rec_read" ON public.profile_recommendations;
CREATE POLICY "prof_rec_read" ON public.profile_recommendations
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (
      author_id = auth.uid()
      OR recipient_id = auth.uid()
      OR status = 'published'
    )
  );

DROP POLICY IF EXISTS "Users view own roles" ON public.user_roles;
CREATE POLICY "Users view own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id AND tenant_id = public.current_tenant_id());
