// Odczyt wpisów z osadzoną stroną-rodzicem (`POST_PARENT_PAGE_EMBED`,
// `postHref.ts`) z ZAPASEM na dotychczasowy `select` bez osadzenia.
//
// PO CO. Osadzenie daje adres kanoniczny bez dodatkowego round-tripu, ale
// jest też nowym punktem zależności zapytania: klucz obcy w cache schematu
// PostgREST, uprawnienia gościa do `pages.slug` / `pages.parent_id`, polityka
// RLS. Rozjazd w którymkolwiek z nich (migracja, przeładowanie schematu,
// zmiana grantów) zamieniłby KAŻDY widget z wpisami w pustkę, choć sam odczyt
// `posts` działa. Dlatego błąd odczytu z osadzeniem nie jest błędem widgetu:
// to samo zapytanie leci drugi raz bez osadzenia, wiersze wracają bez
// `parent_page`, a `postHref` oddaje adres zapasowy `/post/<slug>` - czyli
// dokładnie to, co strona pokazywała przed tą zmianą.
//
// KAŻDY BŁĄD, NIE LISTA KODÓW. Zawężenie do „błędów schematu" (PGRST2xx,
// klasa 42) wymagałoby zgadywania, jak PostgREST i brama nazwą przyszły
// rozjazd; pomyłka w tej liście kończy się pustym widgetem. Koszt szerokiej
// reguły jest ograniczony z góry: pierwsza porażka wyłącza osadzenie w tym
// izolacie na `POST_PARENT_PAGE_RETRY_MS`, więc przy awarii bazy dodatkowy
// odczyt leci raz na okno, a nie przy każdym zapytaniu.
//
// STAN MODUŁU JEST PER IZOLAT (i per karta w przeglądarce) - tak samo jak L1
// `edgeTtlCache`. Po oknie osadzenie jest próbowane ponownie, więc naprawa
// schematu nie wymaga wymiany izolatu.

import { postColumnsWithParentPage } from "./postHref";

/** Błąd odczytu w kształcie, w jakim oddaje go supabase-js. */
interface ReadError {
  message: string;
  code?: string;
}

/** Wynik odczytu PostgREST - tyle, ile czyta ta warstwa. */
interface ReadResult<T> {
  data: T | null;
  error: ReadError | null;
}

/** Jak długo po porażce osadzenia izolat czyta bez niego. */
export const POST_PARENT_PAGE_RETRY_MS = 5 * 60_000;

let embedDisabledUntil = 0;

/**
 * Wykonuje `withParentPage()` (select z osadzeniem); gdy odda błąd - loguje go
 * RAZ na okno, wyłącza osadzenie na `POST_PARENT_PAGE_RETRY_MS` i oddaje wynik
 * `plain()` (ten sam odczyt bez osadzenia). Błąd `plain()` wraca do wołającego
 * bez zmian: awaria samego odczytu `posts` wygląda jak dotąd.
 *
 * Dwa wywołania zamiast jednego z parametrem kolumn: literał `select` zostaje
 * w łańcuchu `.from("posts").select(...)`, gdzie czyta go bramka kontraktu
 * TS <-> SQL.
 */
export async function readWithPostParentPage<A, B>(
  withParentPage: () => PromiseLike<ReadResult<A>>,
  plain: () => PromiseLike<ReadResult<B>>,
): Promise<ReadResult<A | B>> {
  if (Date.now() < embedDisabledUntil) return plain();
  const embedded = await withParentPage();
  if (embedded.error === null) return embedded;
  // Zapytania jednej fali renderu kończą się porażką niemal jednocześnie -
  // okno otwiera (i loguje) tylko pierwsze z nich.
  const now = Date.now();
  if (now >= embedDisabledUntil) {
    embedDisabledUntil = now + POST_PARENT_PAGE_RETRY_MS;
    if (typeof console !== "undefined") {
      // Tekst jedzie w chunku startowym klienta, więc jest krótki i w ASCII.
      // Co się dzieje po tym wpisie (odczyt bez osadzenia, adresy
      // `/post/<slug>` do końca okna) opisuje nagłówek modułu.
      console.warn("[postHref] parent_page:", embedded.error.code ?? "", embedded.error.message);
    }
  }
  return plain();
}

/**
 * `readWithPostParentPage` dla zapytania budowanego jedną funkcją
 * `read(kolumny)`: wariant z osadzeniem dostaje
 * `postColumnsWithParentPage(plainColumns)`, zapasowy - same `plainColumns`.
 * Wołający trzyma JEDEN literał kolumn i nie powtarza ani osadzenia, ani pary
 * domknięć; reguła błędów i okno wyłączenia są te same co wyżej.
 *
 * Łańcuch pisany wprost (`.from("posts").select(<literał>)`), który ma czytać
 * bramka kontraktu TS <-> SQL, zostaje przy `readWithPostParentPage`.
 */
export function readPostsWithParentPage<T>(
  read: (columns: string) => PromiseLike<ReadResult<T>>,
  plainColumns: string,
): Promise<ReadResult<T>> {
  return readWithPostParentPage(
    () => read(postColumnsWithParentPage(plainColumns)),
    () => read(plainColumns),
  );
}

/** Tylko testy: zdejmuje wyłączenie osadzenia, żeby przypadki się nie widziały. */
export function resetPostParentPageRead(): void {
  embedDisabledUntil = 0;
}
