// Metadane widgetow dla biblioteki (lewy panel buildera).
// Ikonki z lucide-shim, etykiety PL/EN wynoszone do i18n przez `label(lang)`.
import type { NlWidgetType } from "./types";
import type { NlLang } from "./types";

export interface WidgetMeta {
  type: NlWidgetType;
  icon: string; // lucide name
  labelPl: string;
  labelEn: string;
  group: "content" | "media" | "layout" | "fields" | "action";
}

export const WIDGET_REGISTRY: WidgetMeta[] = [
  { type: "heading", icon: "Heading", labelPl: "Naglowek", labelEn: "Heading", group: "content" },
  { type: "paragraph", icon: "Type", labelPl: "Tekst / HTML", labelEn: "Text / HTML", group: "content" },
  { type: "social-proof", icon: "Users", labelPl: "Social proof", labelEn: "Social proof", group: "content" },
  { type: "countdown", icon: "Timer", labelPl: "Odliczanie", labelEn: "Countdown", group: "content" },
  { type: "image", icon: "Image", labelPl: "Obraz", labelEn: "Image", group: "media" },
  { type: "divider", icon: "Minus", labelPl: "Separator", labelEn: "Divider", group: "layout" },
  { type: "spacer", icon: "MoveVertical", labelPl: "Odstep", labelEn: "Spacer", group: "layout" },
  { type: "field.email", icon: "Mail", labelPl: "Pole e-mail", labelEn: "Email field", group: "fields" },
  { type: "field.text", icon: "TextCursorInput", labelPl: "Pole tekstowe", labelEn: "Text field", group: "fields" },
  { type: "field.select", icon: "ListFilter", labelPl: "Lista wyboru", labelEn: "Select", group: "fields" },
  { type: "field.mailing-lists", icon: "Layers", labelPl: "Listy mailingowe", labelEn: "Mailing lists", group: "fields" },
  { type: "field.checkbox", icon: "SquareCheck", labelPl: "Checkbox / zgoda", labelEn: "Checkbox / consent", group: "fields" },
  { type: "submit", icon: "Send", labelPl: "Przycisk zapisu", labelEn: "Submit button", group: "action" },
  { type: "success-message", icon: "CheckCircle", labelPl: "Komunikat sukcesu", labelEn: "Success message", group: "action" },
];

export function widgetLabel(type: NlWidgetType, lang: NlLang): string {
  const m = WIDGET_REGISTRY.find((w) => w.type === type);
  if (!m) return type;
  return lang === "pl" ? m.labelPl : m.labelEn;
}
