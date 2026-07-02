// Client-side SEO cache invalidator - wywoływany po każdej zmianie SEO
// (pola seo_*, przekierowania, ustawienia SEO). Odswieża publiczne query keys,
// z których korzysta mapa HTML /sitemap oraz podglądy w adminie, i wywołuje
// router.invalidate() zeby loadery route'ów pociągnęły świezy stan przy nastepnej
// nawigacji. Sitemap.xml, llms.txt, RSS i news-sitemap są serwerowe - ich cache
// (SWR, max-age=0) rewaliduje się na krawędzi bez akcji klienta.
import type { QueryClient } from "@tanstack/react-query";
import type { AnyRouter } from "@tanstack/react-router";

const SEO_QUERY_ROOTS: readonly string[] = [
  "public-pages-tree",
  "public-categories",
  "blog-list",
  "seo-panel-path",
  "site-setting",
  "admin-seo-overview",
  "seo-review",
];

export function invalidateSeoCaches(qc: QueryClient, router?: AnyRouter | null): void {
  for (const key of SEO_QUERY_ROOTS) {
    void qc.invalidateQueries({ queryKey: [key], exact: false });
  }
  if (router && typeof router.invalidate === "function") {
    void router.invalidate();
  }
}
