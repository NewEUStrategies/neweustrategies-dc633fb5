-- ============================================================================
-- Newsletter: wysyłka asynchroniczna (lease + praca porcjami) i automatyczny
-- tick HTTP (pg_cron + pg_net), zamiast wysyłki całej listy w jednym requeście
-- i "planowania", które odpalało się tylko przy wejściu admina na stronę.
--
--   1) newsletter_campaigns.lease_until - dzierżawa aktywnego procesora.
--      Wysyłka przetwarza ograniczoną porcję odbiorców na wywołanie i oddaje
--      dzierżawę; kolejne wywołanie (UI, tick, inny admin) przejmuje kampanię
--      NATYCHMIAST zamiast czekać 20 minut na heurystykę "stuck sending".
--      Kampanie w 'sending' z wygasłą/pustą dzierżawą są bezpiecznie
--      wznawialne (idempotencja per odbiorca istnieje od 20260711083456).
--
--   2) job_runner_settings - pojedynczy wiersz konfiguracji: bazowy URL
--      aplikacji + sekret. RLS bez polityk (odczyt/zapis wyłącznie service
--      role przez staff-gated server fn). Sekret generowany w bazie.
--
--   3) invoke_jobs_tick() + pg_cron co minutę: gdy pg_net dostępny i runner
--      włączony, POST na {base_url}/api/public/jobs-tick z nagłówkiem
--      x-jobs-secret. Endpoint przetwarza zaległe kampanie CAŁKOWICIE bez
--      udziału człowieka (SQL nie może wysyłać e-maili - potrzebuje env
--      RESEND_API_KEY, stąd wywołanie HTTP do aplikacji). Bez pg_net
--      wszystko działa jak dotąd (opportunistic tick + przyciski) - fail-open.
--
-- Idempotentne.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Dzierżawa procesora kampanii
-- ----------------------------------------------------------------------------
ALTER TABLE public.newsletter_campaigns ADD COLUMN IF NOT EXISTS lease_until timestamptz;
COMMENT ON COLUMN public.newsletter_campaigns.lease_until IS
  'Dzierżawa aktywnego procesora wysyłki; NULL/przeszłość = kampania wznawialna.';

CREATE INDEX IF NOT EXISTS newsletter_campaigns_processing_idx
  ON public.newsletter_campaigns (status, scheduled_at)
  WHERE status IN ('scheduled', 'sending');

-- ----------------------------------------------------------------------------
-- 2) Konfiguracja job runnera (pojedynczy wiersz, service-role only)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_runner_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  -- Publiczny bazowy URL aplikacji (np. https://neweuropeanstrategies.com);
  -- cron nie zna hosta requestu, więc musi go mieć w konfiguracji.
  base_url text NOT NULL DEFAULT '',
  secret text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_runner_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_runner_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.job_runner_settings TO service_role;

INSERT INTO public.job_runner_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS job_runner_settings_updated_at ON public.job_runner_settings;
CREATE TRIGGER job_runner_settings_updated_at
  BEFORE UPDATE ON public.job_runner_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3) Tick HTTP: pg_net (jeśli dostępny) + pg_cron co minutę
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    CREATE EXTENSION IF NOT EXISTS pg_net;
  ELSE
    RAISE NOTICE 'pg_net niedostępny - automatyczny tick wyłączony (fallback: opportunistic tick).';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_net: nie udało się włączyć (%) - automatyczny tick wyłączony.', SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION public.invoke_jobs_tick()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  cfg record;
BEGIN
  SELECT enabled, base_url, secret INTO cfg
    FROM public.job_runner_settings WHERE id = 1;
  IF cfg IS NULL OR NOT cfg.enabled OR COALESCE(btrim(cfg.base_url), '') = '' THEN
    RETURN;
  END IF;
  -- pg_net może nie istnieć (środowiska bez rozszerzenia) - fail-open.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'net' AND p.proname = 'http_post'
  ) THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := rtrim(cfg.base_url, '/') || '/api/public/jobs-tick',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-jobs-secret', cfg.secret
    ),
    timeout_milliseconds := 25000
  );
EXCEPTION WHEN OTHERS THEN
  -- Tick jest best-effort; błąd HTTP/konfiguracji nie może wysypać crona.
  NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_jobs_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_jobs_tick() TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron niedostępny - jobs-tick nie zostanie zaplanowany.';
    RETURN;
  END IF;
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron nie jest zainstalowany - jobs-tick nie zostanie zaplanowany.';
    RETURN;
  END IF;
  -- cron.schedule nadpisuje istniejący job o tej samej nazwie.
  PERFORM cron.schedule('jobs-tick', '* * * * *', 'SELECT public.invoke_jobs_tick()');
END $$;
