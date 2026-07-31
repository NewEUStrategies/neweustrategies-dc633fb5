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

/**
 * Historyczne id presetów (pierwotny CHECK z migracji 20260713212243) mapowane
 * na obecny zestaw. Aliasowanie w odczycie chroni wiersze zapisane przed
 * remapem danych (20260731210000) oraz payloady z cache/SSR sprzed deployu.
 */
export const LEGACY_EXPERT_PRESET_ALIASES: Readonly<Record<string, ExpertLayoutPresetId>> = {
  "portrait-left": "classic",
  "full-bleed-cover": "magazine",
  "centered-minimal": "centered",
  "split-columns": "sidebar-left",
  "sidebar-rail": "sidebar-right",
};

export function isExpertLayoutPresetId(value: unknown): value is ExpertLayoutPresetId {
  return typeof value === "string" && EXPERT_LAYOUT_PRESETS.some((preset) => preset.id === value);
}

export function isExpertSectionKey(value: unknown): value is ExpertSectionKey {
  return typeof value === "string" && (EXPERT_SECTIONS as readonly string[]).includes(value);
}

/** Id presetu z dowolnej wartości: obecne id wprost, legacy przez alias. */
export function resolveExpertPresetId(value: unknown): ExpertLayoutPresetId | null {
  if (isExpertLayoutPresetId(value)) return value;
  if (typeof value === "string" && value in LEGACY_EXPERT_PRESET_ALIASES) {
    return LEGACY_EXPERT_PRESET_ALIASES[value];
  }
  return null;
}

export function findExpertPreset(id: string | null | undefined): ExpertLayoutPreset {
  const resolved = resolveExpertPresetId(id) ?? id;
  return EXPERT_LAYOUT_PRESETS.find((p) => p.id === resolved) ?? EXPERT_LAYOUT_PRESETS[0];
}

// Wartości kolorów lądują w scoped `<style>` (ExpertLayoutStyleScope używa
// dangerouslySetInnerHTML), a z inline-edytorem pochodzą też od ekspertów,
// nie tylko od staffu. Biała lista znaków wyklucza `;{}<>:"'` - nie da się
// ani domknąć deklaracji/bloku CSS, ani przemycić url()/data: (dwukropek).
const CSS_COLOR_SAFE_RE = /^[a-zA-Z0-9#%(),.\s/+*-]{1,64}$/;

/** Przytnij i zwaliduj kolor CSS; wartości spoza białej listy -> null. */
export function sanitizeCssColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && CSS_COLOR_SAFE_RE.test(trimmed) ? trimmed : null;
}

/**
 * Znormalizuj kolejność sekcji do pełnej permutacji EXPERT_SECTIONS:
 * odfiltruj nieznane klucze i duplikaty, brakujące sekcje doklej na końcu
 * w kolejności domyślnej. Renderer iteruje po tej liście, więc niepełny
 * zapis nigdy nie może "zgubić" sekcji.
 */
export function normalizeExpertSectionOrder(value: unknown): ExpertSectionKey[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<ExpertSectionKey>();
  const order: ExpertSectionKey[] = [];
  for (const item of value) {
    if (isExpertSectionKey(item) && !seen.has(item)) {
      seen.add(item);
      order.push(item);
    }
  }
  if (order.length === 0) return null;
  for (const key of DEFAULT_EXPERT_SECTION_ORDER) {
    if (!seen.has(key)) order.push(key);
  }
  return order;
}

/**
 * Bezpieczny parsing nadpisań per-ekspert z bazy: `author_profiles.layout_preset`
 * (kolumna z CHECK) + `author_profiles.layout_overrides` (jsonb). Kolumna
 * presetu wygrywa z kluczem `preset` w jsonb. Nieznane klucze, złe typy i
 * niebezpieczne kolory odpadają po cichu - zwracany obiekt zawiera wyłącznie
 * pola faktycznie nadpisane, a pusty wynik składa się do `null`.
 */
export function parseExpertLayoutOverrides(
  raw: unknown,
  presetColumn?: string | null,
): ExpertLayoutOverrides | null {
  const source =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const out: ExpertLayoutOverrides = {};

  const preset = resolveExpertPresetId(presetColumn) ?? resolveExpertPresetId(source.preset);
  if (preset) out.preset = preset;

  const order = normalizeExpertSectionOrder(source.section_order);
  if (order) out.section_order = order;

  if (typeof source.center_hero === "boolean") out.center_hero = source.center_hero;
  if (typeof source.center_details === "boolean") out.center_details = source.center_details;

  const accent = sanitizeCssColor(source.accent_color);
  if (accent) out.accent_color = accent;
  const accentDark = sanitizeCssColor(source.accent_color_dark);
  if (accentDark) out.accent_color_dark = accentDark;

  const rawVisibility = source.visibility;
  if (
    typeof rawVisibility === "object" &&
    rawVisibility !== null &&
    !Array.isArray(rawVisibility)
  ) {
    const visibility: Partial<Record<ExpertSectionKey, boolean>> = {};
    for (const [key, value] of Object.entries(rawVisibility)) {
      if (isExpertSectionKey(key) && typeof value === "boolean") visibility[key] = value;
    }
    if (Object.keys(visibility).length > 0) out.visibility = visibility;
  }

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Draft inline-edytora publikowany do strony /author/$slug: obecność obiektu
 * oznacza tryb podglądu na żywo (strona renderuje draft zamiast zapisanych
 * nadpisań), `overrides: null` w drafcie = podgląd pełnego dziedziczenia.
 */
export interface ExpertLayoutDraft {
  overrides: ExpertLayoutOverrides | null;
}

/** Liczba aktywnych nadpisań - badge w inline-edytorze i telemetria UX. */
export function countExpertLayoutOverrides(
  overrides: ExpertLayoutOverrides | null | undefined,
): number {
  if (!overrides) return 0;
  let count = 0;
  if (overrides.preset) count += 1;
  if (overrides.section_order) count += 1;
  if (typeof overrides.center_hero === "boolean") count += 1;
  if (typeof overrides.center_details === "boolean") count += 1;
  if (typeof overrides.accent_color === "string") count += 1;
  if (typeof overrides.accent_color_dark === "string") count += 1;
  count += Object.keys(overrides.visibility ?? {}).length;
  return count;
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
