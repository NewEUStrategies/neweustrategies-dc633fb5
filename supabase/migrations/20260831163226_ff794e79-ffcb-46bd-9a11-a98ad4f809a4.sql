ALTER TABLE public.donations
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'live'
  CHECK (environment IN ('sandbox', 'live'));

CREATE INDEX IF NOT EXISTS donations_environment_idx
  ON public.donations (environment, created_at DESC);

COMMENT ON COLUMN public.donations.environment IS
  'Srodowisko operatora platnosci (sandbox|live). Bramkuje dopasowanie zdarzen webhooka do wiersza - bez niego zwrot z piaskownicy mogl oznaczyc realna wplate jako zwrocona. Lustro tej samej kolumny w payment_orders (20260731220000).';