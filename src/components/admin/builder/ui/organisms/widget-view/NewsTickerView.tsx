// News ticker - horizontal marquee of latest posts. Used as a builder widget.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WidgetContent } from "@/lib/builder/types";
import { useUsedPostIds } from "@/lib/builder/usedPostIds";

type Lang = "pl" | "en";

interface TickerPost {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
}

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
  const badge = str(c, `badge_${lang}`) || str(c, "badge_pl") || (lang === "pl" ? "Najnowsze" : "Latest");
  const limit = Math.max(3, Math.min(30, num(c, "limit", 10)));
  const speedSeconds = Math.max(10, Math.min(180, num(c, "speedSeconds", 40)));
  const pauseOnHover = bool(c, "pauseOnHover", true);
  const separator = str(c, "separator", "•") || "•";
  const categoriesCsv = str(c, "categoriesCsv", "");
  const uniqueOnPage = bool(c, "uniqueOnPage", false);

  const used = useUsedPostIds();
  const excludeSnapshot = useMemo(
    () => (uniqueOnPage ? used.getSnapshot() : []),
    // Snapshot taken once per mount to avoid refetch churn; uniqueness is best-effort.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uniqueOnPage],
  );

  const categorySlugs = categoriesCsv.split(",").map((s) => s.trim()).filter(Boolean);

  const { data: rows = [], isLoading } = useQuery<TickerPost[]>({
    queryKey: ["builder-news-ticker", { limit, categorySlugs, excludeSnapshot }],
    queryFn: async () => {
      let allowedIds: string[] | null = null;
      if (categorySlugs.length) {
        const { data: cats } = await supabase.from("categories").select("id").in("slug", categorySlugs);
        const catIds = (cats ?? []).map((r) => r.id);
        if (!catIds.length) return [];
        const { data: links } = await supabase.from("post_categories").select("post_id").in("category_id", catIds);
        allowedIds = Array.from(new Set((links ?? []).map((r) => r.post_id)));
        if (!allowedIds.length) return [];
      }
      let q = supabase
        .from("posts")
        .select("id, slug, title_pl, title_en")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(limit);
      if (allowedIds) q = q.in("id", allowedIds);
      if (excludeSnapshot.length) q = q.not("id", "in", `(${excludeSnapshot.join(",")})`);
      const { data } = await q;
      return (data ?? []) as TickerPost[];
    },
  });

  // Register fetched IDs so later "uniqueOnPage" widgets can skip them.
  useEffect(() => {
    if (rows.length) used.register(rows.map((r) => r.id));
  }, [rows, used]);

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
          <a
            href={`/post/${p.slug}`}
            className="text-sm font-medium hover:text-brand transition whitespace-nowrap"
          >
            {title(p)}
          </a>
          <span aria-hidden className="text-muted-foreground/70 select-none">{separator}</span>
        </span>
      ))}
    </NewsTickerMarquee>
  );
}

function NewsTickerMarquee({
  badge, durationSec, pauseOnHover, children,
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
          onMouseEnter={(e) => { if (pauseOnHover) e.currentTarget.style.animationPlayState = "paused"; }}
          onMouseLeave={(e) => { if (pauseOnHover) e.currentTarget.style.animationPlayState = "running"; }}
        >
          {children}
        </div>
        <style dangerouslySetInnerHTML={{ __html: `
          @keyframes ${animName} {
            0% { transform: translate3d(0,0,0); }
            100% { transform: translate3d(-50%,0,0); }
          }
          @media (prefers-reduced-motion: reduce) {
            [data-news-ticker] [style*="animation"] { animation: none !important; }
          }
        ` }} />
      </div>
    </div>
  );
}
