CREATE OR REPLACE FUNCTION public.job_runner_settings_base_url_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
BEGIN
  IF NEW.base_url IS DISTINCT FROM OLD.base_url THEN
    IF COALESCE(btrim(NEW.base_url), '') <> ''
       AND (NEW.base_url !~* '^https://[a-z0-9.-]+(:[0-9]+)?$'
            OR NEW.base_url ~* '^https://(localhost|127\.|0\.0\.0\.0|\[)')
    THEN
      RAISE EXCEPTION 'base_url_not_allowed' USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.job_runner_settings_base_url_guard() IS
  'Trigger ksztaltu adresu runnera: ten sam kontrakt co arm_job_runner. Host pilnuje aplikacja.';

DROP TRIGGER IF EXISTS job_runner_settings_base_url_guard ON public.job_runner_settings;

CREATE TRIGGER job_runner_settings_base_url_guard
  BEFORE UPDATE ON public.job_runner_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.job_runner_settings_base_url_guard();