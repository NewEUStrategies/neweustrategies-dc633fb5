// Public podcast network. URL: /podcasts - the discovery page. Podcast is a
// NETWORK OF PROGRAMS (RUSI/think-tank pattern), not a flat file list: it leads with
// the catalogue of programs (series), each linking to its own program page,
// followed by the newest episodes across the whole network. Links to the
// built-in network RSS feed.
import { createFileRoute, Link, type ErrorComponentProps } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Mic } from "@/lib/lucide-shim";
import { Rss } from "lucide-react";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { DegradedDataNotice } from "@/components/molecules/DegradedDataNotice";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { CARD_IMAGE_SIZES } from "@/lib/cardImageSizes";
import { buildAvatarSrc } from "@/lib/cropSizes";
import {
  latestPodcastsQueryOptions,
  publishedShowsQueryOptions,
  showEpisodeStatsQueryOptions,
  type ShowEpisodeStat,
} from "@/lib/queries/podcasts";
import {
  podcastTitle,
  podcastEpisodeLabel,
  formatDuration,
  showTitle,
  showDescription,
  type Podcast,
  type PodcastShow,
} from "@/lib/podcast/types";
import { anyDegraded, loadResilient, resilientCacheControl } from "@/lib/ssr/resilientLoad";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { ensureI18n as ensurePodcastsI18n } from "@/lib/i18n-podcasts";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import {
  SITE_CANONICAL_ORIGIN,
  buildContentHead,
  feedAlternateLink,
  splitUrl,
} from "@/lib/seo/meta";

const INDEX_LIMIT = 30;

/** Puste kolekcje jako fallback zdegradowanego renderu (lib/ssr/resilientLoad). */
const NO_EPISODES: Podcast[] = [];
const NO_SHOWS: PodcastShow[] = [];
const NO_STATS: ShowEpisodeStat[] = [];

export const Route = createFileRoute("/podcasts/")({
  // Odporne SSR: trzy zapytania biegną RÓWNOLEGLE, każde z własnym budżetem,
  // więc wall-clock loadera to jeden budżet, nie suma trzech. Blip backendu
  // daje HTTP 200 z uczciwym komunikatem zamiast 500 (lib/ssr/resilientLoad).
  loader: async ({ context }) => {
    const [episodes, shows, stats] = await Promise.all([
      loadResilient(context.queryClient, latestPodcastsQueryOptions(INDEX_LIMIT), NO_EPISODES),
      loadResilient(context.queryClient, publishedShowsQueryOptions, NO_SHOWS),
      loadResilient(context.queryClient, showEpisodeStatsQueryOptions, NO_STATS),
    ]);
    const degraded = anyDegraded(episodes, shows, stats);
    setCacheControlHeader(resilientCacheControl(degraded));
    return { degraded };
  },
  head: () => {
    const url = getRequestUrl() || "/podcasts";
    const lang = activeLang(url);
    const head = buildContentHead({
      url,
      lang,
      type: "website",
      title: "Podcast - New European Strategies",
      description:
        lang === "en"
          ? "New European Strategies podcast network - browse programs and listen to the latest episodes."
          : "Sieć podcastów New European Strategies - przeglądaj programy i słuchaj najnowszych odcinków.",
    });
    // Autodiscovery kanału sieciowego: bez tego feed podcastu dawał się
    // zasubskrybować wyłącznie po ręcznym wklejeniu adresu.
    const origin = splitUrl(url).origin || SITE_CANONICAL_ORIGIN;
    return {
      ...head,
      links: [
        ...head.links,
        feedAlternateLink({
          origin,
          feedPath: "/podcast/rss.xml",
          title: lang === "en" ? "NES Podcast - RSS" : "Podcast NES - RSS",
          lang,
        }),
      ],
    };
  },
  component: PodcastsIndex,
  // Nagłówek błędu też idzie ze słownika: `errorComponent` renderuje się jak
  // każdy inny komponent, więc `t()` jest tu dostępne - literał był jedynym
  // miejscem na tej trasie, które mówiło po polsku do wszystkich.
  errorComponent: (props) => <PodcastsIndexError {...props} />,
});

function PodcastsIndexError(props: ErrorComponentProps) {
  ensurePodcastsI18n();
  const { t } = useTranslation();
  return <RouteErrorFallback {...props} title={t("podcastNetwork.loadFailedIndex")} />;
}

function PodcastsIndex() {
  const { data: episodes } = useSuspenseQuery(latestPodcastsQueryOptions(INDEX_LIMIT));
  const { data: shows } = useSuspenseQuery(publishedShowsQueryOptions);
  const { data: stats } = useSuspenseQuery(showEpisodeStatsQueryOptions);
  const { degraded } = Route.useLoaderData();
  ensurePodcastsI18n();
  const { t, i18n } = useTranslation();
  // `lang` zostaje WYŁĄCZNIE do wyboru języka treści (bliźniacze kolumny),
  // etykiety interfejsu idą przez `t()`.
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";

  // Statystyki per program: liczba odcinków + łączny czas (dla kart katalogu).
  const showStats = useMemo(() => {
    const map = new Map<string, { count: number; seconds: number }>();
    for (const s of stats) {
      if (!s.show_id) continue;
      const cur = map.get(s.show_id) ?? { count: 0, seconds: 0 };
      cur.count += 1;
      cur.seconds += s.duration_seconds || 0;
      map.set(s.show_id, cur);
    }
    return map;
  }, [stats]);

  const showTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of shows) map.set(s.id, showTitle(s, lang));
    return map;
  }, [shows, lang]);

  const hasShows = shows.length > 0;

  return (
    <div className="container mx-auto px-4 py-10 max-w-5xl space-y-12">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
            <Mic className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-3xl">Podcast</h1>
            <p className="text-sm text-muted-foreground">{t("podcastNetwork.subtitle")}</p>
          </div>
        </div>
        <a
          href="/podcast/rss.xml"
          className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border border-border hover:bg-muted"
        >
          <Rss className="w-4 h-4" />
          RSS
        </a>
      </header>

      {/* Pusty katalog i „nic nie dojechało" wyglądają identycznie - przy
          degradacji mówimy wprost, co się stało, zamiast sugerować, że sieci
          podcastów nie ma. */}
      {degraded ? (
        <DegradedDataNotice title={t("podcastNetwork.loadFailedPodcasts")} />
      ) : (
        <>
          {hasShows && (
            <section className="space-y-4">
              <h2 className="font-display text-xl">{t("podcastNetwork.programsHeading")}</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {shows.map((s, index) => {
                  const st = showStats.get(s.id);
                  const desc = showDescription(s, lang);
                  const count = st?.count ?? 0;
                  return (
                    <Link
                      key={s.id}
                      to="/podcasts/$show"
                      params={{ show: s.slug }}
                      className="group flex flex-col rounded-xl border border-border overflow-hidden hover:shadow-md transition-shadow bg-card"
                    >
                      <div className="aspect-video bg-muted relative overflow-hidden">
                        {s.cover_image_url ? (
                          // Responsywny srcSet zamiast pełnowymiarowego
                          // oryginału na każdej karcie; pierwszy rząd siatki
                          // (kandydaci LCP na górze strony) jest eager+high,
                          // reszta lazy. Rodzic rezerwuje układ (aspect-video),
                          // więc bez width/height nie ma CLS.
                          <OptimizedImage
                            src={s.cover_image_url}
                            alt=""
                            responsive
                            sizes={CARD_IMAGE_SIZES}
                            priority={index < 3}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Mic className="w-10 h-10 text-muted-foreground/40" />
                          </div>
                        )}
                      </div>
                      <div className="p-4 space-y-1.5 flex-1 flex flex-col">
                        <h3 className="font-medium leading-snug group-hover:text-primary transition-colors">
                          {showTitle(s, lang)}
                        </h3>
                        {desc && (
                          <p className="text-sm text-muted-foreground line-clamp-2 flex-1">
                            {desc}
                          </p>
                        )}
                        <div className="text-xs text-muted-foreground pt-1">
                          {t("podcastNetwork.episodeCount", { count })}
                          {st && st.seconds > 0 ? ` · ${formatDuration(st.seconds)}` : ""}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          <section className="space-y-4">
            <h2 className="font-display text-xl">{t("podcastNetwork.latestHeading")}</h2>
            {episodes.length === 0 ? (
              <p className="text-sm text-muted-foreground py-16 text-center">
                {t("podcastNetwork.emptyEpisodes")}
              </p>
            ) : (
              <ul className="space-y-3">
                {episodes.map((e) => {
                  const ep = podcastEpisodeLabel(e, lang);
                  // `pickLocalized` zamiast `a_en || a_pl`: ciąg z samych spacji
                  // liczy się jako pusty, więc nie renderuje pustego akapitu.
                  const excerpt = pickLocalized(e, "excerpt", lang);
                  const showName = e.show_id ? showTitleById.get(e.show_id) : null;
                  return (
                    <li key={e.id}>
                      <Link
                        to="/podcast/$slug"
                        params={{ slug: e.slug }}
                        className="flex gap-4 p-4 rounded-lg border border-border hover:bg-muted/40 transition-colors"
                      >
                        {e.cover_image_url ? (
                          <img
                            src={buildAvatarSrc(e.cover_image_url, 80)}
                            alt=""
                            className="w-20 h-20 rounded-md object-cover border border-border shrink-0"
                            loading="lazy"
                            decoding="async"
                            width={80}
                            height={80}
                          />
                        ) : (
                          <div className="w-20 h-20 rounded-md bg-muted flex items-center justify-center shrink-0">
                            <Mic className="w-6 h-6 text-muted-foreground" />
                          </div>
                        )}
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                            {showName && (
                              <span className="text-primary font-semibold">{showName}</span>
                            )}
                            {showName && ep && <span aria-hidden>·</span>}
                            {ep && <span>{ep}</span>}
                          </div>
                          <h3 className="font-medium leading-snug">{podcastTitle(e, lang)}</h3>
                          {excerpt && (
                            <p className="text-sm text-muted-foreground line-clamp-2">{excerpt}</p>
                          )}
                          <div className="text-xs text-muted-foreground">
                            {formatDuration(e.duration_seconds)}
                          </div>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
