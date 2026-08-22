// Lista czytelnicza GOŚCIA: artykuły zapisane w `localStorage` przed
// zalogowaniem (to samo źródło danych, do którego pisze `useSaveArticle`).
//
// PO CO OSOBNY MODUŁ, A NIE ATOM PREZENTACJI. Ten kod DOTYKA WEJŚCIA-WYJŚCIA
// (magazyn przeglądarki) i niesie regułę domenową „co jest poprawnym zapisem
// gościa", więc nie spełnia definicji atomu (czysta prezentacja, zero I/O).
// Dlatego mieszka w `lib/` - obok reszty warstwy domenowej - a nie
// w `components/*/atoms`.
//
// PARSOWANIE JEST ODDZIELONE OD ODCZYTU (`parseGuestSaved` vs `readGuestSaved`)
// dokładnie po to, żeby najbogatsze gałęzie tego modułu - uszkodzony JSON, nie-
// tablica, elementy o złym kształcie - dały się sprawdzić BEZ atrapy magazynu.
//
// CZEGO TEN MODUŁ ŚWIADOMIE NIE ROBI (zachowanie zastane, nie ulepszone):
//   * NIE deduplikuje po `url` - dwa wpisy o tym samym adresie zostają dwoma
//     wpisami (a widok listy używa `url` jako `key`, patrz `GuestSavedSection`),
//   * NIE ma limitu długości listy,
//   * NIE odsiewa wpisów przeterminowanych (`guestExpirationDays` egzekwuje
//     `useSaveArticle` przy zapisie, nie ten odczyt).
// Każda z tych zmian jest zmianą ZACHOWANIA widoku gościa, więc należy do
// osobnej decyzji, nie do pracy testowej.
import {
  GUEST_SAVED_ARTICLES_KEY,
  browserStorage,
  readStoredValue,
  writeStoredValue,
} from "@/lib/storageKeys";

/** Pozycja listy gościa. `savedAt` to znacznik czasu w milisekundach. */
export interface GuestSavedItem {
  url: string;
  title: string;
  savedAt: number;
}

/**
 * Czy surowy element z magazynu jest zapisem gościa. STRAŻNIK, nie rzutowanie:
 * warunek sprawdza kształt w RUNTIME i to on zawęża typ, więc element bez
 * adresu (`null`, liczba, obiekt bez `url`) nie przecieka dalej jako
 * `GuestSavedItem`. Jedynym wymaganym polem jest `url` - taką regułę miał
 * kod trasy i taka zostaje.
 */
function isGuestSavedItem(value: unknown): value is GuestSavedItem {
  return (
    typeof value === "object" && value !== null && "url" in value && typeof value.url === "string"
  );
}

/**
 * Parsowanie surowej wartości z magazynu. NIGDY nie rzuca - uszkodzona wartość
 * (ręczna edycja, obcięty zapis, wpis z innej wersji aplikacji) daje pustą
 * listę, a nie wyjątek w renderze listy czytelniczej.
 */
export function parseGuestSaved(raw: string | null): GuestSavedItem[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isGuestSavedItem) : [];
  } catch {
    return [];
  }
}

/**
 * Odczyt z magazynu przeglądarki. Na serwerze (SSR) zwraca pustą listę -
 * `localStorage` nie istnieje, a lista gościa jest z definicji per urządzenie.
 */
export function readGuestSaved(): GuestSavedItem[] {
  if (typeof window === "undefined") return [];
  return parseGuestSaved(readStoredValue(browserStorage("local"), GUEST_SAVED_ARTICLES_KEY));
}

/**
 * Zapis listy gościa. ZWRACA, czy wartość trafiła do magazynu.
 *
 * `writeStoredValue` NIGDY nie rzuca (patrz `lib/storageKeys.ts`) - odmowę
 * magazynu (tryb prywatny Safari, wyczerpany limit) zgłasza wynikiem `false`.
 * Dlatego owijanie tego wywołania w `try/catch` byłoby MARTWYM kodem, a
 * ignorowanie wyniku oznacza, że czytelnik widzi efekt kliknięcia, którego
 * w magazynie nie ma. Bieżący wywołujący (`GuestSavedSection`) ten wynik
 * ignoruje - to zachowanie zastane, udokumentowane testem `it.fails`
 * w `src/routes/__tests__/readingListRoute.test.tsx`.
 */
export function writeGuestSaved(items: readonly GuestSavedItem[]): boolean {
  return writeStoredValue(browserStorage("local"), GUEST_SAVED_ARTICLES_KEY, JSON.stringify(items));
}

/** Usunięcie pozycji po adresie. Czysta funkcja - zapis robi wywołujący. */
export function withoutGuestSaved(items: readonly GuestSavedItem[], url: string): GuestSavedItem[] {
  return items.filter((item) => item.url !== url);
}
