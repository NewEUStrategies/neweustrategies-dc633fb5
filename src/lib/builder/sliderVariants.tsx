// Slider widget - styled variants. Self-contained renderer (no external slider
// library). Variants share data resolution (post bindings, fallback covers,
// autoplay, drag), and each variant renders the slides differently.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight } from "@/lib/lucide-shim";
import { safeImageUrl, safeUrl } from "@/lib/sanitize";
import { useResolvedPostRefs } from "./contentRefs";
import { supabase } from "@/integrations/supabase/client";
import { AppLink } from "@/components/atoms/AppLink";
import type { WidgetTypography } from "./types";

export type SliderVariant =
  | "editorial-hero"
  | "multi-card"
  | "cinematic-overlay"
  | "split-feature"
  | "minimal-strip";

export interface SliderItem {
  image: string;
  /** Optional bound post - cover/title/href become live unless overridden. */
  postId?: string;
  title_pl?: string;
  title_en?: string;
  subtitle_pl?: string;
  subtitle_en?: string;
  href?: string;
  cta_pl?: string;
  cta_en?: string;
  category_pl?: string;
  category_en?: string;
  categoryColor?: string;
  author?: string;
  readTime?: string;
}

export const SLIDER_VARIANTS: { value: SliderVariant; label: string }[] = [
  { value: "editorial-hero", label: "Editorial Hero" },
  { value: "multi-card", label: "Karuzela kart (3-up)" },
  { value: "cinematic-overlay", label: "Cinematic Overlay" },
  { value: "split-feature", label: "Split Feature" },
  { value: "minimal-strip", label: "Minimal + miniatury" },
];

export type NavBgStyle = "glass" | "solid" | "outline" | "soft" | "gradient" | "shadow";
export type NavPosition = "mid" | "mid-outside" | "bottom" | "top";

export interface SliderConfig {
  variant?: SliderVariant;
  items: SliderItem[];
  ratio?: "16/9" | "4/3" | "1/1" | "21/9" | "3/2";
  autoplay?: boolean;
  intervalMs?: number;
  rounded?: "none" | "sm" | "md" | "lg" | "xl" | "full";
  overlayOpacity?: number;
  titleSizePx?: number;
  titleWeight?: number;
  subtitleSizePx?: number;
  subtitleWeight?: number;
  typography?: WidgetTypography;
  /** Number of cards visible per row (only multi-card variant). 1-4, default 3. */
  columns?: 1 | 2 | 3 | 4;
  /** Navigation-button styling (side arrows). */
  navSizePx?: number;      // 28..96, default 52 (desktop) / 44 (mobile)
  navRoundedPx?: number;   // 0..64, default 999 (pill). 999+ = full pill
  navBgColor?: string;     // any CSS color, default #ffffff
  navArrowColor?: string;  // any CSS color, default #ffffff
  navBgStyle?: NavBgStyle; // default "glass"
  navPosition?: NavPosition; // default "mid"
}

export interface NavStyleResolved {
  sizePx: number;
  radiusCss: string;
  bgColor: string;
  arrowColor: string;
  bgStyle: NavBgStyle;
  position: NavPosition;
}

export function resolveNavStyle(cfg: SliderConfig): NavStyleResolved {
  const sizePx = Math.max(28, Math.min(96, cfg.navSizePx ?? 52));
  const radiusRaw = typeof cfg.navRoundedPx === "number" ? cfg.navRoundedPx : 999;
  const radiusCss = radiusRaw >= 999 ? "9999px" : `${Math.max(0, radiusRaw)}px`;
  return {
    sizePx,
    radiusCss,
    bgColor: cfg.navBgColor ?? "#ffffff",
    arrowColor: cfg.navArrowColor ?? "#ffffff",
    bgStyle: cfg.navBgStyle ?? "glass",
    position: cfg.navPosition ?? "mid",
  };
}

const radiusMap: Record<NonNullable<SliderConfig["rounded"]>, string> = {
  none: "0px", sm: "4px", md: "8px", lg: "16px", xl: "24px", full: "9999px",
};

const SLIDER_IMAGE_PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 75" preserveAspectRatio="xMidYMid meet"><rect width="100" height="75" fill="hsl(0 0% 90%)"/><g fill="none" stroke="hsl(0 0% 60%)" stroke-width="1.4"><rect x="30" y="22" width="40" height="28" rx="2"/><circle cx="39" cy="32" r="3"/><path d="m70 50-12-12-22 18"/></g></svg>',
  );

interface RenderProps {
  config: SliderConfig;
  lang: "pl" | "en";
  preview?: boolean;
}

interface FallbackPostImage {
  cover_image_url: string | null;
}

interface ResilientSliderImageProps {
  src: string;
  fallbackSrc?: string;
  placeholderSrc: string;
  active: boolean;
  onBrokenSource: (src: string) => void;
  priority?: boolean;
  /** Override layout className (default: absolute fill cover). */
  className?: string;
  /** Force visibility (skip the fade-via-opacity behaviour). */
  alwaysVisible?: boolean;
}

function ResilientSliderImage({
  src,
  fallbackSrc,
  placeholderSrc,
  active,
  onBrokenSource,
  priority = false,
  className,
  alwaysVisible = false,
}: ResilientSliderImageProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const originalSrc = safeImageUrl(src) || src;
  const fallback = fallbackSrc && fallbackSrc !== originalSrc ? fallbackSrc : placeholderSrc;
  const [displaySrc, setDisplaySrc] = useState(originalSrc || fallback);

  useEffect(() => { setDisplaySrc(originalSrc || fallback); }, [fallback, originalSrc]);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete && img.naturalWidth === 0) {
      onBrokenSource(originalSrc);
      setDisplaySrc(fallback);
    }
  }, [displaySrc, fallback, onBrokenSource, originalSrc]);

  const visible = alwaysVisible || active;
  return (
    <img
      ref={imgRef}
      src={displaySrc}
      alt=""
      draggable={false}
      data-fill-image
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority && active ? "high" : "auto"}
      decoding={priority && active ? "sync" : "async"}
      className={className ?? "eh-img absolute inset-0 w-full h-full object-cover widget-media-fg"}
      style={{
        opacity: visible ? 1 : 0,
        transition: "opacity 700ms cubic-bezier(.22,.61,.36,1)",
      }}
      onError={(e) => {
        onBrokenSource(originalSrc);
        const nextSrc = displaySrc !== fallback ? fallback : placeholderSrc;
        e.currentTarget.onerror = null;
        setDisplaySrc(nextSrc);
      }}
    />
  );
}

export function sliderFallbackImagesQueryOptions(fallbackCount: number) {
  const count = Math.max(3, fallbackCount || 3);
  return {
    queryKey: ["builder-slider-fallback-images", count] as const,
    queryFn: async (): Promise<string[]> => {
      const { data } = await supabase
        .from("posts")
        .select("cover_image_url")
        .eq("status", "published")
        .is("deleted_at", null)
        .not("cover_image_url", "is", null)
        .order("published_at", { ascending: false })
        .limit(count);
      return ((data ?? []) as FallbackPostImage[])
        .map((row) => safeImageUrl(row.cover_image_url ?? ""))
        .filter((src) => src.length > 0);
    },
    staleTime: 120_000,
  };
}

// ------------------------------------------------------------------
// Shared helpers
// ------------------------------------------------------------------

const TITLE_MAX = 220;
const EXCERPT_MAX = 160;
const truncate = (s: string, max: number) =>
  s.length > max ? s.slice(0, Math.max(0, max - 1)).trimEnd() + "…" : s;

const SHARED_STYLES = `
@keyframes ehFadeImg { from { opacity: 0; } to { opacity: 1; } }
@keyframes ehFadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.eh-slider .eh-title-clamp { display: block; overflow: visible; min-height: calc(2 * 1.25em); padding-bottom: 4px; }
.eh-slider .eh-img { transform: none; transform-origin: center center; backface-visibility: hidden; }
.eh-slider:hover .eh-img { transform: none; }
.eh-slider .eh-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.eh-slider .eh-clamp-3 { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }

/* Side arrow buttons - base (position + transitions). Visual style comes from
   .eh-nav-<variant> modifier + inline CSS vars (--nav-bg / --nav-arrow / --nav-size / --nav-radius). */
.eh-slider .eh-side-nav {
  position: absolute; z-index: 5;
  display: inline-flex; align-items: center; justify-content: center;
  width: var(--nav-size, 52px); height: var(--nav-size, 52px);
  border-radius: var(--nav-radius, 9999px);
  color: var(--nav-arrow, #fff);
  border: 1.5px solid transparent;
  cursor: pointer; opacity: 1;
  transition: background 180ms ease, transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease, filter 180ms ease;
}
@media (max-width: 768px) { .eh-slider .eh-side-nav { width: calc(var(--nav-size, 52px) - 8px); height: calc(var(--nav-size, 52px) - 8px); } }
.eh-slider .eh-side-nav:focus-visible { outline: 2px solid var(--nav-arrow, #fff); outline-offset: 2px; }

/* Positioning presets (transform is set inline so hover can compose scale) */
.eh-slider .eh-side-nav[data-pos="mid"].eh-prev,
.eh-slider .eh-side-nav[data-pos="mid-outside"].eh-prev { top: 50%; }
.eh-slider .eh-side-nav[data-pos="mid"].eh-next,
.eh-slider .eh-side-nav[data-pos="mid-outside"].eh-next { top: 50%; }
.eh-slider .eh-side-nav[data-pos="mid"].eh-prev { left: 16px; right: auto; }
.eh-slider .eh-side-nav[data-pos="mid"].eh-next { right: 16px; left: auto; }
.eh-slider .eh-side-nav[data-pos="mid-outside"].eh-prev { left: -28px; right: auto; }
.eh-slider .eh-side-nav[data-pos="mid-outside"].eh-next { right: -28px; left: auto; }
@media (max-width: 768px) {
  .eh-slider .eh-side-nav[data-pos="mid-outside"].eh-prev { left: 8px; }
  .eh-slider .eh-side-nav[data-pos="mid-outside"].eh-next { right: 8px; }
}
.eh-slider .eh-side-nav[data-pos="bottom"] { top: auto; bottom: 16px; transform: none; }
.eh-slider .eh-side-nav[data-pos="bottom"].eh-prev { left: auto; right: calc(24px + var(--nav-size, 52px)); }
.eh-slider .eh-side-nav[data-pos="bottom"].eh-next { right: 16px; left: auto; }
.eh-slider .eh-side-nav[data-pos="top"] { top: 16px; bottom: auto; transform: none; }
.eh-slider .eh-side-nav[data-pos="top"].eh-prev { left: auto; right: calc(24px + var(--nav-size, 52px)); }
.eh-slider .eh-side-nav[data-pos="top"].eh-next { right: 16px; left: auto; }

/* Style variants */
.eh-slider .eh-side-nav.eh-nav-glass {
  background: color-mix(in oklab, var(--nav-bg, #ffffff) 18%, transparent);
  border-color: color-mix(in oklab, var(--nav-bg, #ffffff) 40%, transparent);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  box-shadow: 0 8px 32px -6px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.25);
}
.eh-slider .eh-side-nav.eh-nav-glass:hover { background: color-mix(in oklab, var(--nav-bg, #ffffff) 32%, transparent); border-color: color-mix(in oklab, var(--nav-bg, #ffffff) 60%, transparent); }
.eh-slider .eh-side-nav.eh-nav-solid { background: var(--nav-bg, #111827); }
.eh-slider .eh-side-nav.eh-nav-solid:hover { background: color-mix(in oklab, var(--nav-bg, #111827) 85%, #fff 15%); }
.eh-slider .eh-side-nav.eh-nav-outline { background: transparent; border: 2px solid var(--nav-bg, #ffffff); }
.eh-slider .eh-side-nav.eh-nav-outline:hover { background: color-mix(in oklab, var(--nav-bg, #ffffff) 15%, transparent); }
.eh-slider .eh-side-nav.eh-nav-soft {
  background: color-mix(in oklab, var(--nav-bg, #ffffff) 22%, transparent);
  border-color: color-mix(in oklab, var(--nav-bg, #ffffff) 35%, transparent);
  backdrop-filter: blur(6px);
}
.eh-slider .eh-side-nav.eh-nav-soft:hover { background: color-mix(in oklab, var(--nav-bg, #ffffff) 38%, transparent); }
.eh-slider .eh-side-nav.eh-nav-gradient {
  background: linear-gradient(135deg, var(--nav-bg, #111827), color-mix(in oklab, var(--nav-bg, #111827) 55%, #000 45%));
}
.eh-slider .eh-side-nav.eh-nav-gradient:hover { filter: brightness(1.12); }
.eh-slider .eh-side-nav.eh-nav-shadow {
  background: var(--nav-bg, #ffffff);
  box-shadow: 0 16px 40px -10px rgba(0,0,0,0.55), 0 6px 14px -4px rgba(0,0,0,0.35);
}
.eh-slider .eh-side-nav.eh-nav-shadow:hover { box-shadow: 0 22px 50px -8px rgba(0,0,0,0.6), 0 8px 18px -4px rgba(0,0,0,0.4); }

/* Hover scale composes with position transform via .eh-hover-scale wrapper trick: apply via inline style */
.eh-slider .eh-side-nav[data-pos="mid"]:hover,
.eh-slider .eh-side-nav[data-pos="mid-outside"]:hover { transform: translateY(-50%) scale(1.08); }
.eh-slider .eh-side-nav[data-pos="bottom"]:hover,
.eh-slider .eh-side-nav[data-pos="top"]:hover { transform: scale(1.08); }
.eh-slider .eh-side-nav[data-pos="mid"],
.eh-slider .eh-side-nav[data-pos="mid-outside"] { transform: translateY(-50%); }

.eh-slider .eh-drag-surface { cursor: grab; touch-action: pan-y; user-select: none; -webkit-user-select: none; }
.eh-slider .eh-drag-surface.is-dragging { cursor: grabbing; }
.eh-slider .eh-drag-surface.is-dragging img { pointer-events: none; }

/* Multi-card carousel track */
.eh-slider .eh-track { display: flex; gap: 16px; will-change: transform; transition: transform 480ms cubic-bezier(.22,.61,.36,1); }
.eh-slider .eh-track.is-dragging { transition: none; }
.eh-slider .eh-card { flex: 0 0 auto; }
@media (max-width: 1024px) { .eh-slider .eh-card { width: calc((100% - 16px) / 2) !important; } }
@media (max-width: 640px) { .eh-slider .eh-card { width: 100% !important; } .eh-slider .eh-track { gap: 12px !important; } }
`;

interface NavArrowsProps {
  prevLabel: string;
  nextLabel: string;
  onPrev: () => void;
  onNext: () => void;
  nav: NavStyleResolved;
}
function NavArrows({ prevLabel, nextLabel, onPrev, onNext, nav }: NavArrowsProps) {
  const iconPx = Math.max(14, Math.round(nav.sizePx * 0.42));
  const cssVars: CSSProperties = {
    ["--nav-bg" as string]: nav.bgColor,
    ["--nav-arrow" as string]: nav.arrowColor,
    ["--nav-size" as string]: `${nav.sizePx}px`,
    ["--nav-radius" as string]: nav.radiusCss,
  };
  const cls = `eh-side-nav eh-nav-${nav.bgStyle}`;
  return (
    <>
      <button
        type="button" aria-label={prevLabel}
        data-pos={nav.position}
        onClick={(e) => { e.stopPropagation(); onPrev(); }}
        onPointerDown={(e) => e.stopPropagation()}
        className={`${cls} eh-prev`}
        style={cssVars}
      >
        <ChevronLeft style={{ width: iconPx, height: iconPx }} strokeWidth={2.5} />
      </button>
      <button
        type="button" aria-label={nextLabel}
        data-pos={nav.position}
        onClick={(e) => { e.stopPropagation(); onNext(); }}
        onPointerDown={(e) => e.stopPropagation()}
        className={`${cls} eh-next`}
        style={cssVars}
      >
        <ChevronRight style={{ width: iconPx, height: iconPx }} strokeWidth={2.5} />
      </button>
    </>
  );
}

interface DotsNavProps {
  count: number;
  active: number;
  onSelect: (i: number) => void;
  onPrev?: () => void;
  onNext?: () => void;
  compact?: boolean;
}
function DotsNav({ count, active, onSelect, onPrev, onNext, compact = false }: DotsNavProps) {
  if (count <= 1) return null;
  return (
    <div className={`flex items-center justify-center gap-3 ${compact ? "mt-2" : "mt-3"}`}>
      {onPrev && (
        <button type="button" aria-label="Poprzedni" onClick={onPrev} className="h-8 w-8 inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition">
          <ArrowLeft className="w-4 h-4" />
        </button>
      )}
      <div className="flex items-center gap-2">
        {Array.from({ length: count }).map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Slajd ${i + 1}`}
            onClick={() => onSelect(i)}
            className={`rounded-full transition-all ${i === active ? "w-2.5 h-2.5 bg-foreground" : "w-2 h-2 bg-foreground/25 hover:bg-foreground/50"}`}
          />
        ))}
      </div>
      {onNext && (
        <button type="button" aria-label="Następny" onClick={onNext} className="h-8 w-8 inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition">
          <ArrowRight className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Main render: shared state + variant routing
// ------------------------------------------------------------------

export function SliderRender({ config, lang, preview = false }: RenderProps) {
  const rawItems = useMemo(() => config.items || [], [config.items]);
  const postIds = useMemo(
    () => rawItems.map((it) => (it && it.postId ? it.postId : null)),
    [rawItems],
  );
  const refMap = useResolvedPostRefs(postIds, lang);
  const resolvedItems = useMemo<SliderItem[]>(
    () =>
      rawItems.map((it) => {
        if (!it || !it.postId) return it;
        const ref = refMap.get(it.postId);
        if (!ref) return it;
        const pickStr = (cur: string | undefined, live: string): string =>
          cur && cur.trim() !== "" ? cur : live;
        const titleKey = `title_${lang}` as const;
        const subKey = `subtitle_${lang}` as const;
        return {
          ...it,
          image: pickStr(it.image, ref.cover),
          href: pickStr(it.href, ref.href),
          author: pickStr(it.author, ref.authorName),
          [titleKey]: pickStr(it[titleKey], ref.title),
          [subKey]: pickStr(it[subKey], ref.excerpt),
        };
      }),
    [rawItems, refMap, lang],
  );

  const fallbackCount = Math.max(3, rawItems.length || 3);
  const { data: fallbackImages = [] } = useQuery(sliderFallbackImagesQueryOptions(fallbackCount));
  const [failedImages, setFailedImages] = useState<ReadonlySet<string>>(() => new Set());
  const markImageFailed = useMemo(
    () => (src: string) => {
      if (!src) return;
      setFailedImages((prev) => {
        if (prev.has(src)) return prev;
        const next = new Set(prev); next.add(src); return next;
      });
    },
    [],
  );
  const items = resolvedItems
    .filter((it): it is SliderItem => Boolean(it))
    .map((it, i) => {
      const safe = safeImageUrl(it.image);
      return {
        ...it,
        image: !safe || failedImages.has(safe)
          ? fallbackImages[i % Math.max(1, fallbackImages.length)] || SLIDER_IMAGE_PLACEHOLDER
          : safe,
      };
    })
    .filter((it) => it.image);

  const variant: SliderVariant = config.variant ?? "editorial-hero";
  const ratio = config.ratio ?? "4/3";
  const autoplay = config.autoplay !== false;
  const intervalMs = Math.max(1500, config.intervalMs ?? 4500);
  const rounded = radiusMap[config.rounded ?? "md"];
  const overlayOpacity = typeof config.overlayOpacity === "number" ? config.overlayOpacity : 0.45;
  const titleSize = config.typography?.fontSize?.desktop;
  const descSize = config.typography?.descriptionFontSize?.desktop;
  const sharedTypography: CSSProperties = {
    ...(config.typography?.fontFamily ? { fontFamily: config.typography.fontFamily } : {}),
    ...(config.typography?.fontStyle ? { fontStyle: config.typography.fontStyle } : {}),
    ...(config.typography?.fontWeight ? { fontWeight: config.typography.fontWeight as CSSProperties["fontWeight"] } : {}),
    ...(config.typography?.lineHeight ? { lineHeight: config.typography.lineHeight } : {}),
    ...(config.typography?.letterSpacing ? { letterSpacing: config.typography.letterSpacing } : {}),
    ...(config.typography?.textAlign ? { textAlign: config.typography.textAlign as CSSProperties["textAlign"] } : {}),
    ...(config.typography?.textTransform ? { textTransform: config.typography.textTransform } : {}),
    ...(config.typography?.textDecoration ? { textDecoration: config.typography.textDecoration } : {}),
  };
  const titleStyle: CSSProperties = {
    ...sharedTypography,
    ...(titleSize ? { fontSize: titleSize } : typeof config.titleSizePx === "number" && config.titleSizePx > 0
      ? { fontSize: `${config.titleSizePx}px`, lineHeight: 1.15 } : {}),
    ...(!config.typography?.fontWeight && typeof config.titleWeight === "number" ? { fontWeight: config.titleWeight } : {}),
  };
  const subtitleStyle: CSSProperties = {
    ...sharedTypography,
    ...(descSize ? { fontSize: descSize } : typeof config.subtitleSizePx === "number" && config.subtitleSizePx > 0
      ? { fontSize: `${config.subtitleSizePx}px`, lineHeight: 1.5 } : {}),
    ...(!config.typography?.fontWeight && typeof config.subtitleWeight === "number" ? { fontWeight: config.subtitleWeight } : {}),
    ...(typeof config.typography?.titleDescriptionGapPx === "number" ? { marginTop: `${config.typography.titleDescriptionGapPx}px` } : {}),
  };

  const [idx, setIdx] = useState(0);
  useEffect(() => { setIdx(0); }, [items.length]);
  const columns = Math.max(1, Math.min(4, config.columns ?? 3)) as 1 | 2 | 3 | 4;
  const visibleCount = variant === "multi-card" ? columns : 1;
  const stepCount = Math.max(1, items.length - (variant === "multi-card" ? visibleCount - 1 : 0));
  useEffect(() => {
    if (preview || !autoplay || items.length < 2) return;
    const t = window.setInterval(
      () => setIdx((i) => (i + 1) % stepCount),
      intervalMs,
    );
    return () => window.clearInterval(t);
  }, [autoplay, intervalMs, items.length, preview, stepCount]);

  const dragRef = useRef<{ startX: number; lastX: number; pointerId: number; active: boolean }>({
    startX: 0, lastX: 0, pointerId: -1, active: false,
  });
  const [dragDx, setDragDx] = useState(0);
  const [, force] = useState(0);

  if (items.length === 0) {
    return (
      <div
        className="w-full flex items-center justify-center bg-muted/40 border border-dashed border-border text-xs text-muted-foreground"
        style={{ aspectRatio: ratio.replace("/", " / "), borderRadius: rounded }}
      >
        Dodaj obrazki do slidera
      </div>
    );
  }

  const safeIdx = Math.min(Math.max(0, idx), Math.max(0, stepCount - 1));
  const go = (delta: number) => setIdx((i) => (i + delta + stepCount) % stepCount);

  const aspectStyle: CSSProperties = { aspectRatio: ratio.replace("/", " / "), width: "100%", minHeight: 0 };
  const SWIPE_THRESHOLD = 48;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (preview || items.length < 2) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragRef.current = { startX: e.clientX, lastX: e.clientX, pointerId: e.pointerId, active: true };
    force((n) => n + 1);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d.active || e.pointerId !== d.pointerId) return;
    d.lastX = e.clientX;
    setDragDx(e.clientX - d.startX);
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d.active || e.pointerId !== d.pointerId) return;
    const dx = d.lastX - d.startX;
    dragRef.current = { ...d, active: false };
    setDragDx(0);
    force((n) => n + 1);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    if (Math.abs(dx) >= SWIPE_THRESHOLD) go(dx < 0 ? 1 : -1);
  };

  // Build slide click navigation helper used across variants.
  const navigateTo = (href?: string) => {
    if (!href || preview) return;
    if (href.startsWith("http://") || href.startsWith("https://")) {
      window.open(href, "_blank", "noopener,noreferrer");
    } else {
      window.location.assign(href);
    }
  };

  const sharedProps = {
    items, safeIdx, setIdx, go, lang, preview,
    titleStyle, subtitleStyle, rounded, ratio, aspectStyle,
    overlayOpacity, fallbackImages, markImageFailed,
    dragRef, dragDx, onPointerDown, onPointerMove, endDrag,
    navigateTo, columns,
  };

  return (
    <div className="w-full eh-slider">
      <style>{SHARED_STYLES}</style>
      {variant === "multi-card" && <MultiCardVariant {...sharedProps} />}
      {variant === "cinematic-overlay" && <CinematicOverlayVariant {...sharedProps} />}
      {variant === "split-feature" && <SplitFeatureVariant {...sharedProps} />}
      {variant === "minimal-strip" && <MinimalStripVariant {...sharedProps} />}
      {(variant === "editorial-hero" || ![
        "multi-card", "cinematic-overlay", "split-feature", "minimal-strip",
      ].includes(variant)) && <EditorialHeroVariant {...sharedProps} />}
    </div>
  );
}

// ------------------------------------------------------------------
// Variant: Editorial Hero (existing - large image, centered text below)
// ------------------------------------------------------------------

type VariantProps = {
  items: SliderItem[];
  safeIdx: number;
  setIdx: (n: number) => void;
  go: (d: number) => void;
  lang: "pl" | "en";
  preview: boolean;
  titleStyle: CSSProperties;
  subtitleStyle: CSSProperties;
  rounded: string;
  ratio: string;
  aspectStyle: CSSProperties;
  overlayOpacity: number;
  fallbackImages: string[];
  markImageFailed: (src: string) => void;
  dragRef: React.MutableRefObject<{ startX: number; lastX: number; pointerId: number; active: boolean }>;
  dragDx: number;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  endDrag: (e: React.PointerEvent<HTMLDivElement>) => void;
  navigateTo: (href?: string) => void;
  columns: 1 | 2 | 3 | 4;
  nav: NavStyleResolved;
};

function pickSlideStrings(it: SliderItem, lang: "pl" | "en") {
  const rawTitle = (lang === "en" ? it.title_en : it.title_pl) || it.title_pl || it.title_en || "";
  const rawSub = (lang === "en" ? it.subtitle_en : it.subtitle_pl) || it.subtitle_pl || "";
  const cat = (lang === "en" ? it.category_en : it.category_pl) || it.category_pl || "";
  return {
    title: truncate(rawTitle, TITLE_MAX),
    sub: truncate(rawSub, EXCERPT_MAX),
    cat,
    href: safeUrl(it.href ?? "") || undefined,
    catColor: it.categoryColor || "#ef6c2e",
  };
}

function EditorialHeroVariant(p: VariantProps) {
  const cur = p.items[p.safeIdx] ?? p.items[0];
  const { title, sub, cat, href, catColor } = pickSlideStrings(cur, p.lang);
  return (
    <>
      <div
        data-widget-media
        role={href ? "link" : undefined}
        tabIndex={href ? 0 : undefined}
        aria-label={href ? title : undefined}
        className={`relative w-full overflow-hidden bg-muted/40 eh-drag-surface ${p.dragRef.current.active ? "is-dragging" : ""} ${href ? "cursor-pointer" : ""}`}
        style={{ ...p.aspectStyle, borderRadius: 4 }}
        onPointerDown={p.onPointerDown} onPointerMove={p.onPointerMove}
        onPointerUp={p.endDrag} onPointerCancel={p.endDrag}
        onClick={(e) => {
          if (!href) return;
          const d = p.dragRef.current;
          if (Math.abs(d.lastX - d.startX) > 5) return;
          const target = e.target as HTMLElement;
          if (target.closest(".eh-side-nav")) return;
          p.navigateTo(href);
        }}
        onKeyDown={(e) => {
          if (!href || p.preview) return;
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); p.navigateTo(href); }
        }}
      >
        <div className="absolute inset-0"
          style={{
            transform: p.dragDx ? `translate3d(${p.dragDx * 0.35}px, 0, 0)` : undefined,
            transition: p.dragRef.current.active ? "none" : "transform 320ms cubic-bezier(.22,.61,.36,1)",
          }}
        >
          {p.items.map((it, i) => (
            <ResilientSliderImage
              key={i}
              src={safeImageUrl(it.image) || it.image}
              fallbackSrc={p.fallbackImages[i % Math.max(1, p.fallbackImages.length)]}
              placeholderSrc={SLIDER_IMAGE_PLACEHOLDER}
              active={i === p.safeIdx}
              priority={i === 0}
              onBrokenSource={p.markImageFailed}
            />
          ))}
        </div>
        {p.items.length > 1 && (
          <NavArrows
            prevLabel={p.lang === "en" ? "Previous slide" : "Poprzedni slajd"}
            nextLabel={p.lang === "en" ? "Next slide" : "Następny slajd"}
            onPrev={() => p.go(-1)} onNext={() => p.go(1)}
          />
        )}
        {cat && (
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-3 z-10">
            <span className="inline-block px-4 py-1.5 text-[11px] md:text-xs font-bold uppercase tracking-wider text-white shadow-md"
              style={{ background: catColor, borderRadius: 2 }}>
              {cat}
            </span>
          </div>
        )}
      </div>

      <div key={p.safeIdx} className="px-4 pt-8 pb-2 text-center"
        style={{ animation: "ehFadeUp 600ms cubic-bezier(.22,.61,.36,1) both" }}>
        {href ? (
          <AppLink href={href} className="inline-block w-full">
            <div className="eh-title-clamp">
              <h3 className="cms-post-title text-xl md:text-3xl lg:text-4xl font-bold leading-tight text-foreground" style={p.titleStyle}>
                {title || "\u00A0"}
              </h3>
            </div>
          </AppLink>
        ) : (
          <div className="eh-title-clamp">
            <h3 className="cms-post-title text-xl md:text-3xl lg:text-4xl font-bold leading-tight text-foreground" style={p.titleStyle}>
              {title || "\u00A0"}
            </h3>
          </div>
        )}
        <p className="cms-post-excerpt eh-clamp-3 mt-4 text-sm md:text-base text-muted-foreground max-w-3xl mx-auto leading-relaxed"
          style={{ minHeight: "calc(3 * 1.625em)", ...p.subtitleStyle }}>
          {sub || "\u00A0"}
        </p>
        {(cur.author || cur.readTime) && (
          <div className="mt-4 flex items-center justify-center gap-2 text-xs md:text-sm text-muted-foreground">
            {cur.author && <span>By <span className="font-medium text-foreground/80">{cur.author}</span></span>}
            {cur.author && cur.readTime && <span className="opacity-50">|</span>}
            {cur.readTime && <span className="inline-flex items-center gap-1">⏱ {cur.readTime}</span>}
          </div>
        )}
      </div>

      <DotsNav count={p.items.length} active={p.safeIdx} onSelect={p.setIdx} onPrev={() => p.go(-1)} onNext={() => p.go(1)} />
    </>
  );
}

// ------------------------------------------------------------------
// Variant: Multi-card carousel (3-up, 2-up on tablet, 1-up on mobile)
// ------------------------------------------------------------------

function MultiCardVariant(p: VariantProps) {
  // Card has its own ratio - use 4/3 visual ratio per slide image.
  const dragging = p.dragRef.current.active;
  const cols = p.columns;
  const gapPx = 16;
  const cardWidth = `calc((100% - ${(cols - 1) * gapPx}px) / ${cols})`;
  const trackTransform = `translate3d(calc(${-p.safeIdx * (100 / cols)}% + ${p.dragDx}px), 0, 0)`;
  return (
    <div className="relative">
      <div
        className={`overflow-hidden eh-drag-surface ${dragging ? "is-dragging" : ""}`}
        onPointerDown={p.onPointerDown} onPointerMove={p.onPointerMove}
        onPointerUp={p.endDrag} onPointerCancel={p.endDrag}
      >
        <div className={`eh-track ${dragging ? "is-dragging" : ""}`} style={{ transform: trackTransform, gap: `${gapPx}px` }}>
          {p.items.map((it, i) => {
            const { title, sub, cat, href, catColor } = pickSlideStrings(it, p.lang);
            return (
              <article key={i} className="eh-card group" style={{ width: cardWidth, flex: "0 0 auto" }}>

                <div
                  className={`relative overflow-hidden bg-muted ${href ? "cursor-pointer" : ""}`}
                  style={{ aspectRatio: "4 / 3", borderRadius: p.rounded }}
                  onClick={() => {
                    const d = p.dragRef.current;
                    if (Math.abs(d.lastX - d.startX) > 5) return;
                    p.navigateTo(href);
                  }}
                >
                  <ResilientSliderImage
                    src={safeImageUrl(it.image) || it.image}
                    fallbackSrc={p.fallbackImages[i % Math.max(1, p.fallbackImages.length)]}
                    placeholderSrc={SLIDER_IMAGE_PLACEHOLDER}
                    active alwaysVisible
                    onBrokenSource={p.markImageFailed}
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                  />
                  {cat && (
                    <span className="absolute left-3 top-3 inline-block px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow"
                      style={{ background: catColor, borderRadius: 2 }}>
                      {cat}
                    </span>
                  )}
                </div>
                <div className="pt-3 pb-1 px-1">
                  {href ? (
                    <AppLink href={href} className="block">
                      <h3 className="cms-post-title text-base md:text-lg font-bold leading-snug text-foreground line-clamp-2" style={p.titleStyle}>
                        {title || "\u00A0"}
                      </h3>
                    </AppLink>
                  ) : (
                    <h3 className="cms-post-title text-base md:text-lg font-bold leading-snug text-foreground line-clamp-2" style={p.titleStyle}>
                      {title || "\u00A0"}
                    </h3>
                  )}
                  {sub && (
                    <p className="cms-post-excerpt eh-clamp-2 mt-1.5 text-xs md:text-sm text-muted-foreground leading-relaxed" style={p.subtitleStyle}>
                      {sub}
                    </p>
                  )}
                  {(it.author || it.readTime) && (
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                      {it.author && <span>By <span className="font-medium text-foreground/80">{it.author}</span></span>}
                      {it.author && it.readTime && <span className="opacity-50">·</span>}
                      {it.readTime && <span>⏱ {it.readTime}</span>}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
      <DotsNav count={Math.max(1, p.items.length - (p.columns - 1))} active={p.safeIdx} onSelect={p.setIdx} onPrev={() => p.go(-1)} onNext={() => p.go(1)} />
    </div>
  );
}

// ------------------------------------------------------------------
// Variant: Cinematic overlay (full-bleed image, gradient + text bottom-left)
// ------------------------------------------------------------------

function CinematicOverlayVariant(p: VariantProps) {
  const cur = p.items[p.safeIdx] ?? p.items[0];
  const { title, sub, cat, href, catColor } = pickSlideStrings(cur, p.lang);
  return (
    <>
      <div
        data-widget-media
        className={`relative w-full overflow-hidden bg-black eh-drag-surface ${p.dragRef.current.active ? "is-dragging" : ""} ${href ? "cursor-pointer" : ""}`}
        style={{ ...p.aspectStyle, borderRadius: p.rounded }}
        onPointerDown={p.onPointerDown} onPointerMove={p.onPointerMove}
        onPointerUp={p.endDrag} onPointerCancel={p.endDrag}
        onClick={(e) => {
          const d = p.dragRef.current;
          if (Math.abs(d.lastX - d.startX) > 5) return;
          const t = e.target as HTMLElement;
          if (t.closest(".eh-side-nav")) return;
          p.navigateTo(href);
        }}
      >
        <div className="absolute inset-0" style={{
          transform: p.dragDx ? `translate3d(${p.dragDx * 0.35}px, 0, 0)` : undefined,
          transition: p.dragRef.current.active ? "none" : "transform 320ms cubic-bezier(.22,.61,.36,1)",
        }}>
          {p.items.map((it, i) => (
            <ResilientSliderImage
              key={i}
              src={safeImageUrl(it.image) || it.image}
              fallbackSrc={p.fallbackImages[i % Math.max(1, p.fallbackImages.length)]}
              placeholderSrc={SLIDER_IMAGE_PLACEHOLDER}
              active={i === p.safeIdx}
              priority={i === 0}
              onBrokenSource={p.markImageFailed}
            />
          ))}
        </div>
        {/* Gradient */}
        <div className="absolute inset-0 pointer-events-none" style={{
          background: `linear-gradient(180deg, rgba(0,0,0,${overlayTop(p.overlayOpacity)}) 0%, rgba(0,0,0,0) 35%, rgba(0,0,0,${overlayBottom(p.overlayOpacity)}) 100%)`,
        }} />
        {/* Text */}
        <div key={p.safeIdx} className="absolute inset-x-0 bottom-0 p-5 md:p-8 lg:p-10 text-white"
          style={{ animation: "ehFadeUp 600ms cubic-bezier(.22,.61,.36,1) both" }}>
          <div className="max-w-3xl">
            {cat && (
              <span className="inline-block mb-3 px-2.5 py-1 text-[10px] md:text-xs font-bold uppercase tracking-wider shadow"
                style={{ background: catColor, borderRadius: 2 }}>
                {cat}
              </span>
            )}
            <h3 className="cms-post-title text-2xl md:text-4xl lg:text-5xl font-bold leading-tight drop-shadow" style={p.titleStyle}>
              {title || "\u00A0"}
            </h3>
            {sub && (
              <p className="cms-post-excerpt eh-clamp-2 mt-3 text-sm md:text-base text-white/85 leading-relaxed max-w-2xl" style={p.subtitleStyle}>
                {sub}
              </p>
            )}
            {(cur.author || cur.readTime) && (
              <div className="mt-3 flex items-center gap-2 text-xs text-white/75">
                {cur.author && <span>By <span className="font-medium text-white">{cur.author}</span></span>}
                {cur.author && cur.readTime && <span className="opacity-60">·</span>}
                {cur.readTime && <span>⏱ {cur.readTime}</span>}
              </div>
            )}
          </div>
        </div>
        {p.items.length > 1 && (
          <NavArrows
            prevLabel={p.lang === "en" ? "Previous slide" : "Poprzedni slajd"}
            nextLabel={p.lang === "en" ? "Next slide" : "Następny slajd"}
            onPrev={() => p.go(-1)} onNext={() => p.go(1)}
          />
        )}
        {/* Dots inside */}
        {p.items.length > 1 && (
          <div className="absolute left-1/2 -translate-x-1/2 bottom-2 flex items-center gap-2">
            {p.items.map((_, i) => (
              <button key={i} type="button" aria-label={`Slajd ${i + 1}`} onClick={(e) => { e.stopPropagation(); p.setIdx(i); }}
                className={`rounded-full transition-all ${i === p.safeIdx ? "w-2.5 h-2.5 bg-white" : "w-2 h-2 bg-white/50 hover:bg-white/80"}`} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function overlayTop(base: number) { return Math.min(0.6, base * 0.5); }
function overlayBottom(base: number) { return Math.min(0.95, base + 0.4); }

// ------------------------------------------------------------------
// Variant: Split Feature (image left, content right)
// ------------------------------------------------------------------

function SplitFeatureVariant(p: VariantProps) {
  const cur = p.items[p.safeIdx] ?? p.items[0];
  const { title, sub, cat, href, catColor } = pickSlideStrings(cur, p.lang);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 items-center">
      <div
        data-widget-media
        className={`relative w-full overflow-hidden bg-muted eh-drag-surface ${p.dragRef.current.active ? "is-dragging" : ""} ${href ? "cursor-pointer" : ""}`}
        style={{ ...p.aspectStyle, borderRadius: p.rounded }}
        onPointerDown={p.onPointerDown} onPointerMove={p.onPointerMove}
        onPointerUp={p.endDrag} onPointerCancel={p.endDrag}
        onClick={() => {
          const d = p.dragRef.current;
          if (Math.abs(d.lastX - d.startX) > 5) return;
          p.navigateTo(href);
        }}
      >
        <div className="absolute inset-0" style={{
          transform: p.dragDx ? `translate3d(${p.dragDx * 0.35}px, 0, 0)` : undefined,
          transition: p.dragRef.current.active ? "none" : "transform 320ms cubic-bezier(.22,.61,.36,1)",
        }}>
          {p.items.map((it, i) => (
            <ResilientSliderImage
              key={i}
              src={safeImageUrl(it.image) || it.image}
              fallbackSrc={p.fallbackImages[i % Math.max(1, p.fallbackImages.length)]}
              placeholderSrc={SLIDER_IMAGE_PLACEHOLDER}
              active={i === p.safeIdx} priority={i === 0}
              onBrokenSource={p.markImageFailed}
            />
          ))}
        </div>
        {p.items.length > 1 && (
          <NavArrows
            prevLabel={p.lang === "en" ? "Previous slide" : "Poprzedni slajd"}
            nextLabel={p.lang === "en" ? "Next slide" : "Następny slajd"}
            onPrev={() => p.go(-1)} onNext={() => p.go(1)}
          />
        )}
      </div>
      <div key={p.safeIdx} className="px-1 md:px-2"
        style={{ animation: "ehFadeUp 600ms cubic-bezier(.22,.61,.36,1) both" }}>
        {cat && (
          <span className="inline-block mb-3 px-2.5 py-1 text-[10px] md:text-xs font-bold uppercase tracking-wider text-white shadow"
            style={{ background: catColor, borderRadius: 2 }}>
            {cat}
          </span>
        )}
        {href ? (
          <AppLink href={href} className="block">
            <h3 className="cms-post-title text-2xl md:text-3xl lg:text-4xl font-bold leading-tight text-foreground" style={p.titleStyle}>
              {title || "\u00A0"}
            </h3>
          </AppLink>
        ) : (
          <h3 className="cms-post-title text-2xl md:text-3xl lg:text-4xl font-bold leading-tight text-foreground" style={p.titleStyle}>
            {title || "\u00A0"}
          </h3>
        )}
        {sub && (
          <p className="cms-post-excerpt eh-clamp-3 mt-3 text-sm md:text-base text-muted-foreground leading-relaxed" style={p.subtitleStyle}>
            {sub}
          </p>
        )}
        {(cur.author || cur.readTime) && (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            {cur.author && <span>By <span className="font-medium text-foreground/80">{cur.author}</span></span>}
            {cur.author && cur.readTime && <span className="opacity-50">·</span>}
            {cur.readTime && <span>⏱ {cur.readTime}</span>}
          </div>
        )}
        <DotsNav count={p.items.length} active={p.safeIdx} onSelect={p.setIdx} onPrev={() => p.go(-1)} onNext={() => p.go(1)} compact />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Variant: Minimal + thumbnails strip
// ------------------------------------------------------------------

function MinimalStripVariant(p: VariantProps) {
  const cur = p.items[p.safeIdx] ?? p.items[0];
  const { title, sub, cat, href, catColor } = pickSlideStrings(cur, p.lang);
  return (
    <>
      <div
        data-widget-media
        className={`relative w-full overflow-hidden bg-muted eh-drag-surface ${p.dragRef.current.active ? "is-dragging" : ""} ${href ? "cursor-pointer" : ""}`}
        style={{ ...p.aspectStyle, borderRadius: p.rounded }}
        onPointerDown={p.onPointerDown} onPointerMove={p.onPointerMove}
        onPointerUp={p.endDrag} onPointerCancel={p.endDrag}
        onClick={(e) => {
          const d = p.dragRef.current;
          if (Math.abs(d.lastX - d.startX) > 5) return;
          const t = e.target as HTMLElement;
          if (t.closest(".eh-side-nav") || t.closest("[data-thumb-strip]")) return;
          p.navigateTo(href);
        }}
      >
        <div className="absolute inset-0" style={{
          transform: p.dragDx ? `translate3d(${p.dragDx * 0.35}px, 0, 0)` : undefined,
          transition: p.dragRef.current.active ? "none" : "transform 320ms cubic-bezier(.22,.61,.36,1)",
        }}>
          {p.items.map((it, i) => (
            <ResilientSliderImage
              key={i}
              src={safeImageUrl(it.image) || it.image}
              fallbackSrc={p.fallbackImages[i % Math.max(1, p.fallbackImages.length)]}
              placeholderSrc={SLIDER_IMAGE_PLACEHOLDER}
              active={i === p.safeIdx} priority={i === 0}
              onBrokenSource={p.markImageFailed}
            />
          ))}
        </div>
        {p.items.length > 1 && (
          <NavArrows
            prevLabel={p.lang === "en" ? "Previous slide" : "Poprzedni slajd"}
            nextLabel={p.lang === "en" ? "Next slide" : "Następny slajd"}
            onPrev={() => p.go(-1)} onNext={() => p.go(1)}
          />
        )}
        {/* Bottom caption strip */}
        <div className="absolute inset-x-0 bottom-0 p-3 md:p-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent text-white">
          {cat && (
            <span className="inline-block mb-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{ background: catColor, borderRadius: 2 }}>{cat}</span>
          )}
          <h3 className="cms-post-title text-base md:text-xl font-bold leading-snug line-clamp-2" style={p.titleStyle}>
            {title || "\u00A0"}
          </h3>
          {sub && (
            <p className="cms-post-excerpt mt-1 text-xs md:text-sm text-white/85 line-clamp-1" style={p.subtitleStyle}>
              {sub}
            </p>
          )}
        </div>
      </div>
      {/* Thumbnail strip */}
      {p.items.length > 1 && (
        <div data-thumb-strip className="mt-3 flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:bg-foreground/20 [&::-webkit-scrollbar-thumb]:rounded-full">
          {p.items.map((it, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Slajd ${i + 1}`}
              onClick={() => p.setIdx(i)}
              className={`relative shrink-0 overflow-hidden transition-all ${i === p.safeIdx ? "ring-2 ring-foreground" : "ring-1 ring-border opacity-70 hover:opacity-100"}`}
              style={{ width: 96, aspectRatio: "4 / 3", borderRadius: 4 }}
            >
              <img src={safeImageUrl(it.image) || it.image} alt="" className="absolute inset-0 w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </>
  );
}
