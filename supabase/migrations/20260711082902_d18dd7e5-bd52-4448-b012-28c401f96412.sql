ALTER TABLE public.newsletter_subscribers
  ADD COLUMN IF NOT EXISTS unsubscribe_token text;

-- Backfill existing rows with a unique token
UPDATE public.newsletter_subscribers
   SET unsubscribe_token = encode(gen_random_bytes(24), 'hex')
 WHERE unsubscribe_token IS NULL;

-- Enforce uniqueness and presence for future rows
CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscribers_unsub_token_uidx
  ON public.newsletter_subscribers (unsubscribe_token);

ALTER TABLE public.newsletter_subscribers
  ALTER COLUMN unsubscribe_token SET DEFAULT encode(gen_random_bytes(24), 'hex');

ALTER TABLE public.newsletter_subscribers
  ALTER COLUMN unsubscribe_token SET NOT NULL;

-- Trigger: guarantee a token exists even if a caller sets it to NULL
CREATE OR REPLACE FUNCTION public.newsletter_subscribers_ensure_unsub_token()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.unsubscribe_token IS NULL OR btrim(NEW.unsubscribe_token) = '' THEN
    NEW.unsubscribe_token := encode(gen_random_bytes(24), 'hex');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS newsletter_subscribers_unsub_token_trg
  ON public.newsletter_subscribers;
CREATE TRIGGER newsletter_subscribers_unsub_token_trg
  BEFORE INSERT ON public.newsletter_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.newsletter_subscribers_ensure_unsub_token();