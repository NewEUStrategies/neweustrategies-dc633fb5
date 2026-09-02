// Site-wide RSS 2.0 feed. Language-addressed like every content URL:
//   /rss.xml     -> Polish (default language, bare path)
//   /en/rss.xml  -> English (the router rewrite strips the prefix before
//                   matching, so both land in this handler; the raw request
//                   URL decides the feed language).
// Items carry excerpts only (paywall-safe) with canonical post URLs.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { trustedPublicHost } from "@/lib/http/requestHost";
import { DEFAULT_LANG, localizedPath, stripLangPrefix, type AppLang } from "@/lib/i18n/localePath";
import { SITE_DEFAULT_DESCRIPTION, SITE_DEFAULT_TITLE, SITE_NAME } from "@/lib/seo/meta";
import { siteDescriptionOverride, siteTitleOverride } from "@/lib/seo/settings";
import { buildRssXml, type RssItem } from "@/lib/seo/rss";
import { rssResponseHeaders } from "@/lib/seo/feedCache";
import { parseSeoSettings } from "@/lib/seo/settings";
import { fetchPublishedPosts, fetchSeoSettingsValue } from "@/lib/server/publishedContent.server";
import { crawlerDegradeIsSafe, resolveCrawlerTenantIdForHost } from "@/lib/server/tenant.server";

async function requestContext(): Promise<{ origin: string; host: string; lang: AppLang }> {
  const req = getRequest();
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = (await trustedPublicHost(req)) ?? "";
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
        const { origin, host, lang } = await requestContext();
        // Feeds are served with the service role (bypasses RLS), so the reads
        // MUST be scoped to the tenant owning this request host. FAIL-CLOSED:
        // a host no tenant has claimed (and that is not a preview host) gets
        // a 404 instead of the default tenant's feed on a foreign domain.
        // DEGRADACJA ≠ fail-closed: pusty/nieosiągalny katalog domen albo host
        // podglądowy/lokalny (dev, e2e z placeholderowym Supabase) dostaje
        // poprawny, PUSTY feed - nie ma treści żadnego tenanta do wycieku.
        const tenantId = await resolveCrawlerTenantIdForHost(host);
        if (!tenantId && !(await crawlerDegradeIsSafe(host))) {
          return new Response("Unknown host", { status: 404 });
        }
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
          title: siteTitleOverride(settings, lang) || SITE_DEFAULT_TITLE[lang],
          description: siteDescriptionOverride(settings, lang) || SITE_DEFAULT_DESCRIPTION[lang],
          siteUrl: `${origin}${localizedPath("/", lang)}`,
          feedUrl: `${origin}${localizedPath("/rss.xml", lang)}`,
          language: lang,
          copyright: `© ${new Date().getFullYear()} ${SITE_NAME}`,
          items,
        });

        // NAPRAWA 2026-09-02: kanał PUSTY dostawał ten sam DŁUGI TTL co pełny,
        // co utrwalało awarię trwającą sekundy na dobę (`s-maxage=1800` +
        // `stale-while-revalidate=86400`). Defekt był przypięty jako `it.fails`
        // w `routes/__tests__/feedRoutesDegradation.test.ts`; naprawa zdejmuje
        // to przypięcie i wchodzi razem z resztą kanałów przez jeden kontrakt
        // (`lib/seo/feedCache.ts`).
        return new Response(xml, { headers: rssResponseHeaders(items.length) });
      },
    },
  },
});
