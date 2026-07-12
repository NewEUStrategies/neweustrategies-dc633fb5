// Podcast RSS 2.0 + iTunes feed at /podcast/rss.xml. Served with the service
// role (RLS bypassed), so reads are scoped to the tenant owning the request
// host, FAIL-CLOSED like the site feeds. Items carry <enclosure> audio + the
// iTunes tags Apple/Spotify need to ingest the show - this is the real feed the
// admin "RSS" subscription link should point at when no external URL is set.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { requestPublicHost } from "@/lib/http/requestHost";
import { DEFAULT_LANG, localizedPath, stripLangPrefix, type AppLang } from "@/lib/i18n/localePath";
import { SITE_DEFAULT_DESCRIPTION, SITE_DEFAULT_TITLE, SITE_NAME } from "@/lib/seo/meta";
import { buildPodcastRssXml, type PodcastRssItem } from "@/lib/seo/podcastRss";
import { fetchMediaMetaByUrls, fetchPublishedPodcasts } from "@/lib/server/publishedContent.server";
import { resolveCrawlerTenantIdForHost } from "@/lib/server/tenant.server";

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

export const Route = createFileRoute("/podcast/rss.xml")({
  server: {
    handlers: {
      GET: async () => {
        const { origin, host, lang } = requestContext();
        const tenantId = await resolveCrawlerTenantIdForHost(host);
        if (!tenantId) {
          return new Response("Unknown host", { status: 404 });
        }

        const episodes = await fetchPublishedPodcasts(tenantId);
        const withAudio = episodes
          // Bez URL audio odcinek nie jest prawidłowym elementem podcastu.
          .filter((e) => !!e.audio_url);
        // Prawdziwy rozmiar + MIME dla plików wgranych przez bibliotekę mediów
        // (enclosure length/type); zewnętrzne URL-e zostają przy length=0.
        const mediaMeta = await fetchMediaMetaByUrls(
          tenantId,
          withAudio.map((e) => e.audio_url),
        );
        const items: PodcastRssItem[] = withAudio.map((e) => ({
          url: `${origin}${localizedPath(`/podcast/${e.slug}`, lang)}`,
          title: (lang === "en" ? e.title_en || e.title_pl : e.title_pl || e.title_en) || e.slug,
          description: lang === "en" ? e.excerpt_en || e.excerpt_pl : e.excerpt_pl || e.excerpt_en,
          publishedAt: e.published_at,
          audioUrl: e.audio_url,
          audioBytes: mediaMeta.get(e.audio_url)?.sizeBytes ?? null,
          audioMime: mediaMeta.get(e.audio_url)?.mimeType ?? null,
          durationSeconds: e.duration_seconds,
          season: e.season,
          episodeNumber: e.episode_number,
          imageUrl: e.cover_image_url,
        }));

        const xml = buildPodcastRssXml({
          title: `${SITE_DEFAULT_TITLE[lang]} · Podcast`,
          description: SITE_DEFAULT_DESCRIPTION[lang],
          siteUrl: `${origin}${localizedPath("/podcasts", lang)}`,
          feedUrl: `${origin}${localizedPath("/podcast/rss.xml", lang)}`,
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
