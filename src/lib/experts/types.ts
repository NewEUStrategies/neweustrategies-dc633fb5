// Typy huba eksperta (profil think-tank-style). Ekspert jest obiektem systemowym
// spinającym własne materiały, programy, obszary i obecność medialną - te
// typy opisują znormalizowany kształt konsumowany przez UI.

export type MaterialKind = "article" | "report" | "video" | "podcast" | "event";

/** Funkcja organizacyjna spoza programów (np. "Członkini zarządu"). */
export interface OrgFunction {
  pl: string;
  en: string;
}

/** Program / projekt / departament z funkcją eksperta w nim. */
export interface ExpertProgram {
  id: string;
  slug: string;
  name_pl: string;
  name_en: string;
  kind: "program" | "project" | "department";
  description_pl: string | null;
  description_en: string | null;
  role_pl: string | null;
  role_en: string | null;
}

export interface ExpertiseArea {
  id: string;
  slug: string;
  name_pl: string;
  name_en: string;
}

export interface RegionMeta {
  id: string;
  slug: string;
  name_pl: string;
  name_en: string;
}

export interface CategoryMeta {
  id: string;
  slug: string;
  name_pl: string;
  name_en: string;
}

export type MediaMentionKind =
  | "quote"
  | "interview"
  | "appearance"
  | "oped"
  | "podcast_guest";

export interface MediaMention {
  id: string;
  outlet: string;
  title: string;
  url: string | null;
  kind: MediaMentionKind;
  language: string | null;
  published_on: string;
}

/** Rdzeń huba: tożsamość eksperta + kontakty (bezpośredni i dla mediów). */
export interface ExpertProfile {
  id: string;
  /** tenant_id z `profiles` - pozwala dobrać właściwe `expert_layout_settings`. */
  tenant_id: string | null;
  slug: string | null;
  display_name: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  job_title: string | null;
  company: string | null;
  bio_pl: string | null;
  bio_en: string | null;
  full_bio_pl: string | null;
  full_bio_en: string | null;
  org_functions: OrgFunction[];
  verified_at: string | null;
  /** ISO timestamp - używany jako cache-buster og:image (`?v=...`). */
  updated_at: string | null;
  is_expert: boolean;
  // Kontakt bezpośredni
  contact_email: string | null;
  website_url: string | null;
  twitter_url: string | null;
  linkedin_url: string | null;
  // Kontakt dla mediów
  media_contact_name: string | null;
  media_contact_email: string | null;
  media_contact_phone: string | null;
}

/** Znormalizowany materiał w eksploratorze (publikacja/raport/wideo/podcast/wydarzenie). */
export interface ExpertMaterial {
  id: string;
  kind: MaterialKind;
  title_pl: string;
  title_en: string;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  cover_url: string | null;
  /** ISO; publikacje → published_at, wydarzenia → starts_at. */
  date: string | null;
  href: string;
  programIds: string[];
  regionIds: string[];
  categoryIds: string[];
  /** Wpis, w którym ekspert jest współautorem (nie autorem głównym). */
  isCoauthor: boolean;
}

/** Pełny ładunek huba - jedna jednostka danych dla strony profilu. */
export interface ExpertHubData {
  expert: ExpertProfile;
  programs: ExpertProgram[];
  areas: ExpertiseArea[];
  mediaMentions: MediaMention[];
  materials: ExpertMaterial[];
  // Fasety zredukowane do wartości faktycznie obecnych w materiałach.
  facets: {
    programs: ExpertProgram[];
    regions: RegionMeta[];
    categories: CategoryMeta[];
  };
}

/** Aktywne filtry eksploratora materiałów. */
export interface MaterialFilters {
  kind: MaterialKind | null;
  programId: string | null;
  regionId: string | null;
  categoryId: string | null;
  /** Rok (YYYY) lub null. */
  year: number | null;
}

export const EMPTY_MATERIAL_FILTERS: MaterialFilters = {
  kind: null,
  programId: null,
  regionId: null,
  categoryId: null,
  year: null,
};
