// Czysta logika paginacji serwerowej materiałów eksperta - bez React/Supabase,
// testowalna jednostkowo. Dwie odpowiedzialności:
//   1. Mapowanie ładunku RPC get_expert_materials na ExpertMaterialsPage
//      (kolejność pozycji ZE STRONY SQL jest zachowana 1:1 - żadnego
//      re-sortu, bo to porządek okna LIMIT/OFFSET).
//   2. Ścieżka legacy (okno między deployem kodu a migracją RPC): filtr po
//      slugach + wycięcie strony z pełnego zbioru huba, z semantyką parytetną
//      do SQL (strona poza zakresem = pusta lista, prawdziwy total).
import { applyMaterialFilters } from "./filter";
import {
  eventRowToMaterial,
  groupPivot,
  jsonRow,
  jsonRows,
  podcastRowToMaterial,
  postRowToMaterial,
  type PostPivots,
} from "./normalize";
import {
  EMPTY_MATERIAL_FILTERS,
  type ExpertHubData,
  type ExpertMaterial,
  type ExpertMaterialsPage,
  type MaterialFilterSlugs,
} from "./types";

/** Rozmiar strony eksploratora: 3 wiersze siatki 3-kolumnowej (lg). */
export const EXPERT_MATERIALS_PAGE_SIZE = 9;

/** Liczba stron dla danego totalu (minimum 1 - pusta lista to jedna strona). */
export function materialsTotalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));
}

/**
 * Rezolucja filtrów slugowych (URL/RPC) na id-owe (applyMaterialFilters) po
 * fasetach huba. `null` = któryś slug nie istnieje w fasetach → zbiór pusty
 * (parytet z RPC, które dla nieznanego sluga zwraca total=0, nie wyjątek).
 */
export function resolveFilterSlugs(
  facets: ExpertHubData["facets"],
  slugs: MaterialFilterSlugs,
): typeof EMPTY_MATERIAL_FILTERS | null {
  const filters = { ...EMPTY_MATERIAL_FILTERS, kind: slugs.kind, year: slugs.year };
  if (slugs.program !== null) {
    const program = facets.programs.find((p) => p.slug === slugs.program);
    if (!program) return null;
    filters.programId = program.id;
  }
  if (slugs.region !== null) {
    const region = facets.regions.find((r) => r.slug === slugs.region);
    if (!region) return null;
    filters.regionId = region.id;
  }
  if (slugs.topic !== null) {
    const tag = facets.tags.find((t) => t.slug === slugs.topic);
    if (!tag) return null;
    filters.tagId = tag.id;
  }
  return filters;
}

/** Filtr po slugach na pełnym zbiorze (ścieżka legacy; AND jak w SQL). */
export function filterMaterialsBySlugs(
  materials: ExpertMaterial[],
  facets: ExpertHubData["facets"],
  slugs: MaterialFilterSlugs,
): ExpertMaterial[] {
  const filters = resolveFilterSlugs(facets, slugs);
  if (filters === null) return [];
  return applyMaterialFilters(materials, filters);
}

/**
 * Wycina stronę z przefiltrowanego zbioru. Strona poza zakresem daje pustą
 * listę przy prawdziwym totalu - identycznie jak okno LIMIT/OFFSET w RPC;
 * decyzję o przekierowaniu na ostatnią stronę podejmuje UI, nie warstwa danych.
 */
export function paginateMaterials(
  materials: ExpertMaterial[],
  page: number,
  pageSize: number,
): ExpertMaterialsPage {
  const safePage = Math.max(1, Math.floor(page));
  const safeSize = Math.max(1, Math.floor(pageSize));
  const from = (safePage - 1) * safeSize;
  return {
    materials: materials.slice(from, from + safeSize),
    total: materials.length,
    page: safePage,
    pageSize: safeSize,
  };
}

/** Wynik mapowania ładunku RPC (dyskryminowany - IO decyduje o fallbacku). */
export type MaterialsPayloadResult =
  { kind: "ok"; page: ExpertMaterialsPage } | { kind: "not-found" } | { kind: "invalid" };

/**
 * jsonb z get_expert_materials → ExpertMaterialsPage. Pozycje mapowane w
 * kolejności strony przez te same funkcje normalize co hub i legacy - obie
 * ścieżki nie mogą się rozjechać na kształcie ExpertMaterial.
 */
export function mapExpertMaterialsPayload(payload: unknown): MaterialsPayloadResult {
  const root = jsonRow(payload);
  if (!root) return { kind: "invalid" };
  if (root.found === false) return { kind: "not-found" };
  if (root.found !== true) return { kind: "invalid" };

  const total = Number(root.total);
  const page = Number(root.page);
  const pageSize = Number(root.page_size);
  if (!Number.isFinite(total) || !Number.isFinite(page) || !Number.isFinite(pageSize)) {
    return { kind: "invalid" };
  }

  const pivots: PostPivots = {
    categories: groupPivot(jsonRows(root.post_categories), "category_id"),
    programs: groupPivot(jsonRows(root.post_programs), "program_id"),
    regions: groupPivot(jsonRows(root.post_regions), "region_id"),
    tags: groupPivot(jsonRows(root.post_tags), "tag_id"),
  };

  const materials: ExpertMaterial[] = [];
  for (const item of jsonRows(root.items)) {
    const row = jsonRow(item.row);
    if (!row) continue;
    if (item.source === "post") {
      materials.push(postRowToMaterial(row, item.is_coauthor === true, pivots));
    } else if (item.source === "podcast") {
      materials.push(podcastRowToMaterial(row));
    } else if (item.source === "event") {
      materials.push(eventRowToMaterial(row));
    }
  }

  return {
    kind: "ok",
    page: { materials, total, page: Math.max(1, page), pageSize: Math.max(1, pageSize) },
  };
}
