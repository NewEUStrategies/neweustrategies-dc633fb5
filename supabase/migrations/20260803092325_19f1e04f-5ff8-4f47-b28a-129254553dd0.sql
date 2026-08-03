ALTER TABLE public.outbound_link_checks
  ADD COLUMN IF NOT EXISTS archive_url text,
  ADD COLUMN IF NOT EXISTS archive_timestamp text,
  ADD COLUMN IF NOT EXISTS archive_checked_at timestamptz;

CREATE TABLE IF NOT EXISTS public.outbound_link_alerts (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  broken_count integer NOT NULL DEFAULT 0,
  notified_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.outbound_link_alerts TO authenticated;
GRANT ALL ON public.outbound_link_alerts TO service_role;

ALTER TABLE public.outbound_link_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "link alerts staff read" ON public.outbound_link_alerts;
CREATE POLICY "link alerts staff read" ON public.outbound_link_alerts
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff());