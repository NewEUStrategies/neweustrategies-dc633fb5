// Header "Na czasie / Trending" - compact bar of posts.
// Sources: trending | latest | pinned | selected | mixed.
// Modes: scroll (marquee) | fade | slide | flip | typewriter.
// Colors and label overridable per light/dark via CSS custom properties.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
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
  type LiveDirection,
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
  /** Horizontal marquee layouts: scroll speed in px/s. */
  scrollSpeed?: number;
  /** `glassLive`: pionowy slide (domyślnie) albo poziomy marquee. */
  liveDirection?: LiveDirection;
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
  scrollSpeed = 60,
  liveDirection = "vertical",
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
  const { t, i18n } = useTranslation();
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

  const defaultLabel = t("trendingTicker.badge");
  const label =
    lang === "en"
      ? (labelEn && labelEn.trim()) || (labelPl && labelPl.trim()) || defaultLabel
      : (labelPl && labelPl.trim()) || (labelEn && labelEn.trim()) || defaultLabel;
  const innerMax = fullWidth ? "max-w-none" : "max-w-[1400px] mx-auto";

  const currentBatch =
    kind === "scroll" ? posts : posts.slice(batch * perView, batch * perView + perView);

  const iconClass = `tt-flame tt-flame-${iconAnimation}`;

  if (isMarquee) {
    const isVerticalLayout =
      layoutStyle === "glassCards" ||
      layoutStyle === "glassSpotlight" ||
      (layoutStyle === "glassLive" && liveDirection === "vertical");
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
              scrollSpeed={scrollSpeed}
              perView={perView}
              iconClass={iconClass}
              skin={skin}
            />
          ) : (
            <TickerGlassMarquee
              label={label}
              posts={posts}
              lang={lang}
              intervalSec={intervalSec}
              scrollSpeed={scrollSpeed}
              perView={perView}
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
            className="inline-flex items-center h-10 px-2 sm:px-4 text-[12px] leading-none font-bold uppercase tracking-[0.14em] shrink-0 whitespace-nowrap mr-4"
            style={{
              background: "var(--tt-label-bg)",
              color: "var(--tt-label-fg)",
            }}
          >
            <Flame
              className={`w-4 h-4 shrink-0 ${iconClass}`}
              style={{ color: "var(--tt-label-fg)" }}
              aria-hidden
            />
            <span className="hidden sm:inline leading-none">{label}</span>
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
              <span className="hidden sm:inline leading-none">{label}</span>
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
    author_display_name?: string | null;
    author_avatar_url?: string | null;
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
          className="hidden sm:inline text-[12px] leading-none font-bold tabular-nums"
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
type MarqueeSkin = "marquee" | "cards" | "ribbon" | "spotlight" | "tape" | "live";

const SKIN_BY_LAYOUT: Partial<Record<LayoutStyle, MarqueeSkin>> = {
  glassMarquee: "marquee",
  glassCards: "cards",
  glassRibbon: "ribbon",
  glassSpotlight: "spotlight",
  glassTape: "tape",
  glassLive: "live",
};

/** Inicjały jako zapas, gdy profil nie ma awatara - autor MA być zawsze widoczny. */
function authorInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Inline'owy autor (awatar + nazwisko) - używany przez skin `live`. */
function TickerAuthor({ post }: { post: TickerItemProps["post"] }) {
  const name = post.author_display_name?.trim() ?? "";
  const avatar = post.author_avatar_url?.trim() ?? "";
  if (!name && !avatar) return null;
  return (
    <span className="tt-live-author inline-flex shrink-0 items-center gap-[5px]">
      {avatar ? (
        <img
          src={avatar}
          alt=""
          loading="lazy"
          width={20}
          height={20}
          className="tt-live-avatar h-5 w-5 rounded-[5px] object-cover"
        />
      ) : name ? (
        <span
          className="tt-live-avatar inline-flex h-5 w-5 items-center justify-center rounded-[5px] text-[9px] font-bold"
          aria-hidden
        >
          {authorInitials(name)}
        </span>
      ) : null}
      {name ? (
        <span className="tt-live-name hidden sm:inline whitespace-nowrap text-[12px] font-semibold">
          {name}
        </span>
      ) : null}
    </span>
  );
}

interface MarqueeLayoutProps {
  label: string;
  posts: readonly TickerItemProps["post"][];
  lang: "pl" | "en";
  intervalSec: number;
  /** Horizontal engine: px per second. */
  scrollSpeed: number;
  /** How many items are visible at once in the viewport. */
  perView: number;
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
  scrollSpeed,
  perView,
  iconClass,
  skin,
}: MarqueeLayoutProps) {
  const anim = `tt-marquee-${useId().replace(/:/g, "")}`;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [lapPx, setLapPx] = useState(0);

  // One lap = half of the duplicated track. Measuring it keeps the configured
  // speed honest (px/s) no matter how many posts or how long the titles are.
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setLapPx(el.scrollWidth / 2);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [posts, lang, perView]);

  const speed = Math.max(10, Math.min(400, scrollSpeed || 60));
  // Fallback before measurement: assume ~220px per item.
  const estimated = posts.length * 220;
  const durationSec = Math.max(4, (lapPx || estimated) / speed);
  const loop = [...posts, ...posts];
  // "Items visible at once" caps each pill so exactly `perView` fit the viewport.
  const pillMax = perView > 1 ? `calc((100% - ${(perView - 1) * 12}px) / ${perView})` : undefined;

  return (
    <div
      className={`tt-glass tt-glass--marquee tt-skin--${skin} flex items-center gap-3 overflow-hidden`}
      data-tt-interval={intervalSec}
    >
      <span className="tt-glass-label tt-glass-chip inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap">
        <span className="tt-chip-icon relative inline-flex items-center justify-center shrink-0">
          <Flame className={`w-3.5 h-3.5 shrink-0 ${iconClass}`} aria-hidden />
        </span>
        <span className="tt-chip-text hidden sm:inline">{label}</span>
      </span>

      <div className="tt-glass-track relative min-w-0 flex-1 overflow-hidden">
        <div
          ref={trackRef}
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
              style={{ color: "var(--tt-item)", maxWidth: pillMax }}
              title={itemTitle(p, lang)}
              aria-hidden={i >= posts.length ? true : undefined}
              tabIndex={i >= posts.length ? -1 : undefined}
            >
              {skin === "live" ? (
                <span
                  className="tt-live-index hidden sm:inline shrink-0 text-[13px] font-bold tabular-nums"
                  style={{ color: "var(--tt-label)" }}
                  aria-hidden
                >
                  {String((i % posts.length) + 1).padStart(2, "0")}
                </span>
              ) : (
                <span
                  className="tt-glass-dot inline-block w-1 h-1 rounded-full shrink-0"
                  style={{ background: "var(--tt-dot)" }}
                  aria-hidden
                />
              )}
              <span className="tt-live-title min-w-0 truncate">{itemTitle(p, lang)}</span>
              <span
                aria-hidden
                className="tt-live-separator inline-block w-px h-3.5 shrink-0 self-center"
              />
              {skin === "live" ? <TickerAuthor post={p} /> : null}
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

/** Vertical rotation engine - skins: cards (v5), spotlight (v11). */
function TickerGlassCards({
  label,
  posts,
  lang,
  intervalSec,
  perView,
  iconClass,
  skin,
}: MarqueeLayoutProps) {
  const anim = `tt-cards-${useId().replace(/:/g, "")}`;
  const rows = Math.max(1, Math.min(perView, posts.length));
  // Duplicate the first `rows` cards so the loop never shows an empty slot.
  const track = [...posts, ...posts.slice(0, rows)];
  const slots = track.length;
  const steps = posts.length; // one hold per real post
  const durationSec = Math.max(2, posts.length * Math.max(2, intervalSec));
  const keyframes = buildVerticalKeyframes(slots, anim, steps);

  return (
    <div
      className={`tt-glass tt-glass--cards tt-skin--${skin} flex items-center gap-3 overflow-hidden`}
    >
      <span className="tt-glass-label tt-glass-chip inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap">
        <span className="tt-chip-icon relative inline-flex items-center justify-center shrink-0">
          <Flame className={`w-3.5 h-3.5 shrink-0 ${iconClass}`} aria-hidden />
        </span>
        <span className="tt-chip-text hidden sm:inline">{label}</span>
      </span>

      <div
        className="tt-glass-viewport relative min-w-0 flex-1 overflow-hidden"
        style={{ ["--tt-rows" as string]: String(rows) }}
      >
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
              aria-hidden={i >= posts.length ? true : undefined}
            >
              <span
                className={`${skin === "live" ? "tt-live-index " : ""}hidden sm:inline text-[10px] font-bold tabular-nums opacity-70`}
                style={{ color: "var(--tt-counter)" }}
              >
                {String((i % posts.length) + 1).padStart(2, "0")}
              </span>
              <AppLink
                href={itemHref(p)}
                className="tt-item flex min-w-0 items-center gap-2.5 text-[13px] leading-none font-medium"
                style={{ color: "var(--tt-item)" }}
                title={itemTitle(p, lang)}
                tabIndex={i >= posts.length ? -1 : undefined}
              >
                <span className="tt-live-title min-w-0 truncate">{itemTitle(p, lang)}</span>
                <span
                  aria-hidden
                  className="tt-live-separator inline-block w-px h-3.5 shrink-0 self-center"
                />
                {skin === "live" ? <TickerAuthor post={p} /> : null}
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
export function buildVerticalKeyframes(
  slots: number,
  animName: string,
  stepCount = slots - 1,
): string {
  if (slots < 2) return "";
  const steps = Math.max(1, Math.min(stepCount, slots - 1));
  const slot = 100 / slots;
  const transition = 100 / (slots * steps);
  const hold = slot - transition;
  let frames = "";
  for (let i = 0; i < steps; i += 1) {
    const start = i * ((100 - transition) / steps);
    const end = start + Math.max(0, hold);
    const y = -((i * 100) / slots);
    frames += `${start.toFixed(2)}%,${end.toFixed(2)}%{transform:translate3d(0,${y.toFixed(2)}%,0)}`;
  }
  frames += `100%{transform:translate3d(0,${(-((steps * 100) / slots)).toFixed(2)}%,0)}`;
  return `@keyframes ${animName}{0%{transform:translate3d(0,0,0)}${frames}}`;
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
        .cms-trending, .cms-trending *,
        .tt-glass, .tt-glass * {
          font-family: var(--font-display, "Red Hat Display", system-ui, sans-serif);
        }
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
          height: calc(44px * var(--tt-rows, 1)); border-radius: 12px;
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

        /* v9 - animated gradient ribbon */
        @keyframes tt-ribbon-shift { to { background-position: 200% 50% } }
        .tt-skin--ribbon .tt-glass-track {
          border-radius: 999px; padding: 0 10px;
          background: linear-gradient(90deg,
            color-mix(in srgb, var(--tt-label) 22%, transparent),
            color-mix(in srgb, var(--tt-label) 4%, transparent),
            color-mix(in srgb, var(--tt-label) 22%, transparent));
          background-size: 200% 100%;
          animation: tt-ribbon-shift 9s linear infinite;
          box-shadow: 0 0 0 1px color-mix(in srgb, var(--tt-label) 26%, transparent) inset;
        }
        .tt-skin--ribbon .tt-glass-pill {
          background: none; border: none; box-shadow: none; backdrop-filter: none;
          -webkit-backdrop-filter: none; padding: 0 6px; letter-spacing: .02em;
        }
        .tt-skin--ribbon .tt-glass-pill:hover { transform: none; text-decoration: underline }
        .tt-skin--ribbon .tt-glass-dot {
          width: 5px; height: 5px; transform: rotate(45deg); border-radius: 1px;
        }

        /* v13 - ticker tape */
        .tt-skin--tape .tt-glass-chip {
          border-radius: 0; clip-path: polygon(0 0, 100% 0, calc(100% - 8px) 100%, 0 100%);
          background: var(--tt-label); color: var(--tt-label-fg);
        }
        .tt-skin--tape .tt-glass-track {
          border-top: 1px dashed color-mix(in srgb, var(--tt-border) 90%, transparent);
          border-bottom: 1px dashed color-mix(in srgb, var(--tt-border) 90%, transparent);
        }
        .tt-skin--tape .tt-glass-pill {
          border-radius: 0;
          font-size: 12px; font-variant-numeric: tabular-nums; letter-spacing: .04em; text-transform: uppercase;
          background: none; box-shadow: none; backdrop-filter: none;
          -webkit-backdrop-filter: none;
          border: 1px solid color-mix(in srgb, var(--tt-border) 90%, transparent);
          clip-path: polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%);
        }
        .tt-skin--tape .tt-glass-pill:hover { transform: none }

        /* Widget "Na czasie" - subtelny, mniejszy badge brandowy
           (nie przytłaczający, pasuje do headera zamiast go dominować). */
        .tt-skin--live { gap: 8px }
        .tt-skin--live .tt-glass-chip {
          position: relative;
          overflow: hidden;
          height: 26px;
          padding: 0 10px;
          border-radius: 3px;
          border-left: 2px solid color-mix(in srgb, white 45%, transparent);
          clip-path: none;
          transform: skewX(-8deg);
          transform-origin: center;
          background: linear-gradient(90deg,
            color-mix(in srgb, var(--tt-label) 78%, transparent),
            color-mix(in srgb, var(--tt-label) 92%, transparent));
          color: var(--tt-label-fg);
          font-weight: 800;
          font-size: 10px;
          letter-spacing: .06em;
          text-transform: uppercase;
          box-shadow: 0 3px 10px -4px color-mix(in srgb, var(--tt-label) 55%, transparent);
          transition: transform .25s ease, box-shadow .25s ease;
          gap: 6px;
          /* skew wysuwa lewą krawędź w lewo - dodajemy margines, żeby nie być obciętym przez overflow-hidden rodzica */
          margin-left: 4px;
        }
        .tt-skin--live .tt-glass-chip:active { transform: skewX(-8deg) scale(.97) }
        .tt-skin--live .tt-chip-icon,
        .tt-skin--live .tt-chip-text {
          transform: skewX(8deg);
        }
        .tt-skin--live .tt-chip-text { user-select: none }
        .tt-skin--live .tt-chip-icon {
          width: 16px; height: 16px;
        }
        /* Ikona flame w badge „Na czasie" ma być nieruchoma - wyłączamy globalne animacje. */
        .tt-skin--live .tt-flame {
          animation: none !important;
          transform: none !important;
          will-change: auto;
        }
        /* Delikatna pulsacja za ikoną - zawsze widoczna, nienarzucająca się. */
        .tt-skin--live .tt-chip-icon::before,
        .tt-skin--live .tt-chip-icon::after {
          content: "";
          position: absolute;
          border-radius: 9999px;
          background: color-mix(in srgb, #fff 18%, transparent);
          opacity: .55;
          pointer-events: none;
          animation: tt-live-ping 2.6s cubic-bezier(0,0,.2,1) infinite;
        }
        .tt-skin--live .tt-chip-icon::before { width: 18px; height: 18px }
        .tt-skin--live .tt-chip-icon::after {
          width: 14px; height: 14px;
          background: color-mix(in srgb, #fff 10%, transparent);
          animation-delay: .9s;
        }
        @keyframes tt-live-ping {
          75%, 100% { transform: scale(1.6); opacity: 0 }
        }
        /* Delikatny refleks na hover. */
        .tt-skin--live .tt-glass-chip::after {
          content: "";
          position: absolute;
          inset: 0 auto 0 -100%;
          width: 100%;
          background: linear-gradient(90deg, transparent,
            color-mix(in srgb, white 18%, transparent), transparent);
          transition: left .8s ease-in-out;
          pointer-events: none;
        }
        .tt-skin--live .tt-glass-chip:hover::after { left: 100% }
        @media (prefers-reduced-motion: reduce) {
          .tt-skin--live .tt-glass-chip::after { transition: none }
          .tt-skin--live .tt-chip-icon::before,
          .tt-skin--live .tt-chip-icon::after { animation: none }
        }
        /* Wariant "Na czasie": badge jest samodzielny, bez ciemnego paska nachodzącego na niego */
        .tt-skin--live .tt-glass-track,
        .tt-skin--live .tt-glass-viewport {

          background: transparent;
          border: none;
          border-radius: 0;
          box-shadow: none;
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
          margin-left: 0;
        }
        .tt-skin--live .tt-glass-track::before,
        .tt-skin--live .tt-glass-track::after,
        .tt-skin--live .tt-glass-viewport::before,
        .tt-skin--live .tt-glass-viewport::after {
          display: none;
        }
        .tt-skin--live .tt-glass-card { padding: 0 16px }
        .tt-skin--live .tt-item { font-size: 14px; font-weight: 700; letter-spacing: -.01em }
        .tt-skin--live .tt-glass-pill {
          border-radius: 0; background: none; box-shadow: none; border: 0;
          backdrop-filter: none; -webkit-backdrop-filter: none;
          font-size: 14px; font-weight: 700;
        }
        .tt-skin--live .tt-live-author { color: var(--tt-counter) }
        .tt-skin--live .tt-live-name { color: var(--tt-counter) }

        .tt-skin--live .tt-live-avatar {
          background: color-mix(in srgb, var(--tt-label) 18%, transparent);
          color: var(--tt-label);
          box-shadow: 0 0 0 1px color-mix(in srgb, var(--tt-border) 90%, transparent);
        }
        .tt-skin--live .tt-item.tt-item { column-gap: 0; line-height: 1.5 }
        .tt-skin--live .tt-glass-pill.tt-glass-pill { column-gap: 0; line-height: 1.5 }
        .tt-skin--live .tt-live-index { margin-right: 10px }
        .tt-skin--live .tt-live-title.tt-live-title { line-height: 1.5; padding-block: 2px }
        .tt-live-separator {
          width: 1px; height: 14px; margin: 0 10px;
          background: currentColor;
          opacity: 0.35;
          flex-shrink: 0; align-self: center;
        }
        /* Pionowy slide: numer w kolorze brandu, jak w poziomym marquee */
        .tt-skin--live .tt-glass-card > .tt-live-index {
          font-size: 13px; opacity: 1; color: var(--tt-label);
        }

        /* v11 - spotlight rotation */
        .tt-skin--spotlight .tt-glass-viewport {
          border-radius: 0; border-left: 2px solid var(--tt-label);
          border-top: none; border-right: none; border-bottom: none;
          background: radial-gradient(120% 140% at 0% 50%,
            color-mix(in srgb, var(--tt-label) 20%, transparent), transparent 70%);
          box-shadow: none;
        }
        .tt-skin--spotlight .tt-glass-card + .tt-glass-card { border-top: none }
        .tt-skin--spotlight .tt-glass-card > span:first-child {
          font-size: 18px; opacity: 1; color: var(--tt-label);
        }
        .tt-skin--spotlight .tt-item { font-size: 14px; font-weight: 600 }



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
