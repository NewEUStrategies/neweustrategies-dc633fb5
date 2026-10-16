type SplitNode = "loader" | "component" | "errorComponent" | "notFoundComponent";

/**
 * GORĄCE ŚCIEŻKI - strona główna, catch-all treści (`/$` - artykuł i strony CMS) oraz ich
 * warianty `/en`: komponent, `errorComponent` i `notFoundComponent` w JEDNYM chunku podziału
 * (`HOT_PATH_SPLIT`). To wejścia większości wizyt, a seria bootu dokumentu (`#nes-boot-set`)
 * niesie preloady dopasowanej trasy - każdy osobny plik to osobne żądanie w tej serii.
 *
 * DLACZEGO NIE `undefined`. Komentarz tej reguły obiecywał dla nich „cały moduł w chunku
 * wejściowym", ale `undefined` znaczy dla wtyczki TanStack domyślny podział
 * `[[component], [errorComponent], [notFoundComponent]]` (`router-code-splitter-plugin.js`,
 * `defaultCodeSplitGroupings`) - tak było już na Rollupie, który tylko doklejał część
 * drobnych chunków do wejścia. Na Rolldownie (bez sklejania po rozmiarze) strona główna miała
 * w serii bootu trzy pliki podziału trasy i mikromoduł `homeHeadingSource` (zmierzone
 * 2026-10-16); jedna grupa daje jeden. Pełne `[]` (brak podziału) wciągnęłoby komponent strony
 * głównej do bootu KAŻDEJ strony (moduł opcji trasy jest `$initial`). Koszt grupy: przy
 * nawigacji SPA na te trasy kod błędu i 404 przychodzi razem z komponentem (kilkaset bajtów).
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
 * dzieli), więc zachowanie zalogowanych i panelu nie zmienia się. Korzeń (`__root__`) zostaje
 * przy `undefined` - wtyczka go nie dzieli.
 */
export function routeSplitBehavior({ routeId }: { routeId: string }): SplitNode[][] | undefined {
  if (routeId === "__root__") return undefined;
  if (routeId === "/" || routeId === "/$" || /^\/en(?:\/|$)/.test(routeId)) return HOT_PATH_SPLIT;
  if (routeId === "/admin/") return ADMIN_COCKPIT_SPLIT;
  return [["loader"], ["component"], ["errorComponent"], ["notFoundComponent"]];
}

/** Gorące ścieżki: komponenty trasy w jednym chunku podziału (opis przy `routeSplitBehavior`). */
const HOT_PATH_SPLIT: SplitNode[][] = [["component", "errorComponent", "notFoundComponent"]];

/**
 * KOKPIT PANELU (`/admin/`): `loader` W JEDNEJ GRUPIE Z `component`.
 *
 * Loader i komponent tej trasy dzielą `loadAdminDashboard` (dynamiczny import
 * pulpitu analityki: AdminDashboard, ChartCard, słowniki i18n-admin-*, ~190 KB
 * kodu). Przy osobnych grupach splitter wydziela go do mikromodułu
 * `admin.index.tsx?tsr-shared=1` (~140 B), a o tym, w którym chunku taki moduł
 * współdzielony wyląduje, decyduje bundler. Rollup przy
 * `experimentalMinChunkSize` doklejał go do chunku wybranego po ROZMIARACH
 * innych chunków: na `531a2c5` trafiał do chunku trasy admina; zmiana rozmiaru
 * kilku niezwiązanych widgetów (2026-10-03) przerzuciła go do `CalendarView`
 * i do chunku wejściowego, a wtedy krawędź `import()` pulpitu wychodziła
 * z publicznego chunku - `check:bundle` liczył ~42 KB gz pulpitu do budżetu
 * PUBLICZNEGO. Rolldown nie skleja po rozmiarach, ale umieszczenie modułu
 * współdzielonego nadal jest jego heurystyką. Wspólna grupa trzyma import
 * w chunku `admin.index-*`, czyli w korzeniu adminowym, niezależnie od reszty
 * bundla. Koszt: loader dociąga chunk komponentu, który i tak jest potrzebny
 * zaraz po sesji.
 */
const ADMIN_COCKPIT_SPLIT: SplitNode[][] = [
  ["loader", "component"],
  ["errorComponent"],
  ["notFoundComponent"],
];
