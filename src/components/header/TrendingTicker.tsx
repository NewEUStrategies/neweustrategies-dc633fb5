// Header "Na czasie / Trending" - compact bar of posts.
// Sources: trending | latest | pinned | selected | mixed.
// Modes: scroll (marquee) | fade | slide | flip | typewriter.
// Colors and label overridable per light/dark via CSS custom properties.
import { useEffect, useId, useState } from "react";
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
  isMarqueeLayout,
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
  const isMarquee = isMarqueeLayout(layoutStyle);

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

  if (isMarquee) {
    const isVerticalLayout = layoutStyle === "glassCards" || layoutStyle === "glassSpotlight";
    const skin = SKIN_BY_LAYOUT[layoutStyle] ?? "marquee";
    return (
      <div
        className={`cms-trending border-b cms-trending--glass cms-trending--${skin} ${className ?? ""}`}
        data-testid="trending-ticker"
        data-tt-vid={vid}
        data-tt-layout={layoutStyle}
        style={{ background: "var(--tt-bg)", borderColor: "var(--tt-border)" }}
      >
        <TickerPaletteStyle vid={vid} palette={palette} />
        <div className={`${innerMax} px-4 lg:px-8`}>
          {isVerticalLayout ? (
            <TickerGlassCards
              label={label}
              posts={posts}
              lang={lang}
              intervalSec={intervalSec}
              iconClass={iconClass}
              skin={skin}
            />
          ) : (
            <TickerGlassMarquee
              label={label}
              posts={posts}
              lang={lang}
              intervalSec={intervalSec}
              iconClass={iconClass}
              skin={skin}
            />
          )}
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

/** Visual skin applied to the two marquee engines (horizontal / vertical). */
type MarqueeSkin = "marquee" | "cards" | "ribbon" | "spotlight" | "tape";

const SKIN_BY_LAYOUT: Partial<Record<LayoutStyle, MarqueeSkin>> = {
  glassMarquee: "marquee",
  glassCards: "cards",
  glassRibbon: "ribbon",
  glassSpotlight: "spotlight",
  glassTape: "tape",
};

interface MarqueeLayoutProps {
  label: string;
  posts: readonly TickerItemProps["post"][];
  lang: "pl" | "en";
  intervalSec: number;
  iconClass: string;
  skin: MarqueeSkin;
}


function itemTitle(post: TickerItemProps["post"], lang: "pl" | "en"): string {
  return lang === "en"
    ? post.title_en || post.title_pl || ""
    : post.title_pl || post.title_en || "";
}

function itemHref(post: TickerItemProps["post"]): string {
  return post.href ?? (post.slug ? `/post/${post.slug}` : "#");
}

/** Horizontal marquee engine - skins: marquee (v7), ribbon (v9), tape (v13). */
function TickerGlassMarquee({
  label,
  posts,
  lang,
  intervalSec,
  iconClass,
  skin,
}: MarqueeLayoutProps) {
  const anim = `tt-marquee-${useId().replace(/:/g, "")}`;
  // One lap should scale with the number of items, not with a fixed duration -
  // otherwise 3 posts fly by and 20 posts crawl.
  const durationSec = Math.max(18, Math.min(120, posts.length * Math.max(2, intervalSec) * 0.9));
  const loop = [...posts, ...posts];

  return (
    <div
      className={`tt-glass tt-glass--marquee tt-skin--${skin} flex items-center gap-3 overflow-hidden`}
    >

      <span className="tt-glass-label tt-glass-chip inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap">
        <Flame className={`w-3.5 h-3.5 shrink-0 ${iconClass}`} aria-hidden />
        <span>{label}</span>
      </span>
      <div className="tt-glass-track relative min-w-0 flex-1 overflow-hidden">
        <div
          className="flex w-max items-center gap-3 py-2"
          style={{ animation: `${anim} ${durationSec}s linear infinite` }}
          onMouseEnter={(e) => {
            e.currentTarget.style.animationPlayState = "paused";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.animationPlayState = "running";
          }}
        >
          {loop.map((p, i) => (
            <AppLink
              key={`${p.id}-${i}`}
              href={itemHref(p)}
              className="tt-item tt-glass-pill inline-flex items-center gap-2 whitespace-nowrap text-[13px] leading-none font-medium shrink-0"

              style={{ color: "var(--tt-item)" }}
              title={itemTitle(p, lang)}
              aria-hidden={i >= posts.length ? true : undefined}
              tabIndex={i >= posts.length ? -1 : undefined}
            >
              <span
                className="tt-glass-dot inline-block w-1 h-1 rounded-full"
                style={{ background: "var(--tt-dot)" }}
                aria-hidden
              />
              {itemTitle(p, lang)}
            </AppLink>
          ))}
        </div>
      </div>
      <style
        dangerouslySetInnerHTML={{
          __html: `@keyframes ${anim}{0%{transform:translate3d(0,0,0)}100%{transform:translate3d(-50%,0,0)}}`,
        }}
      />
    </div>
  );
}

/** v5 - floating glass cards rotating vertically, one headline at a time. */
function TickerGlassCards({ label, posts, lang, intervalSec, iconClass }: MarqueeLayoutProps) {
  const anim = `tt-cards-${useId().replace(/:/g, "")}`;
  const slots = posts.length + 1; // duplicate first card for a seamless loop
  const durationSec = Math.max(6, posts.length * Math.max(2, intervalSec));
  const keyframes = buildVerticalKeyframes(slots, anim);
  const track = [...posts, posts[0]];

  return (
    <div className="tt-glass tt-glass--cards flex items-center gap-3 overflow-hidden">
      <span className="tt-glass-label tt-glass-chip inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap">
        <Flame className={`w-3.5 h-3.5 shrink-0 ${iconClass}`} aria-hidden />
        <span>{label}</span>
      </span>
      <div className="tt-glass-viewport relative min-w-0 flex-1 overflow-hidden">
        <div
          className="flex flex-col"
          style={{ animation: `${anim} ${durationSec}s cubic-bezier(.65,0,.35,1) infinite` }}
          onMouseEnter={(e) => {
            e.currentTarget.style.animationPlayState = "paused";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.animationPlayState = "running";
          }}
        >
          {track.map((p, i) => (
            <div
              key={`${p.id}-${i}`}
              className="tt-glass-card flex h-11 shrink-0 items-center gap-2.5"

              aria-hidden={i === posts.length ? true : undefined}
            >
              <span
                className="text-[10px] font-bold tabular-nums opacity-70"
                style={{ color: "var(--tt-counter)" }}
              >
                {String((i % posts.length) + 1).padStart(2, "0")}
              </span>
              <AppLink
                href={itemHref(p)}
                className="tt-item min-w-0 truncate text-[13px] leading-none font-medium"
                style={{ color: "var(--tt-item)" }}
                title={itemTitle(p, lang)}
                tabIndex={i === posts.length ? -1 : undefined}
              >
                {itemTitle(p, lang)}
              </AppLink>
            </div>
          ))}
        </div>
      </div>
      <style dangerouslySetInnerHTML={{ __html: keyframes }} />
    </div>
  );
}

/** Hold-then-advance vertical keyframes for `slots` stacked rows. */
export function buildVerticalKeyframes(slots: number, animName: string): string {
  if (slots < 2) return "";
  const slot = 100 / slots;
  const transition = 100 / (slots * (slots - 1));
  const hold = slot - transition;
  let steps = "";
  for (let i = 0; i < slots - 1; i += 1) {
    const start = i * (slot + transition);
    const end = start + hold;
    const y = -((i * 100) / slots);
    steps += `${start.toFixed(2)}%,${end.toFixed(2)}%{transform:translate3d(0,${y.toFixed(2)}%,0)}`;
  }
  steps += `100%{transform:translate3d(0,${(-(((slots - 1) * 100) / slots)).toFixed(2)}%,0)}`;
  return `@keyframes ${animName}{0%{transform:translate3d(0,0,0)}${steps}}`;
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

        /* Glass marquee / cards (v7 / v5) */
        .tt-glass { position: relative; padding: 6px 0 }
        .tt-glass-label {
          font-size: 11px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase;
          color: var(--tt-label);
        }
        .tt-glass-chip {
          height: 28px; padding: 0 12px; border-radius: 999px;
          border: 1px solid color-mix(in srgb, var(--tt-label) 34%, transparent);
          background: linear-gradient(135deg,
            color-mix(in srgb, var(--tt-label) 18%, transparent),
            color-mix(in srgb, var(--tt-label) 4%, transparent));
          box-shadow: 0 1px 0 color-mix(in srgb, #fff 22%, transparent) inset,
                      0 6px 18px -12px color-mix(in srgb, var(--tt-label) 80%, transparent);
          backdrop-filter: blur(10px) saturate(140%);
          -webkit-backdrop-filter: blur(10px) saturate(140%);
        }
        .tt-glass-pill {
          height: 28px; padding: 0 14px; border-radius: 999px;
          border: 1px solid color-mix(in srgb, var(--tt-border) 90%, transparent);
          background: linear-gradient(135deg,
            color-mix(in srgb, #fff 12%, transparent),
            color-mix(in srgb, #fff 3%, transparent));
          box-shadow: 0 1px 0 color-mix(in srgb, #fff 18%, transparent) inset;
          backdrop-filter: blur(8px) saturate(130%);
          -webkit-backdrop-filter: blur(8px) saturate(130%);
          transition: transform .25s cubic-bezier(.22,.61,.36,1), border-color .25s, box-shadow .25s;
        }
        .tt-glass-pill:hover {
          transform: translateY(-1px);
          border-color: color-mix(in srgb, var(--tt-label) 55%, transparent);
          box-shadow: 0 10px 24px -16px color-mix(in srgb, var(--tt-label) 90%, transparent);
        }
        .tt-glass--marquee .tt-glass-track::before,
        .tt-glass--marquee .tt-glass-track::after {
          content: ""; position: absolute; top: 0; bottom: 0; width: 56px; z-index: 2;
          pointer-events: none;
        }
        .tt-glass--marquee .tt-glass-track::before {
          left: 0; background: linear-gradient(to right, var(--tt-bg), transparent);
        }
        .tt-glass--marquee .tt-glass-track::after {
          right: 0; background: linear-gradient(to left, var(--tt-bg), transparent);
        }
        .tt-glass--cards .tt-glass-viewport {
          height: 44px; border-radius: 12px;
          border: 1px solid color-mix(in srgb, var(--tt-border) 90%, transparent);
          background: linear-gradient(135deg,
            color-mix(in srgb, #fff 10%, transparent),
            color-mix(in srgb, #fff 2%, transparent));
          box-shadow: 0 1px 0 color-mix(in srgb, #fff 16%, transparent) inset,
                      0 12px 28px -22px color-mix(in srgb, var(--tt-label) 80%, transparent);
          backdrop-filter: blur(10px) saturate(140%);
          -webkit-backdrop-filter: blur(10px) saturate(140%);
        }
        .tt-glass--cards .tt-glass-card { padding: 0 14px }
        .tt-glass--cards .tt-glass-card + .tt-glass-card {
          border-top: 1px solid color-mix(in srgb, var(--tt-border) 60%, transparent);
        }


        @media (prefers-reduced-motion: reduce) {
          .tt-glass [style*="animation"] { animation: none !important }
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
