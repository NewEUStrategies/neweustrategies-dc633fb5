// Centralne definicje layoutów Foxiz-like dla pojedynczego wpisu.
// 11 układów dla Standard, 4 dla Video/Audio, 3 dla Gallery.
// Definicje są PRESETAMI - decydują o pozycji nagłówka, croppingu cover,
// szerokości treści i obecności sidebara. Renderer (PostLayoutRenderer)
// mapuje preset na klasy/elementy.
import type React from "react";

export type PostFormat = "standard" | "video" | "audio" | "gallery";

interface RecommendedImageSize {
  width: number;
  height: number;
  /** Krótki opis proporcji, np. "16:9". */
  ratio?: string;
}

export type LayoutHeaderMode =
  "above-cover" | "below-cover" | "overlay" | "side-by-side" | "no-cover";

export type LayoutCoverMode =
  | "wide" // pełna szerokość kolumny artykułu
  | "full-bleed" // wychodzi poza padding kontenera strony
  | "boxed" // ograniczona do BOXED_COVER_MAX_WIDTH
  | "side" // obok nagłówka (split)
  | "ratio" // konfigurowalny ratio (l6/l10/l11)
  | "none";

/**
 * Szerokość ramki cover w wariancie "boxed" (Layout 2). Trzymana obok
 * `coverImageSizes()`, bo ta sama liczba trafia do atrybutu `sizes` -
 * rozjazd oznaczałby pobranie innego kandydata niż malowany.
 */
export const BOXED_COVER_MAX_WIDTH = 672;

export interface LayoutPreset {
  id: string;
  label: string;
  /** Pozycja nagłówka względem cover image */
  header: LayoutHeaderMode;
  /** Sposób wyświetlenia obrazu wyróżniającego */
  cover: LayoutCoverMode;
  /** Czy układ pokazuje sidebar (placeholder) */
  hasSidebar: boolean;
  /** Centrowanie nagłówka domyślnie (może być nadpisane globalnym setting) */
  centerHeaderDefault?: boolean;
  /** Klucz featured-ratio z post_layout_settings dla layoutu */
  featuredRatioKey?: "featured_ratio_l6" | "featured_ratio_l10" | "featured_ratio_l11";
  /** Rekomendowany rozmiar grafiki wyróżniającej (px). */
  recommendedImage?: RecommendedImageSize;
  /**
   * Czy akcje artykułu (podaruj artykuł / badge Google) mają stać w nagłówku,
   * obok metadanych autora - zamiast w pasku quick-view i rzędzie mobilnym.
   */
  headerActions?: boolean;
  /**
   * Czy nagłówek pokazuje excerpt (lead). Domyślnie tak; Layout 1(a) to
   * dokładnie ten sam układ co Layout 1, ale bez zajawki pod tytułem.
   */
  showExcerpt?: boolean;
  /**
   * Twardy limit szerokości kolumny artykułu (px) dla układów "wąskich".
   * Zawęża globalne `no_sidebar_max_width` / `has_sidebar_max_width` -
   * nigdy ich nie poszerza (bierzemy min z obu).
   */
  contentMaxWidth?: number;
}

export const STANDARD_LAYOUTS: LayoutPreset[] = [
  {
    id: "layout-1",
    label: "Layout 1 - klasyczny",
    header: "above-cover",
    cover: "wide",
    hasSidebar: false,
    recommendedImage: { width: 1600, height: 900, ratio: "16:9" },
  },
  {
    id: "layout-1a",
    label: "Layout 1(a) - bez excerpt",
    header: "above-cover",
    cover: "wide",
    hasSidebar: false,
    showExcerpt: false,
    recommendedImage: { width: 1600, height: 900, ratio: "16:9" },
  },
  {
    id: "layout-2",
    label: "Layout 2 - wąski",
    header: "above-cover",
    cover: "boxed",
    hasSidebar: false,
    centerHeaderDefault: true,
    contentMaxWidth: BOXED_COVER_MAX_WIDTH,
    recommendedImage: { width: 800, height: 450, ratio: "16:9" },
  },
  {
    id: "layout-3",
    label: "Layout 3 - z sidebar",
    header: "above-cover",
    cover: "wide",
    hasSidebar: true,
    recommendedImage: { width: 1200, height: 675, ratio: "16:9" },
  },
  {
    id: "layout-4",
    label: "Layout 4 - overlay",
    header: "overlay",
    cover: "full-bleed",
    hasSidebar: false,
    centerHeaderDefault: true,
    recommendedImage: { width: 1920, height: 1080, ratio: "16:9" },
  },
  {
    id: "layout-5",
    label: "Layout 5 - overlay narrow",
    header: "overlay",
    cover: "wide",
    hasSidebar: false,
    centerHeaderDefault: true,
    recommendedImage: { width: 1600, height: 900, ratio: "16:9" },
  },
  {
    id: "layout-6",
    label: "Layout 6 - duży cover",
    header: "above-cover",
    cover: "ratio",
    hasSidebar: false,
    featuredRatioKey: "featured_ratio_l6",
    recommendedImage: { width: 1600, height: 2400, ratio: "2:3" },
  },
  {
    id: "layout-7",
    label: "Layout 7 - split",
    header: "side-by-side",
    cover: "side",
    hasSidebar: false,
    recommendedImage: { width: 900, height: 900, ratio: "1:1" },
  },
  {
    id: "layout-8",
    label: "Layout 8 - magazine",
    header: "below-cover",
    cover: "wide",
    hasSidebar: true,
    recommendedImage: { width: 1600, height: 900, ratio: "16:9" },
  },
  {
    id: "layout-9",
    label: "Layout 9 - bez featured",
    header: "no-cover",
    cover: "none",
    hasSidebar: false,
    centerHeaderDefault: true,
  },
  {
    id: "layout-10",
    label: "Layout 10 - niski hero",
    header: "above-cover",
    cover: "ratio",
    hasSidebar: false,
    featuredRatioKey: "featured_ratio_l10",
    recommendedImage: { width: 1600, height: 720, ratio: "20:9" },
  },
  {
    id: "layout-11",
    label: "Layout 11 - niski hero + sidebar",
    header: "above-cover",
    cover: "ratio",
    hasSidebar: true,
    featuredRatioKey: "featured_ratio_l11",
    recommendedImage: { width: 1200, height: 540, ratio: "20:9" },
  },
  {
    id: "layout-12",
    label: "Layout 12 - overlay + sidebar",
    header: "overlay",
    cover: "full-bleed",
    hasSidebar: true,
    centerHeaderDefault: true,
    recommendedImage: { width: 1920, height: 1080, ratio: "16:9" },
  },
  {
    // Układ redakcyjny (WSJ): tytuł -> lead -> autor + akcje (gift / Google)
    // -> okładka -> "Z tego materiału dowiesz się". Akcje wędrują do nagłówka,
    // więc strona nie powtarza ich w pasku quick-view ani w rzędzie mobilnym.
    id: "layout-13",
    label: "Layout 13 - editorial (WSJ)",
    header: "above-cover",
    cover: "wide",
    hasSidebar: false,
    headerActions: true,
    recommendedImage: { width: 1600, height: 900, ratio: "16:9" },
  },
];

export const VIDEO_LAYOUTS: LayoutPreset[] = STANDARD_LAYOUTS.slice(0, 5).map((l) => ({
  ...l,
  id: l.id.replace("layout-", "video-"),
}));
export const AUDIO_LAYOUTS: LayoutPreset[] = STANDARD_LAYOUTS.slice(0, 5).map((l) => ({
  ...l,
  id: l.id.replace("layout-", "audio-"),
}));
export const GALLERY_LAYOUTS: LayoutPreset[] = STANDARD_LAYOUTS.slice(0, 3).map((l) => ({
  ...l,
  id: l.id.replace("layout-", "gallery-"),
}));

export function getLayoutSet(format: PostFormat): LayoutPreset[] {
  switch (format) {
    case "video":
      return VIDEO_LAYOUTS;
    case "audio":
      return AUDIO_LAYOUTS;
    case "gallery":
      return GALLERY_LAYOUTS;
    default:
      return STANDARD_LAYOUTS;
  }
}

export function findLayout(format: PostFormat, id: string): LayoutPreset {
  const set = getLayoutSet(format);
  return set.find((l) => l.id === id) ?? set[0];
}

/**
 * Single source of truth for the responsive `sizes` of a post's featured/cover
 * image, derived from the layout preset. Consumed by both the renderer
 * (`PostLayoutRenderer` <img sizes>) and the route loader (the
 * `<link rel="preload" as="image" imagesizes>`), so the preloaded candidate is
 * byte-identical to the painted one - never drift, never a double download.
 *
 * Mirrors the render branches:
 *  - overlay header  -> full-bleed hero        => 100vw
 *  - side-by-side    -> half-width split image  => (max-width: 1024px) 100vw, 50vw
 *  - boxed cover     -> max-w-2xl (672px) box   => (max-width: 768px) 100vw, 672px
 *  - everything else -> wide / ratio / default  => 100vw
 */
export function coverImageSizes(preset: LayoutPreset): string {
  if (preset.header === "overlay") return "100vw";
  if (preset.header === "side-by-side") return "(max-width: 1024px) 100vw, 50vw";
  if (preset.cover === "boxed") return `(max-width: 768px) 100vw, ${BOXED_COVER_MAX_WIDTH}px`;
  return "100vw";
}

/**
 * Czy preset w ogóle maluje obraz wyróżniający. `cover: "none"` i
 * `header: "no-cover"` (Layout 9) to ten sam werdykt widziany z dwóch stron -
 * renderer, podgląd CMS i preload LCP w route musi je czytać tak samo.
 */
export function rendersCover(preset: LayoutPreset): boolean {
  return preset.cover !== "none" && preset.header !== "no-cover";
}

/**
 * Szerokość kolumny czytania (px): globalne ustawienie z panelu, zawężone
 * przez ewentualny limit presetu (Layout 2 - wąski).
 */
export function layoutContentMaxWidth(
  preset: LayoutPreset,
  settings: Pick<PostLayoutSettings, "has_sidebar_max_width" | "no_sidebar_max_width">,
  hasSidebar: boolean,
): number {
  const base = hasSidebar ? settings.has_sidebar_max_width : settings.no_sidebar_max_width;
  return preset.contentMaxWidth ? Math.min(base, preset.contentMaxWidth) : base;
}

/**
 * Proporcja ramki cover jako string do `style.aspectRatio`. Kolejność:
 *  1. preset z konfigurowalnym ratio (l6/l10/l11) - wartość z panelu,
 *  2. hero overlay - filmowy pas 16:8 (tytuł ma trafić w dolną nakładkę),
 *  3. rekomendowany rozmiar grafiki - kadr 1:1 z podpowiedzią w panelu,
 *  4. fallback 16:9.
 * Dzięki punktowi 3 "Grafika: 1600×675px · 16:9" z panelu opisuje dokładnie
 * ten kadr, który zobaczy czytelnik - bez dodatkowego przycięcia.
 */
export function coverAspectRatio(preset: LayoutPreset, ratioPct?: number | null): string {
  if (preset.cover === "ratio" && ratioPct && ratioPct > 0) return `100 / ${ratioPct}`;
  if (preset.header === "overlay") return "16 / 8";
  const rec = preset.recommendedImage;
  if (rec && rec.width > 0 && rec.height > 0) return `${rec.width} / ${rec.height}`;
  return "16 / 9";
}

export interface PostLayoutSettings {
  tenant_id: string;
  standard_layout: string;
  video_layout: string;
  audio_layout: string;
  gallery_layout: string;
  featured_ratio_l6: number;
  featured_ratio_l10: number;
  featured_ratio_l11: number;
  center_header: boolean;
  center_entry_meta: boolean;
  has_sidebar_max_width: number;
  no_sidebar_max_width: number;
  paragraph_spacing_rem: number;
  hyperlink_style: string;
  hyperlink_underline: boolean;
  hyperlink_color: string | null;
  hyperlink_color_dark: string | null;
  underline_color: string | null;
  underline_color_dark: string | null;
  list_style: string;
  wide_align_max_width: number;
  image_caption_left_border: boolean;
  quick_view_info: boolean;
  show_post_tags_bar: boolean;
  show_author_card: boolean;
  show_prev_next: boolean;
  prev_next_mobile_hide: boolean;
  show_bottom_newsletter: boolean;
  show_floating_share_bar: boolean;
  /** Box "Cytuj tę analizę" (Chicago/APA/BibTeX) w stopce wpisu. */
  show_citation: boolean;
  /** Pasek udostępniania zaznaczonego cytatu (select-to-share). */
  show_quote_share: boolean;
  auto_load_next_post: boolean;
  /** Nadpisania włączenia sidebara per preset (id-layoutu -> boolean). */
  layout_sidebar_overrides: Record<string, boolean>;
  /**
   * Źródło prawdy rozmiaru tytułu i zajawki wpisu:
   * - "theme" (domyślne): dziedziczy globalne rozmiary czcionek
   *   (Admin -> Opcje motywu -> Rozmiary czcionek): tytuł = --fs-h1,
   *   zajawka = --fs-lead (responsywność niesie sam token motywu).
   * - "layout": używa wartości px per breakpoint z tego wiersza.
   */
  title_size_source: TitleSizeSource;
  /** Typografia overlay (Layout 4/5/12) - rozmiar tytułu w px per breakpoint. */
  overlay_title_size_base: number;
  overlay_title_size_md: number;
  overlay_title_size_lg: number;
  /** Typografia overlay - rozmiar podtytułu (excerpt) w px per breakpoint. */
  overlay_excerpt_size_base: number;
  overlay_excerpt_size_md: number;
  overlay_excerpt_size_lg: number;
  /** Typografia klasycznego nagłówka (bez overlay) - rozmiar tytułu w px. */
  header_title_size_base: number;
  header_title_size_md: number;
  header_title_size_lg: number;
  /** Typografia klasycznego nagłówka - rozmiar podtytułu (excerpt) w px. */
  header_excerpt_size_base: number;
  header_excerpt_size_md: number;
  header_excerpt_size_lg: number;
}

/** Zwraca efektywną wartość hasSidebar (override -> preset default). */
export function effectiveHasSidebar(
  preset: LayoutPreset,
  settings: Pick<PostLayoutSettings, "layout_sidebar_overrides"> | null | undefined,
  postOverride?: boolean | null,
): boolean {
  if (typeof postOverride === "boolean") return postOverride;
  const ov = settings?.layout_sidebar_overrides?.[preset.id];
  return typeof ov === "boolean" ? ov : preset.hasSidebar;
}

export interface LayoutOverrides {
  layout?: string;
  format?: PostFormat;
  center_header?: boolean;
  show_post_tags_bar?: boolean;
  show_author_card?: boolean;
  show_prev_next?: boolean;
  show_bottom_newsletter?: boolean;
  show_floating_share_bar?: boolean;
  show_citation?: boolean;
  show_quote_share?: boolean;
  auto_load_next_post?: boolean;
  /** Per-wpis nadpisanie sidebara (true/false, null = użyj presetu/globalnego overrideu). */
  has_sidebar?: boolean | null;
}

export function defaultPostLayoutSettings(): PostLayoutSettings {
  return {
    tenant_id: "",
    standard_layout: "layout-1",
    video_layout: "video-1",
    audio_layout: "audio-1",
    gallery_layout: "gallery-1",
    featured_ratio_l6: 150,
    featured_ratio_l10: 45,
    featured_ratio_l11: 45,
    center_header: true,
    center_entry_meta: true,
    has_sidebar_max_width: 760,
    no_sidebar_max_width: 840,
    paragraph_spacing_rem: 1.5,
    hyperlink_style: "bold",
    hyperlink_underline: true,
    hyperlink_color: null,
    hyperlink_color_dark: null,
    underline_color: null,
    underline_color_dark: null,
    list_style: "circle",
    wide_align_max_width: 1600,
    image_caption_left_border: false,
    // Domyślnie OFF: pasek quick-view dublował datę i czas czytania, które
    // PostOverlayMeta pokazuje już przy tytule (audyt UX: "kaskada meta").
    // Redakcja może włączyć per-wpis lub globalnie w ustawieniach layoutu.
    quick_view_info: false,
    show_post_tags_bar: true,
    show_author_card: false,
    show_prev_next: false,
    prev_next_mobile_hide: true,
    show_bottom_newsletter: true,
    show_floating_share_bar: true,
    // Cytowania domyślnie ON - to wyróżnik wiarygodności think-tanku; redakcja
    // może wyłączyć globalnie tutaj lub per-wpis w LayoutOverrides.
    show_citation: true,
    show_quote_share: true,
    auto_load_next_post: false,
    layout_sidebar_overrides: {},
    title_size_source: "theme",
    overlay_title_size_base: 24,
    overlay_title_size_md: 30,
    overlay_title_size_lg: 36,
    overlay_excerpt_size_base: 12,
    overlay_excerpt_size_md: 14,
    overlay_excerpt_size_lg: 16,
    header_title_size_base: 30,
    header_title_size_md: 36,
    header_title_size_lg: 48,
    header_excerpt_size_base: 16,
    header_excerpt_size_md: 18,
    header_excerpt_size_lg: 18,
  };
}

/** Skąd pochodzi rozmiar tytułu/zajawki wpisu. */
export type TitleSizeSource = "theme" | "layout";

/**
 * Tokeny globalnych rozmiarów czcionek (Admin -> Opcje motywu -> Rozmiary
 * czcionek). Fallbacki odpowiadają defaultom `FONT_SIZES_DEFAULTS`, żeby SSR
 * bez wczytanego <ThemeFontSizesStyle/> nie skakał rozmiarem.
 */
const THEME_TITLE_VAR = "var(--fs-h1, 44px)";
const THEME_EXCERPT_VAR = "var(--fs-lead, 18px)";
const THEME_TITLE_LH_VAR = "var(--lh-h1, 1.15)";
const THEME_EXCERPT_LH_VAR = "var(--lh-lead, 1.6)";

/** True, gdy tytuł/zajawka dziedziczą globalne rozmiary czcionek motywu. */
export function inheritsThemeTitleSizes(
  s: Pick<PostLayoutSettings, "title_size_source"> | null | undefined,
): boolean {
  return (s?.title_size_source ?? "theme") === "theme";
}

/**
 * Zwraca CSS custom properties do inline-style, które napędzają responsywne
 * klasy `.overlay-title-typography`, `.overlay-excerpt-typography`,
 * `.header-title-typography`, `.header-excerpt-typography`. Dzięki temu
 * jedno źródło (globalne ustawienia) synchronizuje public renderer
 * (PostLayoutRenderer) i podgląd CMS (LayoutScaffold).
 */
export function overlayTypographyStyle(
  s: Pick<
    PostLayoutSettings,
    | "title_size_source"
    | "overlay_title_size_base"
    | "overlay_title_size_md"
    | "overlay_title_size_lg"
    | "overlay_excerpt_size_base"
    | "overlay_excerpt_size_md"
    | "overlay_excerpt_size_lg"
  >,
): React.CSSProperties {
  if (inheritsThemeTitleSizes(s)) {
    return {
      ["--overlay-title-base" as string]: THEME_TITLE_VAR,
      ["--overlay-title-md" as string]: THEME_TITLE_VAR,
      ["--overlay-title-lg" as string]: THEME_TITLE_VAR,
      ["--overlay-excerpt-base" as string]: THEME_EXCERPT_VAR,
      ["--overlay-excerpt-md" as string]: THEME_EXCERPT_VAR,
      ["--overlay-excerpt-lg" as string]: THEME_EXCERPT_VAR,
      // Interlinia zawsze z motywu - żaden layout nie nadpisuje leading tytułu/leadu.
      ["--overlay-title-lh" as string]: THEME_TITLE_LH_VAR,
      ["--overlay-excerpt-lh" as string]: THEME_EXCERPT_LH_VAR,
    };
  }
  return {
    ["--overlay-title-base" as string]: `${s.overlay_title_size_base}px`,
    ["--overlay-title-md" as string]: `${s.overlay_title_size_md}px`,
    ["--overlay-title-lg" as string]: `${s.overlay_title_size_lg}px`,
    ["--overlay-excerpt-base" as string]: `${s.overlay_excerpt_size_base}px`,
    ["--overlay-excerpt-md" as string]: `${s.overlay_excerpt_size_md}px`,
    ["--overlay-excerpt-lg" as string]: `${s.overlay_excerpt_size_lg}px`,
    ["--overlay-title-lh" as string]: THEME_TITLE_LH_VAR,
    ["--overlay-excerpt-lh" as string]: THEME_EXCERPT_LH_VAR,
  };
}

export function headerTypographyStyle(
  s: Pick<
    PostLayoutSettings,
    | "title_size_source"
    | "header_title_size_base"
    | "header_title_size_md"
    | "header_title_size_lg"
    | "header_excerpt_size_base"
    | "header_excerpt_size_md"
    | "header_excerpt_size_lg"
  >,
): React.CSSProperties {
  if (inheritsThemeTitleSizes(s)) {
    return {
      ["--header-title-base" as string]: THEME_TITLE_VAR,
      ["--header-title-md" as string]: THEME_TITLE_VAR,
      ["--header-title-lg" as string]: THEME_TITLE_VAR,
      ["--header-title-lh" as string]: THEME_TITLE_LH_VAR,
      ["--header-excerpt-base" as string]: THEME_EXCERPT_VAR,
      ["--header-excerpt-md" as string]: THEME_EXCERPT_VAR,
      ["--header-excerpt-lg" as string]: THEME_EXCERPT_VAR,
      ["--header-excerpt-lh" as string]: THEME_EXCERPT_LH_VAR,
    };
  }
  return {
    ["--header-title-base" as string]: `${s.header_title_size_base}px`,
    ["--header-title-md" as string]: `${s.header_title_size_md}px`,
    ["--header-title-lg" as string]: `${s.header_title_size_lg}px`,
    ["--header-excerpt-base" as string]: `${s.header_excerpt_size_base}px`,
    ["--header-excerpt-md" as string]: `${s.header_excerpt_size_md}px`,
    ["--header-excerpt-lg" as string]: `${s.header_excerpt_size_lg}px`,
    ["--header-title-lh" as string]: THEME_TITLE_LH_VAR,
    ["--header-excerpt-lh" as string]: THEME_EXCERPT_LH_VAR,
  };
}

/** Łączy globalne ustawienia z overridem konkretnego wpisu. */
export function mergeOverrides(
  global: PostLayoutSettings,
  overrides: LayoutOverrides | null | undefined,
) {
  if (!overrides) return global;
  return {
    ...global,
    center_header: overrides.center_header ?? global.center_header,
    show_post_tags_bar: overrides.show_post_tags_bar ?? global.show_post_tags_bar,
    show_author_card: overrides.show_author_card ?? global.show_author_card,
    show_prev_next: overrides.show_prev_next ?? global.show_prev_next,
    show_bottom_newsletter: overrides.show_bottom_newsletter ?? global.show_bottom_newsletter,
    show_floating_share_bar: overrides.show_floating_share_bar ?? global.show_floating_share_bar,
    show_citation: overrides.show_citation ?? global.show_citation,
    show_quote_share: overrides.show_quote_share ?? global.show_quote_share,
    auto_load_next_post: overrides.auto_load_next_post ?? global.auto_load_next_post,
  };
}

/** Wybiera aktywny layout (override > globalny dla formatu). */
export function pickLayoutId(
  global: PostLayoutSettings,
  format: PostFormat,
  override?: string | null,
): string {
  if (override) return override;
  switch (format) {
    case "video":
      return global.video_layout;
    case "audio":
      return global.audio_layout;
    case "gallery":
      return global.gallery_layout;
    default:
      return global.standard_layout;
  }
}
