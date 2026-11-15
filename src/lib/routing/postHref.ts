// Adres wpisu dla list, kart i sliderów - z danych, które wiersz JUŻ niesie,
// bez żadnego odczytu bazy.
//
// PO CO. Widgety i bloki składały odnośnik jako `/post/<slug>`. Ten adres
// istnieje wyłącznie po to, żeby odpowiedzieć 301 na adres kanoniczny
// `/<pełna ścieżka strony-rodzica>/<slug>` (`routes/post.$slug.tsx` ->
// `legacyPostPath.ts`): każde kliknięcie płaciło dodatkowy dokument i dwa
// odczyty bazy, na hoście, na którym niemal każde żądanie trafia w zimny
// izolat. Ten sam wpis miał też na jednej stronie dwa adresy (`/blog/<slug>`
// z archiwum i `/post/<slug>` z widgetu), co Lighthouse zgłasza jako
// „identical links same purpose", a wyszukiwarka czyta jako dwa sygnały.
//
// SKĄD ŚCIEŻKA RODZICA. Z osadzenia PostgREST `POST_PARENT_PAGE_EMBED` w TYM
// SAMYM `select`, którym jadą wiersze - zero dodatkowych round-tripów na
// ścieżce renderu (zimny render ma 6 połączeń Workera i szeregowe fale
// zapytań; RPC `page_full_paths` byłoby tu kolejną falą).
//
// DLACZEGO TYLKO RODZIC NAJWYŻSZEGO POZIOMU. Funkcja SQL `page_full_path`
// (migracja 20260831160000) składa ścieżkę rekurencją w górę po
// `pages.parent_id`: slugi od korzenia do strony, łączone `/`. Dla strony bez
// rodzica (`parent_id IS NULL`) wynik to DOKŁADNIE jej `slug` - i tylko ten
// przypadek da się policzyć z jednego osadzonego wiersza bez zgadywania.
// Strona zagnieżdżona wymagałaby łańcucha przodków, więc dostaje adres
// zapasowy `/post/<slug>` (301 policzy ścieżkę w bazie, jak dotąd).
//
// DLACZEGO OSADZENIE WIDZI TO SAMO CO `page_full_path`. Obie drogi czytają
// `pages` rolą wołającego (funkcja jest SECURITY INVOKER), więc obie
// przechodzą przez tę samą politykę „Public reads published pages"
// (20260625160054: opublikowana, nieusunięta, najemca hosta). Rodzic
// niewidoczny dla gościa (szkic, kosz, obcy najemca) daje `parent_page: null`
// tutaj i `NULL` z funkcji - w obu przypadkach adresu kanonicznego nie ma,
// więc zostaje `/post/<slug>`.
//
// CZYSTY MODUŁ: bez Reacta, routera i klienta bazy. HTML serwera i strona po
// hydratacji liczą adres z tego samego wiersza w stanie odwodnionym.

/**
 * Osadzenie strony-rodzica w `select` na tabeli `posts`. Klucz obcy podany
 * wprost (`posts_parent_page_id_fkey`, migracja 20260531223436), więc drugi
 * klucz między tymi tabelami nie uczyni osadzenia niejednoznacznym. Literał:
 * bramka kontraktu TS <-> SQL czyta `select` wprost.
 */
export const POST_PARENT_PAGE_EMBED =
  "parent_page:pages!posts_parent_page_id_fkey(slug, parent_id)";

/**
 * Kolumny wpisu z dopisanym osadzeniem strony-rodzica: `"<kolumny>, <osadzenie>"`.
 *
 * Jedyne miejsce, które skleja oba człony: moduły zapytań trzymają wyłącznie
 * literał własnych kolumn (ten sam, którym leci odczyt zapasowy), a wariant
 * z osadzeniem powstaje tutaj. Sklejanie w FUNKCJI, nie w stałej modułu: każda
 * pełna kopia literału z osadzeniem w chunku startowym to bajty pod bramką
 * bundla, a szablon dwóch stałych minifikator może zwinąć z powrotem w literał.
 */
export function postColumnsWithParentPage(plainColumns: string): string {
  return `${plainColumns}, ${POST_PARENT_PAGE_EMBED}`;
}

/** Strona-rodzic wpisu w kształcie osadzenia `POST_PARENT_PAGE_EMBED`. */
export interface PostParentPage {
  slug: string;
  /** `null` = strona najwyższego poziomu (jej pełna ścieżka to sam `slug`). */
  parent_id: string | null;
}

/**
 * Minimum, z którego da się policzyć adres wpisu. `parent_page` jest
 * OPCJONALNE: wiersz ze starszego wpisu cache, z odczytu zapasowego bez
 * osadzenia albo ze źródła, które rodzica nie niesie, nadal ma poprawny adres
 * (zapasowy).
 */
export interface PostHrefSource {
  slug: string;
  parent_page?: PostParentPage | null;
}

/** Stary adres wpisu: trasa `/post/$slug` odpowiada 301 na adres kanoniczny. */
function legacyPostHref(slug: string): string {
  return `/post/${slug}`;
}

/**
 * Adres kanoniczny wpisu BEZ prefiksu języka, o ile da się go policzyć
 * z wiersza: `/<slug rodzica>/<slug wpisu>`, gdy wiersz niesie rodzica
 * najwyższego poziomu. `null` w każdym innym przypadku (brak pola, `null`,
 * rodzic zagnieżdżony, nieoczekiwany kształt) - adres zapasowy wybiera wołający.
 *
 * Wprost woła to powierzchnia, która DOTĄD linkowała innym adresem niż
 * `/post/<slug>` (płaskie `/<slug>` w panelu mega-menu i w widgecie tytułu):
 * bez rodzica do policzenia zostaje przy swoim dotychczasowym adresie, bo oba
 * zapasy różnią się skutkiem dla wpisu bez strony-rodzica (`/post/` -> 302 na
 * `/blog`, płaski -> 404 trasy `/$`). Wszystkie pozostałe wołają `postHref`.
 */
export function postCanonicalHref(post: PostHrefSource): string | null {
  const parent = post.parent_page;
  if (
    parent !== null &&
    typeof parent === "object" &&
    parent.parent_id === null &&
    typeof parent.slug === "string" &&
    parent.slug !== ""
  ) {
    return `/${parent.slug}/${post.slug}`;
  }
  return null;
}

/**
 * Adres wpisu BEZ prefiksu języka (prefiks dokłada wołający - `localizedPath`
 * albo rewrite routera - dokładnie tak, jak robił to dla `/post/<slug>`).
 *
 * Kanoniczny `/<slug rodzica>/<slug wpisu>` (`postCanonicalHref`), a gdy
 * wiersz nie daje go policzyć - adres zapasowy `/post/<slug>`.
 */
export function postHref(post: PostHrefSource): string {
  return postCanonicalHref(post) ?? legacyPostHref(post.slug);
}
