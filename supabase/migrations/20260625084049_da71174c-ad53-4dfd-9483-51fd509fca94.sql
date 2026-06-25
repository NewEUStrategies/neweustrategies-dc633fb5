
ALTER TABLE public.newsletter_settings
  ADD COLUMN IF NOT EXISTS popup_layout text NOT NULL DEFAULT 'stacked',
  ADD COLUMN IF NOT EXISTS popup_side_image_url text,
  ADD COLUMN IF NOT EXISTS popup_extended_fields boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS popup_require_terms boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS popup_terms_html_pl text,
  ADD COLUMN IF NOT EXISTS popup_terms_html_en text,
  ADD COLUMN IF NOT EXISTS popup_mailing_lists jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$ BEGIN
  ALTER TABLE public.newsletter_settings
    ADD CONSTRAINT newsletter_popup_layout_chk CHECK (popup_layout IN ('stacked','split'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
