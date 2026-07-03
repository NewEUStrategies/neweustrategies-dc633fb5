// Header "Na czasie / Trending" - compact bar of posts.
// Sources: trending | latest | pinned | selected | mixed.
// Modes: scroll (marquee) | fade | slide | flip | typewriter.
// Colors and label overridable per light/dark via CSS custom properties.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Flame } from "lucide-react";
import {
  headerTickerQueryOptions,
  type TickerMode,
  type TickerSource,
} from "@/lib/views/headerTickerQuery";
import {
  DEFAULT_TICKER_COLORS,
  type IconAnimation,
  type MixedFill,
  type TickerColorScheme,
} from "@/lib/views/tickerVariants";
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
  selectedPostIds?: string[];
  mixedFill?: MixedFill;
  labelPl?: string;
  labelEn?: string;
  iconAnimation?: IconAnimation;
  colors?: TickerColorScheme;
  fullWidth?: boolean;
  variantId?: string;
  className?: string;
}

function normalizeMode(mode: TickerMode): "scroll" | "fade" | "slide" | "flip" | "typewriter" {
  if (mode === "rotate") return "slide";
  return mode;
}

// Stable, DOM-safe attribute selector fragment for the given variant id.
function safeAttr(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_") || "default";
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
  selectedPostIds,
  mixedFill = "trending",
  labelPl,
  labelEn,
  iconAnimation = "none",
  colors,
  fullWidth = true,
  variantId = "default",
  className,
}: TickerProps) {
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const kind = normalizeMode(mode);
  const palette = colors ?? DEFAULT_TICKER_COLORS;
  const vid = safeAttr(variantId);

  const { data, isLoading } = useQuery(
    headerTickerQueryOptions({
      source,
      days,
      limit,
      pinnedPostId,
      pinnedUntil,
      selectedPostIds,
      mixedFill,
    }),
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

  const defaultLabel = lang === "en" ? "Trending" : "Na czasie";
  const label =
    lang === "en"
      ? (labelEn && labelEn.trim()) || (labelPl && labelPl.trim()) || defaultLabel
      : (labelPl && labelPl.trim()) || (labelEn && labelEn.trim()) || defaultLabel;
  const innerMax = fullWidth ? "max-w-none" : "max-w-[1400px] mx-auto";

  const currentBatch =
    kind === "scroll" ? posts : posts.slice(batch * perView, batch * perView + perView);

  const iconClass = `tt-flame tt-flame-${iconAnimation}`;

  return (
    <div
      className={`cms-trending border-b ${className ?? ""}`}
      data-testid="trending-ticker"
      data-tt-vid={vid}
      style={{
        background: "var(--tt-bg)",
        borderColor: "var(--tt-border)",
      }}
    >
      <TickerPaletteStyle vid={vid} palette={palette} />
      <div className={`${innerMax} px-4 lg:px-8 h-10 flex items-center gap-4 overflow-hidden`}>
        <span
          className="inline-flex items-center gap-1.5 text-[12px] leading-none font-bold uppercase tracking-[0.14em] shrink-0 whitespace-nowrap"
          style={{ color: "var(--tt-label)" }}
        >
          <Flame className={`w-4 h-4 shrink-0 ${iconClass}`} aria-hidden />
          <span className="leading-none">{label}</span>
        </span>
        <span
          className="hidden sm:block h-4 w-px shrink-0"
          aria-hidden
          style={{ background: "var(--tt-border)" }}
        />
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
  post: {
    id: string;
    slug?: string;
    href?: string;
    title_pl: string | null;
    title_en: string | null;
  };
  index: number;
  lang: "pl" | "en";
  animation: "none" | "fade" | "slide" | "flip" | "typewriter";
  delayMs?: number;
}

function TickerItem({ post, index, lang, animation, delayMs = 0 }: TickerItemProps) {
  const title =
    lang === "en"
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
      className={`tt-item group inline-flex items-center gap-2 h-10 text-[13px] leading-none whitespace-nowrap transition shrink-0 ${cls}`}
      style={{ animationDelay: `${delayMs}ms`, color: "var(--tt-item)" }}
      title={title}
    >
      <span
        className="text-[12px] leading-none font-bold tabular-nums"
        style={{ color: "var(--tt-counter)" }}
      >
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
      <span className="tt-caret" aria-hidden>
        |
      </span>
    </span>
  );
}

function TickerPaletteStyle({
  vid,
  palette,
}: {
  vid: string;
  palette: TickerColorScheme;
}) {
  const sel = `[data-tt-vid="${vid}"]`;
  const css = `
    ${sel} {
      --tt-bg: ${palette.light.bg};
      --tt-border: ${palette.light.border};
      --tt-label: ${palette.light.label};
      --tt-item: ${palette.light.item};
      --tt-item-hover: ${palette.light.itemHover};
      --tt-counter: ${palette.light.counter};
    }
    :root.dark ${sel}, .dark ${sel} {
      --tt-bg: ${palette.dark.bg};
      --tt-border: ${palette.dark.border};
      --tt-label: ${palette.dark.label};
      --tt-item: ${palette.dark.item};
      --tt-item-hover: ${palette.dark.itemHover};
      --tt-counter: ${palette.dark.counter};
    }
    ${sel} .tt-item:hover { color: var(--tt-item-hover) !important; }
  `;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
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

        /* Flame animations */
        @keyframes tt-flame-pulse {
          0%,100% { transform: scale(1); filter: drop-shadow(0 0 0 currentColor) }
          50%     { transform: scale(1.18); filter: drop-shadow(0 0 6px currentColor) }
        }
        @keyframes tt-flame-flicker {
          0%,100% { transform: scale(1) rotate(-2deg); opacity: 1 }
          20%     { transform: scale(1.12) rotate(3deg); opacity: .92 }
          40%     { transform: scale(0.94) rotate(-4deg); opacity: .85 }
          60%     { transform: scale(1.08) rotate(2deg); opacity: 1 }
          80%     { transform: scale(0.98) rotate(-1deg); opacity: .95 }
        }
        @keyframes tt-flame-spin {
          from { transform: rotate(0deg) } to { transform: rotate(360deg) }
        }
        @keyframes tt-flame-wave {
          0%,100% { transform: translateY(0) scale(1) }
          50%     { transform: translateY(-2px) scale(1.06) }
        }
        .tt-flame { transform-origin: 50% 90%; will-change: transform, opacity, filter }
        .tt-flame-pulse    { animation: tt-flame-pulse    1.8s ease-in-out infinite }
        .tt-flame-flicker  { animation: tt-flame-flicker  1.4s ease-in-out infinite }
        .tt-flame-spin     { animation: tt-flame-spin     3.2s linear infinite }
        .tt-flame-wave     { animation: tt-flame-wave     1.6s ease-in-out infinite }

        @media (prefers-reduced-motion: reduce) {
          .tt-anim-fade, .tt-anim-slide, .tt-anim-flip { animation: none !important }
          .tt-caret, .tt-flame-pulse, .tt-flame-flicker, .tt-flame-spin, .tt-flame-wave {
            animation: none !important
          }
        }
      `,
      }}
    />
  );
}
