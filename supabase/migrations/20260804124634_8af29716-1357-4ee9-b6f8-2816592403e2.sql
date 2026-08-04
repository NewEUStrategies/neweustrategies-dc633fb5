ALTER TABLE public.newsletter_settings
  ADD COLUMN IF NOT EXISTS popup_showcase_side text NOT NULL DEFAULT 'left',
  ADD COLUMN IF NOT EXISTS popup_showcase_grad_from text,
  ADD COLUMN IF NOT EXISTS popup_showcase_grad_to text,
  ADD COLUMN IF NOT EXISTS popup_showcase_show_brand boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS popup_showcase_show_caption boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS popup_showcase_show_dots boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS popup_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS popup_note_pl text,
  ADD COLUMN IF NOT EXISTS popup_note_en text,
  ADD COLUMN IF NOT EXISTS popup_require_privacy boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS popup_privacy_html_pl text,
  ADD COLUMN IF NOT EXISTS popup_privacy_html_en text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'newsletter_settings_popup_showcase_side_chk'
  ) THEN
    ALTER TABLE public.newsletter_settings
      ADD CONSTRAINT newsletter_settings_popup_showcase_side_chk
      CHECK (popup_showcase_side IN ('left','right'));
  END IF;
END $$;