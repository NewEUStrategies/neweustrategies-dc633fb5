// Walidacja parametru `?audience=` Cennika - wydzielona z `selectors.ts`, bo
// czyta ją `validateSearch` trasy `/pricing`, a `validateSearch` zostaje
// w shellu trasy, czyli w chunku wejściowym KAŻDEGO czytelnika. Import
// `selectors.ts` ciągnął tam całą logikę prezentacji cen razem
// z `billing/tiers` (łącznie 8,7 KB przed minifikacją, pomiar entry
// 2026-10-02) dla jednego testu regexem. `selectors.ts` re-eksportuje funkcję,
// więc komponenty i testy importują jak dotąd.
import { SLUG_KEY_RE } from "@/lib/keyFormat";

/**
 * Walidacja parametru ?audience= z URL (deep-link do segmentu). Ten sam format,
 * którym panel przyjmuje nowy klucz - patrz `lib/keyFormat`.
 */
export function sanitizeAudienceKey(value: unknown): string | undefined {
  return typeof value === "string" && SLUG_KEY_RE.test(value) ? value : undefined;
}
