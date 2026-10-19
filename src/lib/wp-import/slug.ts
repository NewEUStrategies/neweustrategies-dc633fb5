// Slug importu WordPressa - JEDNO miejsce dla obu importerów (wpisy przez
// konektor WP.com w `wordpress-import.functions.ts`, strony przez konektor
// i WXR w `wp-import.functions.ts`).
//
// DEFEKT, który ten moduł zamyka: oba importery miały własną kopię tej samej
// funkcji `toLowerCase -> NFD -> usunięcie znaków łączących -> reszta na
// dywizy`. Litery z kreską i ligatury (ł, ø, đ, ß, æ, œ...) NIE MAJĄ rozkładu
// kanonicznego, więc NFD zostawiała je bez zmian, a następny krok zamieniał je
// na DYWIZ: „Tytuł: podtytuł" -> `tytu-podtytu`, „Łódź" -> `odz`, „Żółw" ->
// `zo-w`. Transliteracja idzie teraz PRZED NFD, mapą wspólną z generatorem
// sluga taksonomii i zaproszeń (`@/lib/text/strokeLetters`) - ten sam tytuł
// daje ten sam adres niezależnie od ekranu, który go wygenerował.
//
// ZGODNOŚĆ WSTECZ. Adresy nadane przez poprzednią wersję żyją w bazie
// (linkowane, indeksowane, z przekierowaniami ze starych permalinków WP).
// Nowa funkcja NIE MOŻE ich zmienić ani zdublować przy ponownym imporcie,
// dlatego `legacySlugify` zostaje - wyłącznie do ODNAJDYWANIA wiersza, który
// poprzednia wersja nadała temu samemu wpisowi (dopasowanie po slugu wpisu
// bez tożsamości WP, kategorie po slugu). Nowych adresów nie wolno nią
// budować.
import { replaceStrokeLetters } from "@/lib/text/strokeLetters";

/** Limit długości sluga importu (kolumna `slug` i reguła SLUG_RE treści). */
export const WP_SLUG_MAX_LENGTH = 120;

/**
 * Slug dla NOWEGO adresu. Transliteracja liter z kreską przed NFD; znaki
 * łączące zdejmowane wąsko (blok U+0300-U+036F), jak dotąd - zmienia się
 * WYŁĄCZNIE wynik dla liter, które poprzednio stawały się dywizem.
 */
export function slugify(input: string): string {
  return replaceStrokeLetters(input.toLowerCase())
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, WP_SLUG_MAX_LENGTH);
}

/**
 * Slug w postaci sprzed transliteracji (do 2026-10-19): litery z kreską jako
 * dywiz. TYLKO do odnajdywania istniejących wierszy - patrz nagłówek modułu.
 * Dla wejścia bez takich liter wynik jest identyczny jak `slugify`.
 */
export function legacySlugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, WP_SLUG_MAX_LENGTH);
}
