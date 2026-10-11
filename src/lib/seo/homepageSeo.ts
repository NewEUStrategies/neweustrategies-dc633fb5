// Tytuł i opis strony głównej - JEDNA reguła dla publicznego `head()` trasy `/`
// i dla podglądów w panelu (edytor strony w /admin/pages, /admin/seo/homepage,
// walidator). Każda z tych powierzchni liczyła to dotąd po swojemu i do
// 2026-10-11 rozjeżdżały się: panel stron pokazywał „Strona główna - sufiks",
// /admin/seo/homepage tytuł serwisu, a `<title>` ignorował nadpisanie strony.
//
// Reguła (strona CMS-a pełniąca rolę strony głównej):
//   * tytuł = `seo_title_<lang>` strony DOSŁOWNIE (bez sufiksu, bez przejścia
//     między językami), a bez niego TYTUŁ SERWISU - nigdy `title_<lang>` strony
//     („Strona główna" to nazwa wiersza w panelu, nie tytuł serwisu),
//   * opis = `seo_description_<lang>`, potem zajawka strony (z fallbackiem
//     językowym, przycięta do budżetu wyniku Google), potem opis serwisu.
// Bez strony (tryb „najnowsze wpisy", render zdegradowany) - wartości serwisu.
import { metaDescription } from "@/lib/routing/publicSegments";
import { resolveSeoText, type ResolvedSeoText, type SeoFieldsRow } from "@/lib/seo/fields";

export interface HomepageSeoRow extends SeoFieldsRow {
  excerpt_pl?: string | null;
  excerpt_en?: string | null;
}

/** Tytuł i opis SERWISU dla języka (site identity albo stałe marki). */
export interface HomepageBrandText {
  title: string;
  description: string;
}

export function resolveHomepageSeoText(
  row: HomepageSeoRow | null | undefined,
  lang: "pl" | "en",
  brand: HomepageBrandText,
): ResolvedSeoText {
  if (!row) return { title: brand.title, description: brand.description, titleIsOverride: false };
  const excerpt =
    lang === "en" ? row.excerpt_en || row.excerpt_pl : row.excerpt_pl || row.excerpt_en;
  // `metaDescription(..., "")` oddaje "" przy pustej zajawce - wtedy opis serwisu.
  const fromExcerpt = metaDescription(excerpt, "");
  return resolveSeoText(row, lang, brand.title, fromExcerpt || brand.description);
}
