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
  SITEMAP_CACHE_HEADERS,
  loadRedirectIndex,
  resolveSitemapTenant,
  sameOriginHostsFor,
  sitemapRequestContext,
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

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { collectSitemapSection, coreSitemapEntries } =
          await import("@/lib/server/sitemapEntries.server");
        const entries = tenantId
          ? await collectSitemapSection(supabaseAdmin, tenantId, origin, parsed.section)
          : parsed.section === "core"
            ? coreSitemapEntries(origin)
            : [];

        const redirectIndex = await loadRedirectIndex(tenantId);
        const urls = expandSitemapUrls(origin, entries, redirectIndex, sameOriginHostsFor(host));
        const slice = shardSlice(urls, parsed.shard);
        // Shard poza zakresem (np. ktoś trzyma stary adres -3.xml po skasowaniu
        // treści) to 404, nie pusty <urlset>: pusty plik w GSC wygląda jak błąd
        // publikacji, a 404 czyści wpis z raportu.
        if (slice.length === 0) return new Response("Unknown sitemap", { status: 404 });

        return new Response(buildUrlsetXml(slice), { headers: SITEMAP_CACHE_HEADERS });
      },
    },
  },
});
