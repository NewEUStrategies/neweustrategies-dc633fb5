// Czy dana ścieżka pokazuje chrome serwisu (nagłówek, stopka, menu).
//
// PO CO OSOBNY MODUŁ. Loader korzenia (`__root.tsx`) na podstawie tej decyzji
// rozgrzewa albo NIE rozgrzewa zapytań menu, tickera i stopki - czyli decyduje
// o kilku round-tripach na KAŻDE żądanie. Pomyłka w którąkolwiek stronę jest
// kosztowna: fałszywe „tak" dokłada zapytania do panelu i logowania, fałszywe
// „nie" daje pierwsze malowanie strony publicznej bez nawigacji.
//
// Prefiksy sprawdzamy z ukośnikiem ORAZ jako dokładne dopasowanie, bo `/admin`
// i `/admin/` to ta sama powierzchnia, a `/administracja` - już nie.

/** Powierzchnie bez chrome'u serwisu: panel i logowanie mają własne układy. */
const CHROMELESS_PREFIXES = ["/admin", "/login"] as const;

export function showsSiteChrome(pathname: string): boolean {
  return !CHROMELESS_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
