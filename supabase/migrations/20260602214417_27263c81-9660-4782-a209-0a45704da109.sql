CREATE TABLE public.wp_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'running',
  site text NOT NULL,
  language text NOT NULL DEFAULT 'pl',
  total int NOT NULL DEFAULT 0,
  processed int NOT NULL DEFAULT 0,
  imported int NOT NULL DEFAULT 0,
  updated_count int NOT NULL DEFAULT 0,
  skipped int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  media_imported int NOT NULL DEFAULT 0,
  log jsonb NOT NULL DEFAULT '[]'::jsonb,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX wp_import_jobs_tenant_idx ON public.wp_import_jobs(tenant_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.wp_import_jobs TO authenticated;
GRANT ALL ON public.wp_import_jobs TO service_role;

ALTER TABLE public.wp_import_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wp_import_jobs tenant read"
  ON public.wp_import_jobs FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id());

CREATE POLICY "wp_import_jobs staff insert"
  ON public.wp_import_jobs FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND actor_id = auth.uid()
    AND (has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'editor'::app_role)
      OR has_role(auth.uid(), 'author'::app_role))
  );

CREATE POLICY "wp_import_jobs staff update"
  ON public.wp_import_jobs FOR UPDATE TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'editor'::app_role)
      OR actor_id = auth.uid())
  );

CREATE TRIGGER wp_import_jobs_set_updated_at
  BEFORE UPDATE ON public.wp_import_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();