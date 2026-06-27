-- Client-side error telemetry sink, beaconed from the browser to
-- /api/public/client-errors (uncaught errors, unhandled rejections, and React
-- error-boundary catches). Mirrors web_vitals: rows are written server-side via
-- the service role; RLS is enabled with NO policies, so anon/authenticated roles
-- cannot read or write it directly. The public ingest route is the only writer
-- (it uses the admin client, which bypasses RLS). Read access is for
-- admins/analytics via the service role only.
CREATE TABLE IF NOT EXISTS public.client_errors (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message    text NOT NULL,
  stack      text,
  source     text,
  path       text,
  meta       jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Query shape: recent errors, optionally filtered by source.
CREATE INDEX IF NOT EXISTS client_errors_created_idx
  ON public.client_errors (created_at DESC);

ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: only the service role (server ingest route) writes.
