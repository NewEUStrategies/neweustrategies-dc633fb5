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
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  showBySlugQueryOptions,
  showEpisodesQueryOptions,
  episodesPeopleQueryOptions,
} from "@/lib/queries/podcasts";
import {
  podcastTitle,
  podcastEpisodeLabel,
  formatDuration,
  showTitle,
  showDescription,
  type Podcast,
  type PodcastPerson,
} from "@/lib/podcast/types";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";
import { safeJsonLd } from "@/lib/seo/jsonld";

export const Route = createFileRoute("/podcasts/$show")({
  loader: async ({ context, params }) => {
    const show = await context.queryClient.ensureQueryData(showBySlugQueryOptions(params.show));
    if (!show) throw notFound();
    await context.queryClient.ensureQueryData(showEpisodesQueryOptions(show.id));
    return { show };
  },
  head: ({ loaderData, params }) => {
    const s = loaderData?.show;
    const url = getRequestUrl() || `/podcasts/${params.show}`;
    const lang = activeLang(url);
    if (!s) return { meta: [{ title: "Podcast" }] };
    const title = showTitle(s, lang);
    const rawDesc = showDescription(s, lang).slice(0, 300);
    const description =
      rawDesc || (lang === "en" ? `${title} — podcast program.` : `Program podcastowy: ${title}.`);
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
    return {
      ...base,
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
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";

  const { data: show } = useSuspenseQuery(showBySlugQueryOptions(slug));
  const { data: episodes } = useSuspenseQuery(showEpisodesQueryOptions(show?.id ?? ""));
  const episodeIds = useMemo(() => episodes.map((e) => e.id), [episodes]);
  const { data: people } = useQuery(episodesPeopleQueryOptions(episodeIds));

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
              src={show.cover_image_url}
              alt=""
              className="w-full h-full object-cover"
              loading="eager"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Mic className="w-12 h-12 text-muted-foreground/40" />
            </div>
          )}
        </div>
        <div className="space-y-3 min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {lang === "en" ? "Program" : "Program"}
          </div>
          <h1 className="font-display text-3xl lg:text-4xl">{title}</h1>
          {description && <p className="text-muted-foreground">{description}</p>}
          <div className="text-xs text-muted-foreground">
            {episodes.length} {lang === "en" ? "episodes" : "odcinków"}
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
          <h2 className="font-display text-lg">{lang === "en" ? "Hosts" : "Prowadzący"}</h2>
          <ul className="flex flex-wrap gap-3">
            {hosts.map((h) => {
              const inner = (
                <span className="flex items-center gap-2">
                  {h.profile_avatar_url ? (
                    <img
                      src={h.profile_avatar_url}
                      alt=""
                      className="w-8 h-8 rounded-full object-cover border border-border"
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
          {lang === "en" ? "No episodes published yet." : "Brak opublikowanych odcinków."}
        </p>
      ) : (
        <div className="space-y-8">
          {seasons.map((group) => (
            <section key={group.season ?? "none"} className="space-y-3">
              {group.season != null && (
                <h2 className="font-display text-lg">
                  {lang === "en" ? `Season ${group.season}` : `Sezon ${group.season}`}
                </h2>
              )}
              <ul className="space-y-3">
                {group.episodes.map((e) => {
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
                            className="w-16 h-16 rounded-md object-cover border border-border shrink-0"
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
