-- Udostępnianie zaznaczonego cytatu (A3): globalny przełącznik w ustawieniach
-- layoutu wpisu (per-wpis nadpisanie w posts.layout_overrides jak pozostałe).
ALTER TABLE public.post_layout_settings
  ADD COLUMN IF NOT EXISTS show_quote_share boolean NOT NULL DEFAULT true;
