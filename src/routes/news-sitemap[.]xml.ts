// Google News sitemap (/news-sitemap.xml) - a hard requirement for a news
// publisher. Only articles from the last 48h are listed (Google News rule,
// enforced in the pure builder); each language version is its own entry with a
// matching <news:language>. Advertised from robots.txt next to the main
// sitemap. Short cache: freshness is the whole point of this surface.
//
// NAPRAWA 2026-10-10: dzień bez publikacji NIE daje już pustego <urlset>
// (Search Console: „Brak tagu XML: url, wiersz 3"). Plan z `planNewsSitemap`
// niesie wtedy najnowszy artykuł jako kotwicę, a tenant bez żadnego artykułu
// dostaje 404 - pliku nie ma i indeks go nie ogłasza. Uzasadnienie:
// `lib/seo/newsSitemap.ts`.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { trustedPublicHost } from "@/lib/http/requestHost";
import { crawlerPublishOrigin } from "@/lib/http/host";
import { planNewsSitemap, renderNewsSitemapXml } from "@/lib/seo/newsSitemap";
import { FEED_CACHE_CONTROL_EMPTY, feedCacheControl } from "@/lib/seo/feedCache";
import { effectiveNewsPublicationName, parseSeoSettings } from "@/lib/seo/settings";
import { fetchSeoSettingsValue } from "@/lib/server/publishedContent.server";
import { loadNewsSitemapEntries } from "@/lib/server/newsSitemapEntries.server";
import { SITEMAP_ROBOTS_HEADER } from "@/lib/server/sitemapRequest.server";
import { crawlerDegradeIsSafe, resolveCrawlerTenantIdForHost } from "@/lib/server/tenant.server";

async function requestContext(): Promise<{ origin: string; host: string }> {
  const req = getRequest();
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = (await trustedPublicHost(req)) ?? "";
  // Ten sam origin, co mapa główna i robots.txt - patrz crawlerPublishOrigin.
  return { origin: crawlerPublishOrigin(host, proto), host };
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

        const entries = tenantId ? await loadNewsSitemapEntries(tenantId, origin) : [];
        const plan = planNewsSitemap(entries, Date.now());

        // Brak JAKIEGOKOLWIEK artykułu (tenant bez treści, host podglądu bez
        // tenanta, czytnik `resilient` po awarii bazy): dokumentu, który
        // przeszedłby walidację schematu, nie da się zbudować - pusty
        // <urlset> to właśnie błąd „Brak tagu XML: url". 404 z krótkim TTL
        // odpowiedzi zdegradowanej: indeks w tym stanie pliku nie ogłasza,
        // a po pierwszej publikacji (albo powrocie bazy) plik wraca w minutę.
        if (plan.mode === "empty") {
          return new Response("No news articles", {
            status: 404,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": FEED_CACHE_CONTROL_EMPTY,
              ...SITEMAP_ROBOTS_HEADER,
            },
          });
        }

        const xml = renderNewsSitemapXml(effectiveNewsPublicationName(settings), plan.entries);
        // NAPRAWA 2026-09-02: pusta news-sitemapa dostawała ten sam TTL co
        // pełna, mimo że ŚWIEŻOŚĆ jest jej całym sensem. Google News czyta ten
        // plik po to, żeby zobaczyć wpisy z ostatnich 48 h; pusty dokument
        // zapamiętany na `s-maxage=300` plus `stale-while-revalidate=600`
        // wypada z okna nowości, a materiał opublikowany w czasie awarii nigdy
        // do News nie trafia. Ten sam kontrakt obejmuje od 2026-10-10 plik
        // z samą KOTWICĄ (okno 48 h puste): to stan „czekam na publikację",
        // więc nowy artykuł musi pojawić się w minutę, nie po SWR.
        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            // TTL PEŁNEJ news-sitemapy jest KRÓTSZY niż kanałów (minuty, nie
            // pół godziny) - świadomy wyjątek, taki sam jak dla relacji na
            // żywo, więc idzie jako `whenFull`.
            "Cache-Control": feedCacheControl(
              plan.mode === "fresh" ? plan.entries.length : 0,
              "public, max-age=120, s-maxage=300, stale-while-revalidate=600",
            ),
            ...SITEMAP_ROBOTS_HEADER,
          },
        });
      },
    },
  },
});
