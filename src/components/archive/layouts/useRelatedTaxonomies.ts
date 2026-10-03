// Lista „Powiązane kategorie / tagi" dla OBU powierzchni archiwum: sekcji pod
// listą (`ArchiveBody`) i widżetu sidebara (`ArchiveSidebar`).
//
// Do 03.10.2026 każda z nich miała własne zapytanie (inne limity, inne klucze
// cache) i własną decyzję o podglądzie admina - sidebar pytał bazę także
// w podglądzie, z identyfikatorem atrapy „preview". Tu jest jedno miejsce,
// które decyduje „atrapa czy baza", a dane idą jedną fabryką
// `relatedTaxonomiesQueryOptions` (ranking ze współwystępowania, nie pierwsze
// wiersze tabeli).
import { useQuery } from "@tanstack/react-query";
import {
  relatedTaxonomiesQueryOptions,
  type RelatedTaxonomy,
} from "@/lib/queries/relatedTaxonomies";
import type { TaxonomyKind } from "@/lib/queries/taxonomyPivot";

const PREVIEW_CHIPS = 6;

/**
 * Deterministyczne chipy podglądu w panelu admina. Podgląd nie ma prawdziwej
 * taksonomii (identyfikator „preview"), a administrator musi ZOBACZYĆ, że
 * sekcja istnieje - pusta wyglądałaby jak wyłączona.
 */
function previewRelatedTaxonomies(lang: "pl" | "en"): readonly RelatedTaxonomy[] {
  return Array.from({ length: PREVIEW_CHIPS }, (_, i) => ({
    id: `mock-${i}`,
    slug: `preview-${i}`,
    name_pl: lang === "en" ? `Sample ${i + 1}` : `Przykład ${i + 1}`,
    name_en: `Sample ${i + 1}`,
  }));
}

/**
 * Powiązane terminy archiwum w kolejności rankingu. W podglądzie admina:
 * atrapa i ZERO żądań do bazy. Do czasu odpowiedzi i przy awarii funkcji -
 * pusta lista (fabryka zapytania sama zamienia błąd na `[]`).
 */
export function useRelatedTaxonomies(
  kind: TaxonomyKind,
  taxonomyId: string,
  lang: "pl" | "en",
  previewMode: boolean,
): readonly RelatedTaxonomy[] {
  const { data } = useQuery({
    ...relatedTaxonomiesQueryOptions(kind, taxonomyId),
    enabled: !previewMode,
  });
  if (previewMode) return previewRelatedTaxonomies(lang);
  return data ?? [];
}
