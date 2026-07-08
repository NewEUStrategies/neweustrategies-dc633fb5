-- Tenant-scope Real User Monitoring (web_vitals) so one workspace's admin can
-- never see another workspace's performance data / URL paths.
--
-- web_vitals had no tenant_id, and getVitalsSummary + web_vitals_daily_p75 read
-- every row via the service role, so a tenant A admin's dashboard aggregated
-- every tenant's samples. Add tenant_id, scope the aggregation function to a
-- tenant, and let the ingest attribute each beacon to the browsed host's tenant.

-- Add + backfill in one place. public.public_tenant_id() resolves the browsed
-- host's tenant and falls back to the default tenant when no request host is
-- present (the migration/DDL context and the service-role ingest client), which
-- is exactly the right value for historical rows and as a NOT NULL safety net.
ALTER TABLE public.web_vitals
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;

UPDATE public.web_vitals
   SET tenant_id = public.public_tenant_id()
 WHERE tenant_id IS NULL;

ALTER TABLE public.web_vitals ALTER COLUMN tenant_id SET DEFAULT public.public_tenant_id();
ALTER TABLE public.web_vitals ALTER COLUMN tenant_id SET NOT NULL;

-- Tenant-first index for the per-tenant windowed aggregation.
CREATE INDEX IF NOT EXISTS web_vitals_tenant_metric_created_idx
  ON public.web_vitals (tenant_id, metric, created_at DESC);

-- Recreate the daily-p75 trend function with a mandatory tenant filter so the
-- admin dashboard only ever aggregates the caller's own tenant. (RLS on the
-- table stays policy-less/service-role-only; isolation is enforced here + in the
-- server function that passes the caller's tenant.)
DROP FUNCTION IF EXISTS public.web_vitals_daily_p75(timestamptz);
CREATE OR REPLACE FUNCTION public.web_vitals_daily_p75(p_since timestamptz, p_tenant uuid)
RETURNS TABLE (day date, metric text, p75 double precision, samples bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT
    (created_at AT TIME ZONE 'UTC')::date AS day,
    metric,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75,
    count(*)::bigint AS samples
  FROM public.web_vitals
  WHERE created_at >= p_since
    AND tenant_id = p_tenant
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;

REVOKE ALL ON FUNCTION public.web_vitals_daily_p75(timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.web_vitals_daily_p75(timestamptz, uuid) TO service_role;
