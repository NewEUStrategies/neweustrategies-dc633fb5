// Pre-save SEO validation for the post/page editors. Pure: given the panel
// snapshot + derived fallbacks, returns per-language / per-field issues with
// the exact numbers editors need (character count vs cap, pixel width vs
// Google truncation budget). Consumed by SeoPanel (inline banner) and by the
// editor save handlers (manual "Zapisz" preflight toast).
//
// Two severities:
//   - "error"   -> the hard character cap enforced by the input (maxLength).
//                  Should never actually fire (the input clamps), but we keep
//                  it defensively so a paste-then-strip edge case still
//                  surfaces cleanly.
//   - "warning" -> the value is longer than Google's rendered pixel budget
//                  (title 600px / description 960px). Google will simply
//                  truncate the snippet, so we warn without blocking.
import { serpDescriptionMetric, serpTitleMetric, type SerpMetric } from "@/lib/seo/serp";
import { metaDescription } from "@/lib/routing/publicSegments";
import { applyTitleSuffix } from "@/lib/seo/fields";
import type { SeoPanelValue } from "@/components/admin/seo/SeoPanel";

type SeoIssueSeverity = "error" | "warning";
type SeoIssueLang = "pl" | "en";
type SeoIssueKind = "title" | "description";

export interface SeoIssue {
  lang: SeoIssueLang;
  kind: SeoIssueKind;
  severity: SeoIssueSeverity;
  /** Character length of the effective (custom or fallback) value. */
  chars: number;
  /** Character cap for the field (maxLength on the input). */
  charLimit: number;
  /** Rendered pixel width of the effective value. */
  px: number;
  /** Google truncation budget for the field, in pixels. */
  pxLimit: number;
}

interface ValidateInput {
  value: SeoPanelValue;
  fallbackTitle: { pl: string; en: string };
  fallbackDescription: { pl: string | null; en: string | null };
  slug: string;
  titleCharLimit: number;
  descriptionCharLimit: number;
  /**
   * Sufiks marki z ustawień SEO (`effectiveTitleSuffix`). Head() i podgląd
   * SERP doklejają go do tytułu WYPROWADZONEGO (pusty `seo_title_*`), więc
   * ostrzeżenie o ucięciu musi mierzyć tytuł RAZEM z nim - inaczej fallback
   * ~460 px przechodził jako „dobry", choć z sufiksem Google go ucina.
   * Nadpisanie z panelu idzie do Google bez sufiksu (`applyTitleSuffix`).
   * Brak/null = zachowanie bez sufiksu.
   */
  titleSuffix?: string | null;
}

function resolveTitle(
  lang: SeoIssueLang,
  value: SeoPanelValue,
  fallback: { pl: string; en: string },
  slug: string,
): { title: string; isOverride: boolean } {
  const override = (lang === "en" ? value.seo_title_en : value.seo_title_pl)?.trim();
  if (override) return { title: override, isOverride: true };
  const derived = lang === "en" ? fallback.en || fallback.pl : fallback.pl || fallback.en;
  return { title: derived || slug, isOverride: false };
}

function resolveDescription(
  lang: SeoIssueLang,
  value: SeoPanelValue,
  fallback: { pl: string | null; en: string | null },
  title: string,
): string {
  const override = (lang === "en" ? value.seo_description_en : value.seo_description_pl)?.trim();
  if (override) return override;
  const derived = lang === "en" ? fallback.en || fallback.pl : fallback.pl || fallback.en;
  return metaDescription(derived, title);
}

function makeIssue(
  lang: SeoIssueLang,
  kind: SeoIssueKind,
  text: string,
  charLimit: number,
  metric: SerpMetric,
): SeoIssue | null {
  const chars = [...text].length;
  const overChars = chars > charLimit;
  const overPixels = metric.grade === "long";
  if (!overChars && !overPixels) return null;
  return {
    lang,
    kind,
    severity: overChars ? "error" : "warning",
    chars,
    charLimit,
    px: metric.px,
    pxLimit: metric.limitPx,
  };
}

/** Compute the full set of SEO issues for a SeoPanel snapshot. */
export function validateSeoPanel(input: ValidateInput): SeoIssue[] {
  const {
    value,
    fallbackTitle,
    fallbackDescription,
    slug,
    titleCharLimit,
    descriptionCharLimit,
    titleSuffix,
  } = input;
  const issues: SeoIssue[] = [];
  for (const lang of ["pl", "en"] as const) {
    const { title, isOverride } = resolveTitle(lang, value, fallbackTitle, slug);
    // Opis wyprowadzony bierze tytuł BEZ sufiksu - tak samo jak panel i head().
    const description = resolveDescription(lang, value, fallbackDescription, title);
    // Mierzony jest tytuł, który naprawdę trafia do Google. `applyTitleSuffix`
    // nie dokleja sufiksu powyżej 120 znaków, a limit pola (160) jest wyższy,
    // więc sufiks nie może zamienić ostrzeżenia w błąd blokujący zapis.
    const served = applyTitleSuffix(title, titleSuffix, isOverride);
    const t = makeIssue(lang, "title", served, titleCharLimit, serpTitleMetric(served));
    if (t) issues.push(t);
    const d = makeIssue(
      lang,
      "description",
      description,
      descriptionCharLimit,
      serpDescriptionMetric(description),
    );
    if (d) issues.push(d);
  }
  return issues;
}

/** True when the snapshot has hard character-cap violations that block save. */
export function hasBlockingSeoIssues(issues: SeoIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}
