-- DRUGA LINIA OBRONY NA `job_runner_settings.base_url`: KSZTAŁT ADRESU.
--
-- PO CO. `base_url` jest pierwszą gałęzią COALESCE w `job_runner_base_url()`
-- (20260731130000), a pg_cron wysyła pod ten adres SEKRET OPERATORA w
-- nagłówkach `x-jobs-secret` i `x-community-cron-secret` (20260731210000).
-- Kolumna nie miała dotąd ani CHECK-a, ani triggera: jedyna walidacja żyła w
-- TypeScripcie panelu i - ostrzej - w `arm_job_runner` (20260731110000).
-- Dwa różne kontrakty na jedną kolumnę to klasa awarii, którą ta migracja
-- domyka od strony bazy: każdy zapis spod service_role (nowa funkcja panelu,
-- skrypt migracyjny, ręczny SQL) przechodzi teraz przez ten sam kształt co
-- ścieżka samozbrojenia.
--
-- CZEGO TU ŚWIADOMIE NIE MA: ALLOWLISTY HOSTÓW. Baza nie ma jak zajrzeć do
-- zmiennych środowiskowych procesu, a katalog `tenants.domain` nie wystarcza -
-- w instalacji jednodomenowej domena najemcy bywa pusta, staging i podglądy
-- mają host spoza katalogu, a `arm_job_runner` uzbraja adresem Z REQUESTU.
-- Allowlista w triggerze zablokowałaby więc legalne wdrożenie zamiast
-- napastnika. Podział jest jawny: BAZA PILNUJE KSZTAŁTU, APLIKACJA HOSTA.

CREATE OR REPLACE FUNCTION public.job_runner_settings_base_url_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
BEGIN
  -- Reagujemy WYŁĄCZNIE na faktyczną zmianę adresu: ten sam wiersz (id = 1) jest
  -- aktualizowany co minutę telemetrią (`invoke_jobs_tick`, `invoke_community_cron`,
  -- `record_job_run`), a te zapisy nie mogą się wywrócić o walidację adresu ani
  -- płacić za nią przy każdym ticku.
  IF NEW.base_url IS DISTINCT FROM OLD.base_url THEN
    -- Pusty adres jest poprawnym stanem: znaczy „wylicz z domeny najemcy
    -- domyślnego", a nie „brak konfiguracji do odrzucenia".
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
  'Trigger kształtu adresu runnera: ten sam kontrakt co arm_job_runner. Host pilnuje aplikacja.';

DROP TRIGGER IF EXISTS job_runner_settings_base_url_guard ON public.job_runner_settings;

CREATE TRIGGER job_runner_settings_base_url_guard
  BEFORE UPDATE ON public.job_runner_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.job_runner_settings_base_url_guard();
