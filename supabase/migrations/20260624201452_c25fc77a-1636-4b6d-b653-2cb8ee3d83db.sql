
ALTER TABLE public.newsletter_settings
  ADD COLUMN IF NOT EXISTS popup_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS popup_trigger text NOT NULL DEFAULT 'delay',
  ADD COLUMN IF NOT EXISTS popup_delay_seconds integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS popup_scroll_percent integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS popup_frequency_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS popup_cover_url text,
  ADD COLUMN IF NOT EXISTS popup_title_pl text NOT NULL DEFAULT 'Zostań w kontakcie',
  ADD COLUMN IF NOT EXISTS popup_title_en text NOT NULL DEFAULT 'Stay in touch',
  ADD COLUMN IF NOT EXISTS popup_description_pl text NOT NULL DEFAULT 'Cotygodniowy przegląd najlepszych treści.',
  ADD COLUMN IF NOT EXISTS popup_description_en text NOT NULL DEFAULT 'A weekly digest of the best stories.',
  ADD COLUMN IF NOT EXISTS popup_cta_pl text NOT NULL DEFAULT 'Zapisz się',
  ADD COLUMN IF NOT EXISTS popup_cta_en text NOT NULL DEFAULT 'Subscribe';

ALTER TABLE public.newsletter_settings
  ADD CONSTRAINT newsletter_popup_trigger_chk
  CHECK (popup_trigger IN ('delay','scroll','exit-intent'));
