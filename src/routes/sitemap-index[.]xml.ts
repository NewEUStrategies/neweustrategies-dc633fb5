// Alias konwencjonalnej nazwy indeksu sitemapy.
//
// Indeks mieszka pod /sitemap.xml (ten adres jest w robots.txt od zawsze i to
// on jest zgłoszony w Search Console), ale "sitemap-index.xml" to nazwa, pod
// którą indeksu szukają narzędzia audytowe i ludzie. Zamiast serwować DRUGĄ
// kopię tej samej treści (podwójny crawl, dwie wersje w cache) alias oddaje 301
// na adres kanoniczny.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sitemap-index.xml")({
  server: {
    handlers: {
      GET: async () =>
        new Response(null, {
          status: 301,
          headers: { Location: "/sitemap.xml", "Cache-Control": "public, max-age=86400" },
        }),
    },
  },
});
