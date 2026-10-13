-- ============================================================================
-- Rozliczenia dostają WŁASNY sekret harmonogramu bazy (PAY-17a, przegląd 3.5
-- i 7.9).
--
-- CO BYŁO ZŁE. `invoke_billing_cron()` pukał do /api/public/billing-cron
-- WSPÓLNYM sekretem runnera (`job_runner_settings.secret`), a endpoint go
-- przyjmował. Ten sam sekret otwiera /api/public/community-cron i jobs-tick,
-- a `scheduler.yml` dokumentował go jako dopuszczalną wartość
-- `COMMUNITY_CRON_SECRET`. Kto znał sekret harmonogramu społeczności (push,
-- digesty), uruchamiał masową wysyłkę maili do abonentów, wygaszanie
-- karencji miejsc zespołowych i zamiatarkę płatności.
--
-- CO ZMIENIA TA MIGRACJA.
--   1. `job_runner_settings.billing_secret` - prywatna kolumna (tylko
--      `service_role`), losowana przy dodaniu kolumny, różna od sekretu
--      runnera (CHECK). Endpoint rozliczeń przyjmuje WYŁĄCZNIE ją albo
--      `BILLING_CRON_SECRET` ze środowiska - sekretu wspólnego już nie.
--   2. `invoke_billing_cron()` puka nowym sekretem i czeka do 60 s (było 25 s):
--      po przypomnieniach biegnie dobowa siatka zamiatarki płatności, która
--      nie zaczyna wiersza bez pełnego budżetu (20 s) przed terminem
--      wołającego (przegląd 3.0). Ta sama wartość żyje w
--      `BILLING_CRON_CALLER_TIMEOUT_MS` (src/routes/api/public/billing-cron.ts)
--      i w kroku „Tick rozliczeń" `scheduler.yml` - test pilnuje zgodności.
--
-- ROTACJA (runbook): UPDATE public.job_runner_settings
--   SET billing_secret = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
--   WHERE id = 1;
-- Wartości nie trzeba nigdzie przepisywać - aplikacja czyta ją z bazy.
--
-- KOLEJNOŚĆ WDROŻENIA. Migracja PRZED kodem tego wydania, oba tego samego
-- dnia i poza oknem `billing-cron-daily` (04:25 UTC): stary kod porównuje
-- nagłówek z sekretem runnera, nowy invoker wysyła sekret rozliczeń - przebieg
-- pg_cron pomiędzy tymi krokami dostaje 401 (bez skutków ubocznych, następny
-- jest za dobę; GitHub Actions jedzie własnym `BILLING_CRON_SECRET`).
--
-- Idempotentne. Bez pg_net/pg_cron fail-open jak dotąd.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Prywatny sekret rozliczeń
-- ----------------------------------------------------------------------------
-- 64 znaki hex z dwóch UUID v4 (244 losowe bity z CSPRNG serwera). Bez
-- pgcrypto: na Supabase mieszka w schemacie `extensions`, a `gen_random_uuid()`
-- jest wbudowane i nie zależy od ścieżki wyszukiwania.
ALTER TABLE public.job_runner_settings
  ADD COLUMN IF NOT EXISTS billing_secret text NOT NULL
    DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

COMMENT ON COLUMN public.job_runner_settings.billing_secret IS
  'Sekret pg_cron -> /api/public/billing-cron (x-billing-cron-secret). WYLACZNIE service_role; rozny od secret (sekretu runnera, ktory otwiera community-cron i jobs-tick).';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.job_runner_settings'::regclass
       AND conname = 'job_runner_settings_billing_secret_own'
  ) THEN
    ALTER TABLE public.job_runner_settings
      ADD CONSTRAINT job_runner_settings_billing_secret_own
      CHECK (length(billing_secret) >= 32 AND billing_secret <> secret);
  END IF;
END $$;

-- Tabela jest service-role only od 20260713170000; powtórzone jawnie, bo
-- kolumna z sekretem nie może zależeć od tego, że nikt nie dodał grantu
-- kolumnowego klientowi w międzyczasie.
REVOKE ALL ON public.job_runner_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL (billing_secret) ON public.job_runner_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.job_runner_settings TO service_role;

-- ----------------------------------------------------------------------------
-- 2) Puknięcie rozliczeń własnym sekretem i z terminem 60 s
-- ----------------------------------------------------------------------------
-- Ciało jak w 20260731130000 (resolver adresu, fail-open bez pg_net); różnią
-- się WYŁĄCZNIE sekret w nagłówku i termin odpowiedzi.
CREATE OR REPLACE FUNCTION public.invoke_billing_cron()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  cfg record;
  v_url text;
BEGIN
  SELECT enabled, billing_secret INTO cfg FROM public.job_runner_settings WHERE id = 1;
  IF cfg IS NULL OR NOT cfg.enabled OR COALESCE(cfg.billing_secret, '') = '' THEN
    RETURN;
  END IF;
  v_url := public.job_runner_base_url();
  IF COALESCE(btrim(v_url), '') = '' THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'net' AND p.proname = 'http_post'
  ) THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := rtrim(v_url, '/') || '/api/public/billing-cron',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-billing-cron-secret', cfg.billing_secret,
      'x-cron-source', 'pg_cron'
    ),
    timeout_milliseconds := 60000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'invoke_billing_cron: %', SQLERRM;
END;
$fn$;

REVOKE ALL ON FUNCTION public.invoke_billing_cron() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_billing_cron() TO service_role;
