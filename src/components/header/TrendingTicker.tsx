// Header "Na czasie / Trending" - compact bar of posts.
// Sources: trending | latest | pinned | selected | mixed.
// Modes: scroll (marquee) | fade | slide | flip | typewriter.
// Colors and label overridable per light/dark via CSS custom properties.
import { useEffect, useState } from "react";
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
  type LayoutStyle,
  type MixedFill,
  type TickerColorScheme,
} from "@/lib/views/tickerVariants";
import { AppLink } from "@/components/atoms/AppLink";
import { hardenStyleCss } from "@/lib/sanitize";

export type { TickerMode };

export interface TickerProps {
  source?: TickerSource;
  mode?: TickerMode;
  layoutStyle?: LayoutStyle;
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
  layoutStyle = "classic",
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
  const isBadge = layoutStyle === "badge";

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

  if (layoutStyle === "editorial") {
    return (
      <div
        className={`cms-trending cms-trending--editorial border-b ${className ?? ""}`}
        data-testid="trending-ticker"
        data-tt-vid={vid}
        data-tt-layout="editorial"
        style={{ background: "var(--tt-bg)", borderColor: "var(--tt-border)" }}
      >
        <TickerPaletteStyle vid={vid} palette={palette} />
        <div className={`${innerMax} px-4 lg:px-8`}>
          <EditorialTicker
            posts={posts.slice(0, Math.max(2, Math.min(6, posts.length)))}
            label={label}
            lang={lang}
            intervalSec={Math.max(3, intervalSec)}
          />
        </div>
        <TickerStyles />
      </div>
    );
  }



  return (
    <div
      className={`cms-trending border-b ${isBadge ? "cms-trending--badge" : "cms-trending--classic"} ${className ?? ""}`}
      data-testid="trending-ticker"
      data-tt-vid={vid}
      data-tt-layout={layoutStyle}
      style={{
        background: "var(--tt-bg)",
        borderColor: "var(--tt-border)",
      }}
    >
      <TickerPaletteStyle vid={vid} palette={palette} />
      <div
        className={`${innerMax} ${isBadge ? "pr-4 lg:pr-8 pl-0" : "px-4 lg:px-8"} h-10 flex items-stretch gap-0 overflow-hidden`}
      >
        {isBadge ? (
          <span
            className="inline-flex items-center h-10 px-4 text-[12px] leading-none font-bold uppercase tracking-[0.14em] shrink-0 whitespace-nowrap mr-4"
            style={{
              background: "var(--tt-label-bg)",
              color: "var(--tt-label-fg)",
            }}
          >
            {label}
          </span>
        ) : (
          <>
            <span
              className="inline-flex items-center h-10 gap-1.5 text-[12px] leading-none font-bold uppercase tracking-[0.14em] shrink-0 whitespace-nowrap mr-4"
              style={{ color: "var(--tt-label)" }}
            >
              <Flame
                className={`w-4 h-4 shrink-0 ${iconClass}`}
                style={{ color: "var(--tt-label)" }}
                aria-hidden
              />
              <span className="leading-none">{label}</span>
            </span>
            <span
              className="hidden sm:block self-center h-4 w-px shrink-0 mr-4"
              aria-hidden
              style={{ background: "var(--tt-border)" }}
            />
          </>
        )}
        <div
          className={`flex-1 min-w-0 flex items-center gap-6 ${
            kind === "scroll" ? "overflow-x-auto scrollbar-none" : "overflow-hidden"
          }`}
          style={{ scrollbarWidth: "none" }}
        >
          {kind === "scroll" ? (
            currentBatch.map((p, i) => (
              <div key={`${p.id}-${i}`} className="inline-flex items-center gap-6 shrink-0">
                <TickerItem
                  post={p}
                  index={i}
                  lang={lang}
                  animation="none"
                  showCounter={!isBadge}
                />
                {isBadge && i < currentBatch.length - 1 && (
                  <span
                    className="tt-dot inline-block w-1 h-1 rounded-full shrink-0"
                    style={{ background: "var(--tt-dot)" }}
                    aria-hidden
                  />
                )}
              </div>
            ))
          ) : (
            <div className="flex-1 min-w-0 flex items-center gap-6" key={`batch-${batch}`}>
              {currentBatch.map((p, i) => (
                <div
                  key={`${p.id}-${batch}-${i}`}
                  className="inline-flex items-center gap-6 shrink-0"
                >
                  <TickerItem
                    post={p}
                    index={batch * perView + i}
                    lang={lang}
                    animation={kind}
                    delayMs={i * 90}
                    showCounter={!isBadge}
                  />
                  {isBadge && i < currentBatch.length - 1 && (
                    <span
                      className="tt-dot inline-block w-1 h-1 rounded-full shrink-0"
                      style={{ background: "var(--tt-dot)" }}
                      aria-hidden
                    />
                  )}
                </div>
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
  showCounter?: boolean;
}

function TickerItem({
  post,
  index,
  lang,
  animation,
  delayMs = 0,
  showCounter = true,
}: TickerItemProps) {
  const title =
    lang === "en" ? post.title_en || post.title_pl || "" : post.title_pl || post.title_en || "";
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
      {showCounter && (
        <span
          className="text-[12px] leading-none font-bold tabular-nums"
          style={{ color: "var(--tt-counter)" }}
        >
          {String(displayIdx).padStart(2, "0")}
        </span>
      )}
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

function TickerPaletteStyle({ vid, palette }: { vid: string; palette: TickerColorScheme }) {
  const sel = `[data-tt-vid="${vid}"]`;
  const L = palette.light;
  const D = palette.dark;
  const css = `
    ${sel} {
      --tt-bg: ${L.bg};
      --tt-border: ${L.border};
      --tt-label: ${L.label};
      --tt-item: ${L.item};
      --tt-item-hover: ${L.itemHover};
      --tt-counter: ${L.counter};
      --tt-label-bg: ${L.labelBg || L.label};
      --tt-label-fg: ${L.labelFg || "#ffffff"};
      --tt-dot: ${L.dot || L.label};
    }
    :root.dark ${sel}, .dark ${sel} {
      --tt-bg: ${D.bg};
      --tt-border: ${D.border};
      --tt-label: ${D.label};
      --tt-item: ${D.item};
      --tt-item-hover: ${D.itemHover};
      --tt-counter: ${D.counter};
      --tt-label-bg: ${D.labelBg || D.label};
      --tt-label-fg: ${D.labelFg || "#ffffff"};
      --tt-dot: ${D.dot || D.label};
    }
    ${sel} .tt-item:hover { color: var(--tt-item-hover) !important; }
  `;
  return <style dangerouslySetInnerHTML={{ __html: hardenStyleCss(css) }} />;
}

interface EditorialPost {
  id: string;
  href?: string;
  slug?: string;
  title_pl: string | null;
  title_en: string | null;
  author_name?: string;
  author_avatar_url?: string | null;
}

/**
 * "Editorial" layout - static section block on the left, vertically sliding
 * headline (title + author) on the right. Pauses on hover and honors
 * prefers-reduced-motion (falls back to a static first item).
 */
function EditorialTicker({
  posts,
  label,
  lang,
  intervalSec,
}: {
  posts: EditorialPost[];
  label: string;
  lang: "pl" | "en";
  intervalSec: number;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = posts.length;

  useEffect(() => {
    if (paused || count < 2) return;
    const t = window.setInterval(() => setIndex((i) => (i + 1) % count), intervalSec * 1000);
    return () => window.clearInterval(t);
  }, [paused, count, intervalSec]);

  const active = posts[Math.min(index, count - 1)];
  const title =
    lang === "en"
      ? active.title_en || active.title_pl || ""
      : active.title_pl || active.title_en || "";
  const href = active.href ?? (active.slug ? `/post/${active.slug}` : "#");
  const sectionWord = lang === "en" ? "Section" : "Sekcja";

  return (
    <div
      className="tt-ed relative flex items-stretch h-14 overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div
        className="relative flex flex-col justify-center pl-4 pr-5 shrink-0 select-none"
        style={{ borderRight: "1px solid var(--tt-border)" }}
      >
        <span
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full"
          aria-hidden
          style={{ background: "var(--tt-label)" }}
        />
        <span
          className="text-[9px] font-bold uppercase leading-none tracking-[0.25em] mb-1"
          style={{ color: "var(--tt-label)" }}
        >
          {sectionWord}
        </span>
        <span
          className="text-[11px] font-extrabold uppercase leading-none tracking-tight"
          style={{ color: "var(--tt-item)" }}
        >
          {label}
        </span>
      </div>

      <div className="relative flex-1 min-w-0 pl-5 pr-2">
        <div key={active.id} className="tt-ed-slide absolute inset-0 pl-5 pr-2 flex items-center">
          <AppLink href={href} className="group flex-1 min-w-0 flex flex-col justify-center py-1.5">
            <span
              className="tt-ed-title text-[14px] font-semibold leading-snug truncate"
              style={{ color: "var(--tt-item)" }}
              title={title}
            >
              {title}
            </span>
            {active.author_name ? (
              <span className="mt-1 flex items-center gap-2 min-w-0">
                {active.author_avatar_url ? (
                  <img
                    src={active.author_avatar_url}
                    alt=""
                    loading="lazy"
                    className="w-[18px] h-[18px] rounded-full object-cover grayscale"
                    style={{ boxShadow: "0 0 0 1px var(--tt-border)" }}
                  />
                ) : null}
                <span
                  className="text-[11px] font-medium truncate"
                  style={{ color: "var(--tt-counter)" }}
                >
                  {active.author_name}
                </span>
              </span>
            ) : null}
          </AppLink>
          <span
            className="hidden sm:block pl-6 text-[22px] font-bold tabular-nums leading-none opacity-40 select-none"
            style={{ color: "var(--tt-counter)" }}
            aria-hidden
          >
            {String(index + 1).padStart(2, "0")}
          </span>
        </div>
      </div>
    </div>
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

        @keyframes tt-ed-slide {
          from { opacity: 0; transform: translateY(14px) }
          to   { opacity: 1; transform: translateY(0) }
        }
        .tt-ed-slide { animation: tt-ed-slide 460ms cubic-bezier(.2,.8,.2,1) both }
        .tt-ed .group:hover .tt-ed-title { color: var(--tt-item-hover, var(--tt-label)) }

        @media (prefers-reduced-motion: reduce) {
          .tt-ed-slide { animation: none !important }
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
