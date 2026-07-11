// Public podcast index. URL: /podcasts — the discovery page that previously
// did not exist (episodes were reachable only via a builder widget or a known
// URL). Lists published episodes and links to the built-in RSS feed.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Mic } from "@/lib/lucide-shim";
import { Rss } from "lucide-react";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { latestPodcastsQueryOptions } from "@/lib/queries/podcasts";
import { podcastTitle, podcastEpisodeLabel, formatDuration } from "@/lib/podcast/types";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";

const INDEX_LIMIT = 50;

export const Route = createFileRoute("/podcasts")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(latestPodcastsQueryOptions(INDEX_LIMIT)),
  head: () => {
    const url = getRequestUrl() || "/podcasts";
    const lang = activeLang(url);
    return buildContentHead({
      url,
      lang,
      type: "website",
      title:
        lang === "en" ? "Podcast - New European Strategies" : "Podcast - New European Strategies",
      description:
        lang === "en"
          ? "Listen to New European Strategies podcast episodes."
          : "Słuchaj odcinków podcastu New European Strategies.",
    });
  },
  component: PodcastsIndex,
  errorComponent: (props) => (
    <RouteErrorFallback {...props} title="Nie udało się załadować listy" />
  ),
});

function PodcastsIndex() {
  const { data: episodes } = useSuspenseQuery(latestPodcastsQueryOptions(INDEX_LIMIT));
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";

  return (
    <div className="container mx-auto px-4 py-10 max-w-4xl space-y-8">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
            <Mic className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-3xl">Podcast</h1>
            <p className="text-sm text-muted-foreground">
              {lang === "en" ? "Latest episodes" : "Najnowsze odcinki"}
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
                    {ep && (
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        {ep}
                      </div>
                    )}
                    <h2 className="font-medium leading-snug">{podcastTitle(e, lang)}</h2>
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
    </div>
  );
}
