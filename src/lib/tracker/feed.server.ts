// Odpowiedź kanału RSS trackera legislacyjnego UE (/tracker/rss.xml,
// /en/tracker/rss.xml). Ta sama mechanika co feedy taksonomii
// (`lib/seo/taxonomyFeed.server.ts`): zaufany host -> tenant fail-closed,
// respektowanie ustawień SEO, język z prefiksu URL, identyczne nagłówki cache.
// Treść pozycji buduje czysty `lib/tracker/feed.ts`, więc tutaj zostaje tylko
// obsługa żądania.
import { getRequest } from "@tanstack/react-start/server";
import { trustedPublicHost } from "@/lib/http/requestHost";
import { DEFAULT_LANG, localizedPath, stripLangPrefix, type AppLang } from "@/lib/i18n/localePath";
import { SITE_NAME } from "@/lib/seo/meta";
import { buildRssXml } from "@/lib/seo/rss";
import { parseSeoSettings } from "@/lib/seo/settings";
import {
  fetchSeoSettingsValue,
  fetchTrackerFeedSources,
} from "@/lib/server/publishedContent.server";
import { resolveCrawlerTenantIdForHost } from "@/lib/server/tenant.server";
import {
  buildTrackerFeedItems,
  trackerFeedChannelText,
  TRACKER_FEED_PATH,
  TRACKER_HUB_PATH,
} from "@/lib/tracker/feed";

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

export async function trackerFeedResponse(): Promise<Response> {
  const { origin, host, lang } = await requestContext();
  // Jak /rss.xml: service role omija RLS, więc odczyt MUSI być zescope'owany
  // do tenanta właściciela hosta; nieznany host = 404 (fail-closed).
  const tenantId = await resolveCrawlerTenantIdForHost(host);
  if (!tenantId) return new Response("Unknown host", { status: 404 });

  const settings = parseSeoSettings(await fetchSeoSettingsValue(tenantId));
  if (!settings.rss_enabled) return new Response("Feed disabled", { status: 404 });

  const limit = settings.rss_item_count;
  const { items, updates } = await fetchTrackerFeedSources(tenantId, limit);
  const feedItems = buildTrackerFeedItems({ items, updates, origin, lang, limit });
  const channel = trackerFeedChannelText(lang);

  const xml = buildRssXml({
    title: `${channel.title} - ${SITE_NAME}`,
    description: channel.description,
    siteUrl: `${origin}${localizedPath(TRACKER_HUB_PATH, lang)}`,
    feedUrl: `${origin}${localizedPath(TRACKER_FEED_PATH, lang)}`,
    language: lang,
    copyright: `© ${new Date().getFullYear()} ${SITE_NAME}`,
    items: feedItems,
  });

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400",
    },
  });
}
