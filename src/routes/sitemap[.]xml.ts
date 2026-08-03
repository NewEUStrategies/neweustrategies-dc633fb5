// INDEKS sitemapy (/sitemap.xml) - adres ogłoszony w robots.txt.
//
// Do 2026-08-03 ta trasa emitowała JEDEN plik <urlset> z całą treścią serwisu
// (wszystkie strony, wpisy, taksonomie, podcasty, dossier, eventy, Q&A, huby
// ekspertów) w dwóch wariantach językowych. Protokół sitemap.org ogranicza
// pojedynczy plik do 50 000 adresów i 50 MB - przy skali redakcji mapa milcząco
// urywałaby się na granicy limitu, a każde żądanie crawlera odpalało kilkanaście
// zapytań do bazy.
//
// Teraz /sitemap.xml jest <sitemapindex>: wskazuje shardy sekcji
// (/sitemaps/<sekcja>.xml, patrz sitemaps.$section.ts) oraz news-sitemap.xml,
// który wcześniej był odkrywalny WYŁĄCZNIE z robots.txt - i to tylko po
// dopisaniu deklaracji, której tam nie było.
import { createFileRoute } from "@tanstack/react-router";
import {
  buildSitemapIndexXml,
  shardCountFor,
  sitemapShardPath,
  type SitemapIndexEntry,
} from "@/lib/seo/sitemapIndex";
import { expandSitemapUrls, newestLastmod } from "@/lib/seo/sitemapXml";
import { parseSeoSettings } from "@/lib/seo/settings";
import {
  SITEMAP_CACHE_HEADERS,
  loadRedirectIndex,
  resolveSitemapTenant,
  sameOriginHostsFor,
  sitemapRequestContext,
} from "@/lib/server/sitemapRequest.server";

// Zachowane eksporty czystych helperów - trasa była (i zostaje) ich publicznym
// wejściem dla testu kontraktu w -sitemap.xml.test.ts.
export { xmlEscape, alternateLinks } from "@/lib/seo/sitemapXml";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const { origin, host } = await sitemapRequestContext();
        const { tenantId, blocked } = await resolveSitemapTenant(host);
        if (blocked) return new Response("Unknown host", { status: 404 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { collectAllSitemapSections } = await import("@/lib/server/sitemapEntries.server");
        const [sections, redirectIndex] = await Promise.all([
          collectAllSitemapSections(supabaseAdmin, tenantId, origin),
          loadRedirectIndex(tenantId),
        ]);

        const sameOriginHosts = sameOriginHostsFor(host);
        const entries: SitemapIndexEntry[] = [];
        for (const [section, sectionEntries] of sections) {
          // Liczymy adresy DOKŁADNIE tak, jak policzy je shard (ta sama funkcja
          // rozwinięcia i to samo sortowanie), więc indeks nigdy nie ogłasza
          // shardu, który wyszedłby pusty, ani nie gubi ostatniego.
          const urls = expandSitemapUrls(origin, sectionEntries, redirectIndex, sameOriginHosts);
          const lastmod = newestLastmod(urls);
          const shards = shardCountFor(urls.length);
          for (let shard = 1; shard <= shards; shard += 1) {
            entries.push({ loc: `${origin}${sitemapShardPath(section, shard)}`, lastmod });
          }
        }

        // Google News sitemap - własny format (news:), więc nie jest sekcją
        // mapy głównej, ale MUSI być odkrywalny. Indeks jest na to właściwym
        // miejscem; robots.txt ogłasza go dodatkowo.
        if (tenantId) {
          try {
            const { fetchSeoSettingsValue } = await import("@/lib/server/publishedContent.server");
            const settings = parseSeoSettings(await fetchSeoSettingsValue(tenantId));
            if (settings.news_sitemap_enabled) {
              entries.push({ loc: `${origin}/news-sitemap.xml` });
            }
          } catch (e) {
            console.warn("[seo] sitemap index news settings unavailable:", e);
          }
        }

        return new Response(buildSitemapIndexXml(entries), { headers: SITEMAP_CACHE_HEADERS });
      },
    },
  },
});
