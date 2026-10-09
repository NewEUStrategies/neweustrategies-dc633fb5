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
// rozjechać. Predykat jest w kluczu zapytania (`withExcerpt`), a projekcja w
// `queryFn` - SSR, hydratacja i refetch mają ten sam kształt wiersza.
//
// PUŁAPKA POWIERZCHNI: widget `carousel` używa TEGO SAMEGO klucza post-listy
// i renderuje KAŻDY wariant przez `PostCard` z zajawką (także `ranked`
// i `numbered`), więc wykluczenia wariantów dotyczą wyłącznie powierzchni
// `list` (widget `post-list`).
import type { WidgetContent } from "@/lib/builder/types";

/** Powierzchnia renderu post-listy: widget `post-list` albo `carousel`. */
export type PostListSurface = "list" | "carousel";

/**
 * Kopia 1:1 `getBool` z `components/builder/organisms/widget-view/frame.ts`
 * (moduł `lib` nie importuje z `components`). Równoważność pilnuje test
 * `postListExcerpt.test.ts` - zmiana jednej kopii bez drugiej czerwieni go.
 */
export function excerptFrameBool(c: WidgetContent, k: string, dflt = false): boolean {
  const v = c[k];
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const normalized = v.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  }
  if (typeof v === "number") {
    if (v === 1) return true;
    if (v === 0) return false;
  }
  return dflt;
}

/**
 * Globalny przełącznik zajawki post-listy - DOKŁADNIE semantyka widoku
 * (`getStr(c, "showExcerpt") !== "0"`, gdzie `getStr` przyjmuje wyłącznie
 * napisy): tylko napis `"0"` wyłącza; `false`, `0` i brak wartości nie.
 */
export function postListExcerptToggle(c: WidgetContent): boolean {
  const v = c["showExcerpt"];
  return !(typeof v === "string" && v === "0");
}

/**
 * Czy post-lista na danej powierzchni RENDERUJE zajawkę choć jednego wiersza.
 * Fałsz tylko wtedy, gdy żadna gałąź widoku jej nie rysuje:
 *  - przełącznik globalny wyłączony (`"0"`);
 *  - lista, wariant `ranked` (bez zajawki w ogóle);
 *  - lista, wariant `numbered` z `showExcerpt` fałszywym w sensie `getBool`.
 * Wariant `overlay` zostaje z zajawką: wiersz bez okładki spada na kartę.
 */
export function postListRendersExcerpt(c: WidgetContent, surface: PostListSurface): boolean {
  if (!postListExcerptToggle(c)) return false;
  if (surface === "carousel") return true;
  const variant = typeof c["variant"] === "string" && c["variant"] ? c["variant"] : "card";
  if (variant === "ranked") return false;
  if (variant === "numbered" && !excerptFrameBool(c, "showExcerpt", true)) return false;
  return true;
}
