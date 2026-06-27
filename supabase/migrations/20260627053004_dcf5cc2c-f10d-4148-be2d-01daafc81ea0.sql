
CREATE TABLE IF NOT EXISTS public.web_vitals (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric     text NOT NULL,
  value      double precision NOT NULL,
  rating     text,
  path       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS web_vitals_metric_created_idx ON public.web_vitals (metric, created_at DESC);
ALTER TABLE public.web_vitals ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.web_vitals TO service_role;

CREATE TABLE IF NOT EXISTS public.client_errors (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message    text NOT NULL,
  stack      text,
  source     text,
  path       text,
  meta       jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_errors_created_idx ON public.client_errors (created_at DESC);
ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.client_errors TO service_role;
