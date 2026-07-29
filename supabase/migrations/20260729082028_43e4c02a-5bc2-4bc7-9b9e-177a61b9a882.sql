CREATE POLICY "Admins read tenant subscriptions"
ON public.subscriptions
FOR SELECT
TO authenticated
USING (
  (has_role((SELECT auth.uid()), 'admin'::app_role) OR has_role((SELECT auth.uid()), 'super_admin'::app_role))
  AND tenant_id = (SELECT current_tenant_id())
);

CREATE INDEX IF NOT EXISTS payment_webhook_events_created_idx
  ON public.payment_webhook_events (created_at DESC);
CREATE INDEX IF NOT EXISTS payment_webhook_events_sub_idx
  ON public.payment_webhook_events (subscription_id);