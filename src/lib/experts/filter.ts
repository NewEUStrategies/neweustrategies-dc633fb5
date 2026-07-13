// Czysta logika eksploratora materiałów - bez zależności od React/Supabase,
// żeby dała się jednostkowo przetestować (parytet z filtrami katalogu osób).
import type { ExpertMaterial, MaterialFilters, MaterialKind } from "./types";

/** Rok publikacji materiału (z pola date), albo null gdy brak daty. */
export function materialYear(m: ExpertMaterial): number | null {
  if (!m.date) return null;
  const y = Number(m.date.slice(0, 4));
  return Number.isFinite(y) && y > 1900 ? y : null;
}

/** Zwraca materiały spełniające WSZYSTKIE aktywne filtry (AND). */
export function applyMaterialFilters(
  materials: ExpertMaterial[],
  filters: MaterialFilters,
): ExpertMaterial[] {
  return materials.filter((m) => {
    if (filters.kind && m.kind !== filters.kind) return false;
    if (filters.programId && !m.programIds.includes(filters.programId)) return false;
    if (filters.regionId && !m.regionIds.includes(filters.regionId)) return false;
    if (filters.categoryId && !m.categoryIds.includes(filters.categoryId)) return false;
    if (filters.year !== null && materialYear(m) !== filters.year) return false;
    return true;
  });
}

/** Malejąca lista lat obecnych w materiałach (do filtra po dacie). */
export function availableYears(materials: ExpertMaterial[]): number[] {
  const set = new Set<number>();
  for (const m of materials) {
    const y = materialYear(m);
    if (y !== null) set.add(y);
  }
  return [...set].sort((a, b) => b - a);
}

/** Liczności materiałów wg typu (do etykiet zakładek/filtra formatu). */
export function kindCounts(materials: ExpertMaterial[]): Record<MaterialKind, number> {
  const counts: Record<MaterialKind, number> = {
    article: 0,
    report: 0,
    video: 0,
    podcast: 0,
    event: 0,
  };
  for (const m of materials) counts[m.kind] += 1;
  return counts;
}
