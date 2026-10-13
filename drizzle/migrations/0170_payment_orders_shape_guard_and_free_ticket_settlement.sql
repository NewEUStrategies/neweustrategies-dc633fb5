CREATE OR REPLACE FUNCTION public.payment_orders_secure_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  plan_row public.access_plans%ROWTYPE;
  v_meta jsonb;
BEGIN
  IF current_setting('role', true) = 'service_role'
     OR current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;
  NEW.status := 'pending';
  NEW.provider_session_id := NULL;
  NEW.provider_intent_id := NULL;
  NEW.invoice_url := NULL;
  NEW.paid_at := NULL;
  IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'payment_orders.user_id must match auth.uid()';
  END IF;
  NEW.currency := upper(coalesce(NEW.currency, ''));
  IF NEW.currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'payment_orders.currency must be a 3-letter ISO code';
  END IF;
  IF NEW.amount_cents IS NULL OR NEW.amount_cents < 0 OR NEW.amount_cents > 100000000 THEN
    RAISE EXCEPTION 'payment_orders.amount_cents out of allowed range';
  END IF;
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
    IF NEW.kind::text = 'one_time' AND plan_row.interval::text <> 'one_time' THEN
      RAISE EXCEPTION 'plan_not_one_time: a recurring plan cannot be bought as a one-time purchase';
    END IF;
    IF NEW.currency = upper(plan_row.currency) AND NEW.amount_cents > plan_row.price_cents THEN
      RAISE EXCEPTION 'payment_orders.amount_cents exceeds plan price';
    END IF;
  END IF;
  IF NEW.entity_id IS NOT NULL AND NEW.entity_type IS NULL THEN
    RAISE EXCEPTION 'payment_orders.entity_type is required when entity_id is set';
  END IF;
  v_meta := COALESCE(NEW.metadata, '{}'::jsonb);
  IF (v_meta ? 'event_id' OR v_meta ? 'registration_id' OR v_meta ? 'ticket_type_id')
     AND (NEW.kind::text <> 'one_time' OR NEW.plan_id IS NOT NULL OR NEW.entity_id IS NOT NULL) THEN
    RAISE EXCEPTION 'ticket_order_conflict: ticket metadata on a plan or content order';
  END IF;
  IF v_meta ? 'registration_id' AND NOT (v_meta ? 'ticket_type_id' AND v_meta ? 'event_id') THEN
    RAISE EXCEPTION 'ticket_order_conflict: a registration is paid only with its ticket and event';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public._event_free_ticket_orders_unsettled(p_limit integer DEFAULT 20)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT o.id
  FROM public.payment_orders o
  WHERE o.provider = 'coupon'
    AND o.kind = 'one_time'
    AND o.amount_cents = 0
    AND o.status IN ('pending', 'paid')
    AND o.user_id IS NOT NULL
    AND COALESCE(o.metadata, '{}'::jsonb) ? 'event_id'
    AND COALESCE(o.metadata, '{}'::jsonb) ? 'coupon_id'
    AND o.created_at < now() - interval '2 minutes'
    AND o.created_at > now() - interval '7 days'
    AND (
      o.status = 'pending'
      OR (
        NOT (COALESCE(o.metadata, '{}'::jsonb) ? 'ticket_refusal')
        AND NOT EXISTS (
          SELECT 1 FROM public.event_registrations r
          WHERE r.payment_order_id = o.id AND r.tenant_id = o.tenant_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.event_rsvps v
          WHERE v.tenant_id = o.tenant_id
            AND v.user_id = o.user_id
            AND v.event_id::text = o.metadata->>'event_id'
            AND v.status = 'going'
        )
      )
    )
  ORDER BY o.created_at
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100));
$$;
REVOKE ALL ON FUNCTION public._event_free_ticket_orders_unsettled(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_free_ticket_orders_unsettled(integer) TO service_role;
COMMENT ON FUNCTION public._event_free_ticket_orders_unsettled(integer) IS
  'Darmowe zamowienia biletowe (kod 100%) bez sladu rozliczenia: pending albo paid bez zgloszenia, RSVP going i odmowy; starsze niz 2 min, mlodsze niz 7 dni. Rozlicza je ponownie tick zadan (TIX-13a).';