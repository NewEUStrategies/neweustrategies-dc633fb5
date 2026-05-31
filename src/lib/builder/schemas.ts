// Declarative widget content schemas.
// Single source of truth for the simple widget content editors.
// Complex list-style widgets (accordion, tabs, pricing) keep custom editors.
import type { WidgetType } from "./types";

export type FieldType =
  | "text"        // single-line, language-agnostic
  | "i18nText"    // single-line, separate PL/EN values stored as `${key}_pl|_en`
  | "i18nHtml"    // textarea HTML, separate PL/EN values
  | "url"
  | "number"
  | "select"
  | "textarea"
  | "stringArray"; // textarea with one item per line

export interface SchemaField {
  /** Storage key for non-i18n fields, OR base key (without `_pl|_en`) for i18n fields. */
  key: string;
  type: FieldType;
  label: string;
  placeholder?: string;
  /** For number fields. */
  min?: number;
  max?: number;
  /** For select fields. */
  options?: ReadonlyArray<{ value: string; label?: string }>;
  /** For textarea fields. */
  rows?: number;
  /** Optional hint shown under the control. */
  hint?: string;
  /** Show only when this predicate returns true (against full content object). */
  visibleWhen?: (content: Record<string, unknown>) => boolean;
}

// Empty schemas mean "use the custom editor branch" or "no editable fields".
export const WIDGET_SCHEMAS: Partial<Record<WidgetType, ReadonlyArray<SchemaField>>> = {
  heading: [
    { key: "text", type: "i18nText", label: "Tekst" },
    { key: "subtitle", type: "i18nText", label: "Podtytuł (opcjonalny)" },
    {
      key: "tag", type: "select", label: "Tag (SEO)",
      options: ["h1", "h2", "h3", "h4", "h5", "h6"].map((v) => ({ value: v })),
    },
    { key: "href", type: "url", label: "Link (opcjonalny)", placeholder: "/o-nas lub https://…" },
    {
      key: "target", type: "select", label: "Otwórz link w",
      options: [
        { value: "self", label: "tym samym oknie" },
        { value: "blank", label: "nowej karcie" },
      ],
      visibleWhen: (c) => typeof c.href === "string" && c.href.length > 0,
    },
    {
      key: "iconName", type: "text", label: "Ikona (opcjonalna)",
      placeholder: "Star, Sparkles, ArrowRight…",
      hint: "Nazwa ikony Lucide. Zostaw puste, aby ukryć.",
    },
    {
      key: "iconPosition", type: "select", label: "Pozycja ikony",
      options: [
        { value: "left", label: "po lewej" },
        { value: "right", label: "po prawej" },
      ],
      visibleWhen: (c) => typeof c.iconName === "string" && c.iconName.length > 0,
    },
  ],
  text: [
    { key: "html", type: "i18nHtml", label: "HTML", rows: 6 },
    {
      key: "columns", type: "number", label: "Kolumny tekstu", min: 1, max: 4,
      hint: "Podział tekstu na kolumny (CSS multi-column).",
    },
    { key: "dropCap", type: "select", label: "Inicjał", options: [
      { value: "off", label: "wyłączony" },
      { value: "on", label: "włączony" },
    ]},
  ],
  image: [
    { key: "src", type: "url", label: "URL obrazka", placeholder: "https://..." },
    { key: "alt", type: "i18nText", label: "Alt" },
  ],
  button: [
    { key: "label", type: "i18nText", label: "Etykieta" },
    { key: "href", type: "url", label: "Link" },
    {
      key: "target", type: "select", label: "Otwórz w",
      options: [
        { value: "self", label: "tym samym oknie" },
        { value: "blank", label: "nowej karcie" },
      ],
    },
    {
      key: "variant", type: "select", label: "Wariant",
      options: [{ value: "primary" }, { value: "outline" }, { value: "ghost" }],
    },
    {
      key: "size", type: "select", label: "Rozmiar",
      options: [
        { value: "sm", label: "mały" },
        { value: "md", label: "średni" },
        { value: "lg", label: "duży" },
      ],
    },
    { key: "iconName", type: "text", label: "Ikona (Lucide)", placeholder: "ArrowRight…" },
    {
      key: "iconPosition", type: "select", label: "Pozycja ikony",
      options: [
        { value: "left", label: "po lewej" },
        { value: "right", label: "po prawej" },
      ],
      visibleWhen: (c) => typeof c.iconName === "string" && c.iconName.length > 0,
    },
    { key: "fullWidth", type: "select", label: "Szerokość", options: [
      { value: "auto", label: "automatyczna" },
      { value: "full", label: "100%" },
    ]},
  ],
  spacer: [
    { key: "height", type: "number", label: "Wysokość (px)", min: 1, max: 800 },
  ],
  video: [
    { key: "url", type: "url", label: "URL (YouTube lub MP4)" },
  ],
  gallery: [
    {
      key: "images", type: "stringArray", rows: 5,
      label: "Obrazki (po jednym URL na linię)",
    },
    { key: "columns", type: "number", label: "Kolumny", min: 1, max: 6 },
  ],
  icon: [
    { key: "name", type: "text", label: "Nazwa ikony", placeholder: "Star, Heart, Mail..." },
    { key: "size", type: "number", label: "Rozmiar (px)", min: 8, max: 256 },
  ],
  map: [
    { key: "query", type: "text", label: "Adres / zapytanie" },
  ],
  "post-list": [
    { key: "limit", type: "number", label: "Limit", min: 1, max: 50 },
    { key: "columns", type: "number", label: "Kolumny", min: 1, max: 6 },
  ],
  carousel: [
    { key: "limit", type: "number", label: "Limit", min: 1, max: 50 },
  ],
  newsletter: [
    { key: "title", type: "i18nText", label: "Tytuł" },
  ],
  cta: [
    { key: "title", type: "i18nText", label: "Tytuł" },
    { key: "cta", type: "i18nText", label: "CTA" },
    { key: "href", type: "url", label: "Link" },
  ],
  contact: [
    { key: "to", type: "text", label: "Email odbiorcy", placeholder: "kontakt@..." },
  ],
  "nav-link": [
    { key: "label", type: "i18nText", label: "Etykieta" },
    { key: "href", type: "url", label: "Docelowy URL", placeholder: "/about lub https://…" },
    {
      key: "target", type: "select", label: "Otwórz w",
      options: [
        { value: "self", label: "tym samym oknie" },
        { value: "blank", label: "nowej karcie" },
      ],
    },
    {
      key: "variant", type: "select", label: "Wygląd",
      options: [
        { value: "text", label: "tekst" },
        { value: "underline", label: "podkreślony" },
        { value: "pill", label: "pigułka" },
        { value: "primary", label: "przycisk primary" },
        { value: "outline", label: "przycisk obrysowany" },
      ],
    },
    {
      key: "iconName", type: "text", label: "Ikona (opcjonalna)",
      placeholder: "ChevronRight, ExternalLink…",
      hint: "Nazwa ikony Lucide. Zostaw puste, aby ukryć.",
    },
  ],
  testimonial: [
    { key: "quote", type: "i18nHtml", label: "Cytat", rows: 3 },
    { key: "author", type: "text", label: "Autor" },
    { key: "role", type: "i18nText", label: "Rola" },
    { key: "avatar", type: "url", label: "Avatar (URL)" },
  ],
};
