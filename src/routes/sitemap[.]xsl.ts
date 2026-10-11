// Arkusz wyglądu map strony (/sitemap.xsl) - XSLT, którym przeglądarka
// pokazuje indeks, pliki sekcji i news-sitemapę jako czytelną stronę
// z klikalnymi adresami. Uzasadnienie i granice: `lib/seo/sitemapStylesheet.ts`.
//
// Statyczny i niezależny od tenanta: nie czyta bazy ani hosta, więc nie ma
// tu ani degradacji, ani fail-closed - na żadnej domenie nie zdradza niczyich
// danych. Długi cache: zmienia się wyłącznie z wdrożeniem.
import { createFileRoute } from "@tanstack/react-router";
import {
  SITEMAP_STYLESHEET_CACHE_CONTROL,
  SITEMAP_STYLESHEET_CONTENT_TYPE,
  buildSitemapStylesheet,
} from "@/lib/seo/sitemapStylesheetXsl";

export const Route = createFileRoute("/sitemap.xsl")({
  server: {
    handlers: {
      GET: async () =>
        new Response(buildSitemapStylesheet(), {
          headers: {
            "Content-Type": SITEMAP_STYLESHEET_CONTENT_TYPE,
            "Cache-Control": SITEMAP_STYLESHEET_CACHE_CONTROL,
            "X-Robots-Tag": "noindex",
          },
        }),
    },
  },
});
