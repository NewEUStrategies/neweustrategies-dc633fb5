// Program (series) page: /podcasts/$show. A podcast PROGRAM groups its
// episodes into seasons, surfaces the recurring hosts, and carries its own
// subscribe links + a per-program RSS feed — the RUSI/think-tank "catalogue of
// distinct series" model rather than one undifferentiated feed.
import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Mic } from "@/lib/lucide-shim";
import { Rss } from "lucide-react";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { PublicNotFound } from "@/components/molecules/PublicNotFound";
import { DegradedDataNotice } from "@/components/molecules/DegradedDataNotice";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  showBySlugQueryOptions,
  showEpisodesQueryOptions,
  episodesPeopleQueryOptions,
} from "@/lib/queries/podcasts";
import { loadResilient, resilientCacheControl } from "@/lib/ssr/resilientLoad";
import { buildAvatarSrc } from "@/lib/cropSizes";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { ensureI18n as ensurePodcastsI18n } from "@/lib/i18n-podcasts";
import { appendLinkHeader, setCacheControlHeader } from "@/lib/http/responseHeaders";
import {
  podcastTitle,
  podcastEpisodeLabel,
  formatDuration,
  showTitle,
  showDescription,
  type Podcast,
  type PodcastPerson,
  type PodcastShow,
} from "@/lib/podcast/types";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import {
  SITE_CANONICAL_ORIGIN,
  buildContentHead,
  feedAlternateLink,
  imagePreloadLink,
  imagePreloadLinkHeaderValue,
  splitUrl,
  type ImagePreloadInput,
} from "@/lib/seo/meta";
import { safeJsonLd } from "@/lib/seo/jsonld";

/**
 * Fallbacki renderu zdegradowanego. `SHOW_UNKNOWN` jest `null` WYŁĄCZNIE jako
 * wartość zasiewu - loader nigdy nie interpretuje go jako „program nie istnieje"
 * (od tego jest flaga `degraded`), więc żaden blip nie zamieni się w 404.
 */
const SHOW_UNKNOWN: PodcastShow | null = null;
const NO_EPISODES: Podcast[] = [];

export const Route = createFileRoute("/podcasts/$show")({
  // Zapytanie TOŻSAMOŚCIOWE (czy ten program istnieje?) NIE MOŻE degradować się
  // do `null` - to sfabrykowałoby 404 na realnie istniejącej stronie, a 404
  // wyrzuca URL z indeksu wyszukiwarki. Rozróżniamy więc trzy stany:
  //   * zapytanie zwróciło wiersz  -> render,
  //   * zapytanie zwróciło `null`  -> notFound() (404 jest PRAWDĄ),
  //   * zapytanie padło / nie zdążyło -> nie wiemy: HTTP 200 `no-store`
  //     z uczciwym komunikatem i ponowieniem. Crawler wróci, nic nie wypada
  //     z indeksu, a monitor nie widzi awarii.
  // Lista odcinków jest wtórna - degraduje się do pustej (lib/ssr/resilientLoad).
  loader: async ({ context, params }) => {
    const identity = await loadResilient(
      context.queryClient,
      showBySlugQueryOptions(params.show),
      SHOW_UNKNOWN,
    );
    if (identity.degraded) {
      setCacheControlHeader(resilientCacheControl(true));
      return { show: null, degraded: true, coverPreload: null };
    }
    const show = identity.data;
    if (!show) throw notFound();

    const episodes = await loadResilient(
      context.queryClient,
      showEpisodesQueryOptions(show.id),
      NO_EPISODES,
    );
    setCacheControlHeader(resilientCacheControl(episodes.degraded));
    // Preload LCP okładki programu - render to zwykłe <img src> bez srcSet,
    // więc deskryptor niesie sam `href` (para srcset/sizes wskazywałaby inny
    // wariant niż malowany i podwoiłaby pobranie). Wartość idzie też jako
    // nagłówek HTTP `Link` (fetch przed parsowaniem HTML, 103 Early Hints).
    // PARYTET: ten sam buildAvatarSrc(…, 160) co w malowanym <img> - okładka
    // renderuje się w polu 160x160, więc preload/paint schodzą na ~320 px
    // wariant ze Storage zamiast pełnowymiarowego oryginału.
    const coverPreload: ImagePreloadInput | null = show.cover_image_url
      ? { href: buildAvatarSrc(show.cover_image_url, 160) }
      : null;
    if (coverPreload) appendLinkHeader(imagePreloadLinkHeaderValue(coverPreload));
    return { show, degraded: episodes.degraded, coverPreload };
  },
  head: ({ loaderData, params }) => {
    const s = loaderData?.show;
    const url = getRequestUrl() || `/podcasts/${params.show}`;
    const lang = activeLang(url);
    if (!s) return { meta: [{ title: "Podcast" }] };
    const title = showTitle(s, lang);
    const rawDesc = showDescription(s, lang).slice(0, 300);
    const description =
      rawDesc || (lang === "en" ? `${title} - podcast program.` : `Program podcastowy: ${title}.`);
    const base = buildContentHead({
      url,
      lang,
      type: "website",
      title: `${title} - podcast`,
      description,
      image: s.cover_image_url,
    });
    // JSON-LD PodcastSeries: pozwala wyszukiwarkom rozpoznać program jako serię.
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "PodcastSeries",
      name: title,
      ...(rawDesc ? { description: rawDesc } : {}),
      ...(s.cover_image_url ? { image: s.cover_image_url } : {}),
      webFeed: `/podcasts/${s.slug}/rss.xml`,
    };
    // Autodiscovery: kanał programu (główny) + kanał sieciowy jako drugi wybór.
    // `webFeed` w JSON-LD widzą wyszukiwarki, ale nie czytniki RSS ani Apple -
    // te szukają wyłącznie <link rel="alternate">.
    const origin = splitUrl(url).origin || SITE_CANONICAL_ORIGIN;
    return {
      ...base,
      links: [
        ...base.links,
        // Preload okładki (LCP) - fetch rusza z <head>, zanim parser dojdzie
        // do <img> w body.
        ...(loaderData?.coverPreload ? [imagePreloadLink(loaderData.coverPreload)] : []),
        feedAlternateLink({
          origin,
          feedPath: `/podcasts/${s.slug}/rss.xml`,
          title: `${title} - RSS`,
          lang,
        }),
        feedAlternateLink({
          origin,
          feedPath: "/podcast/rss.xml",
          title:
            lang === "en"
              ? "NES Podcast - RSS (all programs)"
              : "Podcast NES - RSS (wszystkie programy)",
          lang,
        }),
      ],
      scripts: [{ type: "application/ld+json", children: safeJsonLd(jsonLd) }],
    };
  },
  component: ShowPage,
  errorComponent: (props) => <RouteErrorFallback {...props} />,
  notFoundComponent: PublicNotFound,
});

/** Distinct hosts across the whole series, keyed by profile or display name. */
function seriesHosts(people: PodcastPerson[]): PodcastPerson[] {
  const seen = new Set<string>();
  const out: PodcastPerson[] = [];
  for (const p of people) {
    if (p.role !== "host") continue;
    const key = p.profile_id ?? p.display_name.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** Group episodes by season (desc); nulls collapse into a single group. */
function bySeasons(episodes: Podcast[]): Array<{ season: number | null; episodes: Podcast[] }> {
  const groups = new Map<number | null, Podcast[]>();
  for (const e of episodes) {
    const key = e.season ?? null;
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }
  return Array.from(groups.entries())
    .sort((a, b) => {
      // Named seasons first (desc), the "no season" bucket last.
      if (a[0] == null) return 1;
      if (b[0] == null) return -1;
      return b[0] - a[0];
    })
    .map(([season, eps]) => ({ season, episodes: eps }));
}

function ShowPage() {
  const { show: slug } = Route.useParams();
  const { degraded } = Route.useLoaderData();
  ensurePodcastsI18n();
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";

  const { data: show } = useSuspenseQuery(showBySlugQueryOptions(slug));
  const { data: episodes } = useSuspenseQuery(showEpisodesQueryOptions(show?.id ?? ""));
  const episodeIds = useMemo(() => episodes.map((e) => e.id), [episodes]);
  const { data: people } = useQuery(episodesPeopleQueryOptions(episodeIds));

  // Kolejność ma znaczenie: przy degradacji NIE WIEMY, czy program istnieje,
  // więc nigdy nie pokazujemy „nie znaleziono" - to byłby fałszywy 404.
  if (degraded) {
    return (
      <div className="container mx-auto px-4 py-10 max-w-4xl">
        <DegradedDataNotice title={t("podcastNetwork.loadFailedShow")} />
      </div>
    );
  }
  if (!show) return <PublicNotFound />;

  const title = showTitle(show, lang);
  const description = showDescription(show, lang);
  const hosts = seriesHosts(people ?? []);
  const seasons = bySeasons(episodes);

  const subscribeLinks = [
    { url: show.spotify_url, label: "Spotify" },
    { url: show.apple_url, label: "Apple Podcasts" },
    { url: show.youtube_url, label: "YouTube" },
  ].filter((l) => !!l.url);

  return (
    <article className="container mx-auto px-4 py-10 max-w-4xl space-y-10">
      <Breadcrumbs items={[{ label: "Podcast", href: "/podcasts" }, { label: title }]} />

      <header className="flex flex-col sm:flex-row gap-6 sm:items-start">
        <div className="w-40 h-40 shrink-0 rounded-xl overflow-hidden border border-border bg-muted">
          {show.cover_image_url ? (
            <img
              src={buildAvatarSrc(show.cover_image_url, 160)}
              alt=""
              className="w-full h-full object-cover"
              loading="eager"
              fetchPriority="high"
              decoding="async"
              width={160}
              height={160}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Mic className="w-12 h-12 text-muted-foreground/40" />
            </div>
          )}
        </div>
        <div className="space-y-3 min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("podcastNetwork.programEyebrow")}
          </div>
          <h1 className="font-display text-3xl lg:text-4xl">{title}</h1>
          {description && <p className="text-muted-foreground">{description}</p>}
          <div className="text-xs text-muted-foreground">
            {t("podcastNetwork.episodeCount", { count: episodes.length })}
          </div>

          <nav className="flex flex-wrap gap-2 text-xs pt-1">
            {subscribeLinks.map((l) => (
              <a
                key={l.label}
                href={l.url as string}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-full border border-border hover:bg-muted"
              >
                {l.label}
              </a>
            ))}
            <a
              href={`/podcasts/${show.slug}/rss.xml`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border hover:bg-muted"
            >
              <Rss className="w-3.5 h-3.5" />
              RSS
            </a>
          </nav>
        </div>
      </header>

      {hosts.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-lg">{t("podcastNetwork.hostsHeading")}</h2>
          <ul className="flex flex-wrap gap-3">
            {hosts.map((h) => {
              const inner = (
                <span className="flex items-center gap-2">
                  {h.profile_avatar_url ? (
                    <img
                      src={buildAvatarSrc(h.profile_avatar_url, 32)}
                      alt=""
                      className="w-8 h-8 rounded-full object-cover border border-border"
                      loading="lazy"
                      decoding="async"
                      width={32}
                      height={32}
                    />
                  ) : (
                    <span className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                      <Mic className="w-4 h-4 text-muted-foreground" />
                    </span>
                  )}
                  <span className="text-sm font-medium">{h.display_name}</span>
                </span>
              );
              return (
                <li key={h.id}>
                  {h.profile_slug ? (
                    <Link
                      to="/author/$slug"
                      params={{ slug: h.profile_slug }}
                      className="inline-flex px-3 py-1.5 rounded-full border border-border hover:bg-muted"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <span className="inline-flex px-3 py-1.5 rounded-full border border-border">
                      {inner}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {episodes.length === 0 ? (
        <p className="text-sm text-muted-foreground py-16 text-center">
          {t("podcastNetwork.emptyEpisodes")}
        </p>
      ) : (
        <div className="space-y-8">
          {seasons.map((group) => (
            <section key={group.season ?? "none"} className="space-y-3">
              {group.season != null && (
                <h2 className="font-display text-lg">
                  {t("podcastNetwork.seasonHeading", { season: group.season })}
                </h2>
              )}
              <ul className="space-y-3">
                {group.episodes.map((e) => {
                  const ep = podcastEpisodeLabel(e, lang);
                  const excerpt = pickLocalized(e, "excerpt", lang);
                  return (
                    <li key={e.id}>
                      <Link
                        to="/podcast/$slug"
                        params={{ slug: e.slug }}
                        className="flex gap-4 p-4 rounded-lg border border-border hover:bg-muted/40 transition-colors"
                      >
                        {e.cover_image_url ? (
                          <img
                            src={buildAvatarSrc(e.cover_image_url, 64)}
                            alt=""
                            className="w-16 h-16 rounded-md object-cover border border-border shrink-0"
                            loading="lazy"
                            decoding="async"
                            width={64}
                            height={64}
                          />
                        ) : (
                          <div className="w-16 h-16 rounded-md bg-muted flex items-center justify-center shrink-0">
                            <Mic className="w-5 h-5 text-muted-foreground" />
                          </div>
                        )}
                        <div className="min-w-0 space-y-1">
                          {ep && (
                            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                              {ep}
                            </div>
                          )}
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
            </section>
          ))}
        </div>
      )}
    </article>
  );
}
