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
import { rssResponseHeaders } from "@/lib/seo/feedCache";
import { parseSeoSettings } from "@/lib/seo/settings";
import {
  fetchSeoSettingsValue,
  fetchTrackerFeedSources,
} from "@/lib/server/publishedContent.server";
import { crawlerDegradeIsSafe, resolveCrawlerTenantIdForHost } from "@/lib/server/tenant.server";
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
  //
  // POPRAWKA 2026-08-03: brakowało drugiego członu tego predykatu. `/rss.xml`
  // od początku rozdziela DWA powody braku tenanta (patrz `crawlerDegradeIsSafe`,
  // którego docstring wprost mówi „utrzymywane razem (...), żeby predykat
  // bezpieczeństwa był jeden"):
  //   * nieznany host przy ZASIEDLONYM katalogu domen -> 404, bo nie wolno
  //     reklamować treści domyślnego tenanta na cudzej domenie,
  //   * host podglądu/lokalny albo PUSTY katalog domen -> nie ma czego wyciekać,
  //     więc kanał podaje poprawny, PUSTY feed.
  // Ten feed (i `/live/rss.xml`) miał tylko pierwszy człon, więc na hoście
  // podglądu i w CI bez zasianego katalogu zwracał 404 tam, gdzie `/rss.xml`
  // zwracał 200 - `e2e/seo.spec.ts` słusznie to wyłapało („404 jest akceptowalny
  // tylko gdy redakcja wyłączyła RSS"). Fail-closed dla realnych obcych domen
  // zostaje nietknięty.
  const tenantId = await resolveCrawlerTenantIdForHost(host);
  if (!tenantId && !(await crawlerDegradeIsSafe(host))) {
    return new Response("Unknown host", { status: 404 });
  }

  const settings = parseSeoSettings(tenantId ? await fetchSeoSettingsValue(tenantId) : null);
  if (!settings.rss_enabled) return new Response("Feed disabled", { status: 404 });

  const limit = settings.rss_item_count;
  const { items, updates } = tenantId
    ? await fetchTrackerFeedSources(tenantId, limit)
    : { items: [], updates: [] };
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

  // TTL zależny od liczby pozycji: kanał zdegradowany (czytnik źródeł padł
  // i `resilient` oddał pustkę) nie może utrwalić się na brzegu na dobę.
  return new Response(xml, { headers: rssResponseHeaders(feedItems.length) });
}
