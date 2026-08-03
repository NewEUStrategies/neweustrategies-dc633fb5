// Jedno źródło prawdy dla limitów sekcji "Z tego materiału dowiesz się...".
//
// Limity żyją w TRZECH warstwach i do 2026-08-03 rozjechały się w każdej:
//   1. trigger DB - posts_validate_takeaways / pages_validate_takeaways
//      dopuszczają 7 punktów (migracja 20260709100809 podniosła limit z 6),
//   2. schemat serwerowej funkcji (zod) - odrzucał 7 z błędem walidacji,
//      więc siódmego punktu NIE DAŁO SIĘ zapisać przez updatePost/updatePage,
//   3. panel edytora - licznik i przycisk "dodaj" blokowały na 6, a
//      podpowiedź w tym samym panelu obiecywała "max 7 punktów".
//
// Efekt: baza i dokumentacja mówiły 7, produkt dawał 6, a panel kłamał.
// Klasa błędu jest cicha (nikt nie testuje limitu, o który się nie otarł),
// dlatego stała jest jedna, importowana przez wszystkie warstwy TS, a stronę
// bazy pilnuje kontrakt pgTAP (supabase/tests/takeaways_limits_contract_test.sql).

/**
 * Maksymalna liczba punktów per język. MUSI odpowiadać limitowi triggerów
 * `posts_validate_takeaways` / `pages_validate_takeaways` w bazie.
 */
export const KEY_TAKEAWAYS_MAX_ITEMS = 7;

/**
 * Maksymalna długość jednego punktu (znaki). MUSI odpowiadać limitowi
 * `length(b) > 500` w triggerach walidacyjnych.
 */
export const KEY_TAKEAWAYS_MAX_ITEM_LENGTH = 500;

/** Rekomendowana długość punktu - podpowiedź redakcyjna, nie limit twardy. */
export const KEY_TAKEAWAYS_RECOMMENDED_MIN_LENGTH = 90;
export const KEY_TAKEAWAYS_RECOMMENDED_MAX_LENGTH = 200;

/**
 * Kanoniczna normalizacja listy punktów: przycięcie białych znaków, usunięcie
 * pustych, obcięcie do limitu długości i do limitu liczby punktów.
 *
 * Jedna funkcja dla panelu (podgląd), serwera (zapis) i renderu publicznego -
 * żeby "co jest realnym punktem" znaczyło dokładnie to samo w każdej warstwie.
 * Nadmiar jest OBCINANY, nie odrzucany: wklejenie ośmiu linijek z dokumentu ma
 * dać siedem punktów, a nie błąd bez wskazania, która linijka zawiniła.
 */
export function normalizeTakeaways(
  input: readonly (string | null | undefined)[] | null | undefined,
): string[] {
  if (!input) return [];
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    out.push(
      trimmed.length > KEY_TAKEAWAYS_MAX_ITEM_LENGTH
        ? trimmed.slice(0, KEY_TAKEAWAYS_MAX_ITEM_LENGTH)
        : trimmed,
    );
    if (out.length === KEY_TAKEAWAYS_MAX_ITEMS) break;
  }
  return out;
}
