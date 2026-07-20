-- Tenant-scope client error telemetry (client_errors), mirroring the fix that
-- 20260708150000 applied to web_vitals.
--
-- client_errors had no tenant_id, so the ingest could not attribute an error to
-- the browsed host's tenant and any future admin error dashboard would blend
-- every workspace's messages / stack traces / paths together. Add the column
-- (defaulting to the browsed host's tenant, exactly like web_vitals) so the
-- ingest can pin each row and reads can filter by tenant. RLS stays
-- policy-less/service-role-only; this is data-isolation hygiene at the column.

ALTER TABLE public.client_errors
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;

-- Backfill historical rows to the default tenant (public_tenant_id() has no
-- request host in DDL context and falls back to the default tenant).
UPDATE public.client_errors
   SET tenant_id = public.public_tenant_id()
 WHERE tenant_id IS NULL;

ALTER TABLE public.client_errors ALTER COLUMN tenant_id SET DEFAULT public.public_tenant_id();
ALTER TABLE public.client_errors ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS client_errors_tenant_created_idx
  ON public.client_errors (tenant_id, created_at DESC);
