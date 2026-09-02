// Google News sitemap (/news-sitemap.xml) - a hard requirement for a news
// publisher. Only articles from the last 48h are listed (Google News rule,
// enforced in the pure builder); each language version is its own entry with a
// matching <news:language>. Advertised from robots.txt next to the main
// sitemap. Short cache: freshness is the whole point of this surface.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { trustedPublicHost } from "@/lib/http/requestHost";
import { localizedPath } from "@/lib/i18n/localePath";
import { buildNewsSitemapXml, type NewsSitemapEntry } from "@/lib/seo/newsSitemap";
import { feedCacheControl } from "@/lib/seo/feedCache";
import { effectiveNewsPublicationName, parseSeoSettings } from "@/lib/seo/settings";
import { fetchPublishedPosts, fetchSeoSettingsValue } from "@/lib/server/publishedContent.server";
import { crawlerDegradeIsSafe, resolveCrawlerTenantIdForHost } from "@/lib/server/tenant.server";

async function requestContext(): Promise<{ origin: string; host: string }> {
  const req = getRequest();
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = (await trustedPublicHost(req)) ?? "";
  return { origin: host ? `${proto}://${host}` : "", host };
}

export const Route = createFileRoute("/news-sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const { origin, host } = await requestContext();
        // Service-role reads below bypass RLS - scope them to the host's
        // tenant. FAIL-CLOSED: a host no tenant has claimed (and that is not
        // a preview host) gets a 404 instead of the default tenant's articles
        // on a foreign domain.
        // POPRAWKA 2026-08-03: komentarz wyżej obiecywał tolerancję hosta
        // podglądu („and that is not a preview host"), ale kod jej NIE
        // implementował - brakowało członu degradacji z `crawlerDegradeIsSafe`,
        // tego samego, który ma `/rss.xml` i `sitemapRequest.server.ts`. Skutek:
        // na hoście podglądu i przy pustym katalogu domen ten shard zwracał 404,
        // choć indeks sitemapy go ogłasza. Fail-closed dla realnych obcych domen
        // zostaje nietknięty. (Ta sama klasa, co /tracker/rss.xml i /live/rss.xml.)
        const tenantId = await resolveCrawlerTenantIdForHost(host);
        if (!tenantId && !(await crawlerDegradeIsSafe(host))) {
          return new Response("Unknown host", { status: 404 });
        }
        const settings = parseSeoSettings(tenantId ? await fetchSeoSettingsValue(tenantId) : null);
        if (!settings.news_sitemap_enabled) {
          return new Response("News sitemap disabled", { status: 404 });
        }

        // 200 recent posts comfortably covers any 48h publishing window.
        const posts = tenantId ? await fetchPublishedPosts(tenantId, 200) : [];
        const entries: NewsSitemapEntry[] = [];
        for (const post of posts) {
          if (!post.published_at) continue;
          if (post.title_pl) {
            entries.push({
              url: `${origin}${localizedPath(post.path, "pl")}`,
              title: post.title_pl,
              publishedAt: post.published_at,
              language: "pl",
            });
          }
          if (post.title_en) {
            entries.push({
              url: `${origin}${localizedPath(post.path, "en")}`,
              title: post.title_en,
              publishedAt: post.published_at,
              language: "en",
            });
          }
        }

        const xml = buildNewsSitemapXml({
          publicationName: effectiveNewsPublicationName(settings),
          entries,
        });
        // NAPRAWA 2026-09-02: pusta news-sitemapa dostawała ten sam TTL co
        // pełna, mimo że ŚWIEŻOŚĆ jest jej całym sensem. Google News czyta ten
        // plik po to, żeby zobaczyć wpisy z ostatnich 48 h; pusty dokument
        // zapamiętany na `s-maxage=300` plus `stale-while-revalidate=600`
        // wypada z okna nowości, a materiał opublikowany w czasie awarii nigdy
        // do News nie trafia. Defekt był przypięty jako `it.fails`
        // w `routes/__tests__/feedRoutesDegradation.test.ts`; przypięcie
        // przestało być uzasadnione w chwili, gdy powstał `lib/seo/feedCache.ts` -
        // naprawa to podanie liczby wpisów do gotowego kontraktu.
        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            // TTL PEŁNEJ news-sitemapy jest KRÓTSZY niż kanałów (minuty, nie
            // pół godziny) - świadomy wyjątek, taki sam jak dla relacji na
            // żywo, więc idzie jako `whenFull`.
            "Cache-Control": feedCacheControl(
              entries.length,
              "public, max-age=120, s-maxage=300, stale-while-revalidate=600",
            ),
          },
        });
      },
    },
  },
});
