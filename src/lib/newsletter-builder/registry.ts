// Metadane widgetow dla biblioteki (lewy panel buildera).
// Ikonki z lucide-shim, etykiety PL/EN wynoszone do i18n przez `label(lang)`.
//
// `contexts` decyduje w ktorych builderach widget jest widoczny w bibliotece:
// - "newsletter" - inline / popup newslettera (/admin/newsletter/*)
// - "popup"      - visual popupy (/admin/popups/*)
// Widget bez `contexts` = dostepny wszedzie.
//
// Niektore "widgety" w bibliotece to warianty tego samego `type` (np. field.text)
// z gotowym presetem (name/etykiety) - stad `WidgetLibraryItem` z opcjonalnym
// `id` (unikalny w kartach) oraz `preset` (aplikowany po `makeWidget`).
// Wszystkie te presety mapuja sie na wlasciwosci CRM (crm_upsert_from_form):
//   firstName / lastName -> top-level; company / position / phone / linkedin -> meta.
import type { NlWidgetType, NlLang, NlWidget } from "./types";

export type BuilderContext = "newsletter" | "popup";

export interface WidgetMeta {
  type: NlWidgetType;
  icon: string; // lucide name
  labelPl: string;
  labelEn: string;
  group: "content" | "media" | "layout" | "fields" | "action";
  contexts?: ReadonlyArray<BuilderContext>;
}

/** Element biblioteki: albo widget "goly" (=WidgetMeta), albo preset istniejacego typu. */
export interface WidgetLibraryItem extends WidgetMeta {
  /** Unikalny identyfikator karty; domyslnie = type. Wymagany przy duplikatach type. */
  id?: string;
  /** Preset aplikowany na swiezo utworzony widget (Object.assign po makeWidget). */
  preset?: Partial<NlWidget>;
}

export const WIDGET_REGISTRY: WidgetLibraryItem[] = [
  { type: "heading", icon: "Heading", labelPl: "Naglowek", labelEn: "Heading", group: "content" },
  { type: "paragraph", icon: "Type", labelPl: "Tekst / HTML", labelEn: "Text / HTML", group: "content" },
  { type: "social-proof", icon: "Users", labelPl: "Social proof", labelEn: "Social proof", group: "content" },
  { type: "countdown", icon: "Timer", labelPl: "Odliczanie", labelEn: "Countdown", group: "content" },
  { type: "coupon", icon: "Ticket", labelPl: "Kod rabatowy", labelEn: "Coupon", group: "content" },
  { type: "image", icon: "Image", labelPl: "Obraz", labelEn: "Image", group: "media" },
  { type: "divider", icon: "Minus", labelPl: "Separator", labelEn: "Divider", group: "layout" },
  { type: "spacer", icon: "MoveVertical", labelPl: "Odstep", labelEn: "Spacer", group: "layout" },
  // Pola formularza (wszystkie mapuja sie na CRM):
  { type: "field.email", icon: "Mail", labelPl: "Pole e-mail", labelEn: "Email field", group: "fields" },
  {
    id: "field.text:firstName",
    type: "field.text",
    icon: "User",
    labelPl: "Imie",
    labelEn: "First name",
    group: "fields",
    preset: {
      type: "field.text",
      name: "firstName",
      required: false,
      label: { pl: "Imie", en: "First name" },
      placeholder: { pl: "Imie", en: "First name" },
    } as Partial<NlWidget>,
  },
  {
    id: "field.text:lastName",
    type: "field.text",
    icon: "UserSquare",
    labelPl: "Nazwisko",
    labelEn: "Last name",
    group: "fields",
    preset: {
      type: "field.text",
      name: "lastName",
      required: false,
      label: { pl: "Nazwisko", en: "Last name" },
      placeholder: { pl: "Nazwisko", en: "Last name" },
    } as Partial<NlWidget>,
  },
  {
    id: "field.text:phone",
    type: "field.text",
    icon: "Phone",
    labelPl: "Numer telefonu",
    labelEn: "Phone number",
    group: "fields",
    preset: {
      type: "field.text",
      name: "phone",
      required: false,
      label: { pl: "Numer telefonu", en: "Phone number" },
      placeholder: { pl: "+48 ...", en: "+48 ..." },
    } as Partial<NlWidget>,
  },
  {
    id: "field.text:company",
    type: "field.text",
    icon: "Building2",
    labelPl: "Pracodawca",
    labelEn: "Employer",
    group: "fields",
    preset: {
      type: "field.text",
      name: "company",
      required: false,
      label: { pl: "Pracodawca", en: "Employer" },
      placeholder: { pl: "Nazwa firmy", en: "Company name" },
    } as Partial<NlWidget>,
  },
  {
    id: "field.text:position",
    type: "field.text",
    icon: "Briefcase",
    labelPl: "Stanowisko",
    labelEn: "Job title",
    group: "fields",
    preset: {
      type: "field.text",
      name: "position",
      required: false,
      label: { pl: "Stanowisko", en: "Job title" },
      placeholder: { pl: "np. Marketing Manager", en: "e.g. Marketing Manager" },
    } as Partial<NlWidget>,
  },
  {
    id: "field.text:linkedin",
    type: "field.text",
    icon: "Linkedin",
    labelPl: "LinkedIn",
    labelEn: "LinkedIn",
    group: "fields",
    preset: {
      type: "field.text",
      name: "linkedin",
      required: false,
      label: { pl: "LinkedIn", en: "LinkedIn" },
      placeholder: { pl: "https://linkedin.com/in/...", en: "https://linkedin.com/in/..." },
    } as Partial<NlWidget>,
  },
  { type: "field.text", icon: "TextCursorInput", labelPl: "Pole tekstowe (inne)", labelEn: "Text field (other)", group: "fields" },
  { type: "field.select", icon: "ListFilter", labelPl: "Lista wyboru", labelEn: "Select", group: "fields" },
  { type: "field.mailing-lists", icon: "Layers", labelPl: "Listy mailingowe", labelEn: "Mailing lists", group: "fields" },
  { type: "field.checkbox", icon: "SquareCheck", labelPl: "Checkbox / zgoda", labelEn: "Checkbox / consent", group: "fields" },
  { type: "submit", icon: "Send", labelPl: "Przycisk zapisu", labelEn: "Submit button", group: "action" },
  { type: "cta-button", icon: "MousePointerClick", labelPl: "Przycisk CTA", labelEn: "CTA button", group: "action" },
  { type: "success-message", icon: "CheckCircle", labelPl: "Komunikat sukcesu", labelEn: "Success message", group: "action" },
  { type: "close-button", icon: "X", labelPl: "Przycisk zamknij", labelEn: "Close button", group: "action", contexts: ["popup"] },
];

/** Stabilny identyfikator karty w bibliotece (id albo type). */
export function libraryItemId(item: WidgetLibraryItem): string {
  return item.id ?? item.type;
}

export function widgetLabel(type: NlWidgetType, lang: NlLang): string {
  const m = WIDGET_REGISTRY.find((w) => w.type === type && !w.id);
  if (!m) return type;
  return lang === "pl" ? m.labelPl : m.labelEn;
}

/** Zwraca widgety dostepne dla danego kontekstu (brak `contexts` = wszedzie). */
export function widgetsForContext(context: BuilderContext): WidgetLibraryItem[] {
  return WIDGET_REGISTRY.filter((w) => !w.contexts || w.contexts.includes(context));
}
