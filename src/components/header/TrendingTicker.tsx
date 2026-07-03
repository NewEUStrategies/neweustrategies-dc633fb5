// Header "Na czasie / Trending" - compact bar of posts.
// Supports three sources (trending | latest | pinned) and multiple animation
// modes:
//   - scroll     : horizontal marquee, many items side-by-side in a loop
//                  (no count badge - all visible)
//   - fade       : cross-fade between batches of `visibleCount` items
//   - slide      : slide-up rotation (a.k.a. legacy `rotate`)
//   - flip       : 3D flip on the Y-axis
//   - typewriter : character-by-character type-in of the current title
// For rotate-family modes we render `visibleCount` items simultaneously and
// surface a small "N" badge next to the label so the editor and reader see
// how many news are on the bar at once.
import { useEffect, useMemo, useState } from "react";
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
  visibleCount?: number;
  intervalSec?: number;
  pinnedPostId?: string;
  pinnedUntil?: string | null;
  fullWidth?: boolean;
  className?: string;
}

function normalizeMode(mode: TickerMode): "scroll" | "fade" | "slide" | "flip" | "typewriter" {
  if (mode === "rotate") return "slide";
  return mode;
}

export function TrendingTicker({
  source = "trending",
  mode = "scroll",
  days = 7,
  limit = 8,
  visibleCount = 1,
  intervalSec = 6,
  pinnedPostId,
  pinnedUntil,
  fullWidth = true,
  className,
}: TickerProps) {
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const kind = normalizeMode(mode);

  const { data, isLoading } = useQuery(
    headerTickerQueryOptions({ source, days, limit, pinnedPostId, pinnedUntil }),
  );

  const posts = data ?? [];
  const perView = Math.max(1, Math.min(5, Math.floor(visibleCount || 1)));
  const totalBatches = kind === "scroll" ? 1 : Math.max(1, Math.ceil(posts.length / perView));

  const [batch, setBatch] = useState(0);
  useEffect(() => {
    if (kind === "scroll" || totalBatches < 2) return;
    const ms = Math.max(2, intervalSec) * 1000;
    const t = window.setInterval(() => setBatch((b) => (b + 1) % totalBatches), ms);
    return () => window.clearInterval(t);
  }, [kind, intervalSec, totalBatches]);

  if (isLoading || !posts.length) return null;

  const label = lang === "en" ? "Trending" : "Na czasie";
  const innerMax = fullWidth ? "max-w-none" : "max-w-[1400px] mx-auto";

  const currentBatch = kind === "scroll"
    ? posts
    : posts.slice(batch * perView, batch * perView + perView);

  return (
    <div
      className={`cms-trending border-b border-border bg-muted/30 ${className ?? ""}`}
      data-testid="trending-ticker"
    >
      <div className={`${innerMax} px-4 lg:px-8 h-10 flex items-center gap-4 overflow-hidden`}>
        <span className="inline-flex items-center gap-1.5 text-[12px] leading-none font-bold uppercase tracking-[0.14em] text-brand shrink-0 whitespace-nowrap">
          <Flame className="w-4 h-4 shrink-0" aria-hidden />
          <span className="leading-none">{label}</span>
          {kind !== "scroll" && (
            <span
              className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-brand text-brand-foreground text-[10px] font-bold tabular-nums"
              aria-label={lang === "en" ? `${perView} visible` : `${perView} widoczne`}
              title={lang === "en" ? `${perView} on bar` : `${perView} na pasku`}
            >
              {perView}
            </span>
          )}
        </span>
        <span className="hidden sm:block h-4 w-px bg-border shrink-0" aria-hidden />
        <div
          className={`flex-1 min-w-0 flex items-center gap-6 ${
            kind === "scroll" ? "overflow-x-auto scrollbar-none" : "overflow-hidden"
          }`}
          style={{ scrollbarWidth: "none" }}
        >
          {kind === "scroll" ? (
            currentBatch.map((p, i) => (
              <TickerItem
                key={`${p.id}-${i}`}
                post={p}
                index={i}
                lang={lang}
                animation="none"
              />
            ))
          ) : (
            <div className="flex-1 min-w-0 flex items-center gap-6" key={`batch-${batch}`}>
              {currentBatch.map((p, i) => (
                <TickerItem
                  key={`${p.id}-${batch}-${i}`}
                  post={p}
                  index={batch * perView + i}
                  lang={lang}
                  animation={kind}
                  delayMs={i * 90}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <TickerStyles />
    </div>
  );
}

interface TickerItemProps {
  post: { id: string; slug?: string; href?: string; title_pl: string | null; title_en: string | null };
  index: number;
  lang: "pl" | "en";
  animation: "none" | "fade" | "slide" | "flip" | "typewriter";
  delayMs?: number;
}

function TickerItem({ post, index, lang, animation, delayMs = 0 }: TickerItemProps) {
  const title = lang === "en"
    ? post.title_en || post.title_pl || ""
    : post.title_pl || post.title_en || "";
  const displayIdx = index + 1;
  const cls =
    animation === "fade"
      ? "tt-anim-fade"
      : animation === "slide"
        ? "tt-anim-slide"
        : animation === "flip"
          ? "tt-anim-flip"
          : "";

  const href = post.href ?? (post.slug ? `/post/${post.slug}` : "#");

  return (
    <AppLink
      href={href}
      className={`group inline-flex items-center gap-2 h-10 text-[13px] leading-none whitespace-nowrap hover:text-brand transition shrink-0 ${cls}`}
      style={{ animationDelay: `${delayMs}ms` }}
      title={title}
    >
      <span className="text-[12px] leading-none font-bold text-muted-foreground tabular-nums">
        {String(displayIdx).padStart(2, "0")}
      </span>
      {animation === "typewriter" ? (
        <TypewriterText text={title} delayMs={delayMs} />
      ) : (
        <span className="font-medium truncate max-w-[220px] sm:max-w-none sm:whitespace-nowrap leading-none">
          {title}
        </span>
      )}
    </AppLink>
  );
}

function TypewriterText({ text, delayMs }: { text: string; delayMs: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    const start = window.setTimeout(() => {
      let i = 0;
      const iv = window.setInterval(() => {
        i += 1;
        setN(i);
        if (i >= text.length) window.clearInterval(iv);
      }, 22);
      // Cleanup handled by outer effect return.
      (start as unknown as { _iv?: number })._iv = iv;
    }, delayMs);
    return () => {
      window.clearTimeout(start);
      const iv = (start as unknown as { _iv?: number })._iv;
      if (iv) window.clearInterval(iv);
    };
  }, [text, delayMs]);
  return (
    <span className="font-medium truncate max-w-[220px] sm:max-w-none sm:whitespace-nowrap leading-none">
      {text.slice(0, n)}
      <span className="tt-caret" aria-hidden>|</span>
    </span>
  );
}

function TickerStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
        @keyframes tt-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes tt-slide {
          from { opacity: 0; transform: translateY(60%) }
          to   { opacity: 1; transform: translateY(0) }
        }
        @keyframes tt-flip {
          from { opacity: 0; transform: perspective(600px) rotateX(-85deg); transform-origin: 50% 100% }
          to   { opacity: 1; transform: perspective(600px) rotateX(0deg) }
        }
        .tt-anim-fade  { animation: tt-fade  360ms ease both }
        .tt-anim-slide { animation: tt-slide 420ms cubic-bezier(.22,.61,.36,1) both }
        .tt-anim-flip  { animation: tt-flip  520ms cubic-bezier(.22,.61,.36,1) both }
        .tt-caret { display:inline-block; margin-left:2px; opacity:.6; animation: tt-fade 800ms steps(2) infinite alternate }
        @media (prefers-reduced-motion: reduce) {
          .tt-anim-fade, .tt-anim-slide, .tt-anim-flip { animation: none !important }
          .tt-caret { animation: none !important }
        }
      `,
      }}
    />
  );
}
