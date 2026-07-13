CREATE TABLE IF NOT EXISTS public.job_runner_settings (
  id smallint PRIMARY KEY DEFAULT 1,
  enabled boolean NOT NULL DEFAULT false,
  base_url text NOT NULL DEFAULT '',
  secret text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_runner_settings_singleton CHECK (id = 1)
);

GRANT ALL ON public.job_runner_settings TO service_role;

ALTER TABLE public.job_runner_settings ENABLE ROW LEVEL SECURITY;

-- No policies: service-role only (bypasses RLS). Authenticated/anon have no access.

INSERT INTO public.job_runner_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.tg_job_runner_settings_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS job_runner_settings_updated_at ON public.job_runner_settings;
CREATE TRIGGER job_runner_settings_updated_at
  BEFORE UPDATE ON public.job_runner_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_job_runner_settings_updated_at();