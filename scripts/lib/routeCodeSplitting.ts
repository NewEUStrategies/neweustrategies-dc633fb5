type SplitNode = "loader" | "component" | "errorComponent" | "notFoundComponent";

/**
 * Trasy, których CAŁY moduł zostaje w chunku wejściowym (bez podziału na
 * loader/component): wyłącznie GORĄCE ŚCIEŻKI, czyli strona główna, catch-all
 * treści (`/$` - artykuł i strony CMS) oraz ich warianty `/en`. To są wejścia
 * większości wizyt; dla nich jeden skok po chunk mniej jest wart kilobajtów
 * w entry.
 *
 * ZAWĘŻENIE (2026-10-02). Do tej pory wyjątek obejmował też `/blog`, `/post/`,
 * `/category/`, `/tag/` i `/author/`. Pomiar entry (reports/chunk-inventory)
 * pokazał, że ta piątka wnosiła ~75 KB kodu PRZED minifikacją, który płacił
 * KAŻDY odwiedzający każdej strony: pełne moduły `author.$slug` (9,6 KB),
 * `category.$slug` (6,5 KB), `tag.$slug` (5,8 KB), `blog.index` (5,2 KB) oraz
 * ich prywatne zależności - `lib/queries/archives` (11,6 KB),
 * `lib/expertLayouts` (8,9 KB), `lib/experts/normalize` (8,3 KB),
 * `lib/experts/queries` (7,5 KB) i kilkanaście mniejszych. Po zawężeniu te
 * trasy płacą jeden skok po chunk przy nawigacji (modulepreload z manifestu
 * Start robi go równolegle przy wejściu bezpośrednim), a nikt inny nie płaci
 * ich bajtów. `head()`, `validateSearch` i `loaderDeps` zostają w shellu trasy
 * tak jak dla pozostałych ~300 tras - splitter TanStacka wydziela tylko
 * loader/komponenty.
 *
 * `beforeLoad` i strażnicy auth zostają w modułach tras (splitter ich nie
 * dzieli), więc zachowanie zalogowanych i panelu nie zmienia się.
 */
export function routeSplitBehavior({ routeId }: { routeId: string }): SplitNode[][] | undefined {
  if (
    routeId === "__root__" ||
    routeId === "/" ||
    routeId === "/$" ||
    /^\/en(?:\/|$)/.test(routeId)
  )
    return undefined;
  return [["loader"], ["component"], ["errorComponent"], ["notFoundComponent"]];
}
