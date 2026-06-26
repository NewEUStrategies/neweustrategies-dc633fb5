-- Real User Monitoring sink for Core Web Vitals beaconed from the client to
-- /api/public/vitals. Rows are written server-side via the service role; RLS is
-- enabled with NO policies, so anon/authenticated roles cannot read or write it
-- directly (the public ingest route is the only writer, and it uses the admin
-- client which bypasses RLS). Read access is for admins/analytics via the
-- service role only.
CREATE TABLE IF NOT EXISTS public.web_vitals (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric     text NOT NULL,
  value      double precision NOT NULL,
  rating     text,
  path       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Query shape: aggregate a metric (e.g. p75 LCP) over a recent time window.
CREATE INDEX IF NOT EXISTS web_vitals_metric_created_idx
  ON public.web_vitals (metric, created_at DESC);

ALTER TABLE public.web_vitals ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: only the service role (server ingest route) writes.
