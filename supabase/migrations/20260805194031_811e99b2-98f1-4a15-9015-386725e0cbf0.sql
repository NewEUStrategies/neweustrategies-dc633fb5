ALTER TABLE public.donations DROP CONSTRAINT IF EXISTS donations_status_check;
ALTER TABLE public.donations ADD CONSTRAINT donations_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'paid'::text, 'refunded'::text, 'failed'::text, 'canceled'::text]));

ALTER TABLE public.donations ADD COLUMN IF NOT EXISTS provider_subscription_id text;
ALTER TABLE public.donations ADD COLUMN IF NOT EXISTS recurring boolean NOT NULL DEFAULT false;
ALTER TABLE public.donations ADD COLUMN IF NOT EXISTS paid_at timestamptz;

CREATE INDEX IF NOT EXISTS donations_provider_subscription_id_idx
  ON public.donations (provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS donations_provider_intent_id_key
  ON public.donations (provider, provider_intent_id)
  WHERE provider_intent_id IS NOT NULL;