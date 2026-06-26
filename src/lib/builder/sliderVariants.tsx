// Slider widget - styled variants. Self-contained renderer (no external slider
// library). Variants are being rebuilt from scratch - currently one available.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight } from "@/lib/lucide-shim";
import { safeImageUrl, safeUrl } from "@/lib/sanitize";
import { useResolvedPostRefs } from "./contentRefs";
import { supabase } from "@/integrations/supabase/client";

export type SliderVariant = "editorial-hero";

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
];

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
  const { data: fallbackImages = [] } = useQuery({
    queryKey: ["builder-slider-fallback-images", fallbackCount] as const,
    queryFn: async (): Promise<string[]> => {
      const { data } = await supabase
        .from("posts")
        .select("cover_image_url")
        .eq("status", "published")
        .is("deleted_at", null)
        .not("cover_image_url", "is", null)
        .order("published_at", { ascending: false })
        .limit(fallbackCount);
      return ((data ?? []) as FallbackPostImage[])
        .map((row) => safeImageUrl(row.cover_image_url ?? ""))
        .filter((src) => src.length > 0);
    },
    staleTime: 120_000,
  });
  const [failedImages, setFailedImages] = useState<ReadonlySet<string>>(() => new Set());
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
  const ratio = "4/3";
  const autoplay = config.autoplay !== false;
  const intervalMs = Math.max(1500, config.intervalMs ?? 4500);
  const rounded = radiusMap[config.rounded ?? "md"];
  const titleStyle: CSSProperties = {
    ...(typeof config.titleSizePx === "number" && config.titleSizePx > 0
      ? { fontSize: `${config.titleSizePx}px`, lineHeight: 1.15 }
      : {}),
    ...(typeof config.titleWeight === "number" ? { fontWeight: config.titleWeight } : {}),
  };
  const subtitleStyle: CSSProperties = {
    ...(typeof config.subtitleSizePx === "number" && config.subtitleSizePx > 0
      ? { fontSize: `${config.subtitleSizePx}px`, lineHeight: 1.5 }
      : {}),
    ...(typeof config.subtitleWeight === "number" ? { fontWeight: config.subtitleWeight } : {}),
  };

  const [idx, setIdx] = useState(0);
  useEffect(() => { setIdx(0); }, [items.length]);
  useEffect(() => {
    if (preview || !autoplay || items.length < 2) return;
    const t = window.setInterval(
      () => setIdx((i) => (i + 1) % items.length),
      intervalMs,
    );
    return () => window.clearInterval(t);
  }, [autoplay, intervalMs, items.length, preview]);

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

  // System-wide limits - applied uniformly to every slide so layout height
  // is stable regardless of content length. Counts include spaces.
  const TITLE_MAX = 80;   // ~2 linie na desktopie
  const EXCERPT_MAX = 160; // ~3 linie na desktopie
  const truncate = (s: string, max: number) =>
    s.length > max ? s.slice(0, Math.max(0, max - 1)).trimEnd() + "…" : s;

  const safeIdx = Math.min(Math.max(0, idx), items.length - 1);
  const cur = items[safeIdx] ?? items[0];
  const rawTitle = (lang === "en" ? cur.title_en : cur.title_pl) || cur.title_pl || cur.title_en || "";
  const rawSub   = (lang === "en" ? cur.subtitle_en : cur.subtitle_pl) || cur.subtitle_pl || "";
  const title = truncate(rawTitle, TITLE_MAX);
  const sub   = truncate(rawSub, EXCERPT_MAX);
  const cat   = (lang === "en" ? cur.category_en : cur.category_pl) || cur.category_pl || "";
  const href  = safeUrl(cur.href ?? "") || undefined;
  const catColor = cur.categoryColor || "#ef6c2e";

  const go = (delta: number) =>
    setIdx((i) => (i + delta + items.length) % items.length);

  const aspectStyle: CSSProperties = { aspectRatio: ratio.replace("/", " / "), width: "100%", minHeight: 0 };

  return (
    <div className="w-full eh-slider">
      <style>{`
        @keyframes ehFadeImg { from { opacity: 0; } to { opacity: 1; } }
        @keyframes ehFadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        .eh-slider .eh-title-text {
          position: relative;
          display: inline;
          text-decoration: none;
        }
        .eh-slider .eh-title-text::after {
          content: "";
          position: absolute;
          left: 0;
          bottom: 0;
          width: 100%;
          height: 1px;
          background: currentColor;
          transform: scaleX(0);
          transform-origin: left;
          transition: transform 0.3s ease, opacity 0.3s ease;
          opacity: 0.55;
        }
        .eh-slider:hover .eh-title-text::after { transform: scaleX(1); opacity: 0.55; }

        .eh-slider .eh-img { transform: none; transform-origin: center center; backface-visibility: hidden; }
        .eh-slider:hover .eh-img { transform: none; }
        .eh-slider .eh-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .eh-slider .eh-clamp-3 { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
      `}</style>

      {/* Image */}
      <div data-widget-media className="relative w-full overflow-hidden bg-muted/40" style={{ ...aspectStyle, borderRadius: 4 }}>
        {items.map((it, i) => (
          <img
            key={i}
            src={safeImageUrl(it.image) || it.image}
            alt=""
            draggable={false}
            data-fill-image
            className="eh-img absolute inset-0 w-full h-full object-cover widget-media-fg"
            style={{
              opacity: i === safeIdx ? 1 : 0,
              transition: "opacity 700ms cubic-bezier(.22,.61,.36,1)",
            }}
            onError={(e) => {
              const target = e.currentTarget;
              setFailedImages((prev) => {
                const next = new Set(prev);
                next.add(it.image);
                return next;
              });
              // Inline neutral SVG placeholder - prevents "broken image" icon
              // and white-hole layout when storage returns 404.
              if (typeof console !== "undefined") {
                // eslint-disable-next-line no-console
                console.warn("[slider] image failed to load", target.src);
              }
              const fallback = fallbackImages[i % Math.max(1, fallbackImages.length)] ?? "";
              if (fallback && target.src !== fallback) {
                target.src = fallback;
                return;
              }
              target.onerror = null;
              target.src = SLIDER_IMAGE_PLACEHOLDER;
            }}
          />
        ))}

        {/* Category badge */}
        {cat && (
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-3 z-10">
            <span
              className="inline-block px-4 py-1.5 text-[11px] md:text-xs font-bold uppercase tracking-wider text-white shadow-md"
              style={{ background: catColor, borderRadius: 2 }}
            >
              {cat}
            </span>
          </div>
        )}
      </div>

      {/* Title + excerpt - stała wysokość (rezerwacja 2 linii tytułu + 3 linii excerptu) */}
      <div
        key={safeIdx}
        className="px-4 pt-8 pb-2 text-center"
        style={{ animation: "ehFadeUp 600ms cubic-bezier(.22,.61,.36,1) both" }}
      >
        {href ? (
          <a href={href} className="inline-block w-full">
            <h3
              className="eh-clamp-2 text-xl md:text-3xl lg:text-4xl font-bold leading-tight text-foreground"
              style={{ minHeight: "calc(2 * 1.25em)", ...titleStyle }}
            >
              <span className="eh-title-text">{title || "\u00A0"}</span>
            </h3>
          </a>
        ) : (
          <h3
            className="eh-clamp-2 text-xl md:text-3xl lg:text-4xl font-bold leading-tight text-foreground"
            style={{ minHeight: "calc(2 * 1.25em)", ...titleStyle }}
          >
            <span className="eh-title-text">{title || "\u00A0"}</span>
          </h3>
        )}


        <p
          className="eh-clamp-3 mt-4 text-sm md:text-base text-muted-foreground max-w-3xl mx-auto leading-relaxed"
          style={{ minHeight: "calc(3 * 1.625em)", ...subtitleStyle }}
        >
          {sub || "\u00A0"}
        </p>

        {/* Meta */}
        {(cur.author || cur.readTime) && (
          <div className="mt-4 flex items-center justify-center gap-2 text-xs md:text-sm text-muted-foreground">
            {cur.author && <span>By <span className="font-medium text-foreground/80">{cur.author}</span></span>}
            {cur.author && cur.readTime && <span className="opacity-50">|</span>}
            {cur.readTime && <span className="inline-flex items-center gap-1">⏱ {cur.readTime}</span>}
          </div>
        )}
      </div>


      {/* Nav: arrow • dots • arrow */}
      {items.length > 1 && (
        <div className="mt-3 flex items-center justify-center gap-3">
          <button
            type="button"
            aria-label="Poprzedni"
            onClick={() => go(-1)}
            className="h-8 w-8 inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            {items.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Slajd ${i + 1}`}
                onClick={() => setIdx(i)}
                className={`rounded-full transition-all ${i === safeIdx ? "w-2.5 h-2.5 bg-foreground" : "w-2 h-2 bg-foreground/25 hover:bg-foreground/50"}`}
              />
            ))}
          </div>
          <button
            type="button"
            aria-label="Następny"
            onClick={() => go(1)}
            className="h-8 w-8 inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
