-- Restrict job_runner_settings to super_admin only (platform-wide singleton, not per-tenant)
DROP POLICY IF EXISTS "job_runner_settings staff read" ON public.job_runner_settings;

CREATE POLICY "job_runner_settings super_admin read"
  ON public.job_runner_settings
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));

-- Ensure no other client role can read the secret column
REVOKE SELECT (secret) ON public.job_runner_settings FROM authenticated, anon;
REVOKE ALL ON public.job_runner_settings FROM anon;