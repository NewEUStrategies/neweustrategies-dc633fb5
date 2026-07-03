import { createFileRoute, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { podcastBySlugQueryOptions, podcastSettingsQueryOptions } from "@/lib/queries/podcasts";
import { PodcastPlayer } from "@/components/atoms/PodcastPlayer";
import { podcastTitle, podcastEpisodeLabel, formatDuration } from "@/lib/podcast/types";
import { sanitizeHtml } from "@/lib/sanitize";

export const Route = createFileRoute("/podcast/$slug")({
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(podcastBySlugQueryOptions(params.slug));
    if (!data) throw notFound();
    return null;
  },
  head: ({ params }) => ({
    meta: [{ title: `Podcast · ${params.slug}` }],
  }),
  errorComponent: ({ error }) => (
    <div className="container mx-auto p-8 text-sm">{error.message}</div>
  ),
  notFoundComponent: () => (
    <div className="container mx-auto p-8 text-sm text-muted-foreground">
      Nie znaleziono odcinka.
    </div>
  ),
  component: PodcastSinglePage,
});

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
      <header className="space-y-3">
        {ep && <div className="text-xs uppercase tracking-wider text-muted-foreground">{ep}</div>}
        <h1 className="font-display text-3xl lg:text-4xl">{title}</h1>
        {excerpt && <p className="text-lg text-muted-foreground">{excerpt}</p>}
        <div className="text-xs text-muted-foreground">{formatDuration(p.duration_seconds)}</div>
      </header>

      <PodcastPlayer
        src={p.audio_url}
        title={title}
        initialDuration={p.duration_seconds}
        variant={settings?.default_player_variant === "mini" ? "mini" : "full"}
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
