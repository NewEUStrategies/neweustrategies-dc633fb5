ALTER TABLE public.newsletter_settings
  DROP CONSTRAINT IF EXISTS newsletter_popup_layout_chk;
ALTER TABLE public.newsletter_settings
  ADD CONSTRAINT newsletter_popup_layout_chk CHECK (popup_layout = ANY (ARRAY['stacked'::text,'split'::text,'showcase'::text]));

ALTER TABLE public.newsletter_settings
  ADD COLUMN IF NOT EXISTS popup_showcase_images jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS popup_showcase_brand_pl text NOT NULL DEFAULT 'Newsletter',
  ADD COLUMN IF NOT EXISTS popup_showcase_brand_en text NOT NULL DEFAULT 'Newsletter',
  ADD COLUMN IF NOT EXISTS popup_showcase_tagline_pl text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS popup_showcase_tagline_en text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS popup_showcase_rotate_ms integer NOT NULL DEFAULT 2600;

ALTER TABLE public.newsletter_settings
  DROP CONSTRAINT IF EXISTS newsletter_popup_showcase_rotate_chk;
ALTER TABLE public.newsletter_settings
  ADD CONSTRAINT newsletter_popup_showcase_rotate_chk CHECK (popup_showcase_rotate_ms BETWEEN 800 AND 30000);