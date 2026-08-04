-- Popup rejestracji konta: cała warstwa prezentacji (paleta jasna, siatka
-- galerii, kolejność bloków, układ formularza, przyciski społecznościowe)
-- w jednej kolumnie jsonb. Kolumny `popup_*_color` pozostają paletą CIEMNĄ,
-- więc istniejące tenanty renderują się bez zmian; brakujące klucze uzupełnia
-- resolvePopupDesign() w kodzie (src/lib/newsletter/popupDesign.ts).
ALTER TABLE public.newsletter_settings
  ADD COLUMN IF NOT EXISTS popup_design jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Wartość musi być obiektem - tablica/skalar przeszłyby przez jsonb, ale
-- resolvePopupDesign() zignorowałby je w całości, gubiąc konfigurację cicho.
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
