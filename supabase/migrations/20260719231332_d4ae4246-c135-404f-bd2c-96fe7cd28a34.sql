
ALTER TABLE public.job_runner_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_runner_settings FROM anon, authenticated;
GRANT ALL ON public.job_runner_settings TO service_role;

DROP POLICY IF EXISTS "job_runner_settings staff read" ON public.job_runner_settings;
CREATE POLICY "job_runner_settings staff read"
  ON public.job_runner_settings FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
