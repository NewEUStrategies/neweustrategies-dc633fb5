CREATE OR REPLACE FUNCTION public.payment_webhook_event_tenant(
  p_user_id uuid,
  p_customer_id text,
  p_subscription_id text,
  p_environment text,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_tenant uuid;
  v_email text;
  v_default uuid;
BEGIN
  IF p_user_id IS NOT NULL THEN
    SELECT p.tenant_id INTO v_tenant
      FROM public.profiles p
     WHERE p.id = p_user_id;
    IF v_tenant IS NOT NULL THEN RETURN v_tenant; END IF;
  END IF;

  IF p_subscription_id IS NOT NULL THEN
    SELECT s.tenant_id INTO v_tenant
      FROM public.subscriptions s
     WHERE s.provider_subscription_id = p_subscription_id
       AND (p_environment IS NULL OR s.environment = p_environment)
     ORDER BY s.updated_at DESC
     LIMIT 1;
    IF v_tenant IS NOT NULL THEN RETURN v_tenant; END IF;

    SELECT o.tenant_id INTO v_tenant
      FROM public.payment_orders o
     WHERE o.provider_subscription_id = p_subscription_id
       AND (p_environment IS NULL OR o.environment = p_environment)
     ORDER BY o.created_at DESC
     LIMIT 1;
    IF v_tenant IS NOT NULL THEN RETURN v_tenant; END IF;
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT s.tenant_id INTO v_tenant
      FROM public.subscriptions s
     WHERE s.provider_customer_id = p_customer_id
       AND (p_environment IS NULL OR s.environment = p_environment)
     ORDER BY s.updated_at DESC
     LIMIT 1;
    IF v_tenant IS NOT NULL THEN RETURN v_tenant; END IF;

    SELECT o.tenant_id INTO v_tenant
      FROM public.payment_orders o
     WHERE o.provider_customer_id = p_customer_id
       AND (p_environment IS NULL OR o.environment = p_environment)
     ORDER BY o.created_at DESC
     LIMIT 1;
    IF v_tenant IS NOT NULL THEN RETURN v_tenant; END IF;
  END IF;

  v_email := NULLIF(btrim(COALESCE(
    p_payload #>> '{data,object,customer_details,email}',
    p_payload #>> '{data,object,customer_email}',
    p_payload #>> '{data,object,receipt_email}',
    p_payload #>> '{data,object,billing_details,email}',
    ''
  )), '');

  IF v_email IS NOT NULL THEN
    v_default := public.email_default_tenant_id();
    v_tenant := public.email_resolve_tenant_for_address(v_email);
    IF v_tenant IS DISTINCT FROM v_default THEN RETURN v_tenant; END IF;
  END IF;

  RETURN NULL;
END;
$fn$;

COMMENT ON FUNCTION public.payment_webhook_event_tenant(uuid, text, text, text, jsonb) IS
  'Najemca wiersza dziennika webhookow, kaskada nosnikow tozsamosci: profil -> subskrypcja -> zamowienie -> e-mail z ladunku. NULL, gdy zaden nosnik nie rozstrzyga.';

REVOKE ALL ON FUNCTION public.payment_webhook_event_tenant(uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_webhook_event_tenant(uuid, text, text, text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.tg_payment_webhook_events_bind_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
BEGIN
  NEW.tenant_id := COALESCE(
    public.payment_webhook_event_tenant(
      NEW.user_id,
      NEW.customer_id,
      NEW.subscription_id,
      NEW.environment,
      NEW.payload
    ),
    NEW.tenant_id,
    public.email_default_tenant_id()
  );
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS payment_webhook_events_bind_tenant ON public.payment_webhook_events;
CREATE TRIGGER payment_webhook_events_bind_tenant
  BEFORE INSERT OR UPDATE OF user_id, customer_id, subscription_id
  ON public.payment_webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_payment_webhook_events_bind_tenant();

WITH resolved AS (
  SELECT
    e.id,
    public.payment_webhook_event_tenant(
      e.user_id, e.customer_id, e.subscription_id, e.environment, e.payload
    ) AS tenant_id
  FROM public.payment_webhook_events e
  WHERE e.tenant_id = public.email_default_tenant_id()
)
UPDATE public.payment_webhook_events e
   SET tenant_id = r.tenant_id
  FROM resolved r
 WHERE r.id = e.id
   AND r.tenant_id IS NOT NULL
   AND r.tenant_id IS DISTINCT FROM e.tenant_id;

CREATE OR REPLACE FUNCTION public.admin_payment_webhook_health(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_env text := COALESCE(NULLIF(p_payload->>'environment',''), 'live');
  v_hours integer := LEAST(GREATEST(COALESCE(NULLIF(p_payload->>'since_hours','')::integer, 168), 1), 8760);
  v_since timestamptz;
  v_total integer := 0;
  v_failed integer := 0;
  v_processed integer := 0;
  v_skipped integer := 0;
  v_pending integer := 0;
  v_retries integer := 0;
  v_avg numeric;
  v_p95 numeric;
  v_lag numeric;
  v_types jsonb := '[]'::jsonb;
  v_recent jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL OR NOT (public.has_role(v_uid, 'admin') OR public.has_role(v_uid, 'super_admin')) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden: brak kontekstu najemcy';
  END IF;
  IF v_env NOT IN ('sandbox','live') THEN
    RAISE EXCEPTION 'invalid_payload: environment must be sandbox or live';
  END IF;
  v_since := now() - make_interval(hours => v_hours);

  SELECT
    count(*)::int,
    count(*) FILTER (WHERE w.status = 'failed')::int,
    count(*) FILTER (WHERE w.status = 'processed')::int,
    count(*) FILTER (WHERE w.status = 'skipped')::int,
    count(*) FILTER (WHERE w.status NOT IN ('failed','processed','skipped'))::int,
    COALESCE(sum(GREATEST(COALESCE(w.retry_count,0),0)),0)::int,
    round(avg(w.duration_ms)::numeric, 1),
    round((percentile_disc(0.95) WITHIN GROUP (ORDER BY w.duration_ms))::numeric, 1),
    round(avg(EXTRACT(EPOCH FROM (COALESCE(w.processed_at, w.created_at) - w.occurred_at)))::numeric, 2)
  INTO v_total, v_failed, v_processed, v_skipped, v_pending, v_retries, v_avg, v_p95, v_lag
  FROM public.payment_webhook_events w
  WHERE w.environment = v_env AND w.occurred_at >= v_since AND w.tenant_id = v_tenant;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.total DESC), '[]'::jsonb)
    INTO v_types
  FROM (
    SELECT w.event_type,
           count(*)::int AS total,
           count(*) FILTER (WHERE w.status = 'failed')::int AS failed,
           round(avg(w.duration_ms)::numeric, 1) AS avg_duration_ms
    FROM public.payment_webhook_events w
    WHERE w.environment = v_env AND w.occurred_at >= v_since AND w.tenant_id = v_tenant
    GROUP BY w.event_type
    ORDER BY count(*) DESC
    LIMIT 25
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(f)::jsonb ORDER BY f.occurred_at DESC), '[]'::jsonb)
    INTO v_recent
  FROM (
    SELECT w.id, w.event_type, w.status, w.error, w.occurred_at, w.retry_count
    FROM public.payment_webhook_events w
    WHERE w.environment = v_env AND w.occurred_at >= v_since AND w.status = 'failed'
      AND w.tenant_id = v_tenant
    ORDER BY w.occurred_at DESC
    LIMIT 20
  ) f;

  RETURN jsonb_build_object(
    'environment', v_env,
    'since', v_since,
    'total', v_total,
    'processed', v_processed,
    'skipped', v_skipped,
    'failed', v_failed,
    'pending', v_pending,
    'retries', v_retries,
    'failure_rate', CASE WHEN v_total > 0 THEN round(v_failed::numeric / v_total, 4) ELSE 0 END,
    'avg_duration_ms', v_avg,
    'p95_duration_ms', v_p95,
    'avg_lag_seconds', v_lag,
    'by_type', v_types,
    'recent_failures', v_recent
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_payment_webhook_health(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payment_webhook_health(jsonb) TO authenticated, service_role;

COMMENT ON COLUMN public.payment_webhook_events.tenant_id IS
  'Obszar roboczy zdarzenia (NOT NULL). JEST predykatem polityki RLS "payment_webhook_events admin read" (tenant_id = current_tenant_id() AND is_super_admin()). Klient service_role omija RLS, wiec KAZDE zapytanie spod service_role musi filtrowac po tej kolumnie JAWNIE - polityki nie zobaczy. Wartosc nadaje trigger payment_webhook_events_bind_tenant kaskada nosnikow tozsamosci; wiersze nierozstrzygniete zostaja w najemcy domyslnym.';