// Presety layoutów strony eksperta (/author/$slug). Mirror `postLayouts.ts`:
// jedno źródło prawdy dla admina, renderera publicznego i inline-edytora.
// Kolejność sekcji + widoczność + tokeny kolorystyczne trzymane w
// `expert_layout_settings` (per tenant). Ekspert może nadpisać wybrane pola
// w `author_profiles.layout_preset` / `layout_overrides`.

export type ExpertLayoutPresetId =
  | "classic"
  | "centered"
  | "magazine"
  | "sidebar-left"
  | "sidebar-right"
  | "minimal"
  | "card-stack"
  | "editorial";

export interface ExpertLayoutPreset {
  id: ExpertLayoutPresetId;
  label_pl: string;
  label_en: string;
  description_pl: string;
  description_en: string;
  heroKind: "split" | "centered" | "cover-overlay" | "sidebar" | "minimal" | "card" | "editorial";
  sidebar: "none" | "left" | "right";
  hasCover: boolean;
  centeredContent: boolean;
}

export const EXPERT_LAYOUT_PRESETS: ExpertLayoutPreset[] = [
  {
    id: "classic",
    label_pl: "Klasyczny",
    label_en: "Classic",
    description_pl: "Ciemny hero z prostokątnym portretem, sekcje wertykalnie.",
    description_en: "Dark hero with rectangular portrait, sections stacked.",
    heroKind: "split",
    sidebar: "none",
    hasCover: true,
    centeredContent: false,
  },
  {
    id: "centered",
    label_pl: "Wycentrowany",
    label_en: "Centered",
    description_pl: "Awatar okrągły, tytuł i bio wycentrowane, wąska kolumna.",
    description_en: "Round avatar, centered title and bio, narrow column.",
    heroKind: "centered",
    sidebar: "none",
    hasCover: false,
    centeredContent: true,
  },
  {
    id: "magazine",
    label_pl: "Magazynowy",
    label_en: "Magazine",
    description_pl: "Duża okładka na całą szerokość, hero pod nią.",
    description_en: "Full-width cover on top, hero below it.",
    heroKind: "cover-overlay",
    sidebar: "none",
    hasCover: true,
    centeredContent: false,
  },
  {
    id: "sidebar-left",
    label_pl: "Sidebar lewy",
    label_en: "Sidebar left",
    description_pl: "Sticky sidebar z kontaktem/socials po lewej.",
    description_en: "Sticky contact/socials sidebar on the left.",
    heroKind: "sidebar",
    sidebar: "left",
    hasCover: false,
    centeredContent: false,
  },
  {
    id: "sidebar-right",
    label_pl: "Sidebar prawy",
    label_en: "Sidebar right",
    description_pl: "Odwrócony wariant - sidebar po prawej.",
    description_en: "Mirrored variant - sidebar on the right.",
    heroKind: "sidebar",
    sidebar: "right",
    hasCover: false,
    centeredContent: false,
  },
  {
    id: "minimal",
    label_pl: "Minimalistyczny",
    label_en: "Minimal",
    description_pl: "Bez okładki, typograficzny, akcent linią.",
    description_en: "No cover, typographic, thin accent line.",
    heroKind: "minimal",
    sidebar: "none",
    hasCover: false,
    centeredContent: false,
  },
  {
    id: "card-stack",
    label_pl: "Karty",
    label_en: "Card stack",
    description_pl: "Każda sekcja w karcie z delikatnym cieniem.",
    description_en: "Each section wrapped in a soft-shadow card.",
    heroKind: "card",
    sidebar: "none",
    hasCover: false,
    centeredContent: false,
  },
  {
    id: "editorial",
    label_pl: "Redakcyjny",
    label_en: "Editorial",
    description_pl: "Okładka z overlayem, cytat wstępny, serif.",
    description_en: "Cover with overlay, pull-quote, serif accents.",
    heroKind: "editorial",
    sidebar: "none",
    hasCover: true,
    centeredContent: false,
  },
];

export const EXPERT_SECTIONS = [
  "hero_cover",
  "expertise_bar",
  "details",
  "social_row",
  "contact_card",
  "media_mentions",
  "podcast_strip",
  "materials",
  "cv",
  "programs",
] as const;

export type ExpertSectionKey = (typeof EXPERT_SECTIONS)[number];

export interface ExpertLayoutSettings {
  tenant_id: string;
  default_preset: ExpertLayoutPresetId;
  center_hero: boolean;
  center_details: boolean;
  max_width: number;
  section_order: ExpertSectionKey[];
  show_hero_cover: boolean;
  show_expertise_bar: boolean;
  show_details: boolean;
  show_social_row: boolean;
  show_contact_card: boolean;
  show_media_mentions: boolean;
  show_podcast_strip: boolean;
  show_materials: boolean;
  show_cv: boolean;
  show_programs: boolean;
  hero_bg_color: string | null;
  hero_bg_color_dark: string | null;
  hero_text_color: string | null;
  hero_text_color_dark: string | null;
  accent_color: string | null;
  accent_color_dark: string | null;
  bio_bullet_color: string | null;
  bio_bullet_color_dark: string | null;
  name_size_base: number;
  name_size_lg: number;
  role_size_base: number;
  role_size_lg: number;
}

export const DEFAULT_EXPERT_SECTION_ORDER: ExpertSectionKey[] = [
  "hero_cover",
  "expertise_bar",
  "details",
  "social_row",
  "contact_card",
  "media_mentions",
  "podcast_strip",
  "materials",
  "cv",
  "programs",
];

export function defaultExpertLayoutSettings(tenantId = ""): ExpertLayoutSettings {
  return {
    tenant_id: tenantId,
    default_preset: "classic",
    center_hero: false,
    center_details: false,
    max_width: 1200,
    section_order: DEFAULT_EXPERT_SECTION_ORDER,
    show_hero_cover: true,
    show_expertise_bar: true,
    show_details: true,
    show_social_row: true,
    show_contact_card: true,
    show_media_mentions: true,
    show_podcast_strip: true,
    show_materials: true,
    show_cv: true,
    show_programs: true,
    hero_bg_color: null,
    hero_bg_color_dark: null,
    hero_text_color: null,
    hero_text_color_dark: null,
    accent_color: null,
    accent_color_dark: null,
    bio_bullet_color: null,
    bio_bullet_color_dark: null,
    name_size_base: 36,
    name_size_lg: 48,
    role_size_base: 16,
    role_size_lg: 18,
  };
}

export interface ExpertLayoutOverrides {
  preset?: ExpertLayoutPresetId;
  section_order?: ExpertSectionKey[];
  center_hero?: boolean;
  center_details?: boolean;
  accent_color?: string | null;
  accent_color_dark?: string | null;
  visibility?: Partial<Record<ExpertSectionKey, boolean>>;
}

export function findExpertPreset(id: string | null | undefined): ExpertLayoutPreset {
  return EXPERT_LAYOUT_PRESETS.find((p) => p.id === id) ?? EXPERT_LAYOUT_PRESETS[0];
}

export function mergeExpertLayout(
  tenant: ExpertLayoutSettings,
  expertOverrides: ExpertLayoutOverrides | null | undefined,
): { preset: ExpertLayoutPreset; settings: ExpertLayoutSettings } {
  const ov = expertOverrides ?? {};
  const preset = findExpertPreset(ov.preset ?? tenant.default_preset);
  const visibility = ov.visibility ?? {};
  const merged: ExpertLayoutSettings = {
    ...tenant,
    default_preset: preset.id,
    center_hero: ov.center_hero ?? tenant.center_hero,
    center_details: ov.center_details ?? tenant.center_details,
    section_order: ov.section_order ?? tenant.section_order,
    accent_color: ov.accent_color ?? tenant.accent_color,
    accent_color_dark: ov.accent_color_dark ?? tenant.accent_color_dark,
    show_hero_cover: visibility.hero_cover ?? tenant.show_hero_cover,
    show_expertise_bar: visibility.expertise_bar ?? tenant.show_expertise_bar,
    show_details: visibility.details ?? tenant.show_details,
    show_social_row: visibility.social_row ?? tenant.show_social_row,
    show_contact_card: visibility.contact_card ?? tenant.show_contact_card,
    show_media_mentions: visibility.media_mentions ?? tenant.show_media_mentions,
    show_podcast_strip: visibility.podcast_strip ?? tenant.show_podcast_strip,
    show_materials: visibility.materials ?? tenant.show_materials,
    show_cv: visibility.cv ?? tenant.show_cv,
    show_programs: visibility.programs ?? tenant.show_programs,
  };
  return { preset, settings: merged };
}

export function isSectionVisible(s: ExpertLayoutSettings, key: ExpertSectionKey): boolean {
  const map: Record<ExpertSectionKey, boolean> = {
    hero_cover: s.show_hero_cover,
    expertise_bar: s.show_expertise_bar,
    details: s.show_details,
    social_row: s.show_social_row,
    contact_card: s.show_contact_card,
    media_mentions: s.show_media_mentions,
    podcast_strip: s.show_podcast_strip,
    materials: s.show_materials,
    cv: s.show_cv,
    programs: s.show_programs,
  };
  return map[key];
}
