-- ============================================================================
-- SPOŁECZNOŚĆ 3/10: kanały doręczeń powiadomień - web push + digest e-mail.
--
-- Dotąd powiadomienia żyły wyłącznie in-app (dzwonek). Ten plik dodaje dwie
-- drogi wyjścia, obie sterowane preferencjami użytkownika:
--
--   push_subscriptions        subskrypcje Web Push przeglądarek (endpoint +
--                             klucze p256dh/auth), owner-only RLS.
--   notification_push_queue   kolejka wysyłek: trigger AFTER INSERT na
--                             notifications dopisuje zadanie, gdy odbiorca ma
--                             push_enabled i co najmniej jedną subskrypcję.
--                             Dispatcher (server fn, service_role) zdejmuje
--                             paczki claimem SKIP LOCKED, wysyła VAPID/aes128gcm
--                             i raportuje wynik; backoff wykładniczy, po 8
--                             próbach status 'dead' (wzorzec integration_deliveries).
--   digest e-mail             preferencja off/daily/weekly + claim_due_digests:
--                             atomowe "zdjęcie" partii użytkowników z należnym
--                             digestem (nieprzeczytane od ostatniej wysyłki),
--                             wysyłka przez Resend w tym samym dispatcherze.
--
-- Wysyłka HTTP wymaga procesu poza Postgresem - endpoint /api/public/community-cron
-- (sekret w nagłówku) woła harmonogram zewnętrzny; patrz .env.example.
--
-- Wszystko idempotentne.
-- ============================================================================

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS push_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_digest text NOT NULL DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS digest_last_sent_at timestamptz;

ALTER TABLE public.notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_email_digest_check;
ALTER TABLE public.notification_preferences
  ADD CONSTRAINT notification_preferences_email_digest_check
  CHECK (email_digest IN ('off', 'daily', 'weekly'));

-- ----------------------------------------------------------------------------
-- 1) SUBSKRYPCJE WEB PUSH (owner-only)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  failed_at timestamptz,
  UNIQUE (endpoint),
  CHECK (endpoint ~ '^https://'),
  CHECK (length(endpoint) <= 1024),
  CHECK (length(p256dh) BETWEEN 16 AND 256),
  CHECK (length(auth) BETWEEN 8 AND 64)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON public.push_subscriptions (user_id) WHERE failed_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push subs owner all" ON public.push_subscriptions;
CREATE POLICY "push subs owner all" ON public.push_subscriptions
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ----------------------------------------------------------------------------
-- 2) KOLEJKA WYSYŁEK PUSH (bez dostępu klienckiego)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_push_queue (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  notification_id uuid REFERENCES public.notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'dead')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_push_queue_due
  ON public.notification_push_queue (next_attempt_at) WHERE status = 'pending';

GRANT ALL ON public.notification_push_queue TO service_role;
ALTER TABLE public.notification_push_queue ENABLE ROW LEVEL SECURITY;
-- Brak polityk klienckich: kolejka jest wyłącznie serwerowa.

CREATE OR REPLACE FUNCTION public.tg_notifications_enqueue_push()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
       SELECT 1 FROM public.notification_preferences np
        WHERE np.user_id = NEW.user_id AND np.push_enabled
     )
     AND EXISTS (
       SELECT 1 FROM public.push_subscriptions ps
        WHERE ps.user_id = NEW.user_id AND ps.failed_at IS NULL
     )
  THEN
    INSERT INTO public.notification_push_queue (tenant_id, notification_id, user_id, payload)
    VALUES (
      NEW.tenant_id, NEW.id, NEW.user_id,
      jsonb_build_object(
        'kind', NEW.kind,
        'title_pl', NEW.title_pl,
        'title_en', NEW.title_en,
        'body_pl', NEW.body_pl,
        'body_en', NEW.body_en,
        'href', NEW.href
      )
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Kolejka push nigdy nie może zablokować zapisu powiadomienia in-app.
  RAISE WARNING 'push enqueue failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notifications_enqueue_push ON public.notifications;
CREATE TRIGGER notifications_enqueue_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.tg_notifications_enqueue_push();

-- Claim paczki zadań: attempts++ i przesunięcie next_attempt_at już przy
-- claimie (crash dispatchera = naturalny retry z backoffem, bez wiszących locków).
CREATE OR REPLACE FUNCTION public.claim_push_jobs(p_limit integer DEFAULT 50)
RETURNS SETOF public.notification_push_queue
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.notification_push_queue q
     SET attempts = q.attempts + 1,
         next_attempt_at = now() + (interval '1 minute' * power(2, LEAST(q.attempts, 6)))
   WHERE q.id IN (
     SELECT id FROM public.notification_push_queue
      WHERE status = 'pending' AND next_attempt_at <= now()
      ORDER BY id
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
        FOR UPDATE SKIP LOCKED
   )
  RETURNING q.*;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_push_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_jobs(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.report_push_job(p_id bigint, p_ok boolean, p_dead boolean DEFAULT false)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.notification_push_queue
     SET status = CASE
                    WHEN p_ok THEN 'sent'
                    WHEN p_dead OR attempts >= 8 THEN 'dead'
                    ELSE 'pending'
                  END,
         sent_at = CASE WHEN p_ok THEN now() ELSE sent_at END
   WHERE id = p_id;
$$;

REVOKE EXECUTE ON FUNCTION public.report_push_job(bigint, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_push_job(bigint, boolean, boolean) TO service_role;

-- Trwale martwy endpoint (404/410 z usługi push) - oznacz subskrypcję.
CREATE OR REPLACE FUNCTION public.mark_push_subscription_failed(p_endpoint text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.push_subscriptions
     SET failed_at = now()
   WHERE endpoint = p_endpoint AND failed_at IS NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_push_subscription_failed(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_push_subscription_failed(text) TO service_role;

-- Porządkowanie: wysłane/martwe zadania starsze niż 14 dni.
CREATE OR REPLACE FUNCTION public.prune_push_queue(p_keep interval DEFAULT interval '14 days')
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM public.notification_push_queue
   WHERE status IN ('sent', 'dead') AND created_at < now() - p_keep;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prune_push_queue(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_push_queue(interval) TO service_role;

-- ----------------------------------------------------------------------------
-- 3) DIGEST E-MAIL: atomowy claim partii należnych wysyłek
-- ----------------------------------------------------------------------------
-- Zwraca użytkowników z email_digest = p_frequency, którym minęło okno od
-- ostatniej wysyłki i którzy mają nieprzeczytane powiadomienia z tego okna.
-- digest_last_sent_at jest przestawiany w tej samej instrukcji (SKIP LOCKED),
-- więc równoległe wywołania crona nie zdublują wysyłki.
CREATE OR REPLACE FUNCTION public.claim_due_digests(p_frequency text, p_limit integer DEFAULT 50)
RETURNS TABLE (user_id uuid, email text, display_name text, items jsonb)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window interval;
BEGIN
  IF p_frequency NOT IN ('daily', 'weekly') THEN
    RAISE EXCEPTION 'digest: unknown frequency %', p_frequency;
  END IF;
  v_window := CASE p_frequency WHEN 'daily' THEN interval '20 hours' ELSE interval '6 days' END;

  RETURN QUERY
  WITH cand AS (
    SELECT np.user_id AS uid,
           COALESCE(np.digest_last_sent_at, now() - interval '14 days') AS since
      FROM public.notification_preferences np
     WHERE np.email_digest = p_frequency
       AND (np.digest_last_sent_at IS NULL OR np.digest_last_sent_at < now() - v_window)
       AND EXISTS (
         SELECT 1 FROM public.notifications n
          WHERE n.user_id = np.user_id
            AND n.read_at IS NULL
            AND n.created_at > COALESCE(np.digest_last_sent_at, now() - interval '14 days')
       )
     ORDER BY np.digest_last_sent_at ASC NULLS FIRST
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
       FOR UPDATE SKIP LOCKED
  ),
  upd AS (
    UPDATE public.notification_preferences np
       SET digest_last_sent_at = now()
      FROM cand
     WHERE np.user_id = cand.uid
    RETURNING np.user_id AS uid
  )
  SELECT p.id,
         p.email,
         COALESCE(p.display_name, split_part(p.email, '@', 1)),
         (
           SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'kind', q.kind,
                    'title_pl', q.title_pl,
                    'title_en', q.title_en,
                    'body_pl', q.body_pl,
                    'body_en', q.body_en,
                    'href', q.href,
                    'created_at', q.created_at
                  ) ORDER BY q.created_at DESC), '[]'::jsonb)
             FROM (
               SELECT n.kind, n.title_pl, n.title_en, n.body_pl, n.body_en,
                      n.href, n.created_at
                 FROM public.notifications n
                 JOIN cand c ON c.uid = n.user_id
                WHERE n.user_id = p.id
                  AND n.read_at IS NULL
                  AND n.created_at > c.since
                ORDER BY n.created_at DESC
                LIMIT 20
             ) q
         )
    FROM upd
    JOIN public.profiles p ON p.id = upd.uid
   WHERE p.email IS NOT NULL AND p.email <> '';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_due_digests(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_digests(text, integer) TO service_role;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('prune-push-queue', '30 3 * * *',
      'SELECT public.prune_push_queue()');
  ELSE
    RAISE NOTICE 'pg_cron unavailable - push queue pruned only on demand';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron setup skipped: %', SQLERRM;
END $$;
