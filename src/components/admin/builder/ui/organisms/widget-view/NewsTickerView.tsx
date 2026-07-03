// News ticker - horizontal marquee of latest posts. Used as a builder widget.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WidgetContent } from "@/lib/builder/types";
import { useUsedPostIds } from "@/lib/builder/usedPostIds";
import { AppLink } from "@/components/atoms/AppLink";
import { dedupeAndSlice, type Lang } from "@/lib/builder/postListQuery";
import {
  newsTickerQueryOptions,
  newsTickerDisplayLimit,
  type TickerPost,
} from "@/lib/builder/newsTickerQuery";

function bool(c: WidgetContent, key: string, dflt: boolean): boolean {
  const v = c[key];
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true" || v === "1";
  return dflt;
}
function num(c: WidgetContent, key: string, dflt: number): number {
  const v = c[key];
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return dflt;
}
function str(c: WidgetContent, key: string, dflt = ""): string {
  const v = c[key];
  return typeof v === "string" ? v : dflt;
}

export function NewsTickerView({ c, lang }: { c: WidgetContent; lang: Lang }) {
  const badge =
    str(c, `badge_${lang}`) || str(c, "badge_pl") || (lang === "pl" ? "Najnowsze" : "Latest");
  const displayLimit = newsTickerDisplayLimit(c);
  const speedSeconds = Math.max(10, Math.min(180, num(c, "speedSeconds", 40)));
  const pauseOnHover = bool(c, "pauseOnHover", true);
  const separator = str(c, "separator", "•") || "•";
  const uniqueOnPage = bool(c, "uniqueOnPage", false);

  const used = useUsedPostIds();
  // Stable, snapshot-independent query (same key on the server prefetch / stream
  // gate and the client), so a streamed ticker reuses the dehydrated rows
  // instead of refetching under a divergent key. uniqueOnPage de-dup is applied
  // client-side below, never in the key.
  const { data, isLoading } = useQuery(newsTickerQueryOptions(c, lang));
  // Use the RAW query data (stable: undefined or a memoized array) as the effect
  // dependency. The defaulted `fetched` below is a fresh [] on every render while
  // the query is pending, so depending on it would re-fire the effect each render
  // -> setState -> re-render loop.
  const fetched: TickerPost[] = data ?? [];

  // Client-only de-dup, empty on the server and the first client render (so they
  // match), then adopted post-mount - refining from already-cached rows with no
  // network round-trip.
  const [excludeIds, setExcludeIds] = useState<readonly string[]>([]);
  useEffect(() => {
    if (!uniqueOnPage) return;
    setExcludeIds(used.getSnapshot());
  }, [uniqueOnPage, used, data]);

  const rows: TickerPost[] = uniqueOnPage
    ? dedupeAndSlice(fetched, excludeIds, displayLimit)
    : fetched.slice(0, displayLimit);

  // Register the IDs actually shown so later uniqueOnPage widgets exclude them.
  const visibleIdsKey = rows.map((r) => r.id).join(",");
  useEffect(() => {
    if (visibleIdsKey) used.register(visibleIdsKey.split(","));
  }, [visibleIdsKey, used]);

  const title = (p: TickerPost) =>
    (lang === "pl" ? p.title_pl : p.title_en) || p.title_pl || p.title_en || "-";

  if (isLoading && !rows.length) {
    return (
      <div className="w-full overflow-hidden rounded-md bg-card border border-border px-3 py-2 text-xs text-muted-foreground">
        {lang === "pl" ? "Ładowanie najnowszych…" : "Loading latest…"}
      </div>
    );
  }
  if (!rows.length) {
    return (
      <div className="w-full overflow-hidden rounded-md bg-card border border-border px-3 py-2 text-xs text-muted-foreground">
        {lang === "pl" ? "Brak wpisów do wyświetlenia." : "No posts to display."}
      </div>
    );
  }

  // Render two copies of the list back-to-back for a seamless loop.
  const items = [...rows, ...rows];

  return (
    <NewsTickerMarquee
      badge={badge}
      separator={separator}
      durationSec={speedSeconds}
      pauseOnHover={pauseOnHover}
    >
      {items.map((p, i) => (
        <span key={`${p.id}-${i}`} className="inline-flex items-center gap-3 shrink-0">
          <AppLink href={`/post/${p.slug}`} className="cms-post-title whitespace-nowrap">
            {title(p)}
          </AppLink>
          <span aria-hidden className="text-muted-foreground/70 select-none">
            {separator}
          </span>
        </span>
      ))}
    </NewsTickerMarquee>
  );
}

function NewsTickerMarquee({
  badge,
  durationSec,
  pauseOnHover,
  children,
}: {
  badge: string;
  separator: string;
  durationSec: number;
  pauseOnHover: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [animName] = useState(() => `news-ticker-${Math.random().toString(36).slice(2, 8)}`);

  return (
    <div
      ref={ref}
      data-news-ticker
      className="relative flex w-full items-stretch overflow-hidden rounded-md border border-border bg-card"
      role="marquee"
      aria-label={badge}
    >
      <div className="flex shrink-0 items-center bg-brand text-brand-foreground px-3 py-2 text-[11px] font-bold uppercase tracking-wider">
        {badge}
      </div>
      <div className="relative flex-1 overflow-hidden">
        <div
          className="flex w-max items-center gap-4 py-2 pl-4"
          style={{
            animation: `${animName} ${durationSec}s linear infinite`,
            animationPlayState: "running",
          }}
          onMouseEnter={(e) => {
            if (pauseOnHover) e.currentTarget.style.animationPlayState = "paused";
          }}
          onMouseLeave={(e) => {
            if (pauseOnHover) e.currentTarget.style.animationPlayState = "running";
          }}
        >
          {children}
        </div>
        <style
          dangerouslySetInnerHTML={{
            __html: `
          @keyframes ${animName} {
            0% { transform: translate3d(0,0,0); }
            100% { transform: translate3d(-50%,0,0); }
          }
          @media (prefers-reduced-motion: reduce) {
            [data-news-ticker] [style*="animation"] { animation: none !important; }
          }
        `,
          }}
        />
      </div>
    </div>
  );
}
