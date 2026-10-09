// ZAJAWKI TYLKO TAM, GDZIE WIDGET JE RENDERUJE (fala 3, P3.7b, T2).
//
// Wiersz post-listy i slidera niósł zajawkę (`excerpt_<lang>`) także wtedy, gdy
// widget jej nie rysuje: przełącznik „Pokaż zajawkę" wyłączony albo wariant
// `ranked` (indeks + tytuł + autor). Na fixture `/` wszystkie 7 zapytań
// post-listy i slidera jedzie w stanie `$tsr` z zajawkami, których nikt nie
// czyta (diagnoza `faza3/diagnoza/waga-dokumentu.md` §2.1).
//
// Ten moduł jest JEDYNYM źródłem odpowiedzi „czy ten widget renderuje
// zajawkę": czytają go widok (`PostListView`, `PostsSliderWidget`) i fabryki
// kluczy (`postListQuery`, `sliderPostsQuery`), więc widok i klucz nie mogą się
// rozjechać. Predykat jest w kluczu zapytania (`withExcerpt`) po obu stronach,
// a samo ścinanie (`withoutExcerpts`) biegnie WYŁĄCZNIE na serwerze, w `queryFn`
// za bramką `import.meta.env.SSR` - jego kod nie trafia do chunku wejściowego
// (runda poprawek 9: budżet domknięcia bootu). Refetch klienta zostawia wiersz
// pełny, a znacznik się nie zmienia: widget z `withExcerpt === false` zajawki
// nie rysuje bez względu na treść wiersza (kontrakt znacznika w
// `localizedPostRowsParity.test.tsx`).
//
// PUŁAPKA POWIERZCHNI: widget `carousel` używa TEGO SAMEGO klucza post-listy
// i renderuje KAŻDY wariant przez `PostCard` z zajawką (także `ranked`
// i `numbered`), więc wykluczenia wariantów dotyczą wyłącznie powierzchni
// `list` (widget `post-list`).
import type { WidgetContent, WidgetType } from "@/lib/builder/types";
// `getBool` widoku (ten sam moduł leży w chunku wejściowym, więc import nie
// dokłada krawędzi do domknięcia bootu): wariant `numbered` czyta przełącznik
// zajawki DOKŁADNIE tą funkcją.
import { getBool } from "@/components/builder/organisms/widget-view/frame";

/**
 * Kto czyta wpis post-listy: powierzchnia (`list` = widget `post-list`) albo
 * wprost typ widgetu - rejestr prefetchu i preload LCP podają `widget.type`
 * (bez przeliczania na powierzchnię w każdym miejscu wywołania). Zajawkę
 * w KAŻDYM wariancie rysuje wyłącznie `carousel`.
 */
export type PostListSurface = "list" | WidgetType;

/**
 * Globalny przełącznik zajawki post-listy - DOKŁADNIE semantyka widoku
 * (`getStr(c, "showExcerpt") !== "0"`, gdzie `getStr` przyjmuje wyłącznie
 * napisy): tylko napis `"0"` wyłącza; `false`, `0` i brak wartości nie.
 */
export function postListExcerptToggle(c: WidgetContent): boolean {
  return c["showExcerpt"] !== "0";
}

/**
 * Czy post-lista na danej powierzchni RENDERUJE zajawkę choć jednego wiersza.
 * Fałsz tylko wtedy, gdy żadna gałąź widoku jej nie rysuje:
 *  - przełącznik globalny wyłączony (`"0"`);
 *  - lista, wariant `ranked` (bez zajawki w ogóle);
 *  - lista, wariant `numbered` z `showExcerpt` fałszywym w sensie `getBool`.
 * Wariant `overlay` zostaje z zajawką: wiersz bez okładki spada na kartę.
 * Wariant widoku to `getStr(c, "variant") || "card"`, więc porównanie surowej
 * wartości z nazwą wariantu daje ten sam wynik.
 */
export function postListRendersExcerpt(c: WidgetContent, surface: PostListSurface): boolean {
  if (!postListExcerptToggle(c)) return false;
  if (surface === "carousel") return true;
  const variant = c["variant"];
  return !(variant === "ranked" || (variant === "numbered" && !getBool(c, "showExcerpt", true)));
}

/**
 * Wiersze bez pól `excerpt_*` (klucze zdjęte, nie `null`) dla widgetu, który
 * zajawki nie rysuje. TYLKO SERWER: wywołanie stoi w `queryFn` za bramką
 * `import.meta.env.SSR`, więc ta funkcja nie trafia do bundla klienta. Wspólna
 * dla post-listy i slidera wpisów.
 */
export function withoutExcerpts<T extends { excerpt_pl?: unknown; excerpt_en?: unknown }>(
  rows: readonly T[],
): T[] {
  return rows.map(({ excerpt_pl: _pl, excerpt_en: _en, ...rest }) => rest as T);
}
