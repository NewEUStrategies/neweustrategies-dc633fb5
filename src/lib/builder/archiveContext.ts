// Budowa realnego kontekstu archiwum dla widgetów dynamicznych buildera.
//
// REGRESJA, KTÓRĄ TEN MODUŁ ZAMYKA: żaden kod produkcyjny nie tworzył
// `CurrentPostCtx.archive`, więc widget `archive-title` renderował zaszytą
// w rendererze próbkę ("Przykładowe archiwum", "12 wpisów") - także realnym
// odwiedzającym strony kategorii i tagu. Renderer nie ma już własnej próbki;
// jedynym źródłem danych archiwum jest ten moduł (publicznie) oraz
// `PLACEHOLDER_POST_CTX` (wyłącznie kanwa buildera).
import type { CurrentPostCtx } from "@/lib/content-model/postContext";
import type { TaxonomyMeta } from "@/lib/queries/archives";

/**
 * `total` MUSI pochodzić z tego samego zapytania, co lista wpisów archiwum
 * (`taxonomyArchiveQueryOptions` -> `count: "exact"` na `posts` z filtrem
 * `status = 'published'` + `deleted_at IS NULL`). Wiersze są tam widoczne pod
 * RLS ("Public reads published posts" wiąże je z `public_tenant_id()`), więc
 * liczba wpisów jest scope'owana tenantem bez osobnego zapytania.
 */
export function buildArchiveCtx(
  kind: "category" | "tag",
  taxonomy: TaxonomyMeta,
  total: number,
  lang: "pl" | "en",
): CurrentPostCtx {
  const label =
    (lang === "en" ? taxonomy.name_en || taxonomy.name_pl : taxonomy.name_pl || taxonomy.name_en) ||
    taxonomy.slug;
  const description =
    (lang === "en"
      ? taxonomy.description_en || taxonomy.description_pl
      : taxonomy.description_pl || taxonomy.description_en) || undefined;
  return {
    kind: "archive",
    slug: taxonomy.slug,
    archive: { type: kind, label, description, count: total },
  };
}
