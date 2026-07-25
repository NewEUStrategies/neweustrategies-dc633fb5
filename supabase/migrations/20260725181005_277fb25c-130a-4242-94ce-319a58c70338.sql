
-- ============================================================
-- Server-only log/queue tables: admin-only read, zero user write
-- (INSERT/UPDATE/DELETE going through service_role bypass RLS)
-- ============================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'client_errors','web_vitals','search_query_log','metered_views',
    'post_embeddings','notification_push_queue','command_idempotency'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.has_role(auth.uid(), ''admin''::public.app_role) OR public.has_role(auth.uid(), ''super_admin''::public.app_role))',
      t || '_admin_read', t
    );
  END LOOP;
END $$;

-- ============================================================
-- user_connections: own-visibility only
-- ============================================================

DROP POLICY IF EXISTS user_connections_self_read ON public.user_connections;
CREATE POLICY user_connections_self_read
ON public.user_connections
FOR SELECT
TO authenticated
USING (
  auth.uid() = requester_id
  OR auth.uid() = addressee_id
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
);

-- ============================================================
-- user_reports: reporter reads own; admins read tenant
-- Insert only as self within own tenant.
-- ============================================================

DROP POLICY IF EXISTS user_reports_self_read ON public.user_reports;
CREATE POLICY user_reports_self_read
ON public.user_reports
FOR SELECT
TO authenticated
USING (
  auth.uid() = reporter_id
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
);

DROP POLICY IF EXISTS user_reports_self_insert ON public.user_reports;
CREATE POLICY user_reports_self_insert
ON public.user_reports
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = reporter_id
  AND tenant_id = public.current_tenant_id()
);

DROP POLICY IF EXISTS user_reports_admin_update ON public.user_reports;
CREATE POLICY user_reports_admin_update
ON public.user_reports
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
);
