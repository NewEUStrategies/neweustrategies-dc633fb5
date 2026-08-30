// Declarative widget content schemas.
// Single source of truth for the simple widget content editors.
// Complex list-style widgets (accordion, tabs, pricing) keep custom editors.
import type { WidgetType } from "./types";
import { asBool } from "@/lib/content-model/contentValue";
import { SOCIAL_IDLE_ICON_COLOR } from "./socialBrand";

/**
 * Wspólna podpowiedź widgetów `post-*`. Od naprawy wycieku danych
 * przykładowych widget bez kontekstu wpisu renderuje `null` poza kanwą
 * buildera - redaktor musi to wiedzieć, zanim wstawi go do nagłówka.
 */
const POST_CTX_HINT =
  "Widget czyta dane bieżącego wpisu. Poza stroną wpisu (np. w nagłówku lub stopce) pozostaje ukryty - nigdy nie pokazuje danych przykładowych.";

type FieldType =
  | "text" // single-line, language-agnostic
  | "i18nText" // single-line, separate PL/EN values stored as `${key}_pl|_en`
  | "i18nHtml" // textarea HTML, separate PL/EN values
  | "url"
  | "image" // URL input + file upload to storage
  | "icon" // Lucide icon picker (searchable library)
  | "number"
  | "select"
  | "bool" // real boolean switch - NEVER model an on/off setting as a "0"/"1" select
  | "color" // hex color with native picker + text fallback ("" = inherit)
  | "textarea"
  | "chartData" // textarea CSV + spreadsheet dialog with live chart preview
  | "stringArray" // textarea with one item per line
  | "i18nStringArray"; // textarea with one item per line, stored as `${key}_pl|_en`

export interface SchemaField {
  /** Storage key for non-i18n fields, OR base key (without `_pl|_en`) for i18n fields. */
  key: string;
  /**
   * Klucze HISTORYCZNE tego samego ustawienia, czytane gdy klucz kanoniczny jest
   * pusty. Panel pokazuje wtedy starą wartość (zamiast pustego pola nad
   * działającym ustawieniem), ale zapisuje ZAWSZE `key` - treść migruje sama
   * przy pierwszej edycji. Renderer musi rozumieć oba klucze; bramka wierności
   * ustawień pilnuje, że tak jest.
   */
  legacyKeys?: ReadonlyArray<string>;
  type: FieldType;
  label: string;
  placeholder?: string;
  /**
   * Kolor FAKTYCZNIE użyty, gdy pole jest puste - panel pokazuje go jako
   * próbkę zamiast pustego kwadratu („dziedziczy z global colors").
   */
  inheritedValue?: string;
  /** For number fields. */
  min?: number;
  max?: number;
  step?: number;
  /** Optional default value used when content has no value yet. */
  default?: number | string | boolean;
  /** For select fields. */
  options?: ReadonlyArray<{ value: string; label?: string }>;
  /** For textarea fields. */
  rows?: number;
  /** Optional hint shown under the control. */
  hint?: string;
  /** Show only when this predicate returns true (against full content object). */
  visibleWhen?: (content: Record<string, unknown>) => boolean;
  /** Optional group label to visually cluster related fields in the editor. */
  group?: string;
}

/**
 * Platformy widgetu „Ikony social" - jedno źródło prawdy dla pola koloru ikony
 * per platforma. Renderer czyta te same klucze (`colorFacebook`, `colorX`, ...).
 *
 * Gradient i ton ikony na hoverze NIE mają tu osobnych pól: maluje je arkusz
 * instancji sterowany polami `rowHover` / `rowHoverColor` / `hoverIconMode` /
 * `hoverIconColor` / `newsletterTone` (patrz socialHover.ts). Równoległy zestaw
 * `hoverMode` / `hoverFrom*` był martwy - panel go oferował, renderer nie czytał.
 */
const SOCIAL_PLATFORMS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "Facebook", label: "Facebook" },
  { key: "X", label: "X" },
  { key: "Youtube", label: "YouTube" },
  { key: "Instagram", label: "Instagram" },
  { key: "Linkedin", label: "LinkedIn" },
  { key: "Spotify", label: "Spotify" },
  { key: "Newsletter", label: "Newsletter" },
];

const SOCIAL_PLATFORM_COLOR_FIELDS: ReadonlyArray<SchemaField> = SOCIAL_PLATFORMS.map(
  ({ key, label }) => {
    const idle = SOCIAL_IDLE_ICON_COLOR[key.toLowerCase()];
    return {
      key: `color${key}`,
      type: "color" as const,
      label: `${label} - kolor ikony`,
      group: "Kolory platform",
      inheritedValue: idle?.light,
      placeholder: idle?.light,
      hint: "Puste = kolor tekstu motywu (ciemny w light, jasny w dark) - jak na stronie publicznej.",
    };
  },
);

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
      key: "gradientFrom",
      type: "color",
      label: "Gradient - kolor 1",
      visibleWhen: (c) => c.variant === "gradient",
      group: "Kolory wariantu",
    },
    {
      key: "gradientTo",
      type: "color",
      label: "Gradient - kolor 2",
      visibleWhen: (c) => c.variant === "gradient",
      group: "Kolory wariantu",
    },
    {
      key: "gradientAngle",
      type: "number",
      label: "Gradient - kąt (°)",
      min: 0,
      max: 360,
      step: 5,
      default: 90,
      visibleWhen: (c) => c.variant === "gradient",
      group: "Kolory wariantu",
    },
    {
      key: "highlightColor",
      type: "color",
      label: "Kolor podkreślenia",
      visibleWhen: (c) => c.variant === "highlight",
      group: "Kolory wariantu",
    },
    {
      key: "outlineColor",
      type: "color",
      label: "Kolor obrysu",
      visibleWhen: (c) => c.variant === "outlined",
      group: "Kolory wariantu",
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
    // Uwaga: `authorSizePx` / `authorAvatarSizePx` NIE należą do nagłówka.
    // Były skopiowane ze schematu slidera (jedyny czytelnik: sliderVariants),
    // więc panel nagłówka pokazywał dwa pola bez żadnego efektu w renderze.
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
      type: "icon",
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
    // Renderer umie podstawić logo witryny z Opcji motywu (razem z wariantem
    // dark), ale wyłącznie ten klucz to włącza - bez kontrolki jedyną drogą był
    // przypadek: alt zawierający słowo "logo".
    {
      key: "useSiteLogo",
      type: "select",
      label: "Użyj logo witryny",
      options: [
        { value: "", label: "nie - własna grafika poniżej" },
        { value: "main", label: "logo główne" },
        { value: "mobile", label: "logo mobilne" },
        { value: "transparent", label: "logo na przezroczystym tle" },
      ],
      default: "",
      hint: "Bierze logo z Wygląd → Opcje motywu (wraz z wersją dark). Wtedy pola URL poniżej są ignorowane.",
    },
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
    { key: "label", type: "i18nText", label: "Etykieta", group: "Treść" },
    { key: "href", type: "url", label: "Link (docelowy URL)", group: "Treść" },
    {
      key: "target",
      type: "select",
      label: "Otwórz w",
      options: [
        { value: "self", label: "tym samym oknie" },
        { value: "blank", label: "nowej karcie" },
      ],
      group: "Treść",
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
      group: "Wygląd",
    },
    {
      key: "gradientFrom",
      type: "color",
      label: "Gradient - kolor 1",
      visibleWhen: (c) => c.variant === "gradient",
      group: "Kolory wariantu",
    },
    {
      key: "gradientTo",
      type: "color",
      label: "Gradient - kolor 2",
      visibleWhen: (c) => c.variant === "gradient",
      group: "Kolory wariantu",
    },
    {
      key: "gradientAngle",
      type: "number",
      label: "Gradient - kąt (°)",
      min: 0,
      max: 360,
      step: 5,
      default: 90,
      visibleWhen: (c) => c.variant === "gradient",
      group: "Kolory wariantu",
    },
    {
      key: "btnBgColor",
      type: "color",
      label: "Kolor tła",
      visibleWhen: (c) =>
        c.variant === "primary" || c.variant === "soft" || c.variant === "outline",
      group: "Kolory wariantu",
    },
    {
      key: "btnTextColor",
      type: "color",
      label: "Kolor tekstu",
      visibleWhen: (c) => c.variant !== "gradient",
      group: "Kolory wariantu",
    },
    {
      key: "btnBorderColor",
      type: "color",
      label: "Kolor obramowania",
      visibleWhen: (c) => c.variant === "outline",
      group: "Kolory wariantu",
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
      group: "Wygląd",
    },
    {
      key: "fullWidth",
      type: "select",
      label: "Szerokość",
      options: [
        { value: "auto", label: "automatyczna" },
        { value: "full", label: "100%" },
      ],
      group: "Wygląd",
    },
    {
      key: "iconName",
      type: "icon",
      label: "Ikona (Lucide)",
      placeholder: "ArrowRight…",
      group: "Ikona",
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
      group: "Ikona",
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
      type: "icon",
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
      visibleWhen: (c) => c.variant !== "space" && c.variant !== "gradient",
    },
    {
      key: "gradientFrom",
      type: "color",
      label: "Gradient - kolor 1",
      visibleWhen: (c) => c.variant === "gradient",
      group: "Kolory wariantu",
    },
    {
      key: "gradientTo",
      type: "color",
      label: "Gradient - kolor 2",
      visibleWhen: (c) => c.variant === "gradient",
      group: "Kolory wariantu",
    },
    {
      key: "iconColor",
      type: "color",
      label: "Kolor ikony",
      visibleWhen: (c) => c.variant === "icon",
      group: "Kolory wariantu",
    },
  ],
  spacer: [
    {
      key: "height",
      type: "number",
      label: "Wysokość - desktop (px)",
      min: 1,
      max: 800,
      default: 32,
      group: "Wysokość",
    },
    {
      key: "heightTablet",
      type: "number",
      label: "Wysokość - tablet (px, 0 = dziedziczy)",
      min: 0,
      max: 800,
      default: 0,
      group: "Wysokość",
      hint: "0 oznacza użycie wartości z desktopu.",
    },
    {
      key: "heightMobile",
      type: "number",
      label: "Wysokość - mobile (px, 0 = dziedziczy)",
      min: 0,
      max: 800,
      default: 0,
      group: "Wysokość",
    },
    {
      key: "widthPct",
      type: "number",
      label: "Szerokość (%)",
      min: 10,
      max: 100,
      default: 100,
      group: "Szerokość",
    },
    {
      key: "align",
      type: "select",
      label: "Wyrównanie",
      options: [
        { value: "left", label: "Lewo" },
        { value: "center", label: "Środek" },
        { value: "right", label: "Prawo" },
      ],
      group: "Szerokość",
    },
    {
      key: "bgColor",
      type: "color",
      label: "Kolor tła (opcjonalny)",
      hint: "Zostaw puste dla przezroczystego odstępu.",
      group: "Wygląd",
    },
    {
      key: "showLabel",
      type: "select",
      label: "Etykieta w edytorze",
      options: [
        { value: "show", label: "Pokaż" },
        { value: "hide", label: "Ukryj" },
      ],
      default: "show",
      group: "Wygląd",
    },
  ],
  counter: [
    { key: "value", type: "number", label: "Wartość docelowa", min: 0, max: 1000000 },
    { key: "from", type: "number", label: "Wartość początkowa", min: 0, max: 1000000 },
    { key: "durationMs", type: "number", label: "Czas animacji (ms)", min: 200, max: 10000 },
    { key: "prefix", type: "text", label: "Prefiks" },
    { key: "suffix", type: "text", label: "Sufiks" },
    { key: "delimiter", type: "text", label: "Separator tysięcy" },
    { key: "label_pl", type: "text", label: "Etykieta (PL)" },
    { key: "label_en", type: "text", label: "Etykieta (EN)" },
    {
      key: "align",
      type: "select",
      label: "Wyrównanie",
      options: [
        { value: "left", label: "Lewa" },
        { value: "center", label: "Środek" },
        { value: "right", label: "Prawa" },
      ],
    },
    { key: "accentColor", type: "text", label: "Kolor liczby (hex)" },
    { key: "numberSize", type: "number", label: "Rozmiar liczby (px)", min: 20, max: 200 },
    { key: "labelSize", type: "number", label: "Rozmiar etykiety (px)", min: 10, max: 40 },
  ],
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
      type: "bool",
      label: "Lightbox",
      default: false,
      hint: "Kliknięcie zdjęcia otwiera je na pełnym ekranie (Esc zamyka, strzałki przewijają).",
    },
  ],
  icon: [
    { key: "name", type: "icon", label: "Nazwa ikony", placeholder: "Star, Heart, Mail..." },
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
  chart: [
    {
      key: "kind",
      type: "select",
      label: "Rodzaj wykresu",
      options: [
        { value: "bar", label: "kolumny" },
        { value: "bar-horizontal", label: "słupki poziome" },
        { value: "line", label: "linia" },
        { value: "area", label: "pole (area)" },
        { value: "pie", label: "kołowy" },
        { value: "donut", label: "pierścień (donut)" },
      ],
    },
    { key: "title", type: "i18nText", label: "Tytuł" },
    { key: "description", type: "i18nText", label: "Opis (podtytuł)" },
    {
      key: "data",
      type: "chartData",
      label: "Dane",
      rows: 6,
      hint: 'Arkusz otwiera się w popupie z podglądem wykresu. Format tekstowy: pierwszy wiersz "; Nazwa serii; Nazwa serii", kolejne "Kategoria; wartość; wartość" (separator ";", przecinek dziesiętny dozwolony).',
    },
    { key: "unit", type: "text", label: "Jednostka (np. %, mld EUR)" },
    {
      key: "stacked",
      type: "select",
      label: "Skumulowany (stacked)",
      options: [
        { value: "off", label: "nie" },
        { value: "on", label: "tak" },
      ],
      visibleWhen: (c) => c.kind === "bar" || c.kind === "bar-horizontal" || !c.kind,
    },
    { key: "height", type: "number", label: "Wysokość (px)", min: 160, max: 640, step: 10 },
    {
      key: "showLegend",
      type: "select",
      label: "Legenda",
      options: [
        { value: "on", label: "tak" },
        { value: "off", label: "nie" },
      ],
    },
    {
      key: "showGrid",
      type: "select",
      label: "Siatka",
      options: [
        { value: "on", label: "tak" },
        { value: "off", label: "nie" },
      ],
      // Wykres kołowy nie ma osi, więc nie ma czego kreskować - przełącznik
      // był tam cichym no-opem i tylko mylił autora.
      visibleWhen: (c) => c.kind !== "pie" && c.kind !== "donut",
    },
    {
      key: "showValues",
      type: "select",
      label: "Etykiety wartości",
      options: [
        { value: "off", label: "nie" },
        { value: "on", label: "tak" },
      ],
      hint: "Na wykresie kołowym wartość pojawia się pod udziałem procentowym, w wycinkach od 8% wzwyż.",
    },
    {
      key: "animate",
      type: "select",
      label: "Animacja wejścia",
      options: [
        { value: "on", label: "tak" },
        { value: "off", label: "nie" },
      ],
    },
    { key: "source", type: "i18nText", label: "Źródło danych" },
  ],
  "data-map": [
    {
      key: "region",
      type: "select",
      label: "Region",
      options: [
        { value: "europe", label: "Europa" },
        { value: "world", label: "Świat" },
      ],
    },
    { key: "title", type: "i18nText", label: "Tytuł" },
    { key: "description", type: "i18nText", label: "Opis (podtytuł)" },
    {
      key: "data",
      type: "textarea",
      label: "Dane per kraj",
      rows: 6,
      hint: 'Jeden kraj na wiersz: "KOD; wartość" (kod ISO-2, np. PL; 12,5).',
    },
    { key: "unit", type: "text", label: "Jednostka (np. %, mln)" },
    {
      key: "showLegend",
      type: "select",
      label: "Legenda",
      options: [
        { value: "on", label: "tak" },
        { value: "off", label: "nie" },
      ],
    },
    {
      key: "animate",
      type: "select",
      label: "Animacja wejścia",
      options: [
        { value: "on", label: "tak" },
        { value: "off", label: "nie" },
      ],
    },
    { key: "source", type: "i18nText", label: "Źródło danych" },
  ],
  // Mapa świata: listę połączeń, kolory i podpięcie profili obsługuje własny
  // edytor (`WorldMapEditor`); tutaj zostają ustawienia skalarne, które panel
  // dorysowuje pod nim w sekcji „Pozostałe ustawienia".
  "world-map": [
    { key: "title", type: "i18nText", label: "Tytuł" },
    { key: "subtitle", type: "i18nText", label: "Opis (podtytuł)" },
    {
      key: "fit",
      type: "select",
      label: "Kadr mapy",
      options: [
        { value: "auto", label: "dopasuj do połączeń" },
        { value: "europe", label: "Europa" },
        { value: "world", label: "cały świat" },
      ],
      hint: "Dopasowanie przybliża mapę do punktów, żeby łuki wypełniły kadr zamiast tonąć w oceanie.",
    },
    {
      key: "showLabels",
      type: "bool",
      label: "Etykiety przy punktach",
      hint: "Wyłączone: na mapie zostają same znaczniki, a nazwy niesie lista dostępności.",
    },
    { key: "animate", type: "bool", label: "Animacja rysowania łuków" },
    {
      key: "animationDuration",
      type: "number",
      label: "Czas rysowania łuku (s)",
      min: 0.4,
      max: 10,
      step: 0.1,
      visibleWhen: (c) => c.animate !== false,
    },
    {
      key: "loop",
      type: "bool",
      label: "Powtarzaj w pętli",
      hint: "Wyłączone: łuki rysują się raz i zostają.",
      visibleWhen: (c) => c.animate !== false,
    },
  ],
  // ---- NES Digital Features ----
  "feature-timeline": [
    { key: "title", type: "i18nText", label: "Tytuł" },
    { key: "description", type: "i18nText", label: "Opis (podtytuł)" },
    {
      key: "data",
      type: "textarea",
      label: "Wydarzenia",
      rows: 8,
      hint: 'Jeden wiersz na wydarzenie: "Data; Tytuł|Title; Opis|Description; slot(1-8, opc.)". Separator ";", tłumaczenie po "|".',
    },
    {
      key: "animate",
      type: "select",
      label: "Animacja wejścia",
      options: [
        { value: "on", label: "tak" },
        { value: "off", label: "nie" },
      ],
    },
    { key: "source", type: "i18nText", label: "Źródło danych" },
  ],
  "feature-sankey": [
    { key: "title", type: "i18nText", label: "Tytuł" },
    { key: "description", type: "i18nText", label: "Opis (podtytuł)" },
    {
      key: "data",
      type: "textarea",
      label: "Przepływy",
      rows: 8,
      hint: 'Jeden wiersz na przepływ: "Źródło|Source; Cel|Target; wartość". Wartości > 0.',
    },
    { key: "unit", type: "text", label: "Jednostka (np. mld m³)" },
    { key: "height", type: "number", label: "Wysokość (px)", min: 160, max: 640, step: 10 },
    {
      key: "animate",
      type: "select",
      label: "Animacja wejścia",
      options: [
        { value: "on", label: "tak" },
        { value: "off", label: "nie" },
      ],
    },
    { key: "source", type: "i18nText", label: "Źródło danych" },
  ],
  "feature-compare": [
    { key: "title", type: "i18nText", label: "Tytuł" },
    { key: "description", type: "i18nText", label: "Opis (podtytuł)" },
    {
      key: "data",
      type: "textarea",
      label: "Dane",
      rows: 8,
      hint: 'Nagłówek: "; Kolumna1|Column1; Kolumna2|Column2". Wiersze: "Wskaźnik [jedn.]|Indicator [unit]; v1; v2". Jednostka w "[...]".',
    },
    {
      key: "highlight",
      type: "number",
      label: "Wyróżniona kolumna (0 = pierwsza)",
      min: 0,
      max: 20,
      hint: "Indeks kolumny do podświetlenia akcentem marki. Puste = brak.",
    },
    {
      key: "showBars",
      type: "select",
      label: "Paski w komórkach",
      options: [
        { value: "on", label: "tak" },
        { value: "off", label: "nie" },
      ],
    },
    { key: "source", type: "i18nText", label: "Źródło danych" },
  ],
  "feature-risk-matrix": [
    { key: "title", type: "i18nText", label: "Tytuł" },
    { key: "description", type: "i18nText", label: "Opis (podtytuł)" },
    {
      key: "data",
      type: "textarea",
      label: "Elementy ryzyka",
      rows: 8,
      hint: 'Jeden wiersz na ryzyko: "Nazwa|Name; prawdopodobieństwo 1-5; wpływ 1-5; opis|desc (opc.)".',
    },
    { key: "axisXLabel", type: "i18nText", label: "Etykieta osi X (wpływ)" },
    { key: "axisYLabel", type: "i18nText", label: "Etykieta osi Y (prawdopodobieństwo)" },
    {
      key: "animate",
      type: "select",
      label: "Animacja wejścia",
      options: [
        { value: "on", label: "tak" },
        { value: "off", label: "nie" },
      ],
    },
    { key: "source", type: "i18nText", label: "Źródło danych" },
  ],
  "feature-indicator": [
    { key: "label", type: "i18nText", label: "Etykieta wskaźnika" },
    { key: "value", type: "text", label: "Wartość (np. 72,4)" },
    { key: "unit", type: "text", label: "Jednostka (np. /100, %)" },
    { key: "delta", type: "text", label: "Zmiana (np. +5,1)" },
    { key: "deltaLabel", type: "i18nText", label: "Opis zmiany (np. r/r)" },
    {
      key: "deltaArrow",
      type: "select",
      label: "Strzałka zmiany",
      options: [
        { value: "up", label: "w górę" },
        { value: "down", label: "w dół" },
        { value: "none", label: "brak" },
      ],
    },
    {
      key: "deltaTone",
      type: "select",
      label: "Ton zmiany (kolor)",
      options: [
        { value: "positive", label: "pozytywny (zielony)" },
        { value: "negative", label: "negatywny (czerwony)" },
        { value: "neutral", label: "neutralny" },
      ],
    },
    {
      key: "spark",
      type: "textarea",
      label: "Sparkline (opcjonalny)",
      rows: 2,
      hint: 'Liczby rozdzielone ";" lub nowymi liniami, np. "58; 61; 60; 64".',
    },
    { key: "source", type: "i18nText", label: "Źródło danych" },
    { key: "href", type: "url", label: "Link (opcjonalny)", placeholder: "/tracker lub https://…" },
  ],
  "feature-network": [
    { key: "title", type: "i18nText", label: "Tytuł" },
    { key: "description", type: "i18nText", label: "Opis (podtytuł)" },
    {
      key: "edges",
      type: "textarea",
      label: "Powiązania (krawędzie)",
      rows: 7,
      hint: 'Jeden wiersz na powiązanie: "A|A_en; B|B_en; siła 1-5 (opc.); etykieta|label (opc.)".',
    },
    {
      key: "groups",
      type: "textarea",
      label: "Grupy węzłów (kolory)",
      rows: 5,
      hint: 'Jeden wiersz na przypisanie: "Węzeł|Node; grupa|group". Grupa = wspólny kolor.',
    },
    { key: "height", type: "number", label: "Wysokość (px)", min: 240, max: 720, step: 20 },
    {
      key: "animate",
      type: "select",
      label: "Animacja wejścia",
      options: [
        { value: "on", label: "tak" },
        { value: "off", label: "nie" },
      ],
    },
    { key: "source", type: "i18nText", label: "Źródło danych" },
  ],
  "feature-corridor-map": [
    { key: "title", type: "i18nText", label: "Tytuł" },
    { key: "description", type: "i18nText", label: "Opis (podtytuł)" },
    {
      key: "region",
      type: "select",
      label: "Region",
      options: [
        { value: "europe", label: "Europa" },
        { value: "world", label: "Świat" },
      ],
    },
    {
      key: "corridors",
      type: "textarea",
      label: "Korytarze",
      rows: 6,
      hint: 'Jeden wiersz na korytarz: "Nazwa|Name; slot 1-8; lat,lon > lat,lon > ...". Węzły rozdziela ">".',
    },
    {
      key: "markers",
      type: "textarea",
      label: "Markery (węzły)",
      rows: 5,
      hint: 'Jeden wiersz na marker: "lat,lon; Etykieta|Label".',
    },
    {
      key: "highlightCountries",
      type: "text",
      label: "Podświetlone kraje (ISO-2)",
      placeholder: "PL; DE; AT",
      hint: "Kody ISO-2 rozdzielone przecinkiem lub średnikiem.",
    },
    {
      key: "animate",
      type: "select",
      label: "Animacja wejścia",
      options: [
        { value: "on", label: "tak" },
        { value: "off", label: "nie" },
      ],
    },
    { key: "source", type: "i18nText", label: "Źródło danych" },
  ],
  "feature-sources": [
    { key: "title", type: "i18nText", label: "Tytuł" },
    { key: "description", type: "i18nText", label: "Opis (podtytuł)" },
    {
      key: "entries",
      type: "textarea",
      label: "Źródła",
      rows: 8,
      hint: 'Jeden wiersz na źródło: "Typ|Type; Rok; Tytuł|Title; Wydawca|Publisher; URL".',
    },
    {
      key: "sort",
      type: "select",
      label: "Sortowanie",
      options: [
        { value: "authored", label: "kolejność wpisów" },
        { value: "year-desc", label: "rok malejąco" },
      ],
    },
    {
      key: "showSearch",
      type: "select",
      label: "Pole wyszukiwania",
      options: [
        { value: "on", label: "tak" },
        { value: "off", label: "nie" },
      ],
    },
    { key: "source", type: "i18nText", label: "Źródło danych (podpis)" },
  ],
  "feature-methodology": [
    { key: "title", type: "i18nText", label: "Tytuł" },
    { key: "version", type: "text", label: "Wersja (np. 1.0)" },
    { key: "updated", type: "text", label: "Aktualizacja (np. 2026-07)" },
    {
      key: "defaultOpen",
      type: "select",
      label: "Domyślnie rozwinięta",
      options: [
        { value: "0", label: "nie" },
        { value: "1", label: "tak" },
      ],
    },
    { key: "html", type: "i18nHtml", label: "Treść (HTML)", rows: 6 },
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
  // "post-list" i "carousel" NIE MAJA tu schematu i to jest celowe:
  // `WidgetProperties.ContentFields` obsluguje oba typy dedykowanym edytorem
  // (`PostListEditor`) i wraca z niego zanim dojdzie do renderu schematu.
  // Deklaracje, ktore tu wczesniej stały, byly martwe - nikt ich nie renderowal
  // (a pole `carousel.autoplay` bylo martwe podwojnie: takze niekonsumowane
  // przez widok). Ustawienia obu widgetow, z autoodtwarzaniem karuzeli wlacznie,
  // zyja w `PostListEditor` + `postListCarousel.ts`.
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
      type: "icon",
      label: "Ikona (Lucide)",
      placeholder: "Mail, Send, BellRing, Inbox…",
      hint: "Nazwa ikony Lucide. Domyślnie: Mail.",
      visibleWhen: (c) => {
        const v = typeof c.variant === "string" ? c.variant : "icon";
        return v === "icon" || v === "icon-only";
      },
    },
    {
      // Renderer honoruje `size` od zawsze (kafelek koperty dzieli rysunek
      // i geometrię z widgetem „Ikony social"), ale panel go nie oferował -
      // ustawienie było osiągalne tylko przez ręczną edycję dokumentu.
      // Ta sama bramka widoczności co `iconName`: pozostałe warianty nie mają
      // kafelka, więc rozmiar ikony byłby w nich martwym polem.
      key: "size",
      type: "number",
      label: "Rozmiar ikony (px)",
      min: 10,
      max: 64,
      default: 14,
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
      key: "ctaBgFrom",
      type: "color",
      label: "Tło - kolor 1",
      visibleWhen: (c) => c.variant === "gradient",
      group: "Kolory wariantu",
    },
    {
      key: "ctaBgTo",
      type: "color",
      label: "Tło - kolor 2",
      visibleWhen: (c) => c.variant === "gradient",
      group: "Kolory wariantu",
    },
    {
      key: "ctaGradientAngle",
      type: "number",
      label: "Gradient - kąt (°)",
      min: 0,
      max: 360,
      step: 5,
      default: 135,
      visibleWhen: (c) => c.variant === "gradient",
      group: "Kolory wariantu",
    },
    {
      key: "ctaBgColor",
      type: "color",
      label: "Kolor tła",
      visibleWhen: (c) => c.variant !== "gradient",
      group: "Kolory wariantu",
    },
    {
      key: "ctaTextColor",
      type: "color",
      label: "Kolor tekstu",
      group: "Kolory wariantu",
    },
    {
      key: "ctaBtnBg",
      type: "color",
      label: "Przycisk - tło",
      group: "Kolory wariantu",
    },
    {
      key: "ctaBtnText",
      type: "color",
      label: "Przycisk - tekst",
      group: "Kolory wariantu",
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
  donations: [
    {
      key: "variant",
      type: "select",
      label: "Wariant",
      options: [
        { value: "hero", label: "hero (duża liczba + CTA)" },
        { value: "progress", label: "pasek celu (goal bar)" },
        { value: "stats-strip", label: "pasek statystyk (3 pola)" },
        { value: "compact-card", label: "karta boczna (kompakt)" },
        { value: "inline-bar", label: "wąski pasek inline" },
        { value: "thermometer", label: "termometr pionowy" },
      ],
    },
    { key: "title", type: "i18nText", label: "Tytuł" },
    { key: "subtitle", type: "i18nText", label: "Podtytuł / opis" },
    { key: "cta", type: "i18nText", label: "Etykieta CTA" },
    {
      key: "href",
      type: "url",
      label: "Link CTA",
      placeholder: "/support",
      hint: "Domyślnie /support (strona darowizn).",
    },
    {
      key: "goalCents",
      type: "number",
      label: "Cel zbiórki (grosze)",
      min: 0,
      step: 10000,
      hint: "0 = bez celu (dla wariantów progress/thermometer wymagane >0).",
    },
    {
      key: "currency",
      type: "select",
      label: "Waluta",
      options: [
        { value: "PLN", label: "PLN (zł)" },
        { value: "EUR", label: "EUR (€)" },
      ],
    },
    {
      key: "showMonth",
      type: "select",
      label: "Pokaż sumę miesięczną",
      options: [
        { value: "true", label: "tak" },
        { value: "false", label: "nie" },
      ],
    },
    {
      key: "showCount",
      type: "select",
      label: "Pokaż liczbę darczyńców",
      options: [
        { value: "true", label: "tak" },
        { value: "false", label: "nie" },
      ],
    },
    {
      key: "showRecent",
      type: "select",
      label: "Pokaż ostatnie kwoty (anonimowo)",
      options: [
        { value: "false", label: "nie" },
        { value: "true", label: "tak - do 5 ostatnich" },
      ],
      hint: "Wyświetla wyłącznie kwoty (bez adresów e-mail i wiadomości).",
    },
    {
      key: "accent",
      type: "color",
      label: "Kolor akcentu (opcjonalny)",
    },
    {
      key: "mode",
      type: "select",
      label: "Tryb akcji",
      group: "Darowizna",
      options: [
        { value: "link", label: "link do /support" },
        { value: "quick", label: "bezpośredni link do zbiórki (zrzutka.pl)" },
      ],
      hint: "Wpłaty obsługuje zewnętrzna zbiórka (zrzutka.pl) - CTA nigdy nie otwiera checkoutu operatora płatności.",
    },
  ],
  // Legacy "contact" alias - same fields as the new "contact-form" widget.
  // Actual array is attached after WIDGET_SCHEMAS is constructed (see bottom of file).
  contact: [],

  menu: [
    {
      key: "menu_key",
      type: "text",
      label: "Klucz menu",
      placeholder: "main",
      hint: "Klucz menu zdefiniowanego w Wygląd → Menu (domyślnie: main).",
    },
  ],

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
      type: "icon",
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
  "team-member": [
    {
      key: "photo",
      type: "image",
      label: "Zdjęcie",
      hint: "Wgraj lub wybierz z biblioteki mediów.",
    },
    { key: "name", type: "text", label: "Imię i nazwisko" },
    { key: "position", type: "i18nText", label: "Pozycja / stanowisko" },
    {
      key: "programLabel",
      type: "i18nText",
      label: "Etykieta programu (nad kartą)",
      placeholder: "np. RADA FUNDACJI",
    },
    { key: "bio", type: "i18nHtml", label: "Bio", rows: 6 },
    { key: "email", type: "text", label: "Email", placeholder: "osoba@domena.pl" },
    { key: "phone", type: "text", label: "Telefon", placeholder: "+48 …" },
    { key: "x", type: "url", label: "X", placeholder: "https://x.com/…" },
    { key: "facebook", type: "url", label: "Facebook", placeholder: "https://facebook.com/…" },
    { key: "linkedin", type: "url", label: "LinkedIn", placeholder: "https://linkedin.com/in/…" },
    { key: "instagram", type: "url", label: "Instagram", placeholder: "https://instagram.com/…" },
    { key: "youtube", type: "url", label: "YouTube", placeholder: "https://youtube.com/…" },
    { key: "website", type: "url", label: "Strona www", placeholder: "https://…" },
    {
      key: "accentColor",
      type: "color",
      label: "Kolor akcentu (pozycja)",
      hint: "Puste = kolor brand.",
    },
    {
      key: "overlayAlpha",
      type: "number",
      label: "Przyciemnienie dołu karty (0–1)",
      min: 0,
      max: 1,
      step: 0.05,
    },
    {
      key: "cardMaxWidth",
      type: "number",
      label: "Maks. szerokość karty (px)",
      min: 120,
      max: 1000,
      hint: "Puste = pełna szerokość kolumny. Ustaw, aby ujednolicić rozmiar karty w układach o różnej liczbie kolumn (np. 300 px = ten sam rozmiar w 3 i 4 kolumnach).",
    },
  ],
  // Karta trasy: mapa w tle, tytuł + autor, wielki dystans, polubienie.
  // Renderer (TravelRouteCardView) czyta KAŻDY z tych kluczy bezwarunkowo.
  "travel-route-card": [
    {
      key: "image",
      type: "image",
      label: "Mapa / zdjęcie w tle",
      hint: "Kadr poziomy. Puste = sama płaszczyzna w kolorze nakładki.",
    },
    {
      key: "imageAlt",
      type: "i18nText",
      label: "Tekst alternatywny tła",
      hint: "Puste = mapa jest dekoracją i znika z drzewa dostępności. Wypełnij, jeśli obraz niesie własną informację.",
    },
    { key: "title", type: "i18nText", label: "Tytuł trasy" },
    {
      key: "author",
      type: "i18nText",
      label: "Autor / podpis",
      placeholder: "np. Trasa Pawła",
    },
    {
      key: "distance",
      type: "text",
      label: "Dystans (duża liczba)",
      placeholder: "np. 12K",
      hint: "Bez jednostki - jednostkę wpisz w podpisie poniżej, żeby nie tłumaczyć jej razem z liczbą.",
    },
    {
      key: "distanceCaption",
      type: "i18nText",
      label: "Podpis pod liczbą",
      placeholder: "np. km",
    },
    {
      key: "href",
      type: "url",
      label: "Adres karty",
      placeholder: "https://…",
      hint: "Puste = karta nie jest linkiem. Przycisk polubienia działa niezależnie od odnośnika.",
    },
    {
      key: "showLikes",
      type: "bool",
      label: "Pokaż polubienia",
      hint: "Polubienie zapisuje się TYLKO w przeglądarce odwiedzającego - nie sumuje się między osobami.",
    },
    {
      key: "likes",
      type: "number",
      label: "Liczba polubień na starcie",
      min: 0,
      max: 100000000,
      step: 1,
      default: 0,
      hint: "Powyżej tysiąca licznik skraca się do K/M (1527 -> 1.5K).",
    },
    {
      key: "likeAccentColor",
      type: "color",
      label: "Kolor po polubieniu",
      inheritedValue: "#ef4444",
      hint: "Puste = czerwień domyślna.",
    },
    {
      key: "overlayColor",
      type: "color",
      label: "Kolor nakładki",
      group: "Prezentacja",
      hint: "Puste = kolor marki. Nakładka daje kontrast dla białego tekstu nad zdjęciem.",
    },
    {
      key: "overlayAlpha",
      type: "number",
      label: "Krycie nakładki (0-1)",
      group: "Prezentacja",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.6,
    },
    {
      key: "minHeight",
      type: "number",
      label: "Wysokość karty (px)",
      group: "Prezentacja",
      min: 120,
      max: 720,
      step: 8,
      default: 224,
    },
    {
      key: "maxWidth",
      type: "number",
      label: "Maks. szerokość karty (px)",
      group: "Prezentacja",
      min: 0,
      max: 1200,
      step: 8,
      default: 448,
      hint: "0 = pełna szerokość kolumny.",
    },
    {
      key: "radius",
      type: "number",
      label: "Zaokrąglenie rogów (px)",
      group: "Prezentacja",
      min: 0,
      max: 48,
      step: 1,
      default: 6,
      hint: "6 px to zaokrąglenie platformy. Wzorzec karty używał 16 px.",
    },
    {
      key: "distanceSizePx",
      type: "number",
      label: "Rozmiar liczby dystansu (px)",
      group: "Prezentacja",
      min: 24,
      max: 200,
      step: 2,
      default: 96,
      hint: "Liczba jest wyłączona z globalnej typografii widgetu - rozmiar tytułu i opisu ustawiasz w zakładce Styl.",
    },
    {
      key: "animate",
      type: "bool",
      label: "Animuj wejście karty",
      group: "Prezentacja",
      hint: "Wyłączone również przy systemowym ograniczeniu animacji.",
    },
    {
      key: "hoverLift",
      type: "bool",
      label: "Powiększ kartę pod kursorem",
      group: "Prezentacja",
    },
  ],
  // Karta profilu autora: prezentacja współdzielona z wariantem `profile`
  // bloku `author-bio` (komponent ProfileCard).
  "author-profile-card": [
    {
      key: "photo",
      type: "image",
      label: "Zdjęcie",
      hint: "Portret 3:4. Wgraj lub wybierz z biblioteki mediów.",
    },
    { key: "name", type: "text", label: "Imię i nazwisko" },
    { key: "position", type: "i18nText", label: "Stanowisko / rola" },
    {
      key: "eyebrow",
      type: "i18nText",
      label: "Etykieta nad nazwiskiem",
      placeholder: "np. EKSPERT",
    },
    { key: "description", type: "i18nText", label: "Opis / bio", rows: 4 },
    { key: "email", type: "text", label: "Email", placeholder: "osoba@domena.pl" },
    { key: "x", type: "url", label: "X", placeholder: "https://x.com/…" },
    { key: "linkedin", type: "url", label: "LinkedIn", placeholder: "https://linkedin.com/in/…" },
    { key: "facebook", type: "url", label: "Facebook", placeholder: "https://facebook.com/…" },
    { key: "instagram", type: "url", label: "Instagram", placeholder: "https://instagram.com/…" },
    { key: "youtube", type: "url", label: "YouTube", placeholder: "https://youtube.com/…" },
    { key: "website", type: "url", label: "Strona www", placeholder: "https://…" },
    {
      key: "showSocials",
      type: "bool",
      label: "Pokaż ikony social",
      hint: "Wyłączenie ukrywa całą listę odnośników.",
    },
    {
      key: "showProfileLink",
      type: "bool",
      label: "Linkuj nazwisko do profilu publicznego",
      hint: "Działa po powiązaniu osoby z katalogu ekspertów.",
    },
    // --- Prezentacja: te same klucze steruja wariantem `profile` bloku
    // `author-bio` w block editorze (patrz PROFILE_CARD_STYLE_KEYS). ---
    {
      key: "imageSize",
      type: "number",
      label: "Bok zdjęcia (px)",
      group: "Prezentacja",
      min: 200,
      max: 720,
      step: 10,
      default: 470,
      hint: "Kwadratowy portret na desktopie. Na węższych ekranach zdjęcie kurczy się proporcjonalnie.",
    },
    {
      key: "overlap",
      type: "number",
      label: "Nałożenie karty na zdjęcie (px)",
      group: "Prezentacja",
      min: 0,
      max: 200,
      step: 5,
      default: 80,
      hint: "0 = karta styka się ze zdjęciem bez nakładki.",
    },
    {
      key: "cardMaxWidth",
      type: "number",
      label: "Maks. szerokość układu (px)",
      group: "Prezentacja",
      min: 480,
      max: 1600,
      step: 20,
      default: 1024,
    },
    {
      key: "shadow",
      type: "select",
      label: "Cień karty",
      group: "Prezentacja",
      options: [
        { value: "none", label: "brak" },
        { value: "sm", label: "delikatny" },
        { value: "md", label: "średni" },
        { value: "lg", label: "mocny" },
        { value: "xl", label: "bardzo mocny" },
      ],
      default: "xl",
    },
    {
      key: "socialStyle",
      type: "select",
      label: "Styl przycisków social",
      group: "Prezentacja",
      options: [
        { value: "solid", label: "wypełnione (ikona w kontrze)" },
        { value: "outline", label: "obrys" },
      ],
      default: "solid",
    },
    {
      key: "socialSize",
      type: "number",
      label: "Bok przycisku social (px)",
      group: "Prezentacja",
      min: 28,
      max: 72,
      step: 2,
      default: 48,
    },
    {
      key: "mobileAlign",
      type: "select",
      label: "Wyrównanie treści (mobile)",
      group: "Prezentacja",
      options: [
        { value: "center", label: "wyśrodkowane" },
        { value: "left", label: "do lewej" },
      ],
      default: "center",
      hint: "Na desktopie karta zawsze wyrównuje treść do lewej.",
    },
    {
      key: "animate",
      type: "bool",
      label: "Animuj wejście karty",
      group: "Prezentacja",
      hint: "Wyłączane automatycznie przy systemowym „ogranicz ruch” (prefers-reduced-motion).",
    },
  ],
  // "Speakers" ma dedykowany edytor (SpeakersEditor) - schema pusta, żeby
  // fallback po schemacie nie próbował renderować duplikatów pól.
  speakers: [],
  // Agenda i odliczanie maja dedykowane edytory (EventScheduleEditor /
  // EventCountdownEditor) - schema pusta z tego samego powodu co speakers.
  "event-schedule": [],
  "event-countdown": [],
  // Karta odliczania - dedykowany edytor (EventCountdownCardEditor).
  "event-countdown-card": [],
  // Potwierdzenie zakupu: treść nagłówka/opisu + przełączniki bloków.
  // Dane (data końca dostępu, portal klienta) pochodzą z konta kupującego.
  "purchase-confirmation": [
    { key: "heading", type: "i18nText", label: "Nagłówek", placeholder: "Dziękujemy za zakup" },
    {
      key: "body",
      type: "i18nText",
      label: "Opis",
      placeholder: "Dostęp jest już aktywny na Twoim koncie.",
    },
    {
      key: "showAccessEnd",
      type: "select",
      label: "Data końca dostępu",
      options: [
        { value: "true", label: "pokaż" },
        { value: "false", label: "ukryj" },
      ],
      hint: "Dla subskrypcji pokazuje datę odnowienia, dla zakupu jednorazowego - datę wygaśnięcia.",
    },
    {
      key: "showPortalLink",
      type: "select",
      label: "Portal klienta",
      options: [
        { value: "true", label: "pokaż" },
        { value: "false", label: "ukryj" },
      ],
      hint: "Przycisk otwiera portal operatora płatności (faktury, metoda płatności, anulowanie).",
    },
    {
      key: "showOrdersLink",
      type: "select",
      label: "Link do historii zamówień",
      options: [
        { value: "true", label: "pokaż" },
        { value: "false", label: "ukryj" },
      ],
    },
    {
      key: "showReference",
      type: "select",
      label: "Numer transakcji",
      options: [
        { value: "true", label: "pokaż" },
        { value: "false", label: "ukryj" },
      ],
    },
    {
      key: "showSecureNote",
      type: "select",
      label: "Nota o bezpieczeństwie płatności",
      options: [
        { value: "true", label: "pokaż" },
        { value: "false", label: "ukryj" },
      ],
    },
    { key: "accentColor", type: "color", label: "Kolor akcentu" },
    { key: "href", type: "url", label: "Dodatkowy przycisk - adres" },
    { key: "ctaLabel", type: "i18nText", label: "Dodatkowy przycisk - etykieta" },
  ],
  // Networking 1-1 i sponsorzy - dedykowane edytory (MeetingBookingEditor /
  // SponsorsEditor).
  "onboarding-form": [
    { key: "heading", type: "i18nText", label: "Nagłówek", placeholder: "Brief projektu" },
    { key: "intro", type: "i18nText", label: "Wstęp" },
    { key: "submitLabel", type: "i18nText", label: "Etykieta przycisku wysyłki" },
    { key: "accentColor", type: "color", label: "Kolor akcentu" },
    {
      key: "showStepIndicator",
      type: "select",
      label: "Licznik kroków",
      options: [
        { value: "true", label: "pokaż" },
        { value: "false", label: "ukryj" },
      ],
    },
    {
      key: "requireConsent",
      type: "select",
      label: "Wymagana zgoda na kontakt",
      options: [
        { value: "true", label: "tak" },
        { value: "false", label: "nie" },
      ],
    },
  ],
  // Lista slajdów ma własny edytor (ProgressCarouselEditor); te dwa ustawienia
  // renderer czytał od zawsze (ProgressCarouselView: `ratio`, `accentColor`),
  // więc mieszkają w schemacie i są renderowane przez ten sam edytor
  // (SchemaFieldControl), zamiast być duplikowane ręcznym JSX.
  "progress-carousel": [
    {
      key: "ratio",
      type: "select",
      label: "Proporcje",
      options: [
        { value: "16/9", label: "16:9 - baner poziomy" },
        { value: "21/9", label: "21:9 - ultrawide cinematic" },
        { value: "3/2", label: "3:2 - fotografia" },
        { value: "4/3", label: "4:3 - klasyczny" },
        { value: "1/1", label: "1:1 - kwadrat" },
      ],
      hint: "Proporcje kadru slajdu na mobile i tablecie.",
    },
    {
      key: "accentColor",
      type: "color",
      label: "Kolor akcentu (opcjonalny)",
      hint: "Kolor paska postępu. Puste = kolor marki.",
    },
  ],
  // Lista kart ma własny edytor (CircularCarouselEditor); te pola czyta
  // renderer (CircularCarouselView) i rysuje je SchemaFieldControl.
  "circular-carousel": [
    {
      key: "visibleCount",
      type: "number",
      label: "Widoczne karty (3-7, nieparzyste)",
      min: 3,
      max: 7,
      default: 5,
      group: "Wygląd",
    },
    {
      key: "radiusX",
      type: "number",
      label: "Promień poziomy (px)",
      min: 40,
      max: 600,
      default: 220,
      group: "Wygląd",
    },
    {
      key: "radiusY",
      type: "number",
      label: "Promień pionowy (px)",
      min: 40,
      max: 600,
      default: 100,
      group: "Wygląd",
    },
    {
      key: "accentColor",
      type: "color",
      label: "Kolor akcentu (opcjonalny)",
      hint: "Ramka aktywnej karty, licznik i kropki. Puste = kolor marki.",
      group: "Wygląd",
    },
  ],
  "meeting-booking": [],
  "event-sponsors": [],
  // --- Kluby dyskusyjne (spec §5.5) ---
  "club-card": [
    {
      key: "clubSlug",
      type: "text",
      label: "Adres klubu",
      placeholder: "bezpieczenstwo-europy-srodkowo-wschodniej",
      hint: "Fragment adresu po /club/. Pusty = widget nic nie pokazuje (i nie pyta bazy).",
    },
    {
      key: "showStats",
      type: "bool",
      label: "Pokaż liczniki",
      hint: "Liczba członków i wątków. Obie pochodzą z denormalizacji, więc nie kosztują dodatkowego zapytania.",
      group: "Wygląd",
    },
    { key: "ctaLabel", type: "i18nText", label: "Etykieta przycisku", group: "Wygląd" },
  ],
  "club-threads": [
    { key: "heading", type: "i18nText", label: "Nagłówek", placeholder: "Dyskusje w klubach" },
    {
      key: "sort",
      type: "select",
      label: "Porządek",
      options: [
        { value: "hot", label: "Gorące" },
        { value: "new", label: "Najnowsze" },
      ],
      group: "Dane",
    },
    {
      key: "policyArea",
      type: "text",
      label: "Obszar polityki",
      hint: "Zawężenie do jednego obszaru. Puste = wszystkie kluby, do których wołający ma dostęp.",
      group: "Dane",
    },
    { key: "limit", type: "number", label: "Liczba wątków", min: 1, max: 12, group: "Dane" },
  ],
  "event-list": [
    { key: "heading", type: "i18nText", label: "Nagłówek", placeholder: "Nadchodzące wydarzenia" },
    {
      key: "scope",
      type: "select",
      label: "Zakres",
      options: [
        { value: "upcoming", label: "Nadchodzące" },
        { value: "past", label: "Minione" },
        { value: "all", label: "Wszystkie" },
      ],
      group: "Dane",
    },
    {
      key: "kind",
      type: "select",
      label: "Rodzaj",
      options: [
        { value: "", label: "Wszystkie" },
        { value: "webinar", label: "Webinar" },
        { value: "briefing", label: "Briefing" },
        { value: "roundtable", label: "Okrągły stół" },
        { value: "ama", label: "AMA" },
        { value: "in_person", label: "Stacjonarne" },
        { value: "hybrid", label: "Hybrydowe" },
      ],
      group: "Dane",
    },
    { key: "limit", type: "number", label: "Liczba wydarzeń", min: 1, max: 50, group: "Dane" },
    {
      key: "variant",
      type: "select",
      label: "Wariant",
      options: [
        { value: "cards", label: "Karty" },
        { value: "list", label: "Lista" },
      ],
      group: "Wygląd",
    },
    {
      key: "columns",
      type: "number",
      label: "Kolumny (karty)",
      min: 2,
      max: 4,
      default: 3,
      visibleWhen: (c) => (typeof c.variant === "string" ? c.variant : "cards") === "cards",
      group: "Wygląd",
    },
    { key: "accentColor", type: "color", label: "Kolor akcentu", group: "Wygląd" },
    {
      key: "showCountdown",
      type: "select",
      label: "Chip odliczania (za X dni)",
      options: [
        { value: "true", label: "Tak" },
        { value: "false", label: "Nie" },
      ],
      group: "Opcje",
    },
    {
      key: "showKindBadge",
      type: "select",
      label: "Badge rodzaju",
      options: [
        { value: "true", label: "Tak" },
        { value: "false", label: "Nie" },
      ],
      group: "Opcje",
    },
    {
      key: "showRsvpCount",
      type: "select",
      label: "Licznik zapisanych (RSVP)",
      options: [
        { value: "false", label: "Nie" },
        { value: "true", label: "Tak" },
      ],
      group: "Opcje",
    },
    {
      key: "emptyText",
      type: "i18nText",
      label: "Tekst pustej listy",
      placeholder: "Brak zaplanowanych wydarzeń.",
      group: "Opcje",
    },
  ],
  // Chrome (nagłówek / stopka). Te trzy widgety miały konsumowane ustawienia
  // bez ŻADNEJ kontrolki w panelu: redakcja widziała "brak edytowalnych pól",
  // a renderer i tak czytał `text`/`brand`/`showYear`, `label`, `action`.
  copyright: [
    { key: "brand", type: "text", label: "Nazwa marki", placeholder: "New European Strategies" },
    { key: "text", type: "i18nText", label: "Tekst", placeholder: "Wszelkie prawa zastrzeżone" },
    {
      key: "showYear",
      type: "bool",
      label: "Pokaż rok",
      default: true,
      hint: "Dopisuje znak © i bieżący rok przed nazwą marki.",
    },
  ],
  "lang-switcher": [
    {
      key: "label",
      type: "i18nText",
      label: "Etykieta",
      placeholder: "Zmień język",
      hint: "Opis dla czytników ekranu (aria-label). Na stronie widoczne są wyłącznie flagi PL/EN.",
    },
  ],
  "search-form": [
    {
      key: "action",
      type: "text",
      label: "Adres wyników wyszukiwania",
      placeholder: "/search",
      hint: "Formularz wysyła metodą GET parametr q pod ten adres.",
    },
    { key: "placeholder", type: "i18nText", label: "Placeholder", placeholder: "Szukaj..." },
    { key: "button", type: "i18nText", label: "Etykieta przycisku", placeholder: "Szukaj" },
  ],
  "search-button": [
    { key: "label", type: "i18nText", label: "Placeholder", placeholder: "Szukaj" },
    // Renderer obsługiwał trzy tryby i własny nagłówek panelu wyników, ale
    // panel nie dawał na nie ŻADNEJ kontrolki - jedynym dostępnym trybem był
    // domyślny "dropdown".
    {
      key: "mode",
      type: "select",
      label: "Tryb wyszukiwania",
      options: [
        { value: "dropdown", label: "rozwijany panel pod polem" },
        { value: "standalone", label: "samo pole (wyniki na stronie)" },
        { value: "fullscreen", label: "pełny ekran" },
      ],
      default: "dropdown",
    },
    {
      key: "heading",
      type: "i18nText",
      label: "Nagłówek panelu wyników",
      hint: "Puste = bez nagłówka. Gdy placeholder jest pusty, nagłówek staje się jego zamiennikiem.",
    },
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
  toc: [
    {
      key: "variant",
      type: "select",
      label: "Wariant",
      options: [
        { value: "list", label: "Lista pionowa (klasyczna)" },
        { value: "grid", label: "Grid dwukolumnowy" },
        { value: "sidebar", label: "Sidebar (kompaktowy)" },
      ],
    },
    { key: "title", type: "i18nText", label: "Tytuł", placeholder: "Spis treści" },
    { key: "showNumbers", type: "bool", label: "Numeracja", default: true },
    { key: "showProgress", type: "bool", label: "Pasek postępu czytania", default: false },
    {
      key: "sticky",
      type: "bool",
      label: "Sticky (desktop)",
      default: false,
      hint: "Zalecane przy układzie sidebarowym / w wąskiej kolumnie bocznej.",
    },
    {
      // i18nStringArray, NIE stringArray: renderer czyta `items_pl` / `items_en`
      // (z fallbackiem na bezjęzykowe `items` dla treści sprzed migracji).
      // Zapis do gołego `items` przez kontrolkę oznaczał, że ręczne pozycje
      // nigdy nie trafiały do widgetu.
      key: "items",
      type: "i18nStringArray",
      label: "Pozycje (opcjonalne)",
      hint: "Zostaw puste, aby TOC zaczytał się automatycznie z nagłówków H2/H3 strony. Ręcznie: jedna pozycja per linia. Format: `Tekst` (H2) lub `-- Tekst` (H3). Opcjonalny id: `#moj-id | Tekst`.",
    },
  ],
  "hot-topic-bar": [
    { key: "badge", type: "i18nText", label: "Etykieta (badge)" },
    { key: "title", type: "i18nText", label: "Tytuł" },
    { key: "href", type: "url", label: "Link (opcjonalny)" },
    {
      key: "iconName",
      type: "icon",
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
      key: "linksSource",
      type: "select",
      label: "Źródło linków",
      options: [
        { value: "auto", label: "własne, a gdy puste - globalne" },
        { value: "global", label: "globalne (Opcje motywu → Ikony social)" },
        { value: "own", label: "tylko wpisane poniżej" },
      ],
      hint: "Globalne linki do mediów społecznościowych ustawia się raz w Admin → Wygląd → Opcje motywu → „Ikony social” (/admin/theme-options). Widgety zaciągają je automatycznie.",
    },
    {
      key: "facebook",
      type: "url",
      label: "Facebook URL",
      placeholder: "https://facebook.com/...",
    },
    {
      key: "x",
      legacyKeys: ["twitter"],
      type: "url",
      label: "X (URL)",
      placeholder: "https://x.com/...",
    },
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
    {
      key: "spotify",
      type: "url",
      label: "Spotify URL",
      placeholder: "https://open.spotify.com/...",
    },
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
      hint: "Jawny kolor ma pierwszeństwo przed adaptacją dark / light.",
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
      hint: "Dotyczy kolorów dziedziczonych - nie nadpisuje jawnego wyboru w polu „Kolory ikon”.",
    },
    {
      key: "layout",
      type: "select",
      label: "Układ",
      options: [
        { value: "row", label: "Ikony w rzędzie" },
        { value: "list", label: "Lista (ikona + nazwa + CTA)" },
      ],
      hint: "Lista renderuje każdą platformę jako osobny wiersz z etykietą i CTA (Like / Follow / Subscribe).",
    },
    {
      key: "rowHover",
      type: "select",
      label: "Podświetlenie po najechaniu",
      options: [
        { value: "brand", label: "gradient marki platformy" },
        { value: "house", label: "firmowy pomarańcz (jeden dla wszystkich)" },
        { value: "soft", label: "delikatne (ton marki)" },
        { value: "outline", label: "tylko obramowanie" },
        { value: "custom", label: "własny kolor" },
        { value: "none", label: "brak" },
      ],
      hint: "Działa w obu układach: w liście maluje cały wiersz, w rzędzie - kafelek ikony.",
    },
    {
      key: "rowHoverColor",
      type: "text",
      label: "Własny kolor podświetlenia",
      placeholder: "#B85410 lub var(--brand)",
      visibleWhen: (c) => c.rowHover === "custom",
      hint: "Z koloru budowany jest gradient; kolor tekstu dobiera się automatycznie do jego jasności.",
    },
    {
      key: "hoverIconMode",
      type: "select",
      label: "Ikony po najechaniu",
      options: [
        { value: "auto", label: "automatycznie (jasne na ciemnym tle)" },
        { value: "light", label: "jasne (białe)" },
        { value: "brand", label: "kolor brand" },
        { value: "official", label: "oficjalne kolory marek" },
        { value: "custom", label: "własny kolor" },
        { value: "keep", label: "bez zmiany" },
      ],
      hint: "Na gradiencie marki i firmowym tryb automatyczny rozjaśnia ikonę także w jasnym motywie.",
    },
    {
      key: "hoverIconColor",
      type: "text",
      label: "Własny kolor ikony (hover)",
      placeholder: "#ffffff",
      visibleWhen: (c) => c.hoverIconMode === "custom",
    },
    {
      key: "newsletterTone",
      type: "select",
      label: "Tonacja firmowego gradientu",
      options: [
        { value: "amber", label: "Bursztyn (domyślna)" },
        { value: "cognac", label: "Koniak" },
        { value: "ember", label: "Żar" },
        { value: "sunset", label: "Zachód słońca" },
      ],
      visibleWhen: (c) =>
        c.rowHover === "house" || (c.layout === "list" && c.showNewsletter !== "0"),
      hint: "Tonacja wiersza newslettera oraz całej listy w trybie „firmowy pomarańcz”. Wszystkie rampy trzymają kontrast bieli na poziomie AA.",
    },
    {
      key: "ctaFacebook",
      type: "i18nText",
      label: "CTA Facebook",
      placeholder: "Polub to / Like",
      visibleWhen: (c) => c.layout === "list",
    },
    {
      key: "ctaX",
      type: "i18nText",
      label: "CTA X",
      placeholder: "Obserwuj / Follow",
      visibleWhen: (c) => c.layout === "list",
    },
    {
      key: "ctaYoutube",
      type: "i18nText",
      label: "CTA YouTube",
      placeholder: "Subskrybuj / Subscribe",
      visibleWhen: (c) => c.layout === "list",
    },
    {
      key: "ctaInstagram",
      type: "i18nText",
      label: "CTA Instagram",
      placeholder: "Obserwuj / Follow",
      visibleWhen: (c) => c.layout === "list",
    },
    {
      key: "ctaLinkedin",
      type: "i18nText",
      label: "CTA LinkedIn",
      placeholder: "Obserwuj / Follow",
      visibleWhen: (c) => c.layout === "list",
    },
    {
      key: "ctaSpotify",
      type: "i18nText",
      label: "CTA Spotify",
      placeholder: "Obserwuj / Follow",
      visibleWhen: (c) => c.layout === "list",
    },
    {
      key: "showNewsletter",
      type: "select",
      label: "Wiersz newslettera",
      options: [
        { value: "1", label: "pokaż" },
        { value: "0", label: "ukryj" },
      ],
      visibleWhen: (c) => c.layout === "list",
      hint: "Newsletter renderuje się jak pozostałe platformy (ikona + nazwa + CTA).",
    },
    {
      key: "newsletterUrl",
      type: "text",
      label: "Newsletter URL",
      placeholder: "/newsletter",
      visibleWhen: (c) => c.layout === "list" && c.showNewsletter !== "0",
    },
    {
      key: "ctaNewsletter",
      type: "i18nText",
      label: "CTA Newsletter",
      placeholder: "Subskrybuj / Subscribe",
      visibleWhen: (c) => c.layout === "list" && c.showNewsletter !== "0",
    },
    ...SOCIAL_PLATFORM_COLOR_FIELDS,
  ],

  "trending-now": [
    {
      key: "badge",
      type: "i18nText",
      label: "Etykieta (badge)",
      placeholder: "Warte przeczytania / Worth reading",
    },
    { key: "limit", type: "number", label: "Liczba wpisów", min: 3, max: 30 },
    {
      key: "intervalSec",
      type: "number",
      label: "Co ile sekund zmieniać wpis",
      min: 2,
      max: 60,
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
    {
      key: "showIndex",
      type: "select",
      label: "Numer pozycji",
      options: [
        { value: "true", label: "Pokaż" },
        { value: "false", label: "Ukryj" },
      ],
    },
    {
      key: "showAuthor",
      type: "select",
      label: "Autor (awatar + imię)",
      options: [
        { value: "true", label: "Pokaż" },
        { value: "false", label: "Ukryj" },
      ],
    },
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
    {
      key: "direction",
      type: "select",
      label: "Kierunek animacji",
      options: [
        { value: "vertical", label: "Pionowy (slide)" },
        { value: "horizontal", label: "Poziomy (marquee)" },
      ],
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
        {
          value: "split-image",
          label: "split z grafiką (lewo: obraz + korzyści, prawo: formularz)",
        },
        { value: "inline", label: "inline" },
      ],
    },

    // ----- Wygląd / tło (domyślnie: global colors, dopuszcza transparent) -----
    {
      key: "bgLight",
      type: "color",
      label: "Tło (light mode)",
      hint: "Puste = przezroczyste. Możesz wpisać var(--card) lub dowolny kolor.",
    },
    {
      key: "bgDark",
      type: "color",
      label: "Tło (dark mode)",
      hint: "Puste = przezroczyste. Możesz wpisać var(--card) lub dowolny kolor.",
    },
    {
      key: "perkIconColor",
      type: "color",
      label: "Kolor ikony ✓ (bulletpointy)",
      hint: 'Ikona Lucide „Check" - zmienia się tylko kolor, kształt pozostaje bez zmian. Puste = brand (lub biały w wariancie split-image).',
    },

    // --- Obszar grafiki (aktywny w wariancie "split-image")
    {
      key: "imageUrl",
      type: "image",
      label: "Grafika: obraz (wgraj plik lub wklej URL)",
      hint: "Wgraj plik z dysku (trafi do biblioteki mediów) albo wklej pełny URL. Puste = użyty zostanie gradient fallback.",
    },
    { key: "imageAlt", type: "text", label: "Grafika: alt (PL) - opis dla dostępności / SEO" },
    {
      key: "imageAltEn",
      type: "text",
      label: "Grafika: alt (EN) - accessibility / SEO description",
    },

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
    // Renderer czyta `iconSize` (ikona ✓ przy bulletpointach) i honoruje go w
    // edycji inline na kanwie, ale panel nie miał na to kontrolki.
    {
      key: "iconSize",
      type: "number",
      label: "Rozmiar ikony ✓ (px)",
      min: 8,
      max: 40,
      hint: "Puste = rozmiar dobierany do tekstu bulletpointu.",
    },
    { key: "labelSize", type: "number", label: "Rozmiar etykiet (px)", min: 8, max: 24 },
    {
      key: "placeholderSize",
      type: "number",
      label: "Rozmiar placeholderów / pól (px)",
      min: 8,
      max: 24,
    },
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
    // Formularz czyta `successMsg_${lang}` od zawsze, a panel nie miał na to
    // ŻADNEGO pola: komunikat po wysłaniu był zaszyty ("Wysłano!" / "Sent!").
    {
      key: "successMsg",
      type: "i18nText",
      label: "Komunikat po wysłaniu",
      placeholder: "Wysłano!",
      hint: "Widoczny po udanym wysłaniu formularza. Puste = tekst domyślny.",
    },
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
    {
      key: "descriptionSize",
      type: "number",
      label: "Rozmiar opisu / podtytułu (px)",
      min: 8,
      max: 48,
    },
    { key: "labelSize", type: "number", label: "Rozmiar etykiet pól (px)", min: 8, max: 24 },
    {
      key: "placeholderSize",
      type: "number",
      label: "Rozmiar placeholderów / pól (px)",
      min: 8,
      max: 24,
    },
    { key: "buttonFontSize", type: "number", label: "Rozmiar przycisku (px)", min: 8, max: 28 },
    {
      key: "consentSize",
      type: "number",
      label: "Rozmiar zgód / newsletter (px)",
      min: 8,
      max: 20,
    },
  ],

  // ---------------------------------------------------------------------------
  // Widgety dynamiczne (kontekst wpisu / archiwum).
  //
  // Do tej pory ŻADEN z nich nie miał schematu, więc panel właściwości pokazywał
  // "Brak edytowalnych pól dla tego widgetu", a defaulty z rejestru (tag, wariant,
  // separator, limit...) były nieosiągalne z UI. Wszystkie przełączniki są typu
  // `bool` (prawdziwe true/false); czytelnicy i tak przechodzą przez `asBool`,
  // więc treść zapisana wcześniej jako "0"/"1" znaczy dalej to samo.
  // ---------------------------------------------------------------------------
  "post-title": [
    {
      key: "tag",
      type: "select",
      label: "Tag (SEO)",
      hint: POST_CTX_HINT,
      options: ["h1", "h2", "h3", "h4", "h5", "h6", "p"].map((v) => ({ value: v })),
      default: "h1",
    },
    { key: "linkToPost", type: "bool", label: "Linkuj do wpisu", default: false },
    { key: "fallback", type: "i18nText", label: "Tekst zastępczy (gdy brak tytułu)" },
  ],
  "post-meta": [
    // `showAuthor` NIE jest polem schematu: widoczność (i rozmiar) autora ma
    // wspólną kontrolkę `AuthorDisplayControl`, dorysowaną przez panel dla
    // każdego widgetu z bylinem. Rezolwer nadal czyta ten klucz z dokumentów
    // sprzed ujednolicenia - patrz `@/lib/builder/authorDisplay`.
    { key: "showCategory", type: "bool", label: "Pokaż kategorię", default: true },
    { key: "showDate", type: "bool", label: "Pokaż datę", default: true },
    {
      key: "dateFormat",
      type: "select",
      label: "Format daty",
      options: [
        { value: "long", label: "pełny" },
        { value: "short", label: "skrócony" },
        { value: "relative", label: "względny" },
      ],
      default: "long",
      visibleWhen: (c) => asBool(c.showDate, true),
    },
    { key: "showReadingTime", type: "bool", label: "Pokaż czas czytania", default: true },
    {
      key: "showViews",
      type: "bool",
      label: "Pokaż liczbę odsłon",
      default: false,
      hint: "Realna liczba odsłon wpisu, liczona po stronie serwera w obrębie tenanta. Kanwa buildera pokazuje wartość przykładową.",
    },
    { key: "separator", type: "text", label: "Separator", placeholder: " · " },
  ],
  "post-tags-dyn": [
    {
      key: "variant",
      type: "select",
      label: "Wariant",
      hint: POST_CTX_HINT,
      options: [
        { value: "pill", label: "pigułki" },
        { value: "outline", label: "obrys" },
        { value: "text", label: "tekst" },
      ],
      default: "pill",
    },
    { key: "showLabel", type: "bool", label: "Pokaż etykietę", default: true },
    {
      key: "label",
      type: "i18nText",
      label: "Etykieta",
      visibleWhen: (c) => asBool(c.showLabel, true),
    },
  ],
  "post-categories-dyn": [
    {
      key: "variant",
      type: "select",
      label: "Wariant",
      hint: POST_CTX_HINT,
      options: [
        { value: "pill", label: "pigułki" },
        { value: "outline", label: "obrys" },
        { value: "text", label: "tekst" },
      ],
      default: "pill",
    },
    { key: "limit", type: "number", label: "Limit (0 = bez limitu)", min: 0, max: 20, default: 0 },
  ],
  "post-author-card": [
    {
      key: "variant",
      type: "select",
      label: "Wariant",
      hint: POST_CTX_HINT,
      options: [
        { value: "card", label: "karta" },
        { value: "inline", label: "w linii" },
        { value: "centered", label: "wyśrodkowany" },
      ],
      default: "card",
    },
    // `showAvatar` przeszło do wspólnej kontrolki autora (oś „Zdjęcie autora”).
    // Rezolwer czyta stary klucz jako wartość domyślną tej osi.
    { key: "showBio", type: "bool", label: "Pokaż biogram", default: true },
    { key: "showSocial", type: "bool", label: "Pokaż linki społecznościowe", default: true },
  ],
  "post-breadcrumbs": [
    {
      key: "showHome",
      type: "bool",
      label: "Pokaż stronę główną",
      default: true,
      hint: POST_CTX_HINT,
    },
    {
      key: "home",
      type: "i18nText",
      label: "Etykieta strony głównej",
      visibleWhen: (c) => asBool(c.showHome, true),
    },
    {
      key: "separator",
      type: "select",
      label: "Separator",
      options: [
        { value: "/", label: "ukośnik" },
        { value: ">", label: "strzałka" },
      ],
      default: "/",
    },
  ],
  "post-cover": [
    {
      key: "aspect",
      type: "select",
      label: "Proporcje",
      hint: POST_CTX_HINT,
      options: ["16/9", "4/3", "3/2", "1/1", "21/9"].map((v) => ({ value: v })),
      default: "16/9",
    },
    { key: "rounded", type: "bool", label: "Zaokrąglone rogi", default: true },
    { key: "showCaption", type: "bool", label: "Pokaż podpis", default: false },
    {
      key: "caption",
      type: "i18nText",
      label: "Podpis pod okładką",
      visibleWhen: (c) => asBool(c.showCaption, false),
    },
  ],
  "post-excerpt": [
    {
      key: "maxChars",
      type: "number",
      label: "Maksymalna liczba znaków (0 = bez limitu)",
      min: 0,
      max: 2000,
      default: 240,
      hint: POST_CTX_HINT,
    },
  ],
  "archive-title": [
    {
      key: "showDescription",
      type: "bool",
      label: "Pokaż opis",
      default: true,
      hint: "Widget czyta dane archiwum (kategoria / tag). Poza stroną archiwum pozostaje ukryty.",
    },
    { key: "showCount", type: "bool", label: "Pokaż liczbę wpisów", default: true },
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
  hint: 'Przykład: {"id":"branza","type":"select","labelPl":"Branża","labelEn":"Industry","required":true,"options":[{"value":"fintech","labelPl":"Fintech","labelEn":"Fintech"}]}',
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

/**
 * `join-us` NIE dostaje pary etykieta+placeholder.
 *
 * Formularz "Dołącz do nas" jest zbudowany na `FloatingInput`: pływająca
 * etykieta JEST placeholderem, więc na pole przypada jeden widoczny napis.
 * `pushLabelsFor` dokładał tu drugą kontrolkę (`${key}Label`) na każde z 9 pól -
 * 18 kluczy, których formularz nigdy nie czytał. Redakcja wpisywała tekst,
 * zapisywała i nic się nie zmieniało. Placeholdery są już w schemacie wyżej,
 * więc widgetowi brakuje wyłącznie edytora pól dodatkowych.
 *
 * `contact-form` zostaje przy parze: tam etykieta i placeholder to dwa różne,
 * realnie czytane napisy.
 */
(WIDGET_SCHEMAS["join-us"] as SchemaField[]).push(customFieldsField);

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
  {
    key: "showInterests",
    type: "select",
    label: "Droplista tematów (zainteresowania)?",
    options: [
      { value: "1", label: "tak" },
      { value: "0", label: "nie" },
    ],
    default: "1",
  },
  customFieldsField,
);

// --- Auth form widgets: login / register / lost-password / reset-password ---
//
// Wszystkie przełączniki tych czterech widgetów są typu `bool` (prawdziwe
// `true`/`false`). Historycznie były to selecty "0"/"1", a renderery czytały je
// idiomem `data.showX !== false`; string "0" jest prawdziwy, więc wyłączenie
// pola NIE DZIAŁAŁO. Czytelnicy przechodzą przez `asBool`, więc dokumenty
// zapisane starym panelem nadal znaczą to samo.

/** Wariant powłoki formularza auth - komponent rysuje realnie każdą z opcji. */
const authVariantField = (): SchemaField => ({
  key: "variant",
  type: "select",
  label: "Wariant",
  options: [
    { value: "card", label: "Karta" },
    { value: "flat", label: "Płaski" },
    { value: "inline", label: "Inline" },
  ],
  default: "card",
});

/** Pojedynczy przełącznik on/off widgetu auth. */
const authToggle = (key: string, label: string, defaultOn: boolean): SchemaField => ({
  key,
  type: "bool",
  label,
  default: defaultOn,
});

/**
 * Blok edytora jednego pola formularza auth: widoczność + wymagalność jako
 * `bool`, plus dwujęzyczna etykieta i placeholder. Odpowiednik `fieldBlock`,
 * ale bez selectów "0"/"1".
 */
const authFieldBlock = (
  key: string,
  labelBase: string,
  opts: { show: boolean; require: boolean },
): SchemaField[] => [
  authToggle(
    `show${key.charAt(0).toUpperCase()}${key.slice(1)}`,
    `Pole: ${labelBase} - widoczne?`,
    opts.show,
  ),
  authToggle(
    `require${key.charAt(0).toUpperCase()}${key.slice(1)}`,
    `${labelBase} - wymagane?`,
    opts.require,
  ),
  ...labelPh(key, labelBase),
];

(WIDGET_SCHEMAS as Record<string, ReadonlyArray<SchemaField>>)["login-form"] = [
  authVariantField(),
  { key: "title", type: "i18nText", label: "Tytuł" },
  { key: "subtitle", type: "i18nText", label: "Podtytuł" },
  { key: "submitLabel", type: "i18nText", label: "Etykieta przycisku" },
  ...labelPh("email", "E-mail"),
  ...labelPh("password", "Hasło"),
  // "Zapamiętaj mnie" to checkbox - ma widoczność i etykietę, ale nie ma
  // sensownego "wymagane?" ani placeholdera (oba były martwe).
  authToggle("showRemember", "Pole: Zapamiętaj mnie - widoczne?", true),
  { key: "rememberLabel", type: "i18nText", label: "Etykieta: Zapamiętaj mnie" },
  authToggle("showShowPassword", "Pokaż przycisk pokaż hasło?", true),
  authToggle("showForgot", "Pokaż link zapomniałem hasła?", true),
  authToggle("showRegister", "Pokaż link załóż konto?", true),
  authToggle("showOAuthGoogle", "Pokaż logowanie Google?", true),
  { key: "redirectTo", type: "text", label: "Po zalogowaniu przekieruj do", placeholder: "/" },
  { key: "registerHref", type: "text", label: "URL do rejestracji", placeholder: "/register" },
  {
    key: "forgotHref",
    type: "text",
    label: "URL do odzyskiwania hasła",
    placeholder: "/lost-password",
  },
  // Bez `customFields`: logowanie tylko uwierzytelnia, więc dodatkowe pola nie
  // miałyby dokąd trafić - były cichym śmieciem w panelu.
];

(WIDGET_SCHEMAS as Record<string, ReadonlyArray<SchemaField>>)["register-form"] = [
  authVariantField(),
  { key: "title", type: "i18nText", label: "Tytuł" },
  { key: "subtitle", type: "i18nText", label: "Podtytuł" },
  { key: "submitLabel", type: "i18nText", label: "Etykieta przycisku" },
  ...authFieldBlock("firstName", "Imię", { show: true, require: true }),
  ...authFieldBlock("lastName", "Nazwisko", { show: true, require: true }),
  // E-mail i hasło są strukturalne (Supabase signUp ich wymaga), więc mają
  // tylko etykietę i placeholder - przełączniki byłyby kłamstwem.
  ...labelPh("email", "E-mail"),
  ...authFieldBlock("phone", "Telefon", { show: false, require: false }),
  ...authFieldBlock("company", "Firma", { show: false, require: false }),
  ...authFieldBlock("job", "Stanowisko", { show: false, require: false }),
  ...authFieldBlock("linkedin", "LinkedIn", { show: false, require: false }),
  ...labelPh("password", "Hasło"),
  ...authFieldBlock("passwordConfirm", "Powtórz hasło", { show: false, require: false }),
  authToggle("showShowPassword", "Pokaż przycisk pokaż hasło?", true),
  authToggle("requireConsent", "Wymagaj zgody RODO?", true),
  { key: "consentText", type: "i18nText", label: "Treść zgody (RODO)" },
  authToggle("newsletterOptIn", "Pokaż zapis do newslettera?", true),
  { key: "newsletterLabel", type: "i18nText", label: "Etykieta zapisu do newslettera" },
  authToggle("showOAuthGoogle", "Pokaż rejestrację Google?", true),
  { key: "redirectTo", type: "text", label: "Po rejestracji przekieruj do", placeholder: "/" },
  { key: "loginHref", type: "text", label: "URL logowania", placeholder: "/login" },
  customFieldsField,
];

(WIDGET_SCHEMAS as Record<string, ReadonlyArray<SchemaField>>)["lost-password-form"] = [
  authVariantField(),
  { key: "title", type: "i18nText", label: "Tytuł" },
  { key: "subtitle", type: "i18nText", label: "Podtytuł" },
  { key: "submitLabel", type: "i18nText", label: "Etykieta przycisku" },
  ...labelPh("email", "E-mail"),
  { key: "loginHref", type: "text", label: "URL powrotu do logowania", placeholder: "/login" },
  // Adres w linku wysyłanym mailem. Renderer czytał `redirectTo` od zawsze
  // (`resetPasswordForEmail({ redirectTo })`), a panel go nie wystawiał - jedyną
  // opcją była zaszyta wartość `/reset-password`.
  {
    key: "redirectTo",
    type: "text",
    label: "Adres w linku z maila",
    placeholder: "/reset-password",
    hint: "Strona, na którą prowadzi link resetu hasła. Musi renderować widget „Ustaw nowe hasło”.",
  },
  { key: "successText", type: "i18nText", label: "Komunikat po wysłaniu" },
];

(WIDGET_SCHEMAS as Record<string, ReadonlyArray<SchemaField>>)["reset-password-form"] = [
  authVariantField(),
  { key: "title", type: "i18nText", label: "Tytuł" },
  { key: "subtitle", type: "i18nText", label: "Podtytuł" },
  { key: "submitLabel", type: "i18nText", label: "Etykieta przycisku" },
  ...labelPh("password", "Nowe hasło"),
  ...authFieldBlock("passwordConfirm", "Powtórz nowe hasło", { show: true, require: true }),
  authToggle("showShowPassword", "Pokaż przycisk pokaż hasło?", true),
  {
    key: "minLength",
    type: "number",
    label: "Minimalna długość hasła",
    min: 6,
    max: 128,
    step: 1,
    default: 8,
  },
  { key: "redirectTo", type: "text", label: "Po zapisaniu przekieruj do", placeholder: "/login" },
  { key: "successText", type: "i18nText", label: "Komunikat po zapisaniu" },
];

// Alias legacy "contact" widget schema to the new "contact-form" schema so any
// page still referencing the old type gets the full property panel.
(WIDGET_SCHEMAS as Record<string, ReadonlyArray<SchemaField> | undefined>).contact =
  WIDGET_SCHEMAS["contact-form"];

(WIDGET_SCHEMAS as Record<string, ReadonlyArray<SchemaField>>)["tailored-must-reads"] = [
  {
    key: "label",
    type: "i18nText",
    label: "Nagłówek (użyj {name} dla imienia)",
    hint: "Token {name} jest automatycznie odmieniany do wołacza w PL (np. Igor → Igorze). Możesz też użyć {name.nominative}.",
  },
  {
    key: "fallback",
    type: "i18nText",
    label: "Nagłówek dla niezalogowanych",
    hint: "Widoczny gdy odbiorca nie jest zalogowany.",
  },
  { key: "kicker", type: "i18nText", label: "Kicker (mały nadtytuł)" },
  // Przełączniki jako prawdziwe booleany: string "0" jest w JS prawdziwy, więc
  // select "1"/"0" gubił wyłączone ustawienia. Czytelnicy używają `asBool`,
  // więc treść zapisana wcześniej jako "0"/"1" działa dalej.
  { key: "showKicker", type: "bool", label: "Pokaż kicker", default: true },
  { key: "showExcerpt", type: "bool", label: "Pokaż opis (zajawkę)", default: true },
  // Autor: wspólna kontrolka panelu (widoczność nazwiska i zdjęcia osobno +
  // oba rozmiary). Klucz `showAuthor` zostaje czytany jako wartość historyczna.
  { key: "limit", type: "number", label: "Liczba wpisów", min: 1, max: 9, default: 3 },
  {
    key: "columns",
    type: "select",
    label: "Kolumny",
    hint: "Na telefonie zawsze jedna kolumna, od tabletu dwie, wybrana liczba od dużego ekranu.",
    options: [
      { value: "1", label: "1" },
      { value: "2", label: "2" },
      { value: "3", label: "3" },
      { value: "4", label: "4" },
    ],
    default: "3",
  },
  {
    key: "audience",
    type: "select",
    label: "Widoczność (dla kogo)",
    hint: "Domyślnie widget wyświetla się wyłącznie zalogowanym użytkownikom - rekomendacje bazują na ich zainteresowaniach, obserwacjach i historii czytania.",
    options: [
      { value: "auth", label: "Tylko zalogowani (zalecane)" },
      { value: "all", label: "Wszyscy (goście widzą generyczny nagłówek)" },
      { value: "guest", label: "Tylko niezalogowani" },
    ],
    default: "auth",
  },
];
