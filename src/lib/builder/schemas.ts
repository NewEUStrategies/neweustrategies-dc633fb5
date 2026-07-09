// Declarative widget content schemas.
// Single source of truth for the simple widget content editors.
// Complex list-style widgets (accordion, tabs, pricing) keep custom editors.
import type { WidgetType } from "./types";

type FieldType =
  | "text" // single-line, language-agnostic
  | "i18nText" // single-line, separate PL/EN values stored as `${key}_pl|_en`
  | "i18nHtml" // textarea HTML, separate PL/EN values
  | "url"
  | "image" // URL input + file upload to storage
  | "number"
  | "select"
  | "color" // hex color with native picker + text fallback ("" = inherit)
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
  step?: number;
  /** Optional default value used when content has no value yet. */
  default?: number | string;
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
      key: "tag",
      type: "select",
      label: "Tag (SEO)",
      options: ["h1", "h2", "h3", "h4", "h5", "h6"].map((v) => ({ value: v })),
    },
    {
      key: "variant",
      type: "select",
      label: "Wariant",
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
      key: "sizePreset",
      type: "select",
      label: "Rozmiar (preset)",
      options: [
        { value: "sm", label: "S" },
        { value: "md", label: "M (domyślny)" },
        { value: "lg", label: "L" },
        { value: "xl", label: "XL" },
        { value: "display", label: "Display" },
      ],
    },
    {
      key: "sizePx",
      type: "number",
      label: "Rozmiar tytułu (px)",
      min: 8,
      max: 200,
      hint: "Wpisz dokładny rozmiar w pikselach (np. 28, 32). Nadpisuje preset i działa identycznie na każdym urządzeniu.",
    },
    {
      key: "titleWeight",
      type: "select",
      label: "Grubość tytułu",
      options: [
        { value: "", label: "domyślna" },
        { value: "300", label: "300" },
        { value: "400", label: "400" },
        { value: "500", label: "500" },
        { value: "600", label: "600" },
        { value: "700", label: "700" },
        { value: "800", label: "800" },
        { value: "900", label: "900" },
      ],
    },
    {
      key: "subtitleSizePx",
      type: "number",
      label: "Rozmiar podtytułu (px)",
      min: 8,
      max: 120,
      hint: "Działa identycznie na desktopie, tablecie i mobile.",
    },
    {
      key: "subtitleWeight",
      type: "select",
      label: "Grubość podtytułu",
      options: [
        { value: "", label: "domyślna" },
        { value: "300", label: "300" },
        { value: "400", label: "400" },
        { value: "500", label: "500" },
        { value: "600", label: "600" },
        { value: "700", label: "700" },
      ],
    },
    { key: "href", type: "url", label: "Link (opcjonalny)", placeholder: "/o-nas lub https://…" },
    {
      key: "target",
      type: "select",
      label: "Otwórz link w",
      options: [
        { value: "self", label: "tym samym oknie" },
        { value: "blank", label: "nowej karcie" },
      ],
      visibleWhen: (c) => typeof c.href === "string" && c.href.length > 0,
    },
    {
      key: "iconName",
      type: "text",
      label: "Ikona (opcjonalna)",
      placeholder: "Star, Sparkles, ArrowRight…",
      hint: "Nazwa ikony Lucide. Zostaw puste, aby ukryć.",
    },
    {
      key: "iconPosition",
      type: "select",
      label: "Pozycja ikony",
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
      key: "columns",
      type: "number",
      label: "Kolumny tekstu",
      min: 1,
      max: 4,
      hint: "Podział tekstu na kolumny (CSS multi-column).",
    },
    {
      key: "dropCap",
      type: "select",
      label: "Inicjał",
      options: [
        { value: "off", label: "wyłączony" },
        { value: "on", label: "włączony" },
      ],
    },
  ],
  image: [
    { key: "src", type: "url", label: "URL obrazka", placeholder: "https://..." },
    {
      key: "srcDark",
      type: "url",
      label: "URL obrazka (dark mode)",
      placeholder: "opcjonalnie - pusty = używa głównej grafiki",
      hint: "Osobna grafika dla trybu ciemnego. Pozostaw puste, aby użyć tej samej.",
    },
    { key: "alt", type: "i18nText", label: "Alt" },
    { key: "caption", type: "i18nText", label: "Podpis (opcjonalny)" },
    {
      key: "variant",
      type: "select",
      label: "Wariant",
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
      key: "objectFit",
      type: "select",
      label: "Dopasowanie",
      options: [
        { value: "cover", label: "cover" },
        { value: "contain", label: "contain" },
        { value: "fill", label: "fill" },
        { value: "none", label: "none" },
      ],
    },
    {
      key: "ratio",
      type: "select",
      label: "Proporcje",
      options: [
        { value: "auto", label: "auto" },
        { value: "1/1", label: "1:1" },
        { value: "4/3", label: "4:3" },
        { value: "16/9", label: "16:9" },
        { value: "3/4", label: "3:4" },
        { value: "9/16", label: "9:16" },
      ],
    },
  ],
  button: [
    { key: "label", type: "i18nText", label: "Etykieta" },
    { key: "href", type: "url", label: "Link" },
    {
      key: "target",
      type: "select",
      label: "Otwórz w",
      options: [
        { value: "self", label: "tym samym oknie" },
        { value: "blank", label: "nowej karcie" },
      ],
    },
    {
      key: "variant",
      type: "select",
      label: "Wariant",
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
      key: "size",
      type: "select",
      label: "Rozmiar",
      options: [
        { value: "sm", label: "mały" },
        { value: "md", label: "średni" },
        { value: "lg", label: "duży" },
      ],
    },
    { key: "iconName", type: "text", label: "Ikona (Lucide)", placeholder: "ArrowRight…" },
    {
      key: "iconPosition",
      type: "select",
      label: "Pozycja ikony",
      options: [
        { value: "left", label: "po lewej" },
        { value: "right", label: "po prawej" },
      ],
      visibleWhen: (c) => typeof c.iconName === "string" && c.iconName.length > 0,
    },
    {
      key: "fullWidth",
      type: "select",
      label: "Szerokość",
      options: [
        { value: "auto", label: "automatyczna" },
        { value: "full", label: "100%" },
      ],
    },
  ],
  divider: [
    {
      key: "variant",
      type: "select",
      label: "Wariant",
      options: [
        { value: "line", label: "linia" },
        { value: "dashed", label: "przerywana" },
        { value: "dotted", label: "kropkowana" },
        { value: "double", label: "podwójna" },
        { value: "gradient", label: "gradient" },
        { value: "icon", label: "z ikoną na środku" },
        { value: "wave", label: "fala" },
        { value: "space", label: "tylko odstęp (bez linii)" },
      ],
    },
    {
      key: "iconName",
      type: "text",
      label: "Ikona (dla wariantu z ikoną)",
      visibleWhen: (c) => c.variant === "icon",
    },
    {
      key: "thickness",
      type: "number",
      label: "Grubość / wysokość (px)",
      min: 1,
      max: 400,
      default: 2,
      hint: 'Dla wariantu „tylko odstęp" wartość określa wysokość pustej przestrzeni.',
    },
    {
      key: "widthPct",
      type: "number",
      label: "Szerokość (%)",
      min: 10,
      max: 100,
      step: 5,
      default: 100,
      hint: "Szerokość linii względem kontenera (10-100%).",
      visibleWhen: (c) => c.variant !== "space",
    },
    {
      key: "align",
      type: "select",
      label: "Wyrównanie",
      options: [
        { value: "left", label: "do lewej" },
        { value: "center", label: "wyśrodkowane" },
        { value: "right", label: "do prawej" },
      ],
      default: "center",
      visibleWhen: (c) => c.variant !== "space" && Number(c.widthPct ?? 100) < 100,
    },
    {
      key: "color",
      type: "color",
      label: "Kolor",
      hint: "Pozostaw puste, aby użyć koloru motywu (border).",
      visibleWhen: (c) => c.variant !== "space",
    },
  ],
  spacer: [{ key: "height", type: "number", label: "Wysokość (px)", min: 1, max: 800 }],
  video: [
    { key: "url", type: "url", label: "URL (YouTube lub MP4)" },
    {
      key: "autoplay",
      type: "select",
      label: "Autoodtwarzanie",
      options: [
        { value: "off", label: "wyłączone" },
        { value: "on", label: "włączone (wymaga mute)" },
      ],
    },
    {
      key: "loop",
      type: "select",
      label: "Pętla",
      options: [
        { value: "off", label: "wyłączona" },
        { value: "on", label: "włączona" },
      ],
    },
    {
      key: "controls",
      type: "select",
      label: "Kontrolki",
      options: [
        { value: "on", label: "widoczne" },
        { value: "off", label: "ukryte" },
      ],
    },
    {
      key: "ratio",
      type: "select",
      label: "Proporcje",
      options: [
        { value: "16/9", label: "16:9" },
        { value: "4/3", label: "4:3" },
        { value: "1/1", label: "1:1" },
        { value: "21/9", label: "21:9" },
        { value: "9/16", label: "9:16 (pion)" },
      ],
    },
  ],
  gallery: [
    {
      key: "images",
      type: "stringArray",
      rows: 5,
      label: "Obrazki (po jednym URL na linię)",
    },
    { key: "columns", type: "number", label: "Kolumny", min: 1, max: 6 },
    {
      key: "variant",
      type: "select",
      label: "Wariant",
      options: [
        { value: "grid", label: "siatka" },
        { value: "masonry", label: "masonry" },
        { value: "carousel", label: "karuzela" },
        { value: "polaroid", label: "polaroid" },
      ],
    },
    {
      key: "gap",
      type: "select",
      label: "Odstęp",
      options: [
        { value: "none", label: "brak" },
        { value: "xs", label: "XS" },
        { value: "sm", label: "S" },
        { value: "md", label: "M" },
        { value: "lg", label: "L" },
      ],
    },
    {
      key: "lightbox",
      type: "select",
      label: "Lightbox",
      options: [
        { value: "off", label: "wyłączony" },
        { value: "on", label: "włączony" },
      ],
    },
  ],
  icon: [
    { key: "name", type: "text", label: "Nazwa ikony", placeholder: "Star, Heart, Mail..." },
    { key: "size", type: "number", label: "Rozmiar (px)", min: 8, max: 256 },
    {
      key: "variant",
      type: "select",
      label: "Wariant",
      options: [
        { value: "plain", label: "domyślna" },
        { value: "circle", label: "kółko" },
        { value: "square", label: "kwadrat" },
        { value: "soft", label: "soft" },
        { value: "outlined", label: "obrysowana" },
      ],
    },
    {
      key: "spin",
      type: "select",
      label: "Animacja ciągła",
      options: [
        { value: "none", label: "brak" },
        { value: "spin", label: "obrót" },
        { value: "pulse", label: "pulsowanie" },
        { value: "bounce", label: "skakanie" },
      ],
    },
  ],
  map: [
    { key: "query", type: "text", label: "Adres / zapytanie" },
    {
      key: "ratio",
      type: "select",
      label: "Proporcje",
      options: [
        { value: "16/9", label: "16:9" },
        { value: "4/3", label: "4:3" },
        { value: "1/1", label: "1:1" },
      ],
    },
  ],
  tts: [
    {
      key: "source",
      type: "select",
      label: "Źródło tekstu",
      options: [
        { value: "post", label: "Treść wpisu (automatycznie)" },
        { value: "custom", label: "Własny tekst" },
      ],
    },
    {
      key: "text",
      type: "i18nText",
      label: "Własny tekst (jeśli wybrane)",
      visibleWhen: (c) => c.source === "custom",
    },
    { key: "label", type: "i18nText", label: "Etykieta przycisku" },
    {
      key: "voiceId",
      type: "select",
      label: "Głos",
      options: [
        { value: "JBFqnCBsd6RMkjVDRZzb", label: "George (męski, EN)" },
        { value: "EXAVITQu4vr4xnSDxMaL", label: "Sarah (kobiecy, EN)" },
        { value: "FGY2WhTYpPnrIDTdsKH5", label: "Laura (kobiecy, EN)" },
        { value: "TX3LPaxmHKxFdv7VOQHJ", label: "Liam (męski, EN)" },
        { value: "XrExE9yKIg1WjnnlVkGX", label: "Matilda (kobiecy, EN)" },
        { value: "pFZP5JQG7iQjIQuC4Bku", label: "Lily (kobiecy, EN)" },
        { value: "onwK4e9ZLuTAKqWW03F9", label: "Daniel (męski, EN)" },
        { value: "cgSgspJ2msm6clMCkdW9", label: "Jessica (kobiecy, EN)" },
      ],
    },
    {
      key: "model",
      type: "select",
      label: "Model",
      options: [
        { value: "eleven_multilingual_v2", label: "Multilingual v2 (PL/EN, najlepsza jakość)" },
        { value: "eleven_turbo_v2_5", label: "Turbo v2.5 (szybszy)" },
      ],
    },
  ],
  "post-list": [
    { key: "limit", type: "number", label: "Limit", min: 1, max: 50 },
    { key: "columns", type: "number", label: "Kolumny", min: 1, max: 6 },
    {
      key: "variant",
      type: "select",
      label: "Wariant",
      options: [
        { value: "card", label: "karty" },
        { value: "minimal", label: "minimalny" },
        { value: "overlay", label: "overlay na okładce" },
        { value: "list", label: "lista" },
      ],
    },
  ],
  carousel: [
    { key: "limit", type: "number", label: "Limit", min: 1, max: 50 },
    {
      key: "autoplay",
      type: "select",
      label: "Autoodtwarzanie",
      options: [
        { value: "off", label: "wyłączone" },
        { value: "on", label: "włączone" },
      ],
    },
  ],
  newsletter: [
    { key: "title", type: "i18nText", label: "Tytuł" },
    {
      key: "variant",
      type: "select",
      label: "Wariant",
      options: [
        { value: "icon-only", label: "sama ikona" },
        { value: "icon", label: "ikona + tekst" },
        { value: "inline", label: "inline (email + przycisk)" },
        { value: "card", label: "karta z formularzem" },
        { value: "minimal", label: "minimalny" },
      ],
    },
    {
      key: "iconName",
      type: "text",
      label: "Ikona (Lucide)",
      placeholder: "Mail, Send, BellRing, Inbox…",
      hint: "Nazwa ikony Lucide. Domyślnie: Mail.",
      visibleWhen: (c) => {
        const v = typeof c.variant === "string" ? c.variant : "icon";
        return v === "icon" || v === "icon-only";
      },
    },
    { key: "placeholder", type: "i18nText", label: "Placeholder pola email" },
    { key: "cta", type: "i18nText", label: "Etykieta przycisku" },
  ],
  cta: [
    { key: "title", type: "i18nText", label: "Tytuł" },
    { key: "subtitle", type: "i18nText", label: "Podtytuł (opcjonalny)" },
    { key: "cta", type: "i18nText", label: "CTA" },
    { key: "href", type: "url", label: "Link" },
    {
      key: "variant",
      type: "select",
      label: "Wariant",
      options: [
        { value: "default", label: "domyślny" },
        { value: "gradient", label: "gradient" },
        { value: "split", label: "split (dwa rzędy)" },
        { value: "bar", label: "wąski pasek" },
        { value: "card", label: "karta z cieniem" },
      ],
    },
    {
      key: "align",
      type: "select",
      label: "Wyrównanie",
      options: [
        { value: "left", label: "lewo" },
        { value: "center", label: "środek" },
        { value: "between", label: "rozsunięte" },
      ],
    },
  ],
  // Legacy "contact" alias - same fields as the new "contact-form" widget.
  // Actual array is attached after WIDGET_SCHEMAS is constructed (see bottom of file).
  contact: [],

  "nav-link": [
    { key: "label", type: "i18nText", label: "Etykieta" },
    { key: "href", type: "url", label: "Docelowy URL", placeholder: "/about lub https://…" },
    {
      key: "target",
      type: "select",
      label: "Otwórz w",
      options: [
        { value: "self", label: "tym samym oknie" },
        { value: "blank", label: "nowej karcie" },
      ],
    },
    {
      key: "variant",
      type: "select",
      label: "Wygląd",
      options: [
        { value: "text", label: "tekst" },
        { value: "underline", label: "podkreślony" },
        { value: "pill", label: "pigułka" },
        { value: "primary", label: "przycisk primary" },
        { value: "outline", label: "przycisk obrysowany" },
      ],
    },
    {
      key: "iconName",
      type: "text",
      label: "Ikona (opcjonalna)",
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
    {
      key: "variant",
      type: "select",
      label: "Wariant",
      options: [
        { value: "card", label: "karta" },
        { value: "minimal", label: "minimalny" },
        { value: "quote", label: "z dużym cudzysłowem" },
        { value: "centered", label: "wycentrowany" },
      ],
    },
  ],
  "search-button": [
    { key: "label", type: "i18nText", label: "Placeholder", placeholder: "Szukaj" },
    {
      key: "height",
      type: "number",
      label: "Wysokość pola (px)",
      min: 24,
      max: 120,
      default: 40,
      hint: "Domyślnie 40 px.",
    },
    { key: "radius", type: "number", label: "Zaokrąglenie (px)", min: 0, max: 60, default: 8 },
    {
      key: "fontSize",
      type: "number",
      label: "Rozmiar tekstu (px)",
      min: 10,
      max: 32,
      default: 14,
    },
    { key: "limit", type: "number", label: "Limit wyników", min: 1, max: 20, default: 8 },
    {
      key: "liveResults",
      type: "select",
      label: "Wyniki na żywo",
      options: [
        { value: "on", label: "włączone" },
        { value: "off", label: "wyłączone" },
      ],
    },
  ],

  // ---------- Home-page building blocks ----------
  "section-label": [
    { key: "label", type: "i18nText", label: "Etykieta sekcji" },
    // `variant` and `color`/`accentColor` are rendered by a custom visual picker
    // (SectionLabelEditor) - not by the generic schema renderer.
    { key: "action", type: "i18nText", label: "Tekst linku (opcjonalny)", placeholder: "więcej" },
    { key: "href", type: "url", label: "URL linku (opcjonalny)", placeholder: "/kategoria/..." },
  ],
  "hot-topic-bar": [
    { key: "badge", type: "i18nText", label: "Etykieta (badge)" },
    { key: "title", type: "i18nText", label: "Tytuł" },
    { key: "href", type: "url", label: "Link (opcjonalny)" },
    {
      key: "iconName",
      type: "text",
      label: "Ikona (Lucide)",
      placeholder: "Flame, Zap, AlertTriangle…",
      hint: "Nazwa ikony Lucide. Domyślnie: Flame.",
    },
  ],
  "dark-featured-card": [
    { key: "badge", type: "i18nText", label: "Etykieta (badge)" },
    { key: "title", type: "i18nText", label: "Tytuł" },
    { key: "excerpt", type: "i18nText", label: "Zajawka (opcjonalna)" },
    { key: "image", type: "image", label: "Obrazek", hint: "Wklej URL lub wgraj plik z dysku." },
    {
      key: "imageHover",
      type: "select",
      label: "Animacja obrazka (hover)",
      options: [
        { value: "zoom-in", label: "Zoom in (przybliżenie)" },
        { value: "zoom-out", label: "Zoom out (oddalenie)" },
        { value: "fade", label: "Przyciemnienie" },
        { value: "brighten", label: "Rozjaśnienie" },
        { value: "tilt", label: "Lekkie przechylenie" },
        { value: "none", label: "Brak" },
      ],
      hint: "Efekt po najechaniu kursorem na obrazek.",
    },
    { key: "href", type: "url", label: "Link (opcjonalny)" },
  ],
  "social-icons": [
    {
      key: "facebook",
      type: "url",
      label: "Facebook URL",
      placeholder: "https://facebook.com/...",
    },
    { key: "x", type: "url", label: "X (dawniej Twitter) URL", placeholder: "https://x.com/..." },
    { key: "youtube", type: "url", label: "YouTube URL", placeholder: "https://youtube.com/..." },
    {
      key: "instagram",
      type: "url",
      label: "Instagram URL",
      placeholder: "https://instagram.com/...",
    },
    {
      key: "linkedin",
      type: "url",
      label: "LinkedIn URL",
      placeholder: "https://linkedin.com/in/...",
    },
    { key: "email", type: "text", label: "Email", placeholder: "kontakt@..." },
    {
      key: "showEmpty",
      type: "select",
      label: "Puste platformy",
      options: [
        { value: "hide", label: "ukryj (tylko z linkiem)" },
        { value: "show", label: "pokaż wyszarzone" },
      ],
      hint: "Czy pokazywać ikony bez linku.",
    },
    { key: "size", type: "number", label: "Rozmiar ikony (px)", min: 10, max: 64 },
    {
      key: "gap",
      type: "number",
      label: "Odstęp między ikonami (px)",
      min: 0,
      max: 32,
      hint: "Odległość między poszczególnymi ikonami.",
    },
    {
      key: "colorMode",
      type: "select",
      label: "Kolory ikon",
      options: [
        { value: "inherit", label: "domyślne (dziedziczone)" },
        { value: "brand", label: "kolor brand" },
        { value: "official", label: "oficjalne kolory marek" },
        { value: "custom", label: "własny kolor" },
        { value: "dark", label: "ciemne (czarne)" },
        { value: "light", label: "jasne (białe)" },
      ],
    },
    {
      key: "customColor",
      type: "text",
      label: "Własny kolor",
      placeholder: "#1877F2 lub var(--brand)",
      visibleWhen: (c) => c.colorMode === "custom",
    },
    {
      key: "bgMode",
      type: "select",
      label: "Tło ikony",
      options: [
        { value: "none", label: "brak" },
        { value: "subtle", label: "delikatne (muted)" },
        { value: "brand", label: "brand" },
        { value: "official", label: "oficjalne (marka)" },
        { value: "contrast", label: "kontrastowe (fg/bg)" },
        { value: "custom", label: "własne" },
      ],
    },
    {
      key: "customBgColor",
      type: "text",
      label: "Własny kolor tła",
      placeholder: "#000000",
      visibleWhen: (c) => c.bgMode === "custom",
    },
    {
      key: "shape",
      type: "select",
      label: "Zaokrąglenie",
      options: [
        { value: "none", label: "brak (kant)" },
        { value: "sm", label: "małe" },
        { value: "md", label: "średnie" },
        { value: "lg", label: "duże" },
        { value: "full", label: "pełne (koło)" },
        { value: "square", label: "kwadrat" },
      ],
    },
    {
      key: "themeAdapt",
      type: "select",
      label: "Adaptacja dark / light",
      options: [
        { value: "auto", label: "automatyczna (dostosuj się)" },
        { value: "force-light", label: "wymuś jasny styl" },
        { value: "force-dark", label: "wymuś ciemny styl" },
        { value: "off", label: "wyłączona" },
      ],
      hint: "Jak ikony mają się zachowywać w dark / light mode.",
    },
  ],
  // `rated-list` has its own custom list editor in WidgetProperties.tsx.
  "news-ticker": [
    {
      key: "badge",
      type: "i18nText",
      label: "Etykieta (badge)",
      placeholder: "Najnowsze / Latest",
    },
    { key: "limit", type: "number", label: "Liczba wpisów", min: 3, max: 30 },
    {
      key: "speedSeconds",
      type: "number",
      label: "Tempo (sekundy na pętlę)",
      min: 10,
      max: 180,
      hint: "Im większa wartość, tym wolniejsze przewijanie.",
    },
    {
      key: "pauseOnHover",
      type: "select",
      label: "Pauza po najechaniu",
      options: [
        { value: "true", label: "Tak" },
        { value: "false", label: "Nie" },
      ],
    },
    { key: "separator", type: "text", label: "Separator", placeholder: "•" },
    {
      key: "categoriesCsv",
      type: "text",
      label: "Kategorie (slugi, po przecinku)",
      placeholder: "polityka, gospodarka",
      hint: "Pozostaw puste = wszystkie.",
    },
    {
      key: "uniqueOnPage",
      type: "select",
      label: "Nie powtarzaj wpisów",
      options: [
        { value: "false", label: "Wyłączone" },
        { value: "true", label: "Pomiń wpisy widoczne w innych widgetach" },
      ],
      hint: "Wyklucza wpisy już wyrenderowane przez wcześniejsze widgety na tej stronie.",
    },
  ],
  "podcast-latest": [
    {
      key: "variant",
      type: "select",
      label: "Wariant",
      options: [
        { value: "grid", label: "Siatka" },
        { value: "list", label: "Lista" },
        { value: "featured", label: "Wyróżniony odcinek" },
      ],
    },
    { key: "limit", type: "number", label: "Liczba odcinków", min: 1, max: 24 },
    {
      key: "columns",
      type: "number",
      label: "Kolumny (siatka)",
      min: 1,
      max: 4,
      hint: "Tylko dla wariantu „Siatka”.",
    },
    {
      key: "showPlayer",
      type: "select",
      label: "Pokaż odtwarzacz",
      options: [
        { value: "true", label: "Tak" },
        { value: "false", label: "Nie" },
      ],
    },
  ],
  "web-stories-carousel": [
    {
      key: "variant",
      type: "select",
      label: "Wariant",
      options: [
        { value: "carousel", label: "Karuzela" },
        { value: "grid", label: "Siatka" },
      ],
    },
    { key: "limit", type: "number", label: "Liczba historii", min: 2, max: 20 },
    {
      key: "aspect",
      type: "select",
      label: "Proporcje kafla",
      options: [
        { value: "9/16", label: "Pionowy 9:16" },
        { value: "3/4", label: "3:4" },
        { value: "1/1", label: "Kwadrat" },
      ],
    },
  ],
  "join-us": [
    {
      key: "variant",
      type: "select",
      label: "Wariant",
      options: [
        { value: "card", label: "karta" },
        { value: "split", label: "split (lewo: korzyści, prawo: formularz)" },
        { value: "split-image", label: "split z grafiką (lewo: obraz + korzyści, prawo: formularz)" },
        { value: "inline", label: "inline" },
      ],
    },

    // ----- Wygląd / tło (domyślnie: global colors, dopuszcza transparent) -----
    { key: "bgLight", type: "color", label: "Tło (light mode)", hint: "Puste = tło z global colors. Możesz też ustawić transparent." },
    { key: "bgDark", type: "color", label: "Tło (dark mode)", hint: "Puste = tło z global colors. Możesz też ustawić transparent." },


    // --- Obszar grafiki (aktywny w wariancie "split-image")
    {
      key: "imageUrl",
      type: "image",
      label: "Grafika: obraz (wgraj plik lub wklej URL)",
      hint: "Wgraj plik z dysku (trafi do biblioteki mediów) albo wklej pełny URL. Puste = użyty zostanie gradient fallback.",
    },
    { key: "imageAlt", type: "text", label: "Grafika: alt (PL) - opis dla dostępności / SEO" },
    { key: "imageAltEn", type: "text", label: "Grafika: alt (EN) - accessibility / SEO description" },

    {
      key: "imageGradient",
      type: "text",
      label: "Grafika: gradient/kolor fallback (CSS `background`, np. linear-gradient(...))",
    },
    {
      key: "imageOverlay",
      type: "number",
      label: "Grafika: przyciemnienie (0-100%)",
      min: 0,
      max: 100,
      step: 5,
    },
    {
      key: "imagePosition",
      type: "text",
      label: "Grafika: focal point / object-position (np. center, top, 50% 30%)",
    },
    {
      key: "imageAspect",
      type: "select",
      label: "Grafika: proporcje kadru (aspect-ratio)",
      options: [
        { value: "auto", label: "auto (dopasuj do kolumny obok)" },
        { value: "16/9", label: "16:9 - baner poziomy" },
        { value: "4/3", label: "4:3 - klasyczny" },
        { value: "3/2", label: "3:2 - fotografia" },
        { value: "1/1", label: "1:1 - kwadrat" },
        { value: "4/5", label: "4:5 - portret social" },
        { value: "3/4", label: "3:4 - portret" },
        { value: "2/3", label: "2:3 - plakat" },
        { value: "9/16", label: "9:16 - pionowy / mobile story" },
        { value: "21/9", label: "21:9 - ultrawide cinematic" },
      ],
    },
    {
      key: "imageFit",
      type: "select",
      label: "Grafika: dopasowanie w kadrze (object-fit)",
      options: [
        { value: "cover", label: "cover - wypełnij kadr (może przyciąć)" },
        { value: "contain", label: "contain - zmieść cały obraz (może zostać tło)" },
      ],
    },


    {
      key: "showInterests",
      type: "select",
      label: "Pokaż wybór zainteresowań",
      options: [
        { value: "1", label: "tak" },
        { value: "0", label: "nie" },
      ],
    },
    {
      key: "interestsDisplay",
      type: "select",
      label: "Zainteresowania: sposób wyboru",
      options: [
        { value: "chips", label: "chipsy (widoczne wszystkie)" },
        { value: "droplist", label: "droplist (multiselect)" },
      ],
    },
    {
      key: "requireInterests",
      type: "select",
      label: "Zainteresowania: wymagane?",
      options: [
        { value: "0", label: "nie" },
        { value: "1", label: "tak (min. 1)" },
      ],
    },
    {
      key: "interestSlugs",
      type: "stringArray",
      rows: 6,
      label: "Lista tematów do pokazania (po jednym slug na linię; puste = wszystkie z katalogu)",
    },

    // Copy overrides
    { key: "title", type: "i18nText", label: "Tytuł" },
    { key: "subtitle", type: "i18nText", label: "Podtytuł" },
    { key: "perk1", type: "i18nText", label: "Korzyść 1" },
    { key: "perk2", type: "i18nText", label: "Korzyść 2" },
    { key: "perk3", type: "i18nText", label: "Korzyść 3" },
    { key: "interestsLabel", type: "i18nText", label: "Nagłówek zainteresowań" },
    { key: "submitLabel", type: "i18nText", label: "Etykieta przycisku" },
    { key: "submittingLabel", type: "i18nText", label: "Etykieta podczas wysyłki" },
    { key: "consentText", type: "i18nText", label: "Tekst zgody / stopka" },
    { key: "successText", type: "i18nText", label: "Komunikat sukcesu" },
    { key: "namePlaceholder", type: "i18nText", label: "Placeholder: Imię (pojedyncze pole)" },
    { key: "emailPlaceholder", type: "i18nText", label: "Placeholder: E-mail" },
    // Optional extra fields (+ per-field "wymagane" toggle)
    {
      key: "showFirstName",
      type: "select",
      label: "Pole: Imię (rozdzielone)",
      options: [
        { value: "0", label: "ukryj" },
        { value: "1", label: "pokaż" },
      ],
    },
    {
      key: "requireFirstName",
      type: "select",
      label: "Imię: wymagane?",
      options: [
        { value: "0", label: "nie" },
        { value: "1", label: "tak" },
      ],
    },
    { key: "firstNamePlaceholder", type: "i18nText", label: "Placeholder: Imię" },
    {
      key: "showLastName",
      type: "select",
      label: "Pole: Nazwisko",
      options: [
        { value: "0", label: "ukryj" },
        { value: "1", label: "pokaż" },
      ],
    },
    {
      key: "requireLastName",
      type: "select",
      label: "Nazwisko: wymagane?",
      options: [
        { value: "0", label: "nie" },
        { value: "1", label: "tak" },
      ],
    },
    { key: "lastNamePlaceholder", type: "i18nText", label: "Placeholder: Nazwisko" },
    {
      key: "requireEmail",
      type: "select",
      label: "E-mail: wymagany?",
      options: [
        { value: "1", label: "tak" },
        { value: "0", label: "nie" },
      ],
    },
    {
      key: "showPosition",
      type: "select",
      label: "Pole: Stanowisko (LinkedIn)",
      options: [
        { value: "0", label: "ukryj" },
        { value: "1", label: "pokaż" },
      ],
    },
    {
      key: "requirePosition",
      type: "select",
      label: "Stanowisko: wymagane?",
      options: [
        { value: "0", label: "nie" },
        { value: "1", label: "tak" },
      ],
    },
    { key: "positionPlaceholder", type: "i18nText", label: "Placeholder: Stanowisko" },
    {
      key: "showLinkedin",
      type: "select",
      label: "Pole: Profil LinkedIn",
      options: [
        { value: "0", label: "ukryj" },
        { value: "1", label: "pokaż" },
      ],
    },
    {
      key: "requireLinkedin",
      type: "select",
      label: "LinkedIn: wymagany?",
      options: [
        { value: "0", label: "nie" },
        { value: "1", label: "tak" },
      ],
    },
    { key: "linkedinPlaceholder", type: "i18nText", label: "Placeholder: LinkedIn URL" },
    {
      key: "showPhone",
      type: "select",
      label: "Pole: Telefon",
      options: [
        { value: "0", label: "ukryj" },
        { value: "1", label: "pokaż" },
      ],
    },
    {
      key: "requirePhone",
      type: "select",
      label: "Telefon: wymagany?",
      options: [
        { value: "0", label: "nie" },
        { value: "1", label: "tak" },
      ],
    },
    { key: "phonePlaceholder", type: "i18nText", label: "Placeholder: Telefon" },
    {
      key: "showCompany",
      type: "select",
      label: "Pole: Firma",
      options: [
        { value: "0", label: "ukryj" },
        { value: "1", label: "pokaż" },
      ],
    },
    {
      key: "requireCompany",
      type: "select",
      label: "Firma: wymagana?",
      options: [
        { value: "0", label: "nie" },
        { value: "1", label: "tak" },
      ],
    },
    { key: "companyPlaceholder", type: "i18nText", label: "Placeholder: Firma" },
    {
      key: "showCountry",
      type: "select",
      label: "Pole: Kraj",
      options: [
        { value: "0", label: "ukryj" },
        { value: "1", label: "pokaż" },
      ],
    },
    {
      key: "requireCountry",
      type: "select",
      label: "Kraj: wymagany?",
      options: [
        { value: "0", label: "nie" },
        { value: "1", label: "tak" },
      ],
    },
    { key: "countryPlaceholder", type: "i18nText", label: "Placeholder: Kraj" },

    // ----- Rozmiary czcionek (px) -----
    { key: "titleSize", type: "number", label: "Rozmiar tytułu (px)", min: 10, max: 96 },
    { key: "descriptionSize", type: "number", label: "Rozmiar opisu (px)", min: 8, max: 48 },
    { key: "perkSize", type: "number", label: "Rozmiar bulletpointów (px)", min: 8, max: 32 },
    { key: "labelSize", type: "number", label: "Rozmiar etykiet (px)", min: 8, max: 24 },
    { key: "placeholderSize", type: "number", label: "Rozmiar placeholderów / pól (px)", min: 8, max: 24 },
    { key: "buttonSize", type: "number", label: "Rozmiar przycisku (px)", min: 8, max: 28 },
    { key: "consentSize", type: "number", label: "Rozmiar zgód / stopki (px)", min: 8, max: 20 },
  ],


  "customize-interests": [
    {
      key: "variant",
      type: "select",
      label: "Wariant",
      options: [
        { value: "full", label: "pełny" },
        { value: "compact", label: "kompaktowy" },
      ],
    },
    {
      key: "showHeader",
      type: "select",
      label: "Pokaż nagłówek",
      options: [
        { value: "1", label: "tak" },
        { value: "0", label: "nie" },
      ],
    },
  ],
  "contact-form": [
    {
      key: "variant",
      type: "select",
      label: "Wariant",
      options: [
        { value: "card", label: "Karta" },
        { value: "flat", label: "Płaski" },
      ],
    },
    { key: "title", type: "i18nText", label: "Tytuł" },
    { key: "subtitle", type: "i18nText", label: "Podtytuł" },
    {
      key: "iconUrl",
      type: "image",
      label: "Ikona nagłówka",
      hint: "Rekomendowane 128x128 px (PNG/SVG, kwadrat)",
    },
    // ----- Pola formularza (+ per-field "wymagane") -----
    {
      key: "showFirstName",
      type: "select",
      label: "Pole: Imię",
      options: [
        { value: "1", label: "tak" },
        { value: "0", label: "nie" },
      ],
    },
    {
      key: "requireFirstName",
      type: "select",
      label: "Imię: wymagane?",
      options: [
        { value: "1", label: "tak" },
        { value: "0", label: "nie" },
      ],
    },
    {
      key: "showLastName",
      type: "select",
      label: "Pole: Nazwisko",
      options: [
        { value: "1", label: "tak" },
        { value: "0", label: "nie" },
      ],
    },
    {
      key: "requireLastName",
      type: "select",
      label: "Nazwisko: wymagane?",
      options: [
        { value: "1", label: "tak" },
        { value: "0", label: "nie" },
      ],
    },
    {
      key: "showEmail",
      type: "select",
      label: "Pole: E-mail",
      options: [
        { value: "1", label: "tak" },
        { value: "0", label: "nie" },
      ],
    },
    {
      key: "requireEmail",
      type: "select",
      label: "E-mail: wymagany?",
      options: [
        { value: "1", label: "tak" },
        { value: "0", label: "nie" },
      ],
    },
    {
      key: "showPhone",
      type: "select",
      label: "Pole: Telefon",
      options: [
        { value: "1", label: "tak" },
        { value: "0", label: "nie" },
      ],
    },
    {
      key: "requirePhone",
      type: "select",
      label: "Telefon: wymagany?",
      options: [
        { value: "0", label: "nie" },
        { value: "1", label: "tak" },
      ],
    },
    {
      key: "showCompany",
      type: "select",
      label: "Pole: Firma",
      options: [
        { value: "1", label: "tak" },
        { value: "0", label: "nie" },
      ],
    },
    {
      key: "requireCompany",
      type: "select",
      label: "Firma: wymagana?",
      options: [
        { value: "0", label: "nie" },
        { value: "1", label: "tak" },
      ],
    },
    {
      key: "showSubject",
      type: "select",
      label: "Pole: Temat",
      options: [
        { value: "1", label: "tak" },
        { value: "0", label: "nie" },
      ],
    },
    {
      key: "requireSubject",
      type: "select",
      label: "Temat: wymagany?",
      options: [
        { value: "0", label: "nie" },
        { value: "1", label: "tak" },
      ],
    },
    {
      key: "showMessage",
      type: "select",
      label: "Pole: Wiadomość",
      options: [
        { value: "1", label: "tak" },
        { value: "0", label: "nie" },
      ],
    },
    {
      key: "requireMessage",
      type: "select",
      label: "Wiadomość: wymagana?",
      options: [
        { value: "1", label: "tak" },
        { value: "0", label: "nie" },
      ],
    },

    {
      key: "requireConsent",
      type: "select",
      label: "Wymagaj zgody (RODO)",
      options: [
        { value: "1", label: "tak" },
        { value: "0", label: "nie" },
      ],
    },
    {
      key: "consentText",
      type: "i18nText",
      label: "Treść zgody (RODO)",
      hint: "Możesz użyć składni [tekst linku](https://adres.pl) aby wstawić inline hiperłącze.",
    },
    {
      key: "showNewsletterOptIn",
      type: "select",
      label: "Pole: Zapis do newslettera",
      options: [
        { value: "1", label: "tak" },
        { value: "0", label: "nie" },
      ],
    },

    { key: "newsletterLabel", type: "i18nText", label: "Etykieta zapisu do newslettera" },
    // ----- Layout & przycisk -----
    {
      key: "columns",
      type: "select",
      label: "Kolumny",
      options: [
        { value: "1", label: "1" },
        { value: "2", label: "2" },
        { value: "3", label: "3" },
      ],
    },
    { key: "submitLabel", type: "i18nText", label: "Etykieta przycisku" },
    {
      key: "buttonPosition",
      type: "select",
      label: "Pozycja przycisku",
      options: [
        { value: "bottom", label: "pod formularzem" },
        { value: "inline-right", label: "obok pól (po prawej)" },
      ],
    },
    {
      key: "buttonAlign",
      type: "select",
      label: "Wyrównanie przycisku",
      options: [
        { value: "left", label: "lewa" },
        { value: "center", label: "środek" },
        { value: "right", label: "prawa" },
        { value: "full", label: "pełna szerokość" },
      ],
    },
    {
      key: "buttonVariant",
      type: "select",
      label: "Wariant przycisku",
      options: [
        { value: "solid", label: "wypełniony" },
        { value: "outline", label: "obrysowany" },
        { value: "ghost", label: "ghost" },
        { value: "gradient", label: "gradient" },
      ],
    },
    {
      key: "buttonSize",
      type: "select",
      label: "Rozmiar przycisku",
      options: [
        { value: "sm", label: "S" },
        { value: "md", label: "M" },
        { value: "lg", label: "L" },
      ],
    },
    // ----- Wygląd / tło -----
    { key: "bgLight", type: "color", label: "Tło (light mode)" },
    { key: "bgDark", type: "color", label: "Tło (dark mode)" },
    { key: "textColor", type: "color", label: "Kolor tekstu" },
    { key: "borderColor", type: "color", label: "Kolor obramowania" },
    { key: "radiusPx", type: "number", label: "Zaokrąglenie (px)", min: 0, max: 64, step: 1 },
    {
      key: "paddingPx",
      type: "number",
      label: "Padding wewnętrzny (px)",
      min: 0,
      max: 96,
      step: 2,
    },
    {
      key: "bgImage",
      type: "image",
      label: "Obraz tła (desktop)",
      hint: "Rekomendowane 1600x900 px (lub 2400x1200 dla hero)",
    },
    {
      key: "bgImageMobile",
      type: "image",
      label: "Obraz tła (mobile)",
      hint: "Rekomendowane 800x1000 px (portret)",
    },
    {
      key: "bgOverlay",
      type: "number",
      label: "Przyciemnienie obrazu tła (%)",
      min: 0,
      max: 100,
      step: 5,
    },
    {
      key: "recipient",
      type: "text",
      label: "E-mail odbiorcy (override)",
      placeholder: "kontakt@firma.pl",
    },

    // ----- Rozmiary czcionek (px, puste = domyślne) -----
    { key: "titleSize", type: "number", label: "Rozmiar tytułu (px)", min: 10, max: 96 },
    { key: "descriptionSize", type: "number", label: "Rozmiar opisu / podtytułu (px)", min: 8, max: 48 },
    { key: "labelSize", type: "number", label: "Rozmiar etykiet pól (px)", min: 8, max: 24 },
    { key: "placeholderSize", type: "number", label: "Rozmiar placeholderów / pól (px)", min: 8, max: 24 },
    { key: "buttonFontSize", type: "number", label: "Rozmiar przycisku (px)", min: 8, max: 28 },
    { key: "consentSize", type: "number", label: "Rozmiar zgód / newsletter (px)", min: 8, max: 20 },
  ],
};

// -----------------------------------------------------------------------------
// Form-field editor extensions (Tura A):
// - Every form widget now exposes per-field: show / require / label / placeholder
// - Every form widget gets a `customFields` JSON array editor (hybrid mode)
// -----------------------------------------------------------------------------

/** Generates {label, placeholder} i18nText pairs for a field key. */
const labelPh = (key: string, labelBase: string): SchemaField[] => [
  { key: `${key}Label`, type: "i18nText", label: `Etykieta: ${labelBase}` },
  { key: `${key}Placeholder`, type: "i18nText", label: `Placeholder: ${labelBase}` },
];

/** Full editor block for one form field: show + require + label + placeholder. */
const fieldBlock = (
  key: string,
  labelBase: string,
  opts: { defaultShow?: "0" | "1"; defaultRequire?: "0" | "1" } = {},
): SchemaField[] => [
  {
    key: `show${key.charAt(0).toUpperCase()}${key.slice(1)}`,
    type: "select",
    label: `Pole: ${labelBase} - widoczne?`,
    options: [
      { value: "1", label: "pokaż" },
      { value: "0", label: "ukryj" },
    ],
    default: opts.defaultShow ?? "1",
  },
  {
    key: `require${key.charAt(0).toUpperCase()}${key.slice(1)}`,
    type: "select",
    label: `${labelBase} - wymagane?`,
    options: [
      { value: "1", label: "tak" },
      { value: "0", label: "nie" },
    ],
    default: opts.defaultRequire ?? "0",
  },
  ...labelPh(key, labelBase),
];

/**
 * Custom-fields JSON editor. Users add own fields on top of predefined ones.
 * Format (JSON array of objects, one per line-lite; stored as JSON):
 * [{ "id":"unique","type":"text|email|tel|textarea|select|checkbox",
 *    "labelPl":"", "labelEn":"", "placeholderPl":"", "placeholderEn":"",
 *    "required":false, "options":[{"value":"","labelPl":"","labelEn":""}] }]
 */
const customFieldsField: SchemaField = {
  key: "customFields",
  type: "stringArray",
  rows: 8,
  label: "Dodatkowe pola (JSON, po jednym obiekcie na linię)",
  hint:
    'Przykład: {"id":"branza","type":"select","labelPl":"Branża","labelEn":"Industry","required":true,"options":[{"value":"fintech","labelPl":"Fintech","labelEn":"Fintech"}]}',
};

// --- Push i18n label editors into existing join-us / contact-form schemas ---
const pushLabelsFor = (widgetType: WidgetType, fields: Array<[string, string]>) => {
  const arr = WIDGET_SCHEMAS[widgetType] as SchemaField[] | undefined;
  if (!arr) return;
  const existingKeys = new Set(arr.map((f) => f.key));
  for (const [key, labelBase] of fields) {
    for (const f of labelPh(key, labelBase)) {
      if (!existingKeys.has(f.key)) arr.push(f);
    }
  }
  if (!existingKeys.has("customFields")) arr.push(customFieldsField);
};

pushLabelsFor("join-us", [
  ["firstName", "Imię"],
  ["lastName", "Nazwisko"],
  ["email", "E-mail"],
  ["position", "Stanowisko"],
  ["linkedin", "LinkedIn"],
  ["phone", "Telefon"],
  ["company", "Firma"],
  ["country", "Kraj"],
  ["interests", "Zainteresowania"],
]);

pushLabelsFor("contact-form", [
  ["firstName", "Imię"],
  ["lastName", "Nazwisko"],
  ["email", "E-mail"],
  ["phone", "Telefon"],
  ["company", "Firma"],
  ["subject", "Temat"],
  ["message", "Wiadomość"],
]);

// --- Extend newsletter widget with per-field editors + custom fields ---
(WIDGET_SCHEMAS.newsletter as SchemaField[]).push(
  ...fieldBlock("firstName", "Imię", { defaultShow: "0", defaultRequire: "0" }),
  ...fieldBlock("lastName", "Nazwisko", { defaultShow: "0", defaultRequire: "0" }),
  ...fieldBlock("company", "Firma", { defaultShow: "0", defaultRequire: "0" }),
  ...labelPh("email", "E-mail"),
  {
    key: "requireEmail",
    type: "select",
    label: "E-mail - wymagany?",
    options: [
      { value: "1", label: "tak" },
      { value: "0", label: "nie" },
    ],
    default: "1",
  },
  customFieldsField,
);

// --- Auth form widgets: login / register / lost-password / reset-password ---
(WIDGET_SCHEMAS as Record<string, ReadonlyArray<SchemaField>>)["login-form"] = [
  {
    key: "variant",
    type: "select",
    label: "Wariant",
    options: [
      { value: "card", label: "Karta" },
      { value: "flat", label: "Płaski" },
      { value: "inline", label: "Inline" },
    ],
  },
  { key: "title", type: "i18nText", label: "Tytuł" },
  { key: "subtitle", type: "i18nText", label: "Podtytuł" },
  { key: "submitLabel", type: "i18nText", label: "Etykieta przycisku" },
  ...labelPh("email", "E-mail"),
  ...labelPh("password", "Hasło"),
  ...fieldBlock("remember", "Zapamiętaj mnie", { defaultShow: "1", defaultRequire: "0" }),
  {
    key: "showShowPassword",
    type: "select",
    label: "Pokaż przycisk pokaż hasło?",
    options: [
      { value: "1", label: "tak" },
      { value: "0", label: "nie" },
    ],
    default: "1",
  },
  {
    key: "showForgot",
    type: "select",
    label: "Pokaż link zapomniałem hasła?",
    options: [
      { value: "1", label: "tak" },
      { value: "0", label: "nie" },
    ],
    default: "1",
  },
  {
    key: "showRegister",
    type: "select",
    label: "Pokaż link załóż konto?",
    options: [
      { value: "1", label: "tak" },
      { value: "0", label: "nie" },
    ],
    default: "1",
  },
  {
    key: "showOAuthGoogle",
    type: "select",
    label: "Pokaż logowanie Google?",
    options: [
      { value: "1", label: "tak" },
      { value: "0", label: "nie" },
    ],
    default: "1",
  },
  { key: "redirectTo", type: "text", label: "Po zalogowaniu przekieruj do", placeholder: "/" },
  { key: "registerHref", type: "text", label: "URL do rejestracji", placeholder: "/register" },
  { key: "forgotHref", type: "text", label: "URL do odzyskiwania hasła", placeholder: "/lost-password" },
  customFieldsField,
];

(WIDGET_SCHEMAS as Record<string, ReadonlyArray<SchemaField>>)["register-form"] = [
  {
    key: "variant",
    type: "select",
    label: "Wariant",
    options: [
      { value: "card", label: "Karta" },
      { value: "flat", label: "Płaski" },
    ],
  },
  { key: "title", type: "i18nText", label: "Tytuł" },
  { key: "subtitle", type: "i18nText", label: "Podtytuł" },
  { key: "submitLabel", type: "i18nText", label: "Etykieta przycisku" },
  ...fieldBlock("firstName", "Imię", { defaultShow: "1", defaultRequire: "1" }),
  ...fieldBlock("lastName", "Nazwisko", { defaultShow: "1", defaultRequire: "1" }),
  ...fieldBlock("email", "E-mail", { defaultShow: "1", defaultRequire: "1" }),
  ...fieldBlock("password", "Hasło", { defaultShow: "1", defaultRequire: "1" }),
  ...fieldBlock("passwordConfirm", "Powtórz hasło", { defaultShow: "0", defaultRequire: "0" }),
  ...fieldBlock("phone", "Telefon", { defaultShow: "0", defaultRequire: "0" }),
  ...fieldBlock("company", "Firma", { defaultShow: "0", defaultRequire: "0" }),
  {
    key: "requireConsent",
    type: "select",
    label: "Wymagaj zgody RODO?",
    options: [
      { value: "1", label: "tak" },
      { value: "0", label: "nie" },
    ],
    default: "1",
  },
  { key: "consentText", type: "i18nText", label: "Treść zgody (RODO)" },
  {
    key: "newsletterOptIn",
    type: "select",
    label: "Pokaż zapis do newslettera?",
    options: [
      { value: "1", label: "tak" },
      { value: "0", label: "nie" },
    ],
    default: "1",
  },
  { key: "newsletterLabel", type: "i18nText", label: "Etykieta zapisu do newslettera" },
  {
    key: "showOAuthGoogle",
    type: "select",
    label: "Pokaż rejestrację Google?",
    options: [
      { value: "1", label: "tak" },
      { value: "0", label: "nie" },
    ],
    default: "1",
  },
  { key: "redirectTo", type: "text", label: "Po rejestracji przekieruj do", placeholder: "/" },
  { key: "loginHref", type: "text", label: "URL logowania", placeholder: "/login" },
  customFieldsField,
];

(WIDGET_SCHEMAS as Record<string, ReadonlyArray<SchemaField>>)["lost-password-form"] = [
  {
    key: "variant",
    type: "select",
    label: "Wariant",
    options: [
      { value: "card", label: "Karta" },
      { value: "flat", label: "Płaski" },
    ],
  },
  { key: "title", type: "i18nText", label: "Tytuł" },
  { key: "subtitle", type: "i18nText", label: "Podtytuł" },
  { key: "submitLabel", type: "i18nText", label: "Etykieta przycisku" },
  ...labelPh("email", "E-mail"),
  { key: "loginHref", type: "text", label: "URL powrotu do logowania", placeholder: "/login" },
  { key: "successText", type: "i18nText", label: "Komunikat po wysłaniu" },
];

(WIDGET_SCHEMAS as Record<string, ReadonlyArray<SchemaField>>)["reset-password-form"] = [
  {
    key: "variant",
    type: "select",
    label: "Wariant",
    options: [
      { value: "card", label: "Karta" },
      { value: "flat", label: "Płaski" },
    ],
  },
  { key: "title", type: "i18nText", label: "Tytuł" },
  { key: "subtitle", type: "i18nText", label: "Podtytuł" },
  { key: "submitLabel", type: "i18nText", label: "Etykieta przycisku" },
  ...labelPh("password", "Nowe hasło"),
  ...fieldBlock("passwordConfirm", "Powtórz nowe hasło", {
    defaultShow: "1",
    defaultRequire: "1",
  }),
  { key: "redirectTo", type: "text", label: "Po zapisaniu przekieruj do", placeholder: "/login" },
  { key: "successText", type: "i18nText", label: "Komunikat po zapisaniu" },
];

// Alias legacy "contact" widget schema to the new "contact-form" schema so any
// page still referencing the old type gets the full property panel.
(WIDGET_SCHEMAS as Record<string, ReadonlyArray<SchemaField> | undefined>).contact =
  WIDGET_SCHEMAS["contact-form"];
