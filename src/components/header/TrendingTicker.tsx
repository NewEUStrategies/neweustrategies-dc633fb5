// Header "Na czasie / Trending" - compact bar of posts.
// Supports three sources (trending | latest | pinned) and two display modes
// (scroll: marquee-like horizontal list; rotate: single post, swapped every N s).
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Flame } from "lucide-react";
import {
  headerTickerQueryOptions,
  type TickerMode,
  type TickerSource,
} from "@/lib/views/headerTickerQuery";
import { AppLink } from "@/components/atoms/AppLink";

export type { TickerMode, TickerSource };

export interface TickerProps {
  source?: TickerSource;
  mode?: TickerMode;
  days?: number;
  limit?: number;
  intervalSec?: number;
  pinnedPostId?: string;
  pinnedUntil?: string | null;
  fullWidth?: boolean;
  className?: string;
}

export function TrendingTicker({
  source = "trending",
  mode = "scroll",
  days = 7,
  limit = 8,
  intervalSec = 6,
  pinnedPostId,
  pinnedUntil,
  fullWidth = true,
  className,
}: TickerProps) {
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";

  // Shared with the root-route loader's SSR prefetch (same key + fn), so in
  // steady state this resolves synchronously from the hydrated cache - the
  // ticker is already part of the server HTML instead of appearing after
  // hydration and shifting the layout.
  const { data, isLoading } = useQuery(
    headerTickerQueryOptions({ source, days, limit, pinnedPostId, pinnedUntil }),
  );

  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (mode !== "rotate" || !data || data.length < 2) return;
    const ms = Math.max(2, intervalSec) * 1000;
    const t = window.setInterval(() => setIdx((i) => (i + 1) % data.length), ms);
    return () => window.clearInterval(t);
  }, [mode, intervalSec, data]);

  if (isLoading || !data?.length) return null;

  const label = lang === "en" ? "Trending" : "Na czasie";
  const innerMax = fullWidth ? "max-w-none" : "max-w-[1400px] mx-auto";
  const items = mode === "rotate" ? [data[idx % data.length]] : data;

  return (
    <div
      className={`cms-trending border-b border-border bg-muted/30 ${className ?? ""}`}
      data-testid="trending-ticker"
    >
      <div className={`${innerMax} px-4 lg:px-8 h-10 flex items-center gap-4 overflow-hidden`}>
        <span className="inline-flex items-center gap-1.5 text-[12px] leading-none font-bold uppercase tracking-[0.14em] text-brand shrink-0 whitespace-nowrap">
          <Flame className="w-4 h-4 shrink-0" aria-hidden />
          <span className="leading-none">{label}</span>
        </span>
        <span className="hidden sm:block h-4 w-px bg-border shrink-0" aria-hidden />
        <div
          className={`flex-1 min-w-0 flex items-center gap-6 ${mode === "scroll" ? "overflow-x-auto scrollbar-none" : "overflow-hidden"}`}
          style={{ scrollbarWidth: "none" }}
        >
          {items.map((p, i) => {
            const title = lang === "en" ? p.title_en || p.title_pl : p.title_pl || p.title_en;
            const displayIdx = mode === "rotate" ? idx + 1 : i + 1;
            return (
              <AppLink
                key={`${p.id}-${displayIdx}`}
                href={p.href}
                className="group inline-flex items-center gap-2 h-10 text-[13px] leading-none whitespace-nowrap hover:text-brand transition shrink-0 animate-in fade-in duration-300"
                title={title}
              >
                <span className="text-[12px] leading-none font-bold text-muted-foreground tabular-nums">
                  {String(displayIdx).padStart(2, "0")}
                </span>
                <span className="font-medium truncate max-w-[220px] sm:max-w-none sm:whitespace-nowrap leading-none">
                  {title}
                </span>
              </AppLink>
            );
          })}
        </div>
      </div>
    </div>
  );
}
