// Per-entity SEO field resolution: the single fallback chain shared by the
// public head(), the JSON-LD builders, feeds and the admin SERP preview, so
// what editors preview is byte-identical to what crawlers receive.
//
// Chain (per language):
//   title:       seo_title_<lang>  ->  title_<lang> || title_<other>
//   description: seo_description_<lang> -> excerpt-derived -> title
//   og image:    seo_og_image_url -> cover_image_url -> og_image_generated_url -> site default
//
// SEO overrides deliberately do NOT fall back across languages: a Polish SERP
// snippet must never surface an English-only override (and vice versa).
import type { Lang } from "@/lib/seo/meta";

/** The SEO columns shared by posts and pages (all nullable in the DB). */
export interface SeoFieldsRow {
  seo_title_pl?: string | null;
  seo_title_en?: string | null;
  seo_description_pl?: string | null;
  seo_description_en?: string | null;
  seo_canonical_url?: string | null;
  seo_noindex?: boolean | null;
  seo_og_image_url?: string | null;
  og_image_generated_url?: string | null;
}

/** Query-select fragment for the SEO columns (posts and pages). */
export const SEO_FIELDS_SELECT =
  "seo_title_pl, seo_title_en, seo_description_pl, seo_description_en, seo_canonical_url, seo_noindex, seo_og_image_url, og_image_generated_url";

function clean(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  return v.length ? v : null;
}

/** SEO title override for a language, or null when the editor left it empty. */
export function seoTitleOverride(row: SeoFieldsRow, lang: Lang): string | null {
  return clean(lang === "en" ? row.seo_title_en : row.seo_title_pl);
}

/** SEO description override for a language, or null when empty. */
export function seoDescriptionOverride(row: SeoFieldsRow, lang: Lang): string | null {
  return clean(lang === "en" ? row.seo_description_en : row.seo_description_pl);
}

export interface ResolvedSeoText {
  /** Final <title> / og:title value. */
  title: string;
  /** Final meta/og description. */
  description: string;
  /** True when the title came from an explicit SEO override (rendered
   *  verbatim - the site-name suffix template must not be appended). */
  titleIsOverride: boolean;
}

/**
 * Resolve the final title + description from the row's SEO overrides with the
 * derived values as fallback. `fallbackTitle` / `fallbackDescription` are the
 * pre-existing derived values (localized title, excerpt-based description).
 */
export function resolveSeoText(
  row: SeoFieldsRow,
  lang: Lang,
  fallbackTitle: string,
  fallbackDescription: string,
): ResolvedSeoText {
  const titleOverride = seoTitleOverride(row, lang);
  return {
    title: titleOverride ?? fallbackTitle,
    description: seoDescriptionOverride(row, lang) ?? fallbackDescription,
    titleIsOverride: titleOverride !== null,
  };
}

/**
 * Document <title> template: appends the brand suffix ("Headline - Site") to
 * DERIVED titles only; explicit SEO overrides render verbatim (Yoast
 * semantics). Skips the suffix when the title already ends with it or when the
 * combined length would exceed sane SERP bounds.
 */
export function applyTitleSuffix(
  title: string,
  suffix: string | null | undefined,
  titleIsOverride: boolean,
): string {
  const s = clean(suffix);
  if (!s || titleIsOverride) return title;
  if (title.toLowerCase().endsWith(s.toLowerCase())) return title;
  const combined = `${title} - ${s}`;
  return combined.length > 120 ? title : combined;
}

/**
 * Social image fallback chain. Returns a possibly relative URL - callers
 * resolve it against the request origin. The generated OG card ranks below the
 * editorial cover (a purpose-picked photo beats an automatic text card) and
 * above the site-wide default.
 */
export function resolveSocialImage(
  row: SeoFieldsRow,
  coverImageUrl: string | null | undefined,
): string | null {
  return clean(row.seo_og_image_url) ?? clean(coverImageUrl) ?? clean(row.og_image_generated_url);
}

/** True when the resolved social image is the auto-generated 1200x630 card
 *  (the only case where exact og:image dimensions are known). */
export function socialImageIsGeneratedCard(row: SeoFieldsRow, resolved: string | null): boolean {
  return !!resolved && resolved === clean(row.og_image_generated_url);
}

/**
 * robots meta content. Zero-click/AEO defaults: allow large image previews and
 * unlimited snippets so Google/Bing/AI answer engines can quote the content in
 * rich results and answer boxes (that is where zero-click visibility happens).
 */
export function resolveRobotsMeta(row: SeoFieldsRow): string {
  return row.seo_noindex
    ? "noindex, nofollow"
    : "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";
}

/** Canonical override (absolute URL) or null to keep the derived canonical. */
export function seoCanonicalOverride(row: SeoFieldsRow): string | null {
  const v = clean(row.seo_canonical_url);
  if (!v || !/^https?:\/\//i.test(v)) return null;
  return v;
}
