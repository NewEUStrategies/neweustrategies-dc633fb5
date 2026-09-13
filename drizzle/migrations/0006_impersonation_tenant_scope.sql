UPDATE public.impersonation_sessions AS s
   SET tenant_id = p.tenant_id
  FROM public.profiles AS p
 WHERE p.id = s.actor_user_id
   AND s.tenant_id IS NULL;

DROP POLICY IF EXISTS "super_admin_read_impersonation" ON public.impersonation_sessions;

CREATE POLICY "super_admin_read_impersonation"
  ON public.impersonation_sessions
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = (select public.current_tenant_id())
    AND (select public.is_super_admin())
  );

CREATE INDEX IF NOT EXISTS idx_impersonation_tenant
  ON public.impersonation_sessions(tenant_id, started_at DESC);