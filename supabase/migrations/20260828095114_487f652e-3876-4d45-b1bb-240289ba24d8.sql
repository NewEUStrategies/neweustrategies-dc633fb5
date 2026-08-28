CREATE OR REPLACE FUNCTION public.event_my_registrations(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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
      o.amount_cents,
      o.refunded_amount_cents,
      o.currency,
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
    LEFT JOIN public.payment_orders o ON o.id = r.payment_order_id
    WHERE r.tenant_id = v_tenant
      AND pe.user_id = v_uid
    ORDER BY r.created_at DESC
    LIMIT v_limit
  ) x;

  RETURN jsonb_build_object('registrations', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.event_my_registrations(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_registrations(jsonb) TO authenticated, service_role;