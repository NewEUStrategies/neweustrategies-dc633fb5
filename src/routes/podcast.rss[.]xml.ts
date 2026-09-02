// Podcast RSS 2.0 + iTunes feed at /podcast/rss.xml. Served with the service
// role (RLS bypassed), so reads are scoped to the tenant owning the request
// host, FAIL-CLOSED like the site feeds. Items carry <enclosure> audio + the
// iTunes tags Apple/Spotify need to ingest the show - this is the real feed the
// admin "RSS" subscription link should point at when no external URL is set.
//
// UJEDNOLICENIE KONTRAKTU 2026-09-02 (N2 audytu pokrycia). Ten kanał i
// `/live/rss.xml` - dwie powierzchnie crawlera TEGO SAMEGO modułu - miały DWA
// różne kontrakty braku tenanta, a różnica nie była zamierzona:
//
//   * `/live/rss.xml`, `/rss.xml` i `/tracker/rss.xml` rozdzielają DWA powody
//     braku tenanta (patrz docstring `crawlerDegradeIsSafe`, który wprost mówi
//     „utrzymywane razem (...), żeby predykat bezpieczeństwa był jeden");
//   * ten kanał miał wyłącznie człon fail-closed, więc na hoście podglądowym
//     i przy nieosiągalnym katalogu domen oddawał 404 tam, gdzie tamte trzy
//     oddawały poprawny, pusty kanał.
//
// KTÓRY KONTRAKT JEST POPRAWNY: dwuczłonowy. Człon fail-closed decyduje o
// szczelności tenanta i jest w obu wariantach IDENTYCZNY - realna obca domena
// przy zasiedlonym katalogu dostaje 404 tak samo. Jednoczłonowy warunek NIE
// zacieśnia więc niczego; zamienia tylko „katalog domen nieosiągalny" na 404
// na hostach podglądowych i w CI, czyli jest regresją DOSTĘPNOŚCI bez zysku
// bezpieczeństwa. Ta trasa dostaje dziś ten sam predykat, co pozostałe trzy.
//
// Degradacja emituje kanał PUSTY, a pusty kanał podcastu utrwalony na brzegu
// to ryzyko wypadnięcia audycji z katalogu Apple - dlatego TTL odpowiedzi
// zależy od liczby pozycji (patrz `lib/seo/feedCache.ts`). Bez tego drugiego
// pół kroku ujednolicenie predykatu byłoby wymianą jednej awarii na drugą.
//
// Kanał respektuje też `rss_enabled` - tak jak `/rss.xml`, `/tracker/rss.xml`,
// `/live/rss.xml` i feedy taksonomii. Dotąd był JEDYNYM kanałem RSS w
// repozytorium, którego redakcja nie mogła wyłączyć: przełącznik „RSS" w
// ustawieniach SEO gasił wszystkie pozostałe, a ten serwował dalej. Świadomy
// koszt tej decyzji: wyłączenie RSS gasi także subskrypcję audycji, więc jeśli
// redakcja będzie potrzebowała rozdzielić te dwa zamiary, właściwym krokiem
// jest OSOBNY przełącznik `podcast_feed_enabled`, a nie kanał ignorujący
// jedyny przełącznik, jaki istnieje.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { trustedPublicHost } from "@/lib/http/requestHost";
import { DEFAULT_LANG, localizedPath, stripLangPrefix, type AppLang } from "@/lib/i18n/localePath";
import {
  SITE_DEFAULT_DESCRIPTION,
  SITE_DEFAULT_OG_IMAGE,
  SITE_DEFAULT_TITLE,
  SITE_NAME,
} from "@/lib/seo/meta";
import {
  buildPodcastRssXml,
  type PodcastEpisodeType,
  type PodcastRssItem,
} from "@/lib/seo/podcastRss";
import { resolvePodcastChannelMeta } from "@/lib/seo/podcastChannelMeta";
import { parseSeoSettings } from "@/lib/seo/settings";
import { rssResponseHeaders } from "@/lib/seo/feedCache";
import {
  fetchMediaMetaByUrls,
  fetchPodcastChannelMeta,
  fetchPublishedPodcasts,
  fetchSeoSettingsValue,
  type PodcastChannelMetaRow,
  type PublishedPodcastRow,
} from "@/lib/server/publishedContent.server";
import { crawlerDegradeIsSafe, resolveCrawlerTenantIdForHost } from "@/lib/server/tenant.server";

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

export const Route = createFileRoute("/podcast/rss.xml")({
  server: {
    handlers: {
      GET: async () => {
        const { origin, host, lang } = await requestContext();
        // FAIL-CLOSED + DEGRADACJA, jeden predykat dla wszystkich kanałów
        // (patrz nagłówek pliku): obca domena przy zasiedlonym katalogu to 404,
        // host podglądowy / nieosiągalny katalog to poprawny, pusty kanał.
        const tenantId = await resolveCrawlerTenantIdForHost(host);
        if (!tenantId && !(await crawlerDegradeIsSafe(host))) {
          return new Response("Unknown host", { status: 404 });
        }

        const settings = parseSeoSettings(tenantId ? await fetchSeoSettingsValue(tenantId) : null);
        if (!settings.rss_enabled) {
          return new Response("Feed disabled", { status: 404 });
        }

        // Oba odczyty RÓWNOLEGLE - jak dotąd. Limit 6 równoległych
        // subrequestów na żądanie w Workers jest tu bez znaczenia (dwa),
        // ale serializacja dołożyłaby round-trip do TTFB kanału.
        const [episodes, channelMeta]: [PublishedPodcastRow[], PodcastChannelMetaRow | null] =
          tenantId
            ? await Promise.all([
                fetchPublishedPodcasts(tenantId),
                fetchPodcastChannelMeta(tenantId),
              ])
            : [[], null];
        const withAudio = episodes
          // Bez URL audio odcinek nie jest prawidłowym elementem podcastu.
          .filter((e) => !!e.audio_url);
        // Prawdziwy rozmiar + MIME dla plików wgranych przez bibliotekę mediów
        // (enclosure length/type); zewnętrzne URL-e zostają przy length=0.
        const mediaMeta = tenantId
          ? await fetchMediaMetaByUrls(
              tenantId,
              withAudio.map((e) => e.audio_url),
            )
          : new Map<string, { sizeBytes: number | null; mimeType: string | null }>();
        const items: PodcastRssItem[] = withAudio.map((e) => ({
          url: `${origin}${localizedPath(`/podcast/${e.slug}`, lang)}`,
          // Tożsamość odcinka jest jedna dla obu kanałów językowych - adres
          // kanoniczny bez prefiksu (patrz PodcastRssItem.guid).
          guid: `${origin}/podcast/${e.slug}`,
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

        // Metadane wymagane przez Apple Podcasts Connect (kategoria, explicit,
        // okładka, właściciel). Kanał sieciowy nie ma programu nadrzędnego, więc
        // scalamy `podcast_settings` z domyślnymi marki - dotąd ta trasa nie
        // podawała nawet `imageUrl`, więc feed wychodził bez <itunes:image>.
        const meta = resolvePodcastChannelMeta({
          channel: channelMeta,
          fallback: {
            author: SITE_NAME,
            imageUrl: `${origin}${SITE_DEFAULT_OG_IMAGE}`,
            copyright: `© ${new Date().getFullYear()} ${SITE_NAME}`,
          },
        });

        const xml = buildPodcastRssXml({
          title: `${SITE_DEFAULT_TITLE[lang]} · Podcast`,
          description: SITE_DEFAULT_DESCRIPTION[lang],
          siteUrl: `${origin}${localizedPath("/podcasts", lang)}`,
          feedUrl: `${origin}${localizedPath("/podcast/rss.xml", lang)}`,
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
          items,
        });

        // TTL zależny od liczby pozycji: pusty kanał podcastu utrwalony na
        // brzegu to ryzyko wypadnięcia audycji z katalogu Apple.
        return new Response(xml, { headers: rssResponseHeaders(items.length) });
      },
    },
  },
});
