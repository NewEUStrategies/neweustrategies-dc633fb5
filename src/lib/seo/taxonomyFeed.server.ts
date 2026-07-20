// Wspólna fabryka odpowiedzi feedów tematycznych (D3): RSS 2.0 per
// kategoria / tag / program. Trzy trasy (/category/$slug/rss.xml,
// /tag/$slug/rss.xml, /programs/$slug/rss.xml) różnią się wyłącznie rodzajem
// taksonomii i publiczną ścieżką huba - cała mechanika (tenant fail-closed,
// respektowanie rss_enabled, język z prefiksu URL, cache headers) jest jedna,
// identyczna z /rss.xml.
import { getRequest } from "@tanstack/react-start/server";
import { requestPublicHost } from "@/lib/http/requestHost";
import { DEFAULT_LANG, localizedPath, stripLangPrefix, type AppLang } from "@/lib/i18n/localePath";
import { SITE_NAME } from "@/lib/seo/meta";
import { buildRssXml, type RssItem } from "@/lib/seo/rss";
import { parseSeoSettings } from "@/lib/seo/settings";
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

function requestContext(): { origin: string; host: string; lang: AppLang } {
  const req = getRequest();
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = requestPublicHost(req) ?? "";
  const origin = host ? `${proto}://${host}` : "";
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
  const { origin, host, lang } = requestContext();
  // Jak /rss.xml: service role omija RLS, więc odczyt MUSI być zescope'owany
  // do tenanta właściciela hosta; nieznany host = 404 (fail-closed).
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

  const name = lang === "en" ? taxonomy.name_en || taxonomy.name_pl : taxonomy.name_pl;
  const description =
    (lang === "en"
      ? taxonomy.description_en || taxonomy.description_pl
      : taxonomy.description_pl || taxonomy.description_en) ||
    (lang === "en" ? `Latest analyses: ${name}` : `Najnowsze analizy: ${name}`);
  const hubPath = HUB_PATH[kind](slug);

  const xml = buildRssXml({
    title: `${name} - ${SITE_NAME}`,
    description,
    siteUrl: `${origin}${localizedPath(hubPath, lang)}`,
    feedUrl: `${origin}${localizedPath(`${hubPath}/rss.xml`, lang)}`,
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
}
