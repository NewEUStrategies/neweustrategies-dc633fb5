-- events-harness: include
-- Replay twin of drizzle/migrations/0105_payment_orders_guard_service_role_detection.sql.
-- Straznik payment_orders rozpoznawal service_role tylko po starym ustawieniu
-- `request.jwt.claim.role` albo `current_user`. W funkcji SECURITY DEFINER
-- `current_user` to wlasciciel funkcji, a nowe klucze serwera nie ustawiaja
-- starego claimu - webhook Stripe nie mogl oznaczyc zamowienia jako oplacone
-- (proba 2026-09-28). Czytamy teraz tez `request.jwt.claims` i GUC `role`.
CREATE OR REPLACE FUNCTION public.payment_orders_guard_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_claims text := NULLIF(current_setting('request.jwt.claims', true), '');
  is_service boolean :=
       COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR COALESCE(current_setting('role', true), '') = 'service_role'
    OR (v_claims IS NOT NULL AND (v_claims::jsonb ->> 'role') = 'service_role')
    OR current_user = 'service_role';
BEGIN
  IF is_service THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending'::order_status OR NEW.paid_at IS NOT NULL THEN
      RAISE EXCEPTION 'Only service_role can create orders with non-pending status';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
       OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
       OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
       OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
       OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
       OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.provider_intent_id IS DISTINCT FROM OLD.provider_intent_id
       OR NEW.provider_session_id IS DISTINCT FROM OLD.provider_session_id
       OR NEW.provider_subscription_id IS DISTINCT FROM OLD.provider_subscription_id THEN
      IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
        RAISE EXCEPTION 'Financial fields on payment_orders can only be updated by service_role or admin';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Ta sama poprawka dla profilu platnosci w miejscu, ktore wyswietla kwote
-- zgloszenia bez zamowienia: bilet czekajacy na oplate nie jest "bezplatny".
CREATE OR REPLACE FUNCTION public.event_my_registrations(p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(NULLIF(p_payload->>'limit','')::integer, 20), 1), 50);
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to see your registrations';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'invalid_tenant: unknown host';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      r.id AS registration_id,
      r.event_id,
      r.ticket_type_id,
      r.status,
      r.payment_status,
      r.created_at,
      r.cancelled_at,
      r.paid_at,
      r.waitlist_position,
      r.promoted_at,
      r.notify_email,
      r.notify_sms,
      COALESCE(NULLIF(btrim(r.cancel_reason), ''), NULLIF(btrim(r.decision_note), '')) AS cancel_reason,
      r.decision_source,
      e.slug AS event_slug,
      e.title_pl AS event_title_pl,
      e.title_en AS event_title_en,
      e.starts_at AS event_starts_at,
      e.ends_at AS event_ends_at,
      e.timezone AS event_timezone,
      o.id AS order_id,
      o.status AS order_status,
      COALESCE(o.amount_cents,
        CASE WHEN r.payment_status = 'unpaid' AND r.cancelled_at IS NULL THEN tt.price_cents END
      ) AS amount_cents,
      o.refunded_amount_cents,
      COALESCE(o.currency, tt.currency) AS currency,
      o.provider_session_id,
      o.provider_payment_intent_id,
      o.environment,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', w.id,
                 'event_type', w.event_type,
                 'status', w.status,
                 'occurred_at', w.occurred_at,
                 'processed_at', w.processed_at,
                 'retry_count', w.retry_count
               ) ORDER BY w.occurred_at DESC)
        FROM (
          SELECT w2.*
          FROM public.payment_webhook_events w2
          WHERE w2.tenant_id = r.tenant_id
            AND (
              (o.provider_customer_id IS NOT NULL AND w2.customer_id = o.provider_customer_id)
              OR w2.user_id = v_uid
            )
          ORDER BY w2.occurred_at DESC
          LIMIT 20
        ) w
      ), '[]'::jsonb) AS webhooks
    FROM public.event_registrations r
    JOIN public.event_people pe ON pe.id = r.person_id AND pe.tenant_id = r.tenant_id
    JOIN public.events e ON e.id = r.event_id AND e.tenant_id = r.tenant_id
    LEFT JOIN public.event_ticket_types tt ON tt.id = r.ticket_type_id AND tt.tenant_id = r.tenant_id
    LEFT JOIN public.payment_orders o ON o.id = r.payment_order_id
    WHERE r.tenant_id = v_tenant
      AND pe.user_id = v_uid
    ORDER BY r.created_at DESC
    LIMIT v_limit
  ) x;

  RETURN jsonb_build_object('registrations', v_rows);
END;
$function$;
