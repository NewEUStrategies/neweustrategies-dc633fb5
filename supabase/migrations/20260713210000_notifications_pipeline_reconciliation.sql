-- ============================================================================
-- Powiadomienia: pojednanie DWÓCH równoległych potoków push/digest.
--
-- W repo powstały niezależnie dwie implementacje tego samego:
--
--   A) 20260713092000_notification_channels.sql (KANONICZNA - zostaje):
--      push_subscriptions(user_agent, failed_at, last_seen_at),
--      notification_push_queue + trigger tg_notifications_enqueue_push
--      (szanuje opt-in push_enabled), claim_push_jobs / report_push_job /
--      mark_push_subscription_failed / prune_push_queue,
--      preferencje email_digest + digest_last_sent_at, claim_due_digests.
--      Konsumowana przez src/lib/notifications/dispatch.server.ts i typy
--      wygenerowane z żywej bazy.
--
--   B) 20260713180000_notifications_push_and_digest.sql (DUBEL - znika):
--      push_outbox + trigger notifications_enqueue_push_trg (IGNORUJE
--      push_enabled i odwołuje się do kolumny disabled_at, której żywa baza
--      nie ma - CREATE TABLE IF NOT EXISTS na istniejącej tabeli był no-opem,
--      więc trigger padał i był po cichu połykany przez EXCEPTION WHEN
--      OTHERS), claim_push_outbox, claim_due_digest_users oraz duplikaty
--      preferencji email_digest_frequency / email_digest_last_at.
--
-- Ten plik usuwa świat B (po migracji wartości preferencji do A), dosztukowuje
-- kanoniczne kolumny tam, gdzie świeża baza dostała kształt B, i zostawia
-- jeden potok: notifications -> notification_push_queue -> claim_push_jobs.
-- Strona kodu: usePushSubscription/ChannelsSettings/notificationsTick
-- (konsumenci świata B) znikają, a jobs-tick woła kanoniczny dispatcher.
--
-- Idempotentne.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) push_subscriptions - kanoniczny kształt kolumn
-- ----------------------------------------------------------------------------
ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

-- Jeśli baza dostała kształt B (ua/disabled_at), przenieś wartości i sprzątnij.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'push_subscriptions' AND column_name = 'ua'
  ) THEN
    UPDATE public.push_subscriptions SET user_agent = COALESCE(user_agent, ua);
    ALTER TABLE public.push_subscriptions DROP COLUMN ua;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'push_subscriptions' AND column_name = 'disabled_at'
  ) THEN
    UPDATE public.push_subscriptions SET failed_at = COALESCE(failed_at, disabled_at);
    ALTER TABLE public.push_subscriptions DROP COLUMN disabled_at;
  END IF;
END $$;

-- Duplikaty polityk own-row ze świata B - kanoniczna "push subs owner all"
-- z 092000 pokrywa wszystkie operacje.
DROP POLICY IF EXISTS push_subscriptions_own_select ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_own_insert ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_own_update ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_own_delete ON public.push_subscriptions;

-- Indeks częściowy świata B odwoływał się do disabled_at - po jego kasacji
-- i tak zniknął; kanoniczny odpowiednik na failed_at.
CREATE INDEX IF NOT EXISTS push_subscriptions_user_live_idx
  ON public.push_subscriptions (user_id) WHERE failed_at IS NULL;

-- ----------------------------------------------------------------------------
-- 2) Outbox świata B odchodzi (trigger, claim, tabela, cron)
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS notifications_enqueue_push_trg ON public.notifications;
DROP FUNCTION IF EXISTS public.notifications_enqueue_push();
DROP FUNCTION IF EXISTS public.claim_push_outbox(integer);
DROP TABLE IF EXISTS public.push_outbox;

DO $$
DECLARE
  v_has_job boolean;
BEGIN
  -- Odwolania do cron.job wylacznie przez EXECUTE: plpgsql planowalby
  -- statyczny SELECT nawet za nieprzechodzacym warunkiem IF, wywalajac
  -- srodowiska bez pg_cron (lokalny pgTAP).
  IF to_regclass('cron.job') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = ''prune-push-outbox'')'
    INTO v_has_job;
  IF v_has_job THEN
    PERFORM cron.unschedule('prune-push-outbox');
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3) Preferencje digestu - jedna para kolumn
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'notification_preferences'
       AND column_name = 'email_digest_frequency'
  ) THEN
    -- Użytkownik mógł włączyć digest w UI świata B - nie gubimy tej decyzji.
    UPDATE public.notification_preferences
       SET email_digest = email_digest_frequency
     WHERE email_digest = 'off'
       AND email_digest_frequency IN ('daily', 'weekly');
    ALTER TABLE public.notification_preferences DROP COLUMN email_digest_frequency;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'notification_preferences'
       AND column_name = 'email_digest_last_at'
  ) THEN
    ALTER TABLE public.notification_preferences DROP COLUMN email_digest_last_at;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.claim_due_digest_users(integer);
