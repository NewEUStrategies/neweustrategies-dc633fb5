ALTER TABLE public.newsletter_subscribers
  ADD COLUMN IF NOT EXISTS confirmation_token text,
  ADD COLUMN IF NOT EXISTS confirmation_expires_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscribers_confirmation_token_key
  ON public.newsletter_subscribers (confirmation_token)
  WHERE confirmation_token IS NOT NULL;