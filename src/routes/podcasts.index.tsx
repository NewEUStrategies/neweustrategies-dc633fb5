// Public podcast network. URL: /podcasts — the discovery page. Podcast is a
// NETWORK OF PROGRAMS (RUSI/think-tank pattern), not a flat file list: it leads with
// the catalogue of programs (series), each linking to its own program page,
// followed by the newest episodes across the whole network. Links to the
// built-in network RSS feed.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Mic } from "@/lib/lucide-shim";
import { Rss } from "lucide-react";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import {
  latestPodcastsQueryOptions,
  publishedShowsQueryOptions,
  showEpisodeStatsQueryOptions,
} from "@/lib/queries/podcasts";
import {
  podcastTitle,
  podcastEpisodeLabel,
  formatDuration,
  showTitle,
  showDescription,
} from "@/lib/podcast/types";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";

const INDEX_LIMIT = 30;

export const Route = createFileRoute("/podcasts/")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(latestPodcastsQueryOptions(INDEX_LIMIT)),
      context.queryClient.ensureQueryData(publishedShowsQueryOptions),
      context.queryClient.ensureQueryData(showEpisodeStatsQueryOptions),
    ]),
  head: () => {
    const url = getRequestUrl() || "/podcasts";
    const lang = activeLang(url);
    return buildContentHead({
      url,
      lang,
      type: "website",
      title: "Podcast - New European Strategies",
      description:
        lang === "en"
          ? "New European Strategies podcast network — browse programs and listen to the latest episodes."
          : "Sieć podcastów New European Strategies — przeglądaj programy i słuchaj najnowszych odcinków.",
    });
  },
  component: PodcastsIndex,
  errorComponent: (props) => (
    <RouteErrorFallback {...props} title="Nie udało się załadować listy" />
  ),
});

function PodcastsIndex() {
  const { data: episodes } = useSuspenseQuery(latestPodcastsQueryOptions(INDEX_LIMIT));
  const { data: shows } = useSuspenseQuery(publishedShowsQueryOptions);
  const { data: stats } = useSuspenseQuery(showEpisodeStatsQueryOptions);
  const { i18n } = useTranslation();
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
            <p className="text-sm text-muted-foreground">
              {lang === "en" ? "Programs & episodes" : "Programy i odcinki"}
            </p>
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

      {hasShows && (
        <section className="space-y-4">
          <h2 className="font-display text-xl">{lang === "en" ? "Programs" : "Programy"}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shows.map((s) => {
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
                      <img
                        src={s.cover_image_url}
                        alt=""
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
                      <p className="text-sm text-muted-foreground line-clamp-2 flex-1">{desc}</p>
                    )}
                    <div className="text-xs text-muted-foreground pt-1">
                      {count} {lang === "en" ? (count === 1 ? "episode" : "episodes") : "odc."}
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
        <h2 className="font-display text-xl">
          {lang === "en" ? "Latest episodes" : "Najnowsze odcinki"}
        </h2>
        {episodes.length === 0 ? (
          <p className="text-sm text-muted-foreground py-16 text-center">
            {lang === "en" ? "No episodes published yet." : "Brak opublikowanych odcinków."}
          </p>
        ) : (
          <ul className="space-y-3">
            {episodes.map((e) => {
              const ep = podcastEpisodeLabel(e, lang);
              const excerpt =
                lang === "en" ? e.excerpt_en || e.excerpt_pl : e.excerpt_pl || e.excerpt_en;
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
                        src={e.cover_image_url}
                        alt=""
                        className="w-20 h-20 rounded-md object-cover border border-border shrink-0"
                      />
                    ) : (
                      <div className="w-20 h-20 rounded-md bg-muted flex items-center justify-center shrink-0">
                        <Mic className="w-6 h-6 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                        {showName && <span className="text-primary font-semibold">{showName}</span>}
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
    </div>
  );
}
