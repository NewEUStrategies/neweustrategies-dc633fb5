-- 1) billing_documents: tylko admin/super_admin (zamiast is_staff(), które obejmuje autorów)
DROP POLICY IF EXISTS "billing_documents_staff_select" ON public.billing_documents;
CREATE POLICY "billing_documents_admin_select"
  ON public.billing_documents FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'super_admin'::app_role)
    )
  );

-- 2) email_delivery_events / email_suppressions: admin + editor (bez autorów)
DROP POLICY IF EXISTS "email_delivery_events_staff_select" ON public.email_delivery_events;
CREATE POLICY "email_delivery_events_admin_editor_select"
  ON public.email_delivery_events FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'editor'::app_role)
      OR public.has_role(auth.uid(), 'super_admin'::app_role)
    )
  );

DROP POLICY IF EXISTS "email_suppressions_staff_select" ON public.email_suppressions;
CREATE POLICY "email_suppressions_admin_editor_select"
  ON public.email_suppressions FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'editor'::app_role)
      OR public.has_role(auth.uid(), 'super_admin'::app_role)
    )
  );

-- 3) payment_orders: walidacja kwoty/waluty/planu przy insertach użytkownika
CREATE OR REPLACE FUNCTION public.payment_orders_secure_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  plan_row public.access_plans%ROWTYPE;
BEGIN
  -- Service role (webhooki, narzędzia serwerowe) omija walidację.
  IF current_setting('role', true) = 'service_role'
     OR current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Wymuszenie bezpiecznego stanu początkowego dla zamówień użytkownika.
  NEW.status := 'pending';
  NEW.provider_session_id := NULL;
  NEW.provider_intent_id := NULL;
  NEW.invoice_url := NULL;
  NEW.paid_at := NULL;

  IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'payment_orders.user_id must match auth.uid()';
  END IF;

  -- Waluta: kod ISO 4217, znormalizowany do wielkich liter.
  NEW.currency := upper(coalesce(NEW.currency, ''));
  IF NEW.currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'payment_orders.currency must be a 3-letter ISO code';
  END IF;

  -- Kwota: nieujemna i w rozsądnym zakresie (ochrona przed śmieciowymi rekordami).
  IF NEW.amount_cents IS NULL OR NEW.amount_cents < 0 OR NEW.amount_cents > 100000000 THEN
    RAISE EXCEPTION 'payment_orders.amount_cents out of allowed range';
  END IF;

  -- Plan musi należeć do tenanta wywołującego i być aktywny.
  IF NEW.plan_id IS NOT NULL THEN
    SELECT * INTO plan_row
      FROM public.access_plans
     WHERE id = NEW.plan_id
       AND tenant_id = NEW.tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'payment_orders.plan_id does not belong to this tenant';
    END IF;
    IF NOT plan_row.active THEN
      RAISE EXCEPTION 'payment_orders.plan_id refers to an inactive plan';
    END IF;
    -- Kwota nie może przewyższać ceny planu w jego walucie. Rabaty (kupony)
    -- obniżają kwotę i pozostają dozwolone; przeliczenie na inną walutę
    -- prezentacji odbywa się poza tym warunkiem.
    IF NEW.currency = upper(plan_row.currency) AND NEW.amount_cents > plan_row.price_cents THEN
      RAISE EXCEPTION 'payment_orders.amount_cents exceeds plan price';
    END IF;
  END IF;

  -- Spójność referencji do encji (bilet/wydarzenie itp.).
  IF NEW.entity_id IS NOT NULL AND NEW.entity_type IS NULL THEN
    RAISE EXCEPTION 'payment_orders.entity_type is required when entity_id is set';
  END IF;

  RETURN NEW;
END;
$function$;