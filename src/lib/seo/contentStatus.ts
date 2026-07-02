// Pure per-entity SEO completeness assessment for the /admin/seo overview.
// One transparent rule set turns a content row into per-language field states
// and a 0-100 score, so the overview table, the summary tiles and the filters
// all agree. Framework-free and unit-tested.
import type { SeoFieldsRow } from "@/lib/seo/fields";

export interface SeoStatusInput extends SeoFieldsRow {
  title_pl: string;
  title_en: string;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  cover_image_url: string | null;
}

export type DescriptionSource = "override" | "excerpt" | "missing";
export type SocialImageSource = "override" | "cover" | "card" | "default";
export type SeoGrade = "good" | "warn" | "poor";

export interface SeoContentStatus {
  titleOverride: { pl: boolean; en: boolean };
  description: { pl: DescriptionSource; en: DescriptionSource };
  socialImage: SocialImageSource;
  noindex: boolean;
  canonicalOverride: boolean;
  /** 0-100 completeness (descriptions 2x25, image 20, title override 15, indexable 15). */
  score: number;
  grade: SeoGrade;
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

  let score = 0;
  if (description.pl !== "missing") score += 25;
  if (description.en !== "missing") score += 25;
  if (socialImage !== "default") score += 20;
  if (titleOverride.pl || titleOverride.en) score += 15;
  if (!noindex) score += 15;

  return {
    titleOverride,
    description,
    socialImage,
    noindex,
    canonicalOverride: has(row.seo_canonical_url),
    score,
    grade: score >= 80 ? "good" : score >= 50 ? "warn" : "poor",
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
