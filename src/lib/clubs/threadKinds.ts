// Rodzaje tematu klubu - wydzielone z `types.ts`, bo czyta je `validateSearch`
// trasy `/club/$clubSlug/new`, a `validateSearch` zostaje w shellu trasy, czyli
// w chunku wejściowym KAŻDEGO czytelnika. Import całego `types.ts` ciągnął tam
// 13,3 KB kodu klubowego (pomiar entry 2026-10-02) dla sześciu stringów.
// `types.ts` re-eksportuje obie nazwy, więc reszta modułu importuje jak dotąd.

/** Rodzaj tematu. To NIE jest etykieta - zmienia cykl zycia (V1 §1.3). */
export const CLUB_THREAD_KINDS = [
  "discussion",
  "question",
  "position",
  "resource",
  "announcement",
  "poll",
] as const;
export type ClubThreadKind = (typeof CLUB_THREAD_KINDS)[number];

export function parseClubThreadKind(value: unknown): ClubThreadKind | null {
  return CLUB_THREAD_KINDS.find((kind) => kind === value) ?? null;
}
