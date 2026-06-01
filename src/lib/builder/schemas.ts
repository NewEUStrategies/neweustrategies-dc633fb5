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
    {
      key: "variant", type: "select", label: "Wariant",
      options: [
        { value: "default", label: "klasyczny" },
        { value: "gradient", label: "gradient" },
        { value: "outlined", label: "obrysowany" },
        { value: "highlight", label: "podkreślenie" },
        { value: "uppercase", label: "wersaliki" },
        { value: "serif", label: "serif" },
      ],
    },
    {
      key: "sizePreset", type: "select", label: "Rozmiar",
      options: [
        { value: "sm", label: "S" },
        { value: "md", label: "M (domyślny)" },
        { value: "lg", label: "L" },
        { value: "xl", label: "XL" },
        { value: "display", label: "Display" },
      ],
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
    { key: "caption", type: "i18nText", label: "Podpis (opcjonalny)" },
    {
      key: "variant", type: "select", label: "Wariant",
      options: [
        { value: "default", label: "domyślny" },
        { value: "rounded", label: "zaokrąglony" },
        { value: "circle", label: "okrąg" },
        { value: "polaroid", label: "polaroid" },
        { value: "shadow", label: "z cieniem" },
        { value: "frame", label: "ramka" },
        { value: "zoom-hover", label: "zoom przy hover" },
      ],
    },
    {
      key: "objectFit", type: "select", label: "Dopasowanie",
      options: [
        { value: "cover", label: "cover" },
        { value: "contain", label: "contain" },
        { value: "fill", label: "fill" },
        { value: "none", label: "none" },
      ],
    },
    { key: "ratio", type: "select", label: "Proporcje", options: [
      { value: "auto", label: "auto" },
      { value: "1/1", label: "1:1" },
      { value: "4/3", label: "4:3" },
      { value: "16/9", label: "16:9" },
      { value: "3/4", label: "3:4" },
      { value: "9/16", label: "9:16" },
    ]},
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
      options: [
        { value: "primary", label: "primary" },
        { value: "outline", label: "outline" },
        { value: "ghost", label: "ghost" },
        { value: "gradient", label: "gradient" },
        { value: "soft", label: "soft" },
        { value: "link", label: "link" },
      ],
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
  divider: [
    {
      key: "variant", type: "select", label: "Wariant",
      options: [
        { value: "line", label: "linia" },
        { value: "dashed", label: "przerywana" },
        { value: "dotted", label: "kropkowana" },
        { value: "double", label: "podwójna" },
        { value: "gradient", label: "gradient" },
        { value: "icon", label: "z ikoną na środku" },
        { value: "wave", label: "fala" },
      ],
    },
    { key: "iconName", type: "text", label: "Ikona (dla wariantu z ikoną)",
      visibleWhen: (c) => c.variant === "icon" },
    { key: "thickness", type: "number", label: "Grubość (px)", min: 1, max: 12 },
  ],
  spacer: [
    { key: "height", type: "number", label: "Wysokość (px)", min: 1, max: 800 },
  ],
  video: [
    { key: "url", type: "url", label: "URL (YouTube lub MP4)" },
    { key: "autoplay", type: "select", label: "Autoodtwarzanie", options: [
      { value: "off", label: "wyłączone" },
      { value: "on", label: "włączone (wymaga mute)" },
    ]},
    { key: "loop", type: "select", label: "Pętla", options: [
      { value: "off", label: "wyłączona" },
      { value: "on", label: "włączona" },
    ]},
    { key: "controls", type: "select", label: "Kontrolki", options: [
      { value: "on", label: "widoczne" },
      { value: "off", label: "ukryte" },
    ]},
    { key: "ratio", type: "select", label: "Proporcje", options: [
      { value: "16/9", label: "16:9" },
      { value: "4/3", label: "4:3" },
      { value: "1/1", label: "1:1" },
      { value: "21/9", label: "21:9" },
      { value: "9/16", label: "9:16 (pion)" },
    ]},
  ],
  gallery: [
    {
      key: "images", type: "stringArray", rows: 5,
      label: "Obrazki (po jednym URL na linię)",
    },
    { key: "columns", type: "number", label: "Kolumny", min: 1, max: 6 },
    { key: "variant", type: "select", label: "Wariant", options: [
      { value: "grid", label: "siatka" },
      { value: "masonry", label: "masonry" },
      { value: "carousel", label: "karuzela" },
      { value: "polaroid", label: "polaroid" },
    ]},
    { key: "gap", type: "select", label: "Odstęp", options: [
      { value: "none", label: "brak" },
      { value: "xs", label: "XS" },
      { value: "sm", label: "S" },
      { value: "md", label: "M" },
      { value: "lg", label: "L" },
    ]},
    { key: "lightbox", type: "select", label: "Lightbox", options: [
      { value: "off", label: "wyłączony" },
      { value: "on", label: "włączony" },
    ]},
  ],
  icon: [
    { key: "name", type: "text", label: "Nazwa ikony", placeholder: "Star, Heart, Mail..." },
    { key: "size", type: "number", label: "Rozmiar (px)", min: 8, max: 256 },
    { key: "variant", type: "select", label: "Wariant", options: [
      { value: "plain", label: "domyślna" },
      { value: "circle", label: "kółko" },
      { value: "square", label: "kwadrat" },
      { value: "soft", label: "soft" },
      { value: "outlined", label: "obrysowana" },
    ]},
    { key: "spin", type: "select", label: "Animacja ciągła", options: [
      { value: "none", label: "brak" },
      { value: "spin", label: "obrót" },
      { value: "pulse", label: "pulsowanie" },
      { value: "bounce", label: "skakanie" },
    ]},
  ],
  map: [
    { key: "query", type: "text", label: "Adres / zapytanie" },
    { key: "ratio", type: "select", label: "Proporcje", options: [
      { value: "16/9", label: "16:9" },
      { value: "4/3", label: "4:3" },
      { value: "1/1", label: "1:1" },
    ]},
  ],
  tts: [
    { key: "source", type: "select", label: "Źródło tekstu", options: [
      { value: "post", label: "Treść wpisu (automatycznie)" },
      { value: "custom", label: "Własny tekst" },
    ]},
    { key: "text", type: "i18nText", label: "Własny tekst (jeśli wybrane)", visibleWhen: (c) => c.source === "custom" },
    { key: "label", type: "i18nText", label: "Etykieta przycisku" },
    { key: "voiceId", type: "select", label: "Głos", options: [
      { value: "JBFqnCBsd6RMkjVDRZzb", label: "George (męski, EN)" },
      { value: "EXAVITQu4vr4xnSDxMaL", label: "Sarah (kobiecy, EN)" },
      { value: "FGY2WhTYpPnrIDTdsKH5", label: "Laura (kobiecy, EN)" },
      { value: "TX3LPaxmHKxFdv7VOQHJ", label: "Liam (męski, EN)" },
      { value: "XrExE9yKIg1WjnnlVkGX", label: "Matilda (kobiecy, EN)" },
      { value: "pFZP5JQG7iQjIQuC4Bku", label: "Lily (kobiecy, EN)" },
      { value: "onwK4e9ZLuTAKqWW03F9", label: "Daniel (męski, EN)" },
      { value: "cgSgspJ2msm6clMCkdW9", label: "Jessica (kobiecy, EN)" },
    ]},
    { key: "model", type: "select", label: "Model", options: [
      { value: "eleven_multilingual_v2", label: "Multilingual v2 (PL/EN, najlepsza jakość)" },
      { value: "eleven_turbo_v2_5", label: "Turbo v2.5 (szybszy)" },
    ]},
  ],
  "post-list": [
    { key: "limit", type: "number", label: "Limit", min: 1, max: 50 },
    { key: "columns", type: "number", label: "Kolumny", min: 1, max: 6 },
    { key: "variant", type: "select", label: "Wariant", options: [
      { value: "card", label: "karty" },
      { value: "minimal", label: "minimalny" },
      { value: "overlay", label: "overlay na okładce" },
      { value: "list", label: "lista" },
    ]},
  ],
  carousel: [
    { key: "limit", type: "number", label: "Limit", min: 1, max: 50 },
    { key: "autoplay", type: "select", label: "Autoodtwarzanie", options: [
      { value: "off", label: "wyłączone" },
      { value: "on", label: "włączone" },
    ]},
  ],
  newsletter: [
    { key: "title", type: "i18nText", label: "Tytuł" },
    { key: "variant", type: "select", label: "Wariant", options: [
      { value: "icon", label: "ikona + tekst" },
      { value: "inline", label: "inline (email + przycisk)" },
      { value: "card", label: "karta z formularzem" },
      { value: "minimal", label: "minimalny" },
    ]},
    { key: "placeholder", type: "i18nText", label: "Placeholder pola email" },
    { key: "cta", type: "i18nText", label: "Etykieta przycisku" },
  ],
  cta: [
    { key: "title", type: "i18nText", label: "Tytuł" },
    { key: "subtitle", type: "i18nText", label: "Podtytuł (opcjonalny)" },
    { key: "cta", type: "i18nText", label: "CTA" },
    { key: "href", type: "url", label: "Link" },
    { key: "variant", type: "select", label: "Wariant", options: [
      { value: "default", label: "domyślny" },
      { value: "gradient", label: "gradient" },
      { value: "split", label: "split (dwa rzędy)" },
      { value: "bar", label: "wąski pasek" },
      { value: "card", label: "karta z cieniem" },
    ]},
    { key: "align", type: "select", label: "Wyrównanie", options: [
      { value: "left", label: "lewo" },
      { value: "center", label: "środek" },
      { value: "between", label: "rozsunięte" },
    ]},
  ],
  contact: [
    { key: "to", type: "text", label: "Email odbiorcy", placeholder: "kontakt@..." },
    { key: "variant", type: "select", label: "Wariant", options: [
      { value: "stacked", label: "kolumna" },
      { value: "compact", label: "kompaktowy" },
      { value: "card", label: "karta" },
    ]},
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
    { key: "rating", type: "number", label: "Ocena (0–5)", min: 0, max: 5 },
    { key: "variant", type: "select", label: "Wariant", options: [
      { value: "card", label: "karta" },
      { value: "minimal", label: "minimalny" },
      { value: "quote", label: "z dużym cudzysłowem" },
      { value: "centered", label: "wycentrowany" },
    ]},
  ],
};

