import { useEffect, useId, useRef, useState } from "react";
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
  const direction = str(c, "direction", "vertical") || "vertical";

  const used = useUsedPostIds();
  const { data, isLoading } = useQuery(newsTickerQueryOptions(c, lang));
  const fetched: TickerPost[] = data ?? [];

  const [excludeIds, setExcludeIds] = useState<readonly string[]>([]);
  useEffect(() => {
    if (!uniqueOnPage) return;
    setExcludeIds(used.getSnapshot());
  }, [uniqueOnPage, used, data]);

  const rows: TickerPost[] = uniqueOnPage
    ? dedupeAndSlice(fetched, excludeIds, displayLimit)
    : fetched.slice(0, displayLimit);

  const visibleIdsKey = rows.map((r) => r.id).join(",");
  useEffect(() => {
    if (visibleIdsKey) used.register(visibleIdsKey.split(","));
  }, [visibleIdsKey, used]);

  const title = (p: TickerPost) =>
    (lang === "pl" ? p.title_pl : p.title_en) || p.title_pl || p.title_en || "-";

  if (isLoading && !rows.length) {
    return (
      <div className="cms-meta w-full overflow-hidden rounded-md bg-card border border-border px-3 py-2">
        {lang === "pl" ? "Ładowanie najnowszych…" : "Loading latest…"}
      </div>
    );
  }
  if (!rows.length) {
    return (
      <div className="cms-meta w-full overflow-hidden rounded-md bg-card border border-border px-3 py-2">
        {lang === "pl" ? "Brak wpisów do wyświetlenia." : "No posts to display."}
      </div>
    );
  }

  if (direction === "horizontal") {
    const items = [...rows, ...rows];
    return (
      <NewsTickerMarqueeHorizontal
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
      </NewsTickerMarqueeHorizontal>
    );
  }

  return (
    <NewsTickerVertical badge={badge} durationSec={speedSeconds} pauseOnHover={pauseOnHover}>
      {rows.map((p, i) => (
        <NewsTickerVerticalItem key={p.id} post={p} index={i} title={title(p)} />
      ))}
    </NewsTickerVertical>
  );
}

function NewsTickerVerticalItem({
  post,
  index,
  title,
}: {
  post: TickerPost;
  index: number;
  title: string;
}) {
  const displayName = post.author_display_name || undefined;

  return (
    <AppLink
      href={`/post/${post.slug}`}
      className="group flex h-11 shrink-0 items-center gap-2.5 px-4 pr-5 transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      title={title}
    >
      <span className="shrink-0 text-[10px] font-bold text-[var(--brand)] opacity-60">
        {String(index + 1).padStart(2, "0")}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11px] font-semibold tracking-tight text-foreground transition-colors group-hover:text-[var(--brand-ink)]">
        {title}
      </span>
      {post.author_avatar_url || displayName ? (
        <span className="flex shrink-0 items-center gap-2 border-l border-border pl-3">
          {post.author_avatar_url ? (
            <img
              src={post.author_avatar_url}
              alt=""
              loading="lazy"
              className="h-5 w-5 rounded-[5px] object-cover shadow-sm ring-1 ring-border"
            />
          ) : null}
          {displayName ? (
            <span className="hidden sm:inline whitespace-nowrap text-[10px] font-medium text-muted-foreground">
              {displayName}
            </span>
          ) : null}
        </span>
      ) : null}
    </AppLink>
  );
}

function NewsTickerVertical({
  badge,
  durationSec,
  pauseOnHover,
  children,
}: {
  badge: string;
  durationSec: number;
  pauseOnHover: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const animName = `news-ticker-vertical-${useId().replace(/:/g, "")}`;
  const items = Array.isArray(children) ? children : [children];
  const count = items.length;
  // Duplicate the first item at the end for a seamless vertical loop.
  const first = items[0];
  const trackItems = [...items, first];
  const m = trackItems.length; // N + 1

  const keyframes = buildVerticalKeyframes(m, animName);

  return (
    <div
      ref={ref}
      data-news-ticker="vertical"
      className="relative flex h-11 w-full items-stretch overflow-hidden rounded-xl border border-border bg-card shadow-sm"
      role="marquee"
      aria-label={badge}
    >
      <div className="relative z-30 flex shrink-0 items-center gap-2 bg-[linear-gradient(135deg,var(--brand),color-mix(in_oklab,var(--brand)_70%,white))] px-4 text-[10px] font-black uppercase tracking-[0.18em] text-brand-foreground shadow-[4px_0_12px_rgba(0,0,0,0.08)]">
        <span aria-hidden className="relative flex h-1.5 w-1.5 items-center justify-center">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-40" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
        <span>{badge}</span>
      </div>

      <div className="relative flex-1 overflow-hidden bg-muted/20">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-2 bg-gradient-to-b from-foreground/5 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-2 bg-gradient-to-t from-foreground/5 to-transparent" />

        <div
          className="flex flex-col"
          style={{
            animation: `${animName} ${durationSec}s cubic-bezier(0.65, 0, 0.35, 1) infinite`,
            animationPlayState: "running",
          }}
          onMouseEnter={(e) => {
            if (pauseOnHover) e.currentTarget.style.animationPlayState = "paused";
          }}
          onMouseLeave={(e) => {
            if (pauseOnHover) e.currentTarget.style.animationPlayState = "running";
          }}
        >
          {trackItems.map((child, i) => (
            <div key={`${i}`} aria-hidden={i === count ? true : undefined}>
              {child}
            </div>
          ))}
        </div>
        <style
          dangerouslySetInnerHTML={{
            __html: keyframes,
          }}
        />
      </div>
    </div>
  );
}

function buildVerticalKeyframes(m: number, animName: string): string {
  if (m < 2) return "";
  const slot = 100 / m;
  const transition = 100 / (m * (m - 1));
  const hold = slot - transition;

  let steps = "";
  for (let i = 0; i < m - 1; i++) {
    const start = i * (slot + transition);
    const end = start + hold;
    const y = -((i * 100) / m);
    steps += `${start.toFixed(2)}%, ${end.toFixed(2)}% { transform: translate3d(0, ${y.toFixed(2)}%, 0); }\n`;
  }
  // Final duplicate item at 100% so the loop snaps back to the first item seamlessly.
  const finalY = -(((m - 1) * 100) / m);
  steps += `100% { transform: translate3d(0, ${finalY.toFixed(2)}%, 0); }\n`;

  return `
    @keyframes ${animName} {
      0% { transform: translate3d(0, 0, 0); }
      ${steps}
    }
    @media (prefers-reduced-motion: reduce) {
      [data-news-ticker="vertical"] [style*="animation"] { animation: none !important; }
    }
  `;
}

function NewsTickerMarqueeHorizontal({
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
  const animName = `news-ticker-${useId().replace(/:/g, "")}`;

  return (
    <div
      ref={ref}
      data-news-ticker="horizontal"
      className="relative flex w-full items-stretch overflow-hidden rounded-md border border-border bg-card"
      role="marquee"
      aria-label={badge}
    >
      <div className="flex shrink-0 items-center bg-brand px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-brand-foreground">
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
            [data-news-ticker="horizontal"] [style*="animation"] { animation: none !important; }
          }
        `,
          }}
        />
      </div>
    </div>
  );
}
