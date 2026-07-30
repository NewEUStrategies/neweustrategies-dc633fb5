-- payment_webhook_events: platform-level only (no tenant_id column)
DROP POLICY IF EXISTS "payment_webhook_events admin read" ON public.payment_webhook_events;
CREATE POLICY "payment_webhook_events admin read"
  ON public.payment_webhook_events FOR SELECT TO authenticated
  USING (public.is_super_admin());

-- user_reports
DROP POLICY IF EXISTS "user_reports_self_read" ON public.user_reports;
CREATE POLICY "user_reports_self_read"
  ON public.user_reports FOR SELECT TO authenticated
  USING (
    (auth.uid() = reporter_id AND tenant_id = public.current_tenant_id())
    OR (
      tenant_id = public.current_tenant_id()
      AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
    )
  );

DROP POLICY IF EXISTS "user_reports_admin_update" ON public.user_reports;
CREATE POLICY "user_reports_admin_update"
  ON public.user_reports FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
  );

-- analytics_events
DROP POLICY IF EXISTS "analytics_events_admin_read" ON public.analytics_events;
CREATE POLICY "analytics_events_admin_read"
  ON public.analytics_events FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
  );

-- client_errors
DROP POLICY IF EXISTS "client_errors_admin_read" ON public.client_errors;
CREATE POLICY "client_errors_admin_read"
  ON public.client_errors FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
  );

-- command_idempotency
DROP POLICY IF EXISTS "command_idempotency_admin_read" ON public.command_idempotency;
CREATE POLICY "command_idempotency_admin_read"
  ON public.command_idempotency FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
  );

-- metered_views
DROP POLICY IF EXISTS "metered_views_admin_read" ON public.metered_views;
CREATE POLICY "metered_views_admin_read"
  ON public.metered_views FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
  );

-- notification_push_queue
DROP POLICY IF EXISTS "notification_push_queue_admin_read" ON public.notification_push_queue;
CREATE POLICY "notification_push_queue_admin_read"
  ON public.notification_push_queue FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
  );

-- post_embeddings
DROP POLICY IF EXISTS "post_embeddings_admin_read" ON public.post_embeddings;
CREATE POLICY "post_embeddings_admin_read"
  ON public.post_embeddings FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
  );

-- search_query_log
DROP POLICY IF EXISTS "search_query_log_admin_read" ON public.search_query_log;
CREATE POLICY "search_query_log_admin_read"
  ON public.search_query_log FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
  );

-- web_vitals
DROP POLICY IF EXISTS "web_vitals_admin_read" ON public.web_vitals;
CREATE POLICY "web_vitals_admin_read"
  ON public.web_vitals FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
  );