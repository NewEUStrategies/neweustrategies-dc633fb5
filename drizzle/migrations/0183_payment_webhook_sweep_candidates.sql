CREATE INDEX IF NOT EXISTS payment_webhook_events_sweep_open_idx
  ON public.payment_webhook_events (created_at)
  WHERE status IN ('failed', 'received');

CREATE OR REPLACE FUNCTION public.payment_webhook_sweep_candidates(
  p_limit integer,
  p_max_attempts integer,
  p_backoff_base_ms bigint,
  p_stuck_after_ms bigint,
  p_horizon_ms bigint
)
RETURNS TABLE (
  id uuid,
  event_id text,
  event_type text,
  environment text,
  occurred_at timestamptz,
  status text,
  created_at timestamptz,
  last_retried_at timestamptz,
  processed_at timestamptz,
  retry_count integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  WITH open_rows AS (
    SELECT w.id, w.event_id, w.event_type, w.environment, w.occurred_at, w.status,
           w.created_at, w.last_retried_at, w.processed_at, w.retry_count,
           CASE
             WHEN w.status = 'failed' THEN
               COALESCE(w.processed_at, w.last_retried_at, w.created_at)
                 + make_interval(secs => p_backoff_base_ms::double precision
                                         * power(2::double precision, w.retry_count) / 1000)
             ELSE
               COALESCE(w.last_retried_at, w.created_at)
                 + make_interval(secs => GREATEST(
                     p_stuck_after_ms::double precision,
                     p_backoff_base_ms::double precision
                       * power(2::double precision, w.retry_count)
                   ) / 1000)
           END AS due_at
      FROM public.payment_webhook_events w
     WHERE w.status IN ('failed', 'received')
       AND w.retry_count < GREATEST(p_max_attempts, 0)
       AND NOT (COALESCE(w.payload, '{}'::jsonb) ? '_redacted')
       AND CASE
             WHEN w.event_id LIKE 'reconcile\_%' THEN w.created_at
             ELSE COALESCE(w.occurred_at, w.created_at)
           END >= now() - make_interval(secs => p_horizon_ms::double precision / 1000)
  )
  SELECT o.id, o.event_id, o.event_type, o.environment, o.occurred_at, o.status,
         o.created_at, o.last_retried_at, o.processed_at, o.retry_count
    FROM open_rows o
   WHERE (o.status = 'failed' AND o.due_at <= now())
      OR (o.status = 'received' AND o.due_at < now())
   ORDER BY o.due_at, o.created_at, o.id
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 500));
$fn$;

REVOKE ALL ON FUNCTION public.payment_webhook_sweep_candidates(integer, integer, bigint, bigint, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_webhook_sweep_candidates(integer, integer, bigint, bigint, bigint)
  TO service_role;

COMMENT ON FUNCTION public.payment_webhook_sweep_candidates(integer, integer, bigint, bigint, bigint) IS
  'Zamiatarka dziennika platnosci: wiersze failed/received do wziecia TERAZ (odstep wykladniczy, sufit prob, horyzont od occurred_at, bez ladunkow po retencji _redacted), najdluzej czekajace najpierw. Tylko service_role.';