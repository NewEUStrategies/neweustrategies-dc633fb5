// Term organizacji i jego teksty w języku strony - wydzielone z
// `queries/organization.ts`, bo czyta je `head()` trasy `/organization/$slug`,
// a `head()` zostaje w shellu trasy, czyli w chunku wejściowym KAŻDEGO
// czytelnika. Import `organization.ts` ciągnął tam klienta zapytań profilu
// (4,6 KB przed minifikacją, pomiar entry 2026-10-02) dla dwóch funkcji na
// stringach. `organization.ts` re-eksportuje wszystko, co tu mieszka.

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
