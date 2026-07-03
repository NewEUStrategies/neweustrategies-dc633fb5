// Client-side SEO cache invalidator - wywoływany po każdej zmianie SEO
// (pola seo_*, przekierowania, ustawienia SEO). Odswieża publiczne query keys,
// z których korzysta mapa HTML /sitemap oraz podglądy w adminie, i wywołuje
// router.invalidate() zeby loadery route'ów pociągnęły świezy stan przy nastepnej
// nawigacji. Sitemap.xml, llms.txt, RSS i news-sitemap są serwerowe - ich cache
// (SWR, max-age=0) rewaliduje się na krawędzi bez akcji klienta.
import type { QueryClient } from "@tanstack/react-query";

/**
 * Strukturalny podzbiór routera TanStack (AnyRouter spełnia go bez castów).
 * Dzięki temu invalidator nie zależy od pełnego typu routera i daje się
 * testować zwykłym obiektem { invalidate }.
 */
export interface RouterLike {
  invalidate: () => unknown;
}

/**
 * Prefiksy query keys unieważniane po zmianie SEO. Każdy wpis MUSI odpowiadać
 * rzeczywistemu prefiksowi klucza używanemu w aplikacji (react-query dopasowuje
 * po prefiksie tablicy):
 *
 * - ["public"]              - wszystkie publiczne query (src/lib/queries/*:
 *                             resolved content, home-page, pages-tree,
 *                             categories, blog list, blocks, archives, search),
 *                             bo kazde z nich renderuje pola seo_* / noindex.
 * - ["seo-panel-path"]      - podgląd ścieżki w panelu SEO edytora
 *                             (SeoPanel.tsx).
 * - ["site_settings"]       - adminowe odczyty site_settings (useSettings),
 *                             w tym blob "seo" z ustawieniami SEO/GEO/AEO.
 * - ["site_settings_public"]- publiczna mapa ustawień (resolveSetting), z której
 *                             head() czyta title_suffix itd.
 * - ["admin-seo-posts"] / ["admin-seo-pages"] - dashboard /admin/seo.
 * - ["admin-seo-404"] / ["admin-redirects"]   - ekran przekierowań i log 404.
 *
 * Test regresyjny (src/lib/seo/__tests__/invalidate.test.ts) seeduje cache
 * prawdziwymi kluczami z src/lib/queries i pilnuje, ze kazdy z nich faktycznie
 * przechodzi w stan invalidated - to on wyłapie dryf nazw kluczy.
 */
export const SEO_QUERY_KEY_PREFIXES: readonly (readonly string[])[] = [
  ["public"],
  ["seo-panel-path"],
  ["site_settings"],
  ["site_settings_public"],
  ["admin-seo-posts"],
  ["admin-seo-pages"],
  ["admin-seo-404"],
  ["admin-redirects"],
];

export function invalidateSeoCaches(qc: QueryClient, router?: RouterLike | null): void {
  for (const prefix of SEO_QUERY_KEY_PREFIXES) {
    void qc.invalidateQueries({ queryKey: [...prefix], exact: false });
  }
  if (router && typeof router.invalidate === "function") {
    void router.invalidate();
  }
}
