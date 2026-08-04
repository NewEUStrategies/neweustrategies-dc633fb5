ALTER TABLE public.newsletter_settings
  ADD COLUMN IF NOT EXISTS popup_design jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'newsletter_settings_popup_design_obj_chk'
  ) THEN
    ALTER TABLE public.newsletter_settings
      ADD CONSTRAINT newsletter_settings_popup_design_obj_chk
      CHECK (jsonb_typeof(popup_design) = 'object');
  END IF;
END $$;

COMMENT ON COLUMN public.newsletter_settings.popup_design IS
  'Prezentacja popupu rejestracji (PopupDesign): colorScheme, light, panel, gallery, form.';