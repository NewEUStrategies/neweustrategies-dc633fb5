// Fixture'y huba eksperta.
//
// Ładunek huba (`ExpertHubData`) ma ~10 pól najwyższego poziomu i profil
// o ~20 kolumnach, więc wpisany w każdy plik testowy z osobna rozjeżdża się
// przy pierwszej zmianie kontraktu - i rozjeżdża się CICHO, bo `as` w teście
// nikogo nie ostrzeże. Stąd jeden budownik, tak samo jak przy czacie, profilu
// i sieci kontaktów.
import { defaultExpertLayoutSettings, type ExpertLayoutSettings } from "@/lib/expertLayouts";
import type {
  ExpertHubData,
  ExpertMaterial,
  ExpertProgram,
  ExpertiseArea,
  MediaMention,
} from "@/lib/experts/types";

export const EXPERT_IDS = {
  user: "11111111-1111-4111-8111-111111111111",
  tenant: "22222222-2222-4222-8222-222222222222",
} as const;

export type ExpertProfile = ExpertHubData["expert"];

/**
 * Nadpisania huba przyjmują profil CZĘŚCIOWY - inaczej każdy test musiałby
 * powtarzać komplet ~22 kolumn albo rzutować przez `as never`, a to pierwszy
 * krok do fixture'a, który nie zgadza się z kontraktem i nikogo nie ostrzega.
 */
export type ExpertHubOverrides = Omit<Partial<ExpertHubData>, "expert"> & {
  expert?: Partial<ExpertProfile>;
};

/** Profil eksperta - domyślnie MINIMALNY (same wymagane pola, reszta pusta). */
export function expertProfile(overrides: Partial<ExpertProfile> = {}): ExpertProfile {
  return {
    id: EXPERT_IDS.user,
    tenant_id: EXPERT_IDS.tenant,
    slug: "anna-kowalska",
    display_name: "Anna Kowalska",
    avatar_url: null,
    cover_url: null,
    job_title: null,
    company: null,
    bio_pl: null,
    bio_en: null,
    full_bio_pl: null,
    full_bio_en: null,
    org_functions: [],
    verified_at: null,
    updated_at: null,
    is_expert: true,
    expert_requests_enabled: true,
    contact_email: null,
    website_url: null,
    twitter_url: null,
    linkedin_url: null,
    media_contact_name: null,
    media_contact_email: null,
    ...overrides,
  } as ExpertProfile;
}

export function expertHub(overrides: ExpertHubOverrides = {}): ExpertHubData {
  // `expert` wyjmujemy Z NAZWY, a nie zostawiamy w rozwinięciu: wywołanie
  // `expertHub({ expert: undefined })` (typowe dla budownika testowego, który
  // przekazuje dalej opcjonalny parametr) inaczej nadpisałoby zbudowany profil
  // wartością `undefined` i komponent wywracał się na `e.display_name`.
  const { expert, ...rest } = overrides;
  return {
    programs: [],
    areas: [],
    mediaMentions: [],
    materials: [],
    facets: { programs: [], regions: [], categories: [], tags: [] },
    ...rest,
    expert: expertProfile(expert),
  } as ExpertHubData;
}

export function expertSettings(
  overrides: Partial<ExpertLayoutSettings> = {},
): ExpertLayoutSettings {
  return { ...defaultExpertLayoutSettings(EXPERT_IDS.tenant), ...overrides };
}

export function expertArea(overrides: Partial<ExpertiseArea> = {}): ExpertiseArea {
  return { id: "a1", slug: "energia", name_pl: "Energia", name_en: "Energy", ...overrides };
}

/**
 * Program eksperta. `kind: "department"` to NIE jest kosmetyka - `ExpertHubDetails`
 * rozdziela po nim jednostkę organizacyjną od projektu badawczego, więc każdy
 * test kolejności sekcji musi umieć ustawić to pole bez rzutowania.
 */
export function expertProgram(overrides: Partial<ExpertProgram> = {}): ExpertProgram {
  return {
    id: "p1",
    slug: "klimat",
    name_pl: "Klimat",
    name_en: "Climate",
    kind: "program",
    description_pl: null,
    description_en: null,
    role_pl: "Kierowniczka",
    role_en: "Lead",
    ...overrides,
  };
}

export function expertMention(overrides: Partial<MediaMention> = {}): MediaMention {
  return {
    id: "m1",
    outlet: "Rzeczpospolita",
    title: "Komentarz o pakiecie energetycznym",
    url: "https://rp.example/artykul",
    kind: "quote",
    language: "pl",
    published_on: "2026-07-15",
    cover_url: null,
    ...overrides,
  } as MediaMention;
}

export function expertMaterial(overrides: Partial<ExpertMaterial> = {}): ExpertMaterial {
  return {
    id: "x1",
    kind: "article",
    href: "/blog/analiza",
    title_pl: "Analiza pakietu",
    title_en: "Package analysis",
    excerpt_pl: "Streszczenie analizy",
    excerpt_en: "Analysis summary",
    cover_url: null,
    date: "2026-07-01",
    programIds: [],
    regionIds: [],
    categoryIds: [],
    tagIds: [],
    isCoauthor: false,
    ...overrides,
  };
}
