// Pure per-entity SEO completeness assessment for the /admin/seo overview.
// One transparent rule set turns a content row into per-language field states
// and a 0-100 score, so the overview table, the summary tiles and the filters
// all agree. Framework-free and unit-tested.
import type { SeoFieldsRow } from "@/lib/seo/fields";
import { serpTitleMetric } from "@/lib/seo/serp";

export interface SeoStatusInput extends SeoFieldsRow {
  title_pl: string;
  title_en: string;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  cover_image_url: string | null;
}

type DescriptionSource = "override" | "excerpt" | "missing";
type SocialImageSource = "override" | "cover" | "card" | "default";
export type SeoGrade = "good" | "warn" | "poor";

export interface SeoContentStatus {
  titleOverride: { pl: boolean; en: boolean };
  description: { pl: DescriptionSource; en: DescriptionSource };
  socialImage: SocialImageSource;
  noindex: boolean;
  canonicalOverride: boolean;
  /**
   * Tytuły PL i EN, które naprawdę trafią do Google (nadpisanie albo tytuł
   * treści), mieszczą się w budżecie ~600 px.
   */
  titleFits: boolean;
  /** 0-100 completeness (descriptions 2x25, image 20, titles fit 15, indexable 15). */
  score: number;
  grade: SeoGrade;
}

/**
 * Pasma oceny 0-100 -> `good` / `warn` / `poor`.
 *
 * JEDEN WŁAŚCICIEL PROGÓW. Kokpit SEO liczy wynik marki własnym modułem
 * (`brandAudit`), ale plakietkę rysuje tą samą skalą, co tabela treści.
 * Dopóki obie strony miały własną kopię tego wyrażenia, ta sama liczba mogła
 * zapalić dwa różne kolory w dwóch miejscach panelu - bez żadnego objawu poza
 * tym, że redakcja widzi sprzeczność.
 */
export function seoGrade(score: number): SeoGrade {
  return score >= 80 ? "good" : score >= 50 ? "warn" : "poor";
}

function has(value: string | null | undefined): boolean {
  return !!value && value.trim().length > 0;
}

function descriptionSource(
  override: string | null | undefined,
  excerpt: string | null | undefined,
): DescriptionSource {
  if (has(override)) return "override";
  if (has(excerpt)) return "excerpt";
  return "missing";
}

/** Assess one post/page row. */
export function seoContentStatus(row: SeoStatusInput): SeoContentStatus {
  const description = {
    pl: descriptionSource(row.seo_description_pl, row.excerpt_pl),
    en: descriptionSource(row.seo_description_en, row.excerpt_en),
  };
  const socialImage: SocialImageSource = has(row.seo_og_image_url)
    ? "override"
    : has(row.cover_image_url)
      ? "cover"
      : has(row.og_image_generated_url)
        ? "card"
        : "default";
  const titleOverride = { pl: has(row.seo_title_pl), en: has(row.seo_title_en) };
  const noindex = !!row.seo_noindex;
  // Punkty za TYTUŁ, który Google pokaże w całości - nie za samo nadpisanie.
  // Dawne „+15 za dowolny tytuł SEO" pchało redakcję do nadpisywania, a
  // nadpisanie po cichu zdejmuje sufiks marki (`applyTitleSuffix`).
  const servedTitle = (lang: "pl" | "en"): string => {
    const other = lang === "pl" ? "en" : "pl";
    return (
      row[`seo_title_${lang}`]?.trim() ||
      row[`title_${lang}`]?.trim() ||
      row[`title_${other}`]?.trim() ||
      ""
    );
  };
  const titleFits = (["pl", "en"] as const).every((lang) => {
    const title = servedTitle(lang);
    return title !== "" && serpTitleMetric(title).grade !== "long";
  });

  let score = 0;
  if (description.pl !== "missing") score += 25;
  if (description.en !== "missing") score += 25;
  if (socialImage !== "default") score += 20;
  if (titleFits) score += 15;
  if (!noindex) score += 15;

  return {
    titleOverride,
    description,
    socialImage,
    noindex,
    canonicalOverride: has(row.seo_canonical_url),
    titleFits,
    score,
    grade: seoGrade(score),
  };
}

/** Aggregate counters for the overview summary tiles. */
export interface SeoOverviewSummary {
  total: number;
  missingDescription: number;
  defaultImage: number;
  noindexed: number;
  withOverrides: number;
}

export function summarizeSeoStatuses(statuses: readonly SeoContentStatus[]): SeoOverviewSummary {
  const summary: SeoOverviewSummary = {
    total: statuses.length,
    missingDescription: 0,
    defaultImage: 0,
    noindexed: 0,
    withOverrides: 0,
  };
  for (const s of statuses) {
    if (s.description.pl === "missing" || s.description.en === "missing") {
      summary.missingDescription += 1;
    }
    if (s.socialImage === "default") summary.defaultImage += 1;
    if (s.noindex) summary.noindexed += 1;
    if (
      s.titleOverride.pl ||
      s.titleOverride.en ||
      s.description.pl === "override" ||
      s.description.en === "override"
    ) {
      summary.withOverrides += 1;
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Powielone opisy
// ---------------------------------------------------------------------------

/** Wiersz do wykrywania duplikatów - klucz jednoznaczny w obrębie raportu. */
export interface DescriptionDuplicateInput {
  key: string;
  excerpt_pl: string | null | undefined;
  excerpt_en: string | null | undefined;
  seo_description_pl: string | null | undefined;
  seo_description_en: string | null | undefined;
}

/** Krótsze opisy („Czytaj więcej", „Wkrótce") nie świadczą o skopiowaniu. */
const DUPLICATE_MIN_CHARS = 40;

function normalizeDescription(raw: string | null | undefined): string | null {
  const clean = (raw ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return clean.length >= DUPLICATE_MIN_CHARS ? clean : null;
}

/**
 * Treści, których opis (nadpisanie SEO, a bez niego zajawka - w TYM SAMYM
 * języku) jest identyczny z opisem innej treści. Wynik: klucz wiersza -> klucze
 * pozostałych wierszy z tym samym opisem.
 *
 * Po co: zajawka skopiowana z innego artykułu (import WordPressa dopasowany po
 * slugu, duplikat wpisu, autozapis z poprzednio otwartego wpisu) daje w Google
 * dwa identyczne snippety - i nic w panelu tego nie pokazywało.
 */
export function findDuplicateDescriptions(
  rows: readonly DescriptionDuplicateInput[],
): Map<string, string[]> {
  const byText = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const lang of ["pl", "en"] as const) {
      const text = normalizeDescription(
        row[`seo_description_${lang}`]?.trim()
          ? row[`seo_description_${lang}`]
          : row[`excerpt_${lang}`],
      );
      if (!text) continue;
      const bucket = `${lang}\u0000${text}`;
      const keys = byText.get(bucket) ?? new Set<string>();
      keys.add(row.key);
      byText.set(bucket, keys);
    }
  }
  const out = new Map<string, string[]>();
  for (const keys of byText.values()) {
    if (keys.size < 2) continue;
    for (const key of keys) {
      const others = new Set(out.get(key) ?? []);
      for (const other of keys) if (other !== key) others.add(other);
      out.set(key, [...others]);
    }
  }
  return out;
}
