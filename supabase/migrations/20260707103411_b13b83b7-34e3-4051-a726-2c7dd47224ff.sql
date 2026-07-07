
ALTER TABLE public.newsletter_settings
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'both',
  ADD COLUMN IF NOT EXISTS inline_doc jsonb,
  ADD COLUMN IF NOT EXISTS popup_doc jsonb,
  ADD COLUMN IF NOT EXISTS sender_name text,
  ADD COLUMN IF NOT EXISTS sender_email text;

ALTER TABLE public.newsletter_settings
  DROP CONSTRAINT IF EXISTS newsletter_settings_mode_check;
ALTER TABLE public.newsletter_settings
  ADD CONSTRAINT newsletter_settings_mode_check
  CHECK (mode IN ('off','inline','popup','both'));
