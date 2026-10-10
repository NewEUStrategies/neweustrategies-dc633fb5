// Shard sitemapy: /sitemaps/<sekcja>.xml (przy przepełnieniu <sekcja>-2.xml).
// Listowany z indeksu /sitemap.xml - patrz sitemap[.]xml.ts po uzasadnienie
// podziału (limit 50 000 adresów protokołu + koszt jednego wielkiego handlera).
//
// Parametr jest CAŁYM segmentem ("posts-2.xml"), bo generator tras TanStack nie
// dopuszcza parametru z sufiksem w nazwie pliku; rozszerzenie zdejmuje
// `parseSitemapShard`, on też odrzuca nieznane sekcje i nieistniejące numery.
import { createFileRoute } from "@tanstack/react-router";
import { parseSitemapShard, shardSlice } from "@/lib/seo/sitemapIndex";
import { buildUrlsetXml, expandSitemapUrls } from "@/lib/seo/sitemapXml";
import {
  loadRedirectIndex,
  resolveSitemapTenant,
  sameOriginHostsFor,
  sitemapCacheHeaders,
  sitemapRequestContext,
  sitemapUnavailableResponse,
} from "@/lib/server/sitemapRequest.server";

export const Route = createFileRoute("/sitemaps/$section")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const parsed = parseSitemapShard(params.section);
        if (!parsed) return new Response("Unknown sitemap", { status: 404 });

        const { origin, host } = await sitemapRequestContext();
        // Ten sam kontrakt tenanta co indeks: nieznany host to 404, host
        // podglądowy/lokalny degraduje do statycznego szkieletu (sekcja "core").
        const { tenantId, blocked } = await resolveSitemapTenant(host);
        if (blocked) return new Response("Unknown host", { status: 404 });

        // Sekcja `core` to statyczne huby: nie czyta bazy, więc nie czeka na
        // klienta Supabase ani na kolektory - zostaje jej wyłącznie
        // (budżetowany) indeks przekierowań. To jest plik, który crawler musi
        // dostać ZAWSZE, także przy niedostępnej bazie.
        const { collectSitemapSectionResult, coreSitemapEntries } =
          await import("@/lib/server/sitemapEntries.server");
        let entries = parsed.section === "core" ? coreSitemapEntries(origin) : [];
        if (tenantId && parsed.section !== "core") {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const read = await collectSitemapSectionResult(
            supabaseAdmin,
            tenantId,
            origin,
            parsed.section,
          );
          // Awaria odczytu (błąd albo przekroczony budżet) to NIE pusta sekcja:
          // 404 kazałoby Search Console uznać plik za usunięty. 503 +
          // Retry-After = „wróć za chwilę" - patrz `sitemapUnavailableResponse`.
          if (read.failed) return sitemapUnavailableResponse();
          entries = read.entries;
        }

        const redirectIndex = await loadRedirectIndex(tenantId);
        const urls = expandSitemapUrls(origin, entries, redirectIndex, sameOriginHostsFor(host));
        const slice = shardSlice(urls, parsed.shard);
        // Shard poza zakresem (np. ktoś trzyma stary adres -3.xml po skasowaniu
        // treści) to 404, nie pusty <urlset>: pusty plik w GSC wygląda jak błąd
        // publikacji, a 404 czyści wpis z raportu.
        if (slice.length === 0) return new Response("Unknown sitemap", { status: 404 });

        // Szkielet `core` bez tenanta to odpowiedź zdegradowana - krótki TTL
        // bez `stale-while-revalidate` (patrz `sitemapCacheHeaders`).
        return new Response(buildUrlsetXml(slice), { headers: sitemapCacheHeaders(!tenantId) });
      },
    },
  },
});
