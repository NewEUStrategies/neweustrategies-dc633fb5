// Google News sitemap (/news-sitemap.xml) - a hard requirement for a news
// publisher. Only articles from the last 48h are listed (Google News rule,
// enforced in the pure builder); each language version is its own entry with a
// matching <news:language>. Advertised from robots.txt next to the main
// sitemap. Short cache: freshness is the whole point of this surface.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { localizedPath } from "@/lib/i18n/localePath";
import { buildNewsSitemapXml, type NewsSitemapEntry } from "@/lib/seo/newsSitemap";
import { effectiveNewsPublicationName, parseSeoSettings } from "@/lib/seo/settings";
import { fetchPublishedPosts, fetchSeoSettingsValue } from "@/lib/server/publishedContent.server";
import { resolveTenantIdForHost } from "@/lib/server/tenant.server";

function requestContext(): { origin: string; host: string } {
  const req = getRequest();
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host") ?? "";
  return { origin: host ? `${proto}://${host}` : "", host };
}

export const Route = createFileRoute("/news-sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const { origin, host } = requestContext();
        // Service-role reads below bypass RLS - scope them to the host's
        // tenant. Unresolvable tenant -> empty sitemap shell (crawler surfaces
        // never 500 and never serve unscoped data).
        const tenantId = await resolveTenantIdForHost(host);
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
        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=120, s-maxage=300, stale-while-revalidate=600",
          },
        });
      },
    },
  },
});
