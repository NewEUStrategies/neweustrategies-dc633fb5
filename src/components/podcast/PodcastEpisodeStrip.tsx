// Compact list of podcast episodes reused on aggregation surfaces (expert
// profile, specialization/category page). Renders nothing while loading or
// when empty, so hosts can drop it in unconditionally.
import { Link } from "@tanstack/react-router";
import { Mic } from "@/lib/lucide-shim";
import { podcastTitle, podcastEpisodeLabel, formatDuration } from "@/lib/podcast/types";
import type { Podcast } from "@/lib/podcast/types";

export function PodcastEpisodeStrip({
  episodes,
  lang,
  title,
}: {
  episodes: Podcast[] | undefined;
  lang: "pl" | "en";
  title: string;
}) {
  if (!episodes || episodes.length === 0) return null;
  return (
    <section className="space-y-4">
      <h2 className="font-display text-2xl">{title}</h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {episodes.map((e) => {
          const ep = podcastEpisodeLabel(e, lang);
          const excerpt =
            lang === "en" ? e.excerpt_en || e.excerpt_pl : e.excerpt_pl || e.excerpt_en;
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
                    className="w-16 h-16 rounded-md object-cover border border-border shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <Mic className="w-5 h-5 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 space-y-0.5">
                  {ep && (
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      {ep}
                    </div>
                  )}
                  <div className="text-sm font-medium leading-snug line-clamp-2">
                    {podcastTitle(e, lang)}
                  </div>
                  {excerpt && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{excerpt}</p>
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
  );
}
