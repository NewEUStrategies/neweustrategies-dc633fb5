// Wspólny kontrakt zakładek edytora popupu rejestracji: pełne ustawienia,
// rozwiązana warstwa prezentacji i celowane funkcje patchujące (dzięki nim
// zakładki nie muszą znać kształtu zagnieżdżonego JSON-a `popup_design`).
import type { NewsletterSettings } from "@/hooks/useNewsletterSettings";
import type {
  PopupColorScheme,
  PopupControlColors,
  PopupDesign,
  PopupFormDesign,
  PopupGalleryDesign,
  PopupPanelDesign,
  PopupThemeColors,
} from "@/lib/newsletter/popupDesign";

export interface SignupPopupTabProps {
  value: NewsletterSettings;
  design: PopupDesign;
  onChange: (patch: Partial<NewsletterSettings>) => void;
  patchPanel: (patch: Partial<PopupPanelDesign>) => void;
  patchGallery: (patch: Partial<PopupGalleryDesign>) => void;
  patchForm: (patch: Partial<PopupFormDesign>) => void;
  patchLight: (patch: Partial<PopupThemeColors>) => void;
  /** Nadpisania kolorów checkboxów i przycisku CTA - osobno dla obu palet. */
  patchControls: (mode: "dark" | "light", patch: Partial<PopupControlColors>) => void;
  setColorScheme: (scheme: PopupColorScheme) => void;
}
