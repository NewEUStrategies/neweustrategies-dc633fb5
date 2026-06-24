// Centralne definicje layoutów Foxiz-like dla pojedynczego wpisu.
// 11 układów dla Standard, 4 dla Video/Audio, 3 dla Gallery.
// Definicje są PRESETAMI - decydują o pozycji nagłówka, croppingu cover,
// szerokości treści i obecności sidebara. Renderer (PostLayoutRenderer)
// mapuje preset na klasy/elementy.

export type PostFormat = "standard" | "video" | "audio" | "gallery";

export interface LayoutPreset {
  id: string;
  label: string;
  /** Pozycja nagłówka względem cover image */
  header: "above-cover" | "below-cover" | "overlay" | "side-by-side" | "no-cover";
  /** Sposób wyświetlenia obrazu wyróżniającego */
  cover:
    | "wide" // pełna szerokość kontenera
    | "full-bleed" // pełna szerokość ekranu
    | "boxed" // ograniczona do max-width
    | "side" // obok nagłówka
    | "ratio" // konfigurowalny ratio (l6/l10/l11)
    | "none";
  /** Czy układ pokazuje sidebar (placeholder) */
  hasSidebar: boolean;
  /** Centrowanie nagłówka domyślnie (może być nadpisane globalnym setting) */
  centerHeaderDefault?: boolean;
  /** Klucz featured-ratio z post_layout_settings dla layoutu */
  featuredRatioKey?: "featured_ratio_l6" | "featured_ratio_l10" | "featured_ratio_l11";
}

export const STANDARD_LAYOUTS: LayoutPreset[] = [
  { id: "layout-1", label: "Layout 1 — klasyczny", header: "above-cover", cover: "wide", hasSidebar: false },
  { id: "layout-1a", label: "Layout 1(a) — bez excerpt", header: "above-cover", cover: "wide", hasSidebar: false },
  { id: "layout-2", label: "Layout 2 — wąski", header: "above-cover", cover: "boxed", hasSidebar: false, centerHeaderDefault: true },
  { id: "layout-3", label: "Layout 3 — z sidebar", header: "above-cover", cover: "wide", hasSidebar: true },
  { id: "layout-4", label: "Layout 4 — overlay", header: "overlay", cover: "full-bleed", hasSidebar: false, centerHeaderDefault: true },
  { id: "layout-5", label: "Layout 5 — overlay narrow", header: "overlay", cover: "wide", hasSidebar: false, centerHeaderDefault: true },
  { id: "layout-6", label: "Layout 6 — duży cover", header: "above-cover", cover: "ratio", hasSidebar: false, featuredRatioKey: "featured_ratio_l6" },
  { id: "layout-7", label: "Layout 7 — split", header: "side-by-side", cover: "side", hasSidebar: false },
  { id: "layout-8", label: "Layout 8 — magazine", header: "below-cover", cover: "wide", hasSidebar: true },
  { id: "layout-9", label: "Layout 9 — bez featured", header: "no-cover", cover: "none", hasSidebar: false, centerHeaderDefault: true },
  { id: "layout-10", label: "Layout 10 — niski hero", header: "above-cover", cover: "ratio", hasSidebar: false, featuredRatioKey: "featured_ratio_l10" },
  { id: "layout-11", label: "Layout 11 — niski hero + sidebar", header: "above-cover", cover: "ratio", hasSidebar: true, featuredRatioKey: "featured_ratio_l11" },
];

export const VIDEO_LAYOUTS: LayoutPreset[] = STANDARD_LAYOUTS.slice(0, 5).map((l) => ({ ...l, id: l.id.replace("layout-", "video-") }));
export const AUDIO_LAYOUTS: LayoutPreset[] = STANDARD_LAYOUTS.slice(0, 5).map((l) => ({ ...l, id: l.id.replace("layout-", "audio-") }));
export const GALLERY_LAYOUTS: LayoutPreset[] = STANDARD_LAYOUTS.slice(0, 3).map((l) => ({ ...l, id: l.id.replace("layout-", "gallery-") }));

export function getLayoutSet(format: PostFormat): LayoutPreset[] {
  switch (format) {
    case "video": return VIDEO_LAYOUTS;
    case "audio": return AUDIO_LAYOUTS;
    case "gallery": return GALLERY_LAYOUTS;
    default: return STANDARD_LAYOUTS;
  }
}

export function findLayout(format: PostFormat, id: string): LayoutPreset {
  const set = getLayoutSet(format);
  return set.find((l) => l.id === id) ?? set[0];
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
  show_sources_bar: boolean;
  show_via_bar: boolean;
  show_author_card: boolean;
  show_prev_next: boolean;
  prev_next_mobile_hide: boolean;
  show_bottom_newsletter: boolean;
  show_floating_share_bar: boolean;
  auto_load_next_post: boolean;
}

export interface LayoutOverrides {
  layout?: string;
  format?: PostFormat;
  center_header?: boolean;
  show_post_tags_bar?: boolean;
  show_sources_bar?: boolean;
  show_via_bar?: boolean;
  show_author_card?: boolean;
  show_prev_next?: boolean;
  show_bottom_newsletter?: boolean;
  show_floating_share_bar?: boolean;
  auto_load_next_post?: boolean;
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
    quick_view_info: true,
    show_post_tags_bar: true,
    show_sources_bar: true,
    show_via_bar: true,
    show_author_card: false,
    show_prev_next: false,
    prev_next_mobile_hide: true,
    show_bottom_newsletter: true,
    show_floating_share_bar: true,
  };
}

/** Łączy globalne ustawienia z overridem konkretnego wpisu. */
export function mergeOverrides(global: PostLayoutSettings, overrides: LayoutOverrides | null | undefined) {
  if (!overrides) return global;
  return {
    ...global,
    center_header: overrides.center_header ?? global.center_header,
    show_post_tags_bar: overrides.show_post_tags_bar ?? global.show_post_tags_bar,
    show_sources_bar: overrides.show_sources_bar ?? global.show_sources_bar,
    show_via_bar: overrides.show_via_bar ?? global.show_via_bar,
    show_author_card: overrides.show_author_card ?? global.show_author_card,
    show_prev_next: overrides.show_prev_next ?? global.show_prev_next,
    show_bottom_newsletter: overrides.show_bottom_newsletter ?? global.show_bottom_newsletter,
    show_floating_share_bar: overrides.show_floating_share_bar ?? global.show_floating_share_bar,
  };
}

/** Wybiera aktywny layout (override > globalny dla formatu). */
export function pickLayoutId(global: PostLayoutSettings, format: PostFormat, override?: string | null): string {
  if (override) return override;
  switch (format) {
    case "video": return global.video_layout;
    case "audio": return global.audio_layout;
    case "gallery": return global.gallery_layout;
    default: return global.standard_layout;
  }
}
