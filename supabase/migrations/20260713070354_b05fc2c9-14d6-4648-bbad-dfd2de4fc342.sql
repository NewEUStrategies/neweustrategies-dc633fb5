-- ============================================================================
-- Powiadomienia: kanał WEB PUSH + E-MAIL DIGEST (część 1/5, pojednanie w 4/5)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  ua text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'push_subscriptions'
       AND column_name = 'disabled_at'
  ) THEN
    CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
      ON public.push_subscriptions (user_id) WHERE disabled_at IS NULL;
  END IF;
END $$;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_subscriptions_own_select ON public.push_subscriptions;
CREATE POLICY push_subscriptions_own_select ON public.push_subscriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS push_subscriptions_own_insert ON public.push_subscriptions;
CREATE POLICY push_subscriptions_own_insert ON public.push_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS push_subscriptions_own_update ON public.push_subscriptions;
CREATE POLICY push_subscriptions_own_update ON public.push_subscriptions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS push_subscriptions_own_delete ON public.push_subscriptions;
CREATE POLICY push_subscriptions_own_delete ON public.push_subscriptions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

REVOKE ALL ON public.push_subscriptions FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

CREATE TABLE IF NOT EXISTS public.push_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notification_id uuid,
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  dead_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_outbox_due_idx
  ON public.push_outbox (next_attempt_at)
  WHERE delivered_at IS NULL AND dead_at IS NULL;

ALTER TABLE public.push_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_outbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.push_outbox TO service_role;

CREATE OR REPLACE FUNCTION public.notifications_enqueue_push()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.push_subscriptions ps
    WHERE ps.user_id = NEW.user_id AND ps.disabled_at IS NULL
  ) THEN
    INSERT INTO public.push_outbox (notification_id, user_id, tenant_id, payload)
    VALUES (
      NEW.id, NEW.user_id, NEW.tenant_id,
      jsonb_build_object(
        'title', COALESCE(NULLIF(btrim(NEW.title_pl), ''), NULLIF(btrim(NEW.title_en), ''), 'Powiadomienie'),
        'body',  COALESCE(NULLIF(btrim(NEW.body_pl), ''), NULLIF(btrim(NEW.body_en), '')),
        'href',  NEW.href,
        'icon',  NEW.icon,
        'kind',  NEW.kind,
        'tag',   COALESCE(NEW.kind, 'system') || ':' || COALESCE(NEW.href, '')
      )
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notifications_enqueue_push_trg ON public.notifications;
CREATE TRIGGER notifications_enqueue_push_trg
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_enqueue_push();

CREATE OR REPLACE FUNCTION public.claim_push_outbox(p_limit integer DEFAULT 100)
RETURNS SETOF public.push_outbox
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.push_outbox po
     SET attempts = po.attempts + 1,
         next_attempt_at = now() + LEAST(
           make_interval(mins => 1) * power(2, po.attempts),
           make_interval(hours => 1)
         )
   WHERE po.id IN (
     SELECT id FROM public.push_outbox
      WHERE delivered_at IS NULL AND dead_at IS NULL AND next_attempt_at <= now()
      ORDER BY id
      FOR UPDATE SKIP LOCKED
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 200))
   )
  RETURNING po.*;
$$;

REVOKE ALL ON FUNCTION public.claim_push_outbox(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_outbox(integer) TO service_role;

DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron niedostepny - prune-push-outbox pominiety.';
    RETURN;
  END IF;
  PERFORM cron.schedule('prune-push-outbox', '30 3 * * *',
    $sql$DELETE FROM public.push_outbox
      WHERE (delivered_at IS NOT NULL OR dead_at IS NOT NULL)
        AND created_at < now() - interval '14 days'$sql$);
END $$;

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS email_digest_frequency text NOT NULL DEFAULT 'off'
    CHECK (email_digest_frequency IN ('off', 'daily', 'weekly'));
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS email_digest_last_at timestamptz;

COMMENT ON COLUMN public.notification_preferences.email_digest_frequency IS
  'E-mailowe podsumowanie nieprzeczytanych powiadomien: off/daily/weekly (opt-in).';

CREATE OR REPLACE FUNCTION public.claim_due_digest_users(p_limit integer DEFAULT 50)
RETURNS TABLE (user_id uuid, email text, frequency text, since timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  WITH due AS (
    SELECT np.user_id,
           np.email_digest_frequency AS freq,
           COALESCE(
             np.email_digest_last_at,
             now() - CASE np.email_digest_frequency
                       WHEN 'weekly' THEN interval '7 days'
                       ELSE interval '1 day'
                     END
           ) AS since
      FROM public.notification_preferences np
     WHERE np.email_digest_frequency IN ('daily', 'weekly')
       AND (
         np.email_digest_last_at IS NULL
         OR np.email_digest_last_at < now() - CASE np.email_digest_frequency
              WHEN 'weekly' THEN interval '7 days'
              ELSE interval '1 day'
            END
       )
     ORDER BY np.user_id
     FOR UPDATE OF np SKIP LOCKED
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
  ),
  claimed AS (
    UPDATE public.notification_preferences np
       SET email_digest_last_at = now()
      FROM due
     WHERE np.user_id = due.user_id
    RETURNING np.user_id, due.freq, due.since
  )
  SELECT c.user_id, p.email, c.freq, c.since
    FROM claimed c
    LEFT JOIN public.profiles p ON p.id = c.user_id
   WHERE EXISTS (
     SELECT 1 FROM public.notifications n
      WHERE n.user_id = c.user_id
        AND n.read_at IS NULL
        AND n.created_at > c.since
   );
$$;

REVOKE ALL ON FUNCTION public.claim_due_digest_users(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_digest_users(integer) TO service_role;
