// Wspólna fabryka odpowiedzi feedów tematycznych (D3): RSS 2.0 per
// kategoria / tag / program. Trzy trasy (/category/$slug/rss.xml,
// /tag/$slug/rss.xml, /programs/$slug/rss.xml) różnią się wyłącznie rodzajem
// taksonomii i publiczną ścieżką huba - cała mechanika (tenant fail-closed,
// respektowanie rss_enabled, język z prefiksu URL, cache headers) jest jedna,
// identyczna z /rss.xml.
import { getRequest } from "@tanstack/react-start/server";
import { crawlerPublishOrigin } from "@/lib/http/host";
import { trustedPublicHost } from "@/lib/http/requestHost";
import { DEFAULT_LANG, localizedPath, stripLangPrefix, type AppLang } from "@/lib/i18n/localePath";
import { SITE_NAME } from "@/lib/seo/meta";
import { buildRssXml, type RssItem } from "@/lib/seo/rss";
import { rssResponseHeaders } from "@/lib/seo/feedCache";
import { parseSeoSettings, siteNameOverride } from "@/lib/seo/settings";
import {
  fetchPublishedPostsByTaxonomy,
  fetchSeoSettingsValue,
  fetchTaxonomyForFeed,
  type FeedTaxonomyKind,
} from "@/lib/server/publishedContent.server";
import { resolveCrawlerTenantIdForHost } from "@/lib/server/tenant.server";

/** Publiczna ścieżka huba taksonomii (siteUrl kanału + baza feedUrl). */
const HUB_PATH: Record<FeedTaxonomyKind, (slug: string) => string> = {
  category: (slug) => `/category/${slug}`,
  tag: (slug) => `/tag/${slug}`,
  program: (slug) => `/programs/${slug}`,
};

async function requestContext(): Promise<{ origin: string; host: string; lang: AppLang }> {
  const req = getRequest();
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = (await trustedPublicHost(req)) ?? "";
  // WSPÓLNA reguła originu powierzchni crawlera (`crawlerPublishOrigin`) - ta
  // sama, co /rss.xml, mapa strony, robots.txt i llms.txt. Wcześniej origin
  // składał się tu wprost z hosta żądania, więc na hoście podglądu kanał
  // kategorii linkował `https://localhost/...`, a na aliasie hostingu - adres
  // aliasu zamiast kanonicznego; brak zaufanego hosta dawał adresy względne,
  // których czytnik RSS nie umie rozwiązać.
  const origin = crawlerPublishOrigin(host, proto);
  let lang: AppLang = DEFAULT_LANG;
  try {
    lang = stripLangPrefix(new URL(req.url).pathname).lang ?? DEFAULT_LANG;
  } catch {
    /* keep default */
  }
  return { origin, host, lang };
}

export async function taxonomyFeedResponse(
  kind: FeedTaxonomyKind,
  slug: string,
): Promise<Response> {
  const { origin, host, lang } = await requestContext();
  // Jak /rss.xml: service role omija RLS, więc odczyt MUSI być zescope'owany
  // do tenanta właściciela hosta; nieznany host = 404 (fail-closed).
  // Członu degradacji (`crawlerDegradeIsSafe`) tu ŚWIADOMIE nie ma: kanał jest
  // adresowany SLUGIEM, a bez tenanta nie ma czego znaleźć po slugu - każda
  // droga i tak kończy się 404 (ta sama reguła, co `/podcasts/$show/rss.xml`;
  // przypięta w `routes/__tests__/feedRoutesDegradation.test.ts`, blok N2).
  const tenantId = await resolveCrawlerTenantIdForHost(host);
  if (!tenantId) return new Response("Unknown host", { status: 404 });

  const settings = parseSeoSettings(await fetchSeoSettingsValue(tenantId));
  if (!settings.rss_enabled) return new Response("Feed disabled", { status: 404 });

  const taxonomy = await fetchTaxonomyForFeed(tenantId, kind, slug);
  if (!taxonomy) return new Response("Not found", { status: 404 });

  const posts = await fetchPublishedPostsByTaxonomy(tenantId, kind, slug, settings.rss_item_count);
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

  // Spadek nazwy jest SYMETRYCZNY: taksonomia opisana wyłącznie w jednym
  // języku (import, program prowadzony po angielsku) nie może wystawić kanału
  // drugiego języka z tytułem " - <serwis>" - czytniki RSS zapisują tytuł
  // kanału trwale przy subskrypcji, więc późniejsza poprawka treści by go nie
  // naprawiła. Ostatnią deską jest slug, jak dla tytułu pozycji wyżej.
  const name =
    (lang === "en" ? taxonomy.name_en || taxonomy.name_pl : taxonomy.name_pl || taxonomy.name_en) ||
    slug;
  const description =
    (lang === "en"
      ? taxonomy.description_en || taxonomy.description_pl
      : taxonomy.description_pl || taxonomy.description_en) ||
    (lang === "en" ? `Latest analyses: ${name}` : `Najnowsze analizy: ${name}`);
  const hubPath = HUB_PATH[kind](slug);
  // Nazwa serwisu z ustawień SEO (już pobranych wyżej) - to samo źródło, co
  // `og:site_name` i `WebSite.name`; stała marki tylko jako zapas.
  const siteName = siteNameOverride(settings) || SITE_NAME;

  const xml = buildRssXml({
    title: `${name} - ${siteName}`,
    description,
    siteUrl: `${origin}${localizedPath(hubPath, lang)}`,
    feedUrl: `${origin}${localizedPath(`${hubPath}/rss.xml`, lang)}`,
    language: lang,
    copyright: `© ${new Date().getFullYear()} ${siteName}`,
    items,
  });

  // Taksonomia ISTNIEJE (inaczej wyszliśmy 404 wyżej), ale może nie mieć ani
  // jednego opublikowanego wpisu - albo czytnik wpisów zdegradował do pustki.
  // Krótki TTL dla kanału pustego, patrz `feedCache.ts`.
  return new Response(xml, { headers: rssResponseHeaders(items.length) });
}
