// Per-program podcast RSS 2.0 + iTunes feed at /podcasts/$show/rss.xml.
// Separate feed for each program (RUSI/think-tank "distinct series" model), alongside
// the network-wide feed at /podcast/rss.xml. Served with the service role (RLS
// bypassed), so reads are scoped to the tenant owning the request host and
// FAIL-CLOSED like the site feeds.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { trustedPublicHost } from "@/lib/http/requestHost";
import { DEFAULT_LANG, localizedPath, stripLangPrefix, type AppLang } from "@/lib/i18n/localePath";
import { SITE_DEFAULT_OG_IMAGE, SITE_DEFAULT_TITLE, SITE_NAME } from "@/lib/seo/meta";
import {
  buildPodcastRssXml,
  type PodcastEpisodeType,
  type PodcastRssItem,
} from "@/lib/seo/podcastRss";
import { resolvePodcastChannelMeta } from "@/lib/seo/podcastChannelMeta";
import {
  fetchMediaMetaByUrls,
  fetchPodcastChannelMeta,
  fetchPublishedPodcastsByShow,
  fetchPublishedShowBySlug,
} from "@/lib/server/publishedContent.server";
import { resolveCrawlerTenantIdForHost } from "@/lib/server/tenant.server";

/** `podcasts.episode_type` -> typ Apple; nieznana wartość degraduje do "full". */
function episodeType(raw: string | null | undefined): PodcastEpisodeType {
  return raw === "trailer" || raw === "bonus" ? raw : "full";
}

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

export const Route = createFileRoute("/podcasts/$show/rss.xml")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { origin, host, lang } = await requestContext();
        const tenantId = await resolveCrawlerTenantIdForHost(host);
        if (!tenantId) {
          return new Response("Unknown host", { status: 404 });
        }

        const show = await fetchPublishedShowBySlug(tenantId, params.show);
        if (!show) {
          return new Response("Unknown program", { status: 404 });
        }

        const [episodes, channelMeta] = await Promise.all([
          fetchPublishedPodcastsByShow(tenantId, show.id),
          fetchPodcastChannelMeta(tenantId),
        ]);
        const withAudio = episodes.filter((e) => !!e.audio_url);
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
          explicit: e.explicit,
          episodeType: episodeType(e.episode_type),
        }));

        const showTitle =
          (lang === "en" ? show.title_en || show.title_pl : show.title_pl || show.title_en) ||
          show.slug;
        const showDesc =
          (lang === "en" ? show.description_en || show.description_pl : show.description_pl) ||
          SITE_DEFAULT_TITLE[lang];

        // Program nadpisuje metadane kanału sieciowego (inny prowadzący, inna
        // kategoria), a brakujące pola dziedziczy - patrz podcastChannelMeta.
        const meta = resolvePodcastChannelMeta({
          channel: channelMeta,
          show,
          fallback: {
            author: SITE_NAME,
            imageUrl: `${origin}${SITE_DEFAULT_OG_IMAGE}`,
            copyright: `© ${new Date().getFullYear()} ${SITE_NAME}`,
          },
        });

        const xml = buildPodcastRssXml({
          title: `${SITE_DEFAULT_TITLE[lang]} · ${showTitle}`,
          description: showDesc,
          siteUrl: `${origin}${localizedPath(`/podcasts/${show.slug}`, lang)}`,
          feedUrl: `${origin}${localizedPath(`/podcasts/${show.slug}/rss.xml`, lang)}`,
          language: lang,
          copyright: meta.copyright,
          imageUrl: meta.imageUrl,
          author: meta.author,
          ownerName: meta.ownerName,
          ownerEmail: meta.ownerEmail,
          category: meta.category,
          subcategory: meta.subcategory,
          explicit: meta.explicit,
          showType: meta.showType,
          complete: meta.complete,
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
