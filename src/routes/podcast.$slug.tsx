import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  podcastBySlugQueryOptions,
  podcastSettingsQueryOptions,
  showBySlugQueryOptions,
  showEpisodesQueryOptions,
  episodePeopleQueryOptions,
} from "@/lib/queries/podcasts";
import { supabase } from "@/integrations/supabase/client";
import { PODCAST_SHOW_FIELDS } from "@/lib/queries/podcasts";
import type { PodcastShow } from "@/lib/podcast/types";
import { PodcastPlayer } from "@/components/atoms/PodcastPlayer";
import { Mic, Quote as QuoteIcon, Copy, Check } from "@/lib/lucide-shim";
import { ExternalLink } from "lucide-react";
import {
  podcastTitle,
  podcastEpisodeLabel,
  formatDuration,
  personRoleLabel,
  parseChapters,
  parseQuotes,
  parseResources,
  showTitle,
} from "@/lib/podcast/types";
import { safeJsonLd } from "@/lib/seo/jsonld";
import { sanitizeHtml } from "@/lib/sanitize";

export const Route = createFileRoute("/podcast/$slug")({
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(podcastBySlugQueryOptions(params.slug));
    if (!data) throw notFound();
    return { podcast: data };
  },
  head: ({ loaderData }) => {
    const p = loaderData?.podcast;
    if (!p) return { meta: [{ title: "Podcast" }] };
    const title = p.title_pl || p.title_en || "Podcast";
    const description = (p.excerpt_pl || p.excerpt_en || "").slice(0, 300) || undefined;
    // JSON-LD PodcastEpisode: pozwala wyszukiwarkom rozpoznać odcinek podcastu.
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "PodcastEpisode",
      name: title,
      ...(description ? { description } : {}),
      ...(p.episode_number != null ? { episodeNumber: p.episode_number } : {}),
      ...(p.published_at ? { datePublished: p.published_at } : {}),
      associatedMedia: {
        "@type": "MediaObject",
        contentUrl: p.audio_url,
      },
    };
    return {
      meta: [
        { title: `${title} · Podcast` },
        ...(description ? [{ name: "description", content: description }] : []),
        { property: "og:title", content: title },
        { property: "og:type", content: "article" },
        ...(description ? [{ property: "og:description", content: description }] : []),
        ...(p.cover_image_url ? [{ property: "og:image", content: p.cover_image_url }] : []),
      ],
      scripts: [{ type: "application/ld+json", children: safeJsonLd(jsonLd) }],
    };
  },
  errorComponent: () => (
    <div className="container mx-auto p-8 text-sm text-muted-foreground">
      Nie udało się wczytać odcinka. Spróbuj ponownie później.
    </div>
  ),
  notFoundComponent: () => (
    <div className="container mx-auto p-8 text-sm text-muted-foreground">
      Nie znaleziono odcinka.
    </div>
  ),
  component: PodcastSinglePage,
});

function playerVariant(v: string | undefined): "mini" | "full" | "sticky" {
  return v === "mini" || v === "sticky" ? v : "full";
}

/** Fetch the parent program by id (episode page arrives with show_id, not slug). */
function showByIdQueryOptions(showId: string | null) {
  return {
    queryKey: ["podcast-shows", "id", showId] as const,
    queryFn: async (): Promise<PodcastShow | null> => {
      if (!showId) return null;
      const { data, error } = await supabase
        .from("podcast_shows")
        .select(PODCAST_SHOW_FIELDS)
        .eq("id", showId)
        .eq("status", "published")
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as PodcastShow | null;
    },
    enabled: !!showId,
    staleTime: 5 * 60_000,
  };
}

function PodcastSinglePage() {
  const { slug } = Route.useParams();
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const lang: "pl" | "en" = isPl ? "pl" : "en";

  const { data: p } = useQuery(podcastBySlugQueryOptions(slug));
  const { data: settings } = useQuery(podcastSettingsQueryOptions);
  const { data: show } = useQuery(showByIdQueryOptions(p?.show_id ?? null));
  const { data: people } = useQuery(episodePeopleQueryOptions(p?.id ?? ""));
  const { data: showEpisodes } = useQuery({
    ...showEpisodesQueryOptions(p?.show_id ?? ""),
    enabled: !!p?.show_id,
  });

  // Seek udostępniony przez odtwarzacz — rozdziały przeskakują do znacznika.
  const seekRef = useRef<((seconds: number) => void) | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const chapters = useMemo(() => parseChapters(p?.chapters), [p?.chapters]);
  const quotes = useMemo(() => parseQuotes(p?.quotes), [p?.quotes]);
  const resources = useMemo(() => parseResources(p?.resources), [p?.resources]);
  const hosts = (people ?? []).filter((x) => x.role === "host");
  const guests = (people ?? []).filter((x) => x.role === "guest");
  const recommendations = useMemo(
    () => (showEpisodes ?? []).filter((e) => e.id !== p?.id).slice(0, 4),
    [showEpisodes, p?.id],
  );

  if (!p) return null;

  const title = podcastTitle(p, lang);
  const ep = podcastEpisodeLabel(p, lang);
  const notes =
    lang === "en" ? p.show_notes_en || p.show_notes_pl : p.show_notes_pl || p.show_notes_en;
  const transcript =
    lang === "en" ? p.transcript_en || p.transcript_pl : p.transcript_pl || p.transcript_en;
  const excerpt = lang === "en" ? p.excerpt_en || p.excerpt_pl : p.excerpt_pl || p.excerpt_en;

  const sources = resources.filter((r) => r.kind === "source");
  const related = resources.filter((r) => r.kind === "related");

  const copyQuote = async (text: string, attribution: string, idx: number) => {
    const body = attribution ? `„${text}" — ${attribution}` : `„${text}"`;
    try {
      await navigator.clipboard.writeText(`${body}\n\n${title}`);
      setCopiedIdx(idx);
      window.setTimeout(() => setCopiedIdx((v) => (v === idx ? null : v)), 2000);
    } catch {
      /* schowek niedostępny (np. brak HTTPS) — po cichu pomijamy */
    }
  };

  return (
    <article className="container mx-auto px-4 py-10 max-w-4xl space-y-8">
      <header className="flex flex-col sm:flex-row gap-5 sm:items-start">
        <div className="w-32 h-32 shrink-0 rounded-xl overflow-hidden border border-border bg-muted">
          {p.cover_image_url ? (
            <img
              src={p.cover_image_url}
              alt=""
              className="w-full h-full object-cover"
              loading="eager"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Mic className="w-10 h-10 text-muted-foreground/40" />
            </div>
          )}
        </div>
        <div className="space-y-3 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            {show && (
              <Link
                to="/podcasts/$show"
                params={{ show: show.slug }}
                className="text-primary font-semibold hover:underline"
              >
                {showTitle(show, lang)}
              </Link>
            )}
            {show && ep && <span aria-hidden>·</span>}
            {ep && <span>{ep}</span>}
          </div>
          <h1 className="font-display text-3xl lg:text-4xl">{title}</h1>
          {excerpt && <p className="text-lg text-muted-foreground">{excerpt}</p>}
          <div className="text-xs text-muted-foreground">{formatDuration(p.duration_seconds)}</div>
        </div>
      </header>

      <PodcastPlayer
        src={p.audio_url}
        title={title}
        coverUrl={p.cover_image_url}
        initialDuration={p.duration_seconds}
        variant={playerVariant(settings?.default_player_variant)}
        showSpeed={settings?.show_speed_control ?? true}
        lang={lang}
        registerSeek={(fn) => {
          seekRef.current = fn;
        }}
      />

      {(settings?.spotify_url ||
        settings?.apple_url ||
        settings?.google_url ||
        settings?.rss_url) && (
        <nav className="flex flex-wrap gap-2 text-xs">
          {settings.spotify_url && (
            <a
              href={settings.spotify_url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-full border border-border hover:bg-muted"
            >
              Spotify
            </a>
          )}
          {settings.apple_url && (
            <a
              href={settings.apple_url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-full border border-border hover:bg-muted"
            >
              Apple Podcasts
            </a>
          )}
          {settings.google_url && (
            <a
              href={settings.google_url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-full border border-border hover:bg-muted"
            >
              Google
            </a>
          )}
          {settings.rss_url && (
            <a
              href={settings.rss_url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-full border border-border hover:bg-muted"
            >
              RSS
            </a>
          )}
        </nav>
      )}

      {(hosts.length > 0 || guests.length > 0) && (
        <section className="space-y-3">
          <h2 className="font-display text-xl">{lang === "en" ? "People" : "Osoby"}</h2>
          <div className="flex flex-wrap gap-3">
            {[...hosts, ...guests].map((person) => {
              const inner = (
                <>
                  {person.profile_avatar_url ? (
                    <img
                      src={person.profile_avatar_url}
                      alt=""
                      className="w-9 h-9 rounded-full object-cover border border-border"
                    />
                  ) : (
                    <span className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
                      <Mic className="w-4 h-4 text-muted-foreground" />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block text-sm font-medium leading-tight truncate">
                      {person.display_name}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {personRoleLabel(person.role, lang)}
                    </span>
                  </span>
                </>
              );
              const cls =
                "flex items-center gap-2 px-3 py-1.5 rounded-full border border-border max-w-full";
              if (person.profile_slug) {
                return (
                  <Link
                    key={person.id}
                    to="/author/$slug"
                    params={{ slug: person.profile_slug }}
                    className={`${cls} hover:bg-muted`}
                  >
                    {inner}
                  </Link>
                );
              }
              if (person.url) {
                return (
                  <a
                    key={person.id}
                    href={person.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${cls} hover:bg-muted`}
                  >
                    {inner}
                  </a>
                );
              }
              return (
                <span key={person.id} className={cls}>
                  {inner}
                </span>
              );
            })}
          </div>
        </section>
      )}

      {chapters.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-xl">{lang === "en" ? "Chapters" : "Rozdziały"}</h2>
          <ol className="divide-y divide-border border border-border rounded-lg overflow-hidden">
            {chapters.map((c, i) => {
              const label = lang === "en" ? c.title_en || c.title_pl : c.title_pl || c.title_en;
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => seekRef.current?.(c.start)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/40 transition-colors"
                  >
                    <span className="text-xs tabular-nums text-primary font-medium w-14 shrink-0">
                      {formatDuration(c.start)}
                    </span>
                    <span className="text-sm">{label || `#${i + 1}`}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {quotes.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-xl">
            {lang === "en" ? "Quotes to share" : "Cytaty do udostępnienia"}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {quotes.map((q, i) => {
              const text = lang === "en" ? q.text_en || q.text_pl : q.text_pl || q.text_en;
              if (!text) return null;
              return (
                <figure
                  key={i}
                  className="relative rounded-lg border border-border bg-muted/30 p-4 pr-11 space-y-2"
                >
                  <QuoteIcon className="w-5 h-5 text-primary/60" />
                  <blockquote className="text-sm leading-relaxed">{text}</blockquote>
                  {q.attribution && (
                    <figcaption className="text-xs text-muted-foreground">
                      — {q.attribution}
                    </figcaption>
                  )}
                  <button
                    type="button"
                    onClick={() => copyQuote(text, q.attribution, i)}
                    aria-label={lang === "en" ? "Copy quote" : "Kopiuj cytat"}
                    className="absolute top-3 right-3 h-8 w-8 rounded-md border border-border bg-background flex items-center justify-center hover:bg-muted"
                  >
                    {copiedIdx === i ? (
                      <Check className="w-4 h-4 text-green-600" />
                    ) : (
                      <Copy className="w-4 h-4 text-muted-foreground" />
                    )}
                  </button>
                </figure>
              );
            })}
          </div>
        </section>
      )}

      {notes && (
        <section className="prose prose-sm max-w-none">
          <h2 className="font-display text-xl">{lang === "en" ? "Show notes" : "Notatki"}</h2>
          <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(notes) }} />
        </section>
      )}

      {(sources.length > 0 || related.length > 0) && (
        <section className="grid gap-6 sm:grid-cols-2">
          {sources.length > 0 && (
            <div className="space-y-2">
              <h2 className="font-display text-lg">{lang === "en" ? "Sources" : "Źródła"}</h2>
              <ul className="space-y-1.5">
                {sources.map((r, i) => {
                  const label =
                    (lang === "en" ? r.label_en || r.label_pl : r.label_pl || r.label_en) || r.url;
                  return (
                    <li key={i}>
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-start gap-1.5 text-sm text-primary hover:underline"
                      >
                        <ExternalLink className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>{label}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {related.length > 0 && (
            <div className="space-y-2">
              <h2 className="font-display text-lg">
                {lang === "en" ? "Related materials" : "Materiały dodatkowe"}
              </h2>
              <ul className="space-y-1.5">
                {related.map((r, i) => {
                  const label =
                    (lang === "en" ? r.label_en || r.label_pl : r.label_pl || r.label_en) || r.url;
                  return (
                    <li key={i}>
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-start gap-1.5 text-sm text-primary hover:underline"
                      >
                        <ExternalLink className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>{label}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      )}

      {transcript && (
        <details className="border border-border rounded-lg p-4">
          <summary className="cursor-pointer font-medium">
            {lang === "en" ? "Transcript" : "Transkrypcja"}
          </summary>
          <div
            className="mt-3 prose prose-sm max-w-none whitespace-pre-wrap"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(transcript) }}
          />
        </details>
      )}

      {recommendations.length > 0 && (
        <section className="space-y-3 border-t border-border pt-8">
          <h2 className="font-display text-xl">
            {lang === "en" ? "More from this program" : "Więcej z tego programu"}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {recommendations.map((e) => {
              const rEp = podcastEpisodeLabel(e, lang);
              return (
                <li key={e.id}>
                  <Link
                    to="/podcast/$slug"
                    params={{ slug: e.slug }}
                    className="flex gap-3 p-3 rounded-lg border border-border hover:bg-muted/40 transition-colors h-full"
                  >
                    {e.cover_image_url ? (
                      <img
                        src={e.cover_image_url}
                        alt=""
                        className="w-14 h-14 rounded-md object-cover border border-border shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-md bg-muted flex items-center justify-center shrink-0">
                        <Mic className="w-5 h-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0 space-y-0.5">
                      {rEp && (
                        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                          {rEp}
                        </div>
                      )}
                      <div className="text-sm font-medium leading-snug line-clamp-2">
                        {podcastTitle(e, lang)}
                      </div>
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
      )}
    </article>
  );
}
