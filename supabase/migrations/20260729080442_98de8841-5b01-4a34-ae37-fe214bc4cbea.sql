-- Historia zdarzeń od dostawcy płatności + stan nieudanych płatności
CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL,
  event_type text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox','live')),
  subscription_id text,
  customer_id text,
  user_id uuid,
  status text NOT NULL DEFAULT 'processed' CHECK (status IN ('processed','failed','ignored')),
  error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_webhook_events_event_id_key
  ON public.payment_webhook_events (event_id, environment);
CREATE INDEX IF NOT EXISTS payment_webhook_events_created_idx
  ON public.payment_webhook_events (created_at DESC);
CREATE INDEX IF NOT EXISTS payment_webhook_events_sub_idx
  ON public.payment_webhook_events (subscription_id);

GRANT SELECT ON public.payment_webhook_events TO authenticated;
GRANT ALL ON public.payment_webhook_events TO service_role;

ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_webhook_events admin read" ON public.payment_webhook_events;
CREATE POLICY "payment_webhook_events admin read"
  ON public.payment_webhook_events
  FOR SELECT
  TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

-- Stan windykacji miękkiej (dunning) na subskrypcji
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS last_payment_failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_failure_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_payment_at timestamptz;