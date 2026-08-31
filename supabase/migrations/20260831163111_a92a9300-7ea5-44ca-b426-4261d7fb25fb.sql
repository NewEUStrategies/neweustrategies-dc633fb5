-- Plaszczyzna wlasciciela w module platnosci i czlonkostw: odczyt MUSI wiazac
-- tenanta, nie tylko wlasciciela.

-- subscriptions ---------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own subscription" ON public.subscriptions;
CREATE POLICY "Users can view own subscription"
  ON public.subscriptions FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

-- membership_grants -----------------------------------------------------------
DROP POLICY IF EXISTS "grants own read" ON public.membership_grants;
CREATE POLICY "grants own read" ON public.membership_grants
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

-- organization_seats ----------------------------------------------------------
DROP POLICY IF EXISTS "seats own read" ON public.organization_seats;
CREATE POLICY "seats own read" ON public.organization_seats
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

-- user_purchases --------------------------------------------------------------
DROP POLICY IF EXISTS "purchases owner read" ON public.user_purchases;
CREATE POLICY "purchases owner read"
  ON public.user_purchases FOR SELECT TO authenticated
  USING (
    (user_id = (SELECT auth.uid()) AND tenant_id = (SELECT public.current_tenant_id()))
    OR (
      tenant_id = (SELECT public.current_tenant_id())
      AND has_role((SELECT auth.uid()), 'admin'::app_role)
    )
  );

-- user_subscriptions ----------------------------------------------------------
DROP POLICY IF EXISTS "subs owner read" ON public.user_subscriptions;
CREATE POLICY "subs owner read"
  ON public.user_subscriptions FOR SELECT TO authenticated
  USING (
    (user_id = (SELECT auth.uid()) AND tenant_id = (SELECT public.current_tenant_id()))
    OR (
      tenant_id = (SELECT public.current_tenant_id())
      AND has_role((SELECT auth.uid()), 'admin'::app_role)
    )
  );

-- post_gift_links --------------------------------------------------------------
DROP POLICY IF EXISTS "gift links owner read" ON public.post_gift_links;
CREATE POLICY "gift links owner read"
  ON public.post_gift_links FOR SELECT
  TO authenticated
  USING (
    (created_by = (SELECT auth.uid()) AND tenant_id = (SELECT public.current_tenant_id()))
    OR (
      tenant_id = (SELECT public.current_tenant_id())
      AND (has_role((SELECT auth.uid()), 'admin'::app_role) OR has_role((SELECT auth.uid()), 'editor'::app_role))
    )
  );

COMMENT ON COLUMN public.payment_webhook_events.tenant_id IS
  'Tenant platnika (NOT NULL, default email_default_tenant_id(), wiazany triggerem payment_webhook_events_bind_tenant). Sluzy indeksowaniu i raportom per obszar roboczy. Polityka odczytu celowo NIE zaweza po tenancie: jedyny podmiot czytajacy to super admin (rola platformowa), ktory diagnozuje takze zdarzenia sprzed powiazania platnika.';