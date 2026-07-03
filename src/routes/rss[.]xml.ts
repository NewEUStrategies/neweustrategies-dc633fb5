// Site-wide RSS 2.0 feed. Language-addressed like every content URL:
//   /rss.xml     -> Polish (default language, bare path)
//   /en/rss.xml  -> English (the router rewrite strips the prefix before
//                   matching, so both land in this handler; the raw request
//                   URL decides the feed language).
// Items carry excerpts only (paywall-safe) with canonical post URLs.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { DEFAULT_LANG, localizedPath, stripLangPrefix, type AppLang } from "@/lib/i18n/localePath";
import { SITE_DEFAULT_DESCRIPTION, SITE_DEFAULT_TITLE, SITE_NAME } from "@/lib/seo/meta";
import { buildRssXml, type RssItem } from "@/lib/seo/rss";
import { parseSeoSettings } from "@/lib/seo/settings";
import { fetchPublishedPosts, fetchSeoSettingsValue } from "@/lib/server/publishedContent.server";
import { resolveTenantIdForHost } from "@/lib/server/tenant.server";

function requestContext(): { origin: string; host: string; lang: AppLang } {
  const req = getRequest();
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host") ?? "";
  const origin = host ? `${proto}://${host}` : "";
  let lang: AppLang = DEFAULT_LANG;
  try {
    lang = stripLangPrefix(new URL(req.url).pathname).lang ?? DEFAULT_LANG;
  } catch {
    /* keep default */
  }
  return { origin, host, lang };
}

export const Route = createFileRoute("/rss.xml")({
  server: {
    handlers: {
      GET: async () => {
        const { origin, host, lang } = requestContext();
        // Feeds are served with the service role (bypasses RLS), so the reads
        // MUST be scoped to the tenant owning this request host. When the
        // tenant directory is unavailable the feed degrades to an EMPTY shell
        // (crawler surfaces never 500 and never serve unscoped data).
        const tenantId = await resolveTenantIdForHost(host);
        const settings = parseSeoSettings(tenantId ? await fetchSeoSettingsValue(tenantId) : null);
        if (!settings.rss_enabled) {
          return new Response("Feed disabled", { status: 404 });
        }

        const posts = tenantId ? await fetchPublishedPosts(tenantId, settings.rss_item_count) : [];
        const items: RssItem[] = posts.map((post) => ({
          url: `${origin}${localizedPath(post.path, lang)}`,
          title:
            (lang === "en" ? post.title_en || post.title_pl : post.title_pl || post.title_en) ||
            post.slug,
          description:
            lang === "en" ? post.excerpt_en || post.excerpt_pl : post.excerpt_pl || post.excerpt_en,
          publishedAt: post.published_at,
          imageUrl: post.cover_image_url,
        }));

        const xml = buildRssXml({
          title: SITE_DEFAULT_TITLE[lang],
          description: SITE_DEFAULT_DESCRIPTION[lang],
          siteUrl: `${origin}${localizedPath("/", lang)}`,
          feedUrl: `${origin}${localizedPath("/rss.xml", lang)}`,
          language: lang,
          copyright: `© ${new Date().getFullYear()} ${SITE_NAME}`,
          items,
        });

        return new Response(xml, {
          headers: {
            "Content-Type": "application/rss+xml; charset=utf-8",
            "Cache-Control": "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400",
          },
        });
      },
    },
  },
});
