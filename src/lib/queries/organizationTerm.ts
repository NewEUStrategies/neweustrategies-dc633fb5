// Term organizacji i jego teksty w języku strony - wydzielone z
// `queries/organization.ts`, bo czyta je `head()` trasy `/organization/$slug`,
// a `head()` zostaje w shellu trasy, czyli w chunku wejściowym KAŻDEGO
// czytelnika. Import `organization.ts` ciągnął tam klienta zapytań profilu
// (4,6 KB przed minifikacją, pomiar entry 2026-10-02) dla dwóch funkcji na
// stringach. `organization.ts` re-eksportuje term i jego teksty.

/** Term organizacji - dokładnie te kolumny `categories`, które widać na stronie. */
export interface OrganizationTerm {
  id: string;
  slug: string;
  name_pl: string;
  name_en: string;
  description_pl: string | null;
  description_en: string | null;
  logo_url: string | null;
  color: string | null;
}

/** Tekst po normalizacji białych znaków; pusty i nie-string dają `null`. */
export function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
}

/** Nazwa organizacji w języku strony, z fallbackiem na drugi wariant. */
export function organizationName(term: OrganizationTerm, lang: "pl" | "en"): string {
  const primary = lang === "en" ? term.name_en : term.name_pl;
  const secondary = lang === "en" ? term.name_pl : term.name_en;
  return cleanText(primary) ?? cleanText(secondary) ?? term.slug;
}

/** Opis w języku strony. `null` = element opisu znika w całości. */
export function organizationDescription(term: OrganizationTerm, lang: "pl" | "en"): string | null {
  const primary = lang === "en" ? term.description_en : term.description_pl;
  const secondary = lang === "en" ? term.description_pl : term.description_en;
  return cleanText(primary) ?? cleanText(secondary);
}

/** Teksty profilu organizacji, których potrzebuje `head()`. */
export interface OrganizationPageCopy {
  /** Nazwa zastępcza, gdy loader nie oddał organizacji (degradacja, 404). */
  readonly fallbackName: string;
  /** Człon tytułu karty: „NATO - organizacja". */
  readonly titleSuffix: string;
  /** Słowo przed numerem strony listy w tytule: „(strona 3)". */
  readonly pageLabel: string;
  /** Pierwszy okruszek - ten sam w JSON-LD i w widocznej nawigacji. */
  readonly breadcrumb: string;
  /** Opis meta, gdy term nie ma własnego. */
  readonly descriptionFallback: (name: string) => string;
}

/**
 * Teksty `head()` jako stała mapa PL/EN, a nie słownik i18n - z dwóch powodów,
 * tych samych co w `lib/clubs/applyHead.ts`: `head()` biegnie poza drzewem
 * Reacta (język bierzemy z adresu, nie z singletona i18next) i zostaje
 * w shellu trasy, czyli w chunku wejściowym każdego czytelnika - import
 * `i18n-organizations` wciągnąłby tam cały słownik profilu. Do 2026-10-02 te
 * same napisy siedziały w trasie jako warunki `isEn ? … : …`, a nakładka miała
 * ich martwe kopie; dziś nakładka czyta okruszek STĄD, więc widoczna
 * nawigacja i dane strukturalne nie mogą się rozjechać.
 */
export const ORGANIZATION_PAGE_COPY: Readonly<Record<"pl" | "en", OrganizationPageCopy>> = {
  pl: {
    fallbackName: "Organizacja",
    titleSuffix: "organizacja",
    pageLabel: "strona",
    breadcrumb: "Organizacje",
    descriptionFallback: (name) => `${name} - profil organizacji w New European Strategies.`,
  },
  en: {
    fallbackName: "Organization",
    titleSuffix: "organization",
    pageLabel: "page",
    breadcrumb: "Organizations",
    descriptionFallback: (name) => `${name} - organization profile at New European Strategies.`,
  },
};
