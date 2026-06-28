// `podcast-latest` builder widget view - renders a grid of recent episodes.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { latestPodcastsQueryOptions } from "@/lib/queries/podcasts";
import { formatDuration, podcastEpisodeLabel, podcastTitle } from "@/lib/podcast/types";
import { PodcastPlayer } from "@/components/atoms/PodcastPlayer";
import { WidgetMediaImage } from "@/components/atoms/WidgetMediaImage";

interface Props {
  c: Record<string, unknown>;
  lang: "pl" | "en";
}

function getNum(c: Record<string, unknown>, k: string, d: number): number {
  const v = c[k];
  return typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : d;
}

function getStr(c: Record<string, unknown>, k: string, d = ""): string {
  const v = c[k]; return typeof v === "string" ? v : d;
}

export function PodcastLatestView({ c, lang }: Props) {
  const limit = getNum(c, "limit", 4);
  const columns = Math.max(1, Math.min(4, getNum(c, "columns", 2)));
  const variant = (getStr(c, "variant") || "grid") as "grid" | "list" | "featured";
  const showPlayer = (getStr(c, "showPlayer") || "true") !== "false";

  const { data, isLoading } = useQuery(latestPodcastsQueryOptions(limit));

  if (isLoading) return <div className="text-sm text-muted-foreground">…</div>;
  if (!data?.length) {
    return <div className="text-sm text-muted-foreground">{lang === "en" ? "No podcasts yet." : "Brak odcinków."}</div>;
  }

  if (variant === "featured") {
    const p = data[0];
    return (
      <article className="grid lg:grid-cols-2 gap-6 border border-border rounded-xl overflow-hidden bg-card">
        {p.cover_image_url ? (
          <WidgetMediaImage src={p.cover_image_url} alt="" frameClassName="relative block aspect-square w-full overflow-hidden bg-muted" sizes="(max-width: 1024px) 100vw, 50vw" />
        ) : <div className="aspect-square bg-muted" />}
        <div className="p-6 flex flex-col gap-3 justify-center">
          {podcastEpisodeLabel(p, lang) && <span className="text-xs uppercase tracking-wider text-muted-foreground">{podcastEpisodeLabel(p, lang)}</span>}
          <Link to="/podcast/$slug" params={{ slug: p.slug }} className="cms-post-title">
            {podcastTitle(p, lang)}
          </Link>
          <p className="cms-post-excerpt text-sm text-muted-foreground line-clamp-3">
            {lang === "en" ? p.excerpt_en || p.excerpt_pl : p.excerpt_pl || p.excerpt_en}
          </p>
          {showPlayer && (
            <PodcastPlayer src={p.audio_url} initialDuration={p.duration_seconds} variant="full" lang={lang} />
          )}
        </div>
      </article>
    );
  }

  if (variant === "list") {
    return (
      <ul className="divide-y divide-border border border-border rounded-lg bg-card">
        {data.map((p) => (
          <li key={p.id} className="p-4 flex items-center gap-4">
            {p.cover_image_url ? (
              <WidgetMediaImage src={p.cover_image_url} alt="" frameClassName="relative block h-14 w-14 shrink-0 overflow-hidden rounded bg-muted" responsiveWidths={[56, 112, 168]} sizes="56px" />
            ) : <div className="w-14 h-14 rounded bg-muted shrink-0" />}
            <div className="flex-1 min-w-0">
              {podcastEpisodeLabel(p, lang) && <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{podcastEpisodeLabel(p, lang)}</div>}
              <Link to="/podcast/$slug" params={{ slug: p.slug }} className="cms-post-title truncate block">
                {podcastTitle(p, lang)}
              </Link>
              <div className="cms-post-excerpt text-xs text-muted-foreground">{formatDuration(p.duration_seconds)}</div>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  const colsCls = ["grid-cols-1", "grid-cols-1 sm:grid-cols-2", "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3", "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"][columns - 1];

  return (
    <div className={`grid ${colsCls} gap-4`}>
      {data.map((p) => (
        <article key={p.id} className="border border-border rounded-lg overflow-hidden bg-card hover:shadow-md transition-shadow">
          {p.cover_image_url ? (
            <Link to="/podcast/$slug" params={{ slug: p.slug }}>
              <WidgetMediaImage src={p.cover_image_url} alt="" frameClassName="relative block aspect-square w-full overflow-hidden bg-muted" sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw" />
            </Link>
          ) : <div className="aspect-square bg-muted" />}
          <div className="p-4 space-y-2">
            {podcastEpisodeLabel(p, lang) && <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{podcastEpisodeLabel(p, lang)}</div>}
            <Link to="/podcast/$slug" params={{ slug: p.slug }} className="cms-post-title line-clamp-2 block">
              {podcastTitle(p, lang)}
            </Link>
            <div className="cms-post-excerpt text-xs text-muted-foreground">{formatDuration(p.duration_seconds)}</div>
            {showPlayer && (
              <PodcastPlayer src={p.audio_url} initialDuration={p.duration_seconds} variant="mini" lang={lang} />
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
