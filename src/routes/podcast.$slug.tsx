import { createFileRoute, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { podcastBySlugQueryOptions, podcastSettingsQueryOptions } from "@/lib/queries/podcasts";
import { PodcastPlayer } from "@/components/atoms/PodcastPlayer";
import { Mic } from "@/lib/lucide-shim";
import { podcastTitle, podcastEpisodeLabel, formatDuration } from "@/lib/podcast/types";
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

function PodcastSinglePage() {
  const { slug } = Route.useParams();
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const lang: "pl" | "en" = isPl ? "pl" : "en";

  const { data: p } = useQuery(podcastBySlugQueryOptions(slug));
  const { data: settings } = useQuery(podcastSettingsQueryOptions);

  if (!p) return null;

  const title = podcastTitle(p, lang);
  const ep = podcastEpisodeLabel(p, lang);
  const notes =
    lang === "en" ? p.show_notes_en || p.show_notes_pl : p.show_notes_pl || p.show_notes_en;
  const transcript =
    lang === "en" ? p.transcript_en || p.transcript_pl : p.transcript_pl || p.transcript_en;
  const excerpt = lang === "en" ? p.excerpt_en || p.excerpt_pl : p.excerpt_pl || p.excerpt_en;

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
          {ep && <div className="text-xs uppercase tracking-wider text-muted-foreground">{ep}</div>}
          <h1 className="font-display text-3xl lg:text-4xl">{title}</h1>
          {excerpt && <p className="text-lg text-muted-foreground">{excerpt}</p>}
          <div className="text-xs text-muted-foreground">{formatDuration(p.duration_seconds)}</div>
        </div>
      </header>

      <PodcastPlayer
        src={p.audio_url}
        title={title}
        initialDuration={p.duration_seconds}
        variant={playerVariant(settings?.default_player_variant)}
        showSpeed={settings?.show_speed_control ?? true}
        lang={lang}
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

      {notes && (
        <section className="prose prose-sm max-w-none">
          <h2 className="font-display text-xl">{lang === "en" ? "Show notes" : "Notatki"}</h2>
          <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(notes) }} />
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
    </article>
  );
}
