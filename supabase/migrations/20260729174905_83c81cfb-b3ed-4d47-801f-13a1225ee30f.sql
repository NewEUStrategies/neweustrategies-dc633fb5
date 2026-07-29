ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS ticket_price_cents integer,
  ADD COLUMN IF NOT EXISTS ticket_currency text NOT NULL DEFAULT 'PLN';

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_ticket_price_positive;
ALTER TABLE public.events
  ADD CONSTRAINT events_ticket_price_positive
  CHECK (ticket_price_cents IS NULL OR ticket_price_cents >= 100);

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_ticket_currency_allowed;
ALTER TABLE public.events
  ADD CONSTRAINT events_ticket_currency_allowed
  CHECK (ticket_currency IN ('PLN','EUR'));

COMMENT ON COLUMN public.events.ticket_price_cents IS 'Cena biletu w najmniejszej jednostce waluty; NULL = wydarzenie bezpłatne.';