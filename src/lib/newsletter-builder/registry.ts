// Metadane widgetow dla biblioteki (lewy panel buildera).
// Ikonki z lucide-shim, etykiety PL/EN wynoszone do i18n przez `label(lang)`.
//
// `contexts` decyduje w ktorych builderach widget jest widoczny w bibliotece:
// - "newsletter" - inline / popup newslettera (/admin/newsletter/*)
// - "popup"      - visual popupy (/admin/popups/*)
// Widget bez `contexts` = dostepny wszedzie.
import type { NlWidgetType, NlLang } from "./types";

export type BuilderContext = "newsletter" | "popup";

export interface WidgetMeta {
  type: NlWidgetType;
  icon: string; // lucide name
  labelPl: string;
  labelEn: string;
  group: "content" | "media" | "layout" | "fields" | "action";
  contexts?: ReadonlyArray<BuilderContext>;
}

export const WIDGET_REGISTRY: WidgetMeta[] = [
  { type: "heading", icon: "Heading", labelPl: "Naglowek", labelEn: "Heading", group: "content" },
  { type: "paragraph", icon: "Type", labelPl: "Tekst / HTML", labelEn: "Text / HTML", group: "content" },
  { type: "social-proof", icon: "Users", labelPl: "Social proof", labelEn: "Social proof", group: "content" },
  { type: "countdown", icon: "Timer", labelPl: "Odliczanie", labelEn: "Countdown", group: "content" },
  { type: "coupon", icon: "Ticket", labelPl: "Kod rabatowy", labelEn: "Coupon", group: "content" },
  { type: "image", icon: "Image", labelPl: "Obraz", labelEn: "Image", group: "media" },
  { type: "divider", icon: "Minus", labelPl: "Separator", labelEn: "Divider", group: "layout" },
  { type: "spacer", icon: "MoveVertical", labelPl: "Odstep", labelEn: "Spacer", group: "layout" },
  // Pola formularza newslettera - dostepne rowniez w popupie (uzytkownik
  // moze zbudowac formularz zapisu wewnatrz popupu z tych samych prymitywow).
  { type: "field.email", icon: "Mail", labelPl: "Pole e-mail", labelEn: "Email field", group: "fields" },
  { type: "field.text", icon: "TextCursorInput", labelPl: "Pole tekstowe", labelEn: "Text field", group: "fields" },
  { type: "field.select", icon: "ListFilter", labelPl: "Lista wyboru", labelEn: "Select", group: "fields" },
  { type: "field.mailing-lists", icon: "Layers", labelPl: "Listy mailingowe", labelEn: "Mailing lists", group: "fields" },
  { type: "field.checkbox", icon: "SquareCheck", labelPl: "Checkbox / zgoda", labelEn: "Checkbox / consent", group: "fields" },
  { type: "submit", icon: "Send", labelPl: "Przycisk zapisu", labelEn: "Submit button", group: "action" },
  { type: "cta-button", icon: "MousePointerClick", labelPl: "Przycisk CTA", labelEn: "CTA button", group: "action" },
  { type: "success-message", icon: "CheckCircle", labelPl: "Komunikat sukcesu", labelEn: "Success message", group: "action" },
  { type: "close-button", icon: "X", labelPl: "Przycisk zamknij", labelEn: "Close button", group: "action", contexts: ["popup"] },
];

export function widgetLabel(type: NlWidgetType, lang: NlLang): string {
  const m = WIDGET_REGISTRY.find((w) => w.type === type);
  if (!m) return type;
  return lang === "pl" ? m.labelPl : m.labelEn;
}

/** Zwraca widgety dostepne dla danego kontekstu (brak `contexts` = wszedzie). */
export function widgetsForContext(context: BuilderContext): WidgetMeta[] {
  return WIDGET_REGISTRY.filter((w) => !w.contexts || w.contexts.includes(context));
}
