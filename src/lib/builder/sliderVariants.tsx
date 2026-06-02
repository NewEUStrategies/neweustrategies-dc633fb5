// Slider widget - styled variants. Self-contained renderer (no external slider
// library). Auto-play, swipe-free, keyboard-free; controls vary per variant.
import { useEffect, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight } from "@/lib/lucide-shim";
import { safeImageUrl, safeUrl } from "@/lib/sanitize";

export type SliderVariant =
  | "classic"          // image + bottom caption bar + arrows + dots
  | "fade"             // crossfade, centered caption overlay
  | "ken-burns"        // slow zoom on active slide, bottom caption
  | "hero-overlay"     // full-bleed, dark gradient + headline+button
  | "split"            // 50/50 image | text panel
  | "minimal-dots"     // image only + tiny dots, no arrows
  | "bold-arrows"      // large arrows on sides, no dots
  | "card-stack"       // rounded card with shadow, peek of next slide
  | "polaroid"         // white frame + caption underneath
  | "thumbnail-strip"; // big slide + thumbnail row

export interface SliderItem {
  image: string;
  title_pl?: string;
  title_en?: string;
  subtitle_pl?: string;
  subtitle_en?: string;
  href?: string;
  cta_pl?: string;
  cta_en?: string;
}

export const SLIDER_VARIANTS: { value: SliderVariant; label: string }[] = [
  { value: "classic",         label: "Klasyczny" },
  { value: "fade",            label: "Crossfade" },
  { value: "ken-burns",       label: "Ken Burns (zoom)" },
  { value: "hero-overlay",    label: "Hero z overlay'em" },
  { value: "split",           label: "Split 50/50" },
  { value: "minimal-dots",    label: "Minimal (kropki)" },
  { value: "bold-arrows",     label: "Duże strzałki" },
  { value: "card-stack",      label: "Karta z cieniem" },
  { value: "polaroid",        label: "Polaroid" },
  { value: "thumbnail-strip", label: "Z miniaturkami" },
];

export type AnimType = "fade" | "slide" | "zoom" | "blur" | "reveal" | "none";
export type AnimDir = "left" | "right" | "up" | "down";

export interface SliderConfig {
  variant?: SliderVariant;
  items: SliderItem[];
  ratio?: "16/9" | "4/3" | "1/1" | "21/9" | "3/2";
  autoplay?: boolean;
  intervalMs?: number;
  rounded?: "none" | "sm" | "md" | "lg" | "xl" | "full";
  overlayOpacity?: number; // 0..1, for hero-overlay & fade
  imageAnim?: AnimType;
  imageDir?: AnimDir;
  textAnim?: AnimType;
  textDir?: AnimDir;
  ctaAnim?: AnimType;
  ctaDir?: AnimDir;
}

export const ANIM_TYPES: { value: AnimType; label: string }[] = [
  { value: "fade",   label: "Pojawianie" },
  { value: "slide",  label: "Wjazd" },
  { value: "zoom",   label: "Zoom" },
  { value: "blur",   label: "Rozmycie" },
  { value: "reveal", label: "Odsłonięcie" },
  { value: "none",   label: "Bez animacji" },
];

export const ANIM_DIRS: { value: AnimDir; label: string }[] = [
  { value: "left",  label: "← z lewej" },
  { value: "right", label: "z prawej →" },
  { value: "up",    label: "↑ z góry" },
  { value: "down",  label: "↓ z dołu" },
];

const radiusMap: Record<NonNullable<SliderConfig["rounded"]>, string> = {
  none: "0px", sm: "4px", md: "8px", lg: "16px", xl: "24px", full: "9999px",
};

interface RenderProps {
  config: SliderConfig;
  lang: "pl" | "en";
  preview?: boolean; // disable autoplay in editor preview tiles
}

export function SliderRender({ config, lang, preview = false }: RenderProps) {
  const items = (config.items || []).filter((it) => it && it.image);
  const variant = config.variant ?? "classic";
  const ratio = config.ratio ?? "16/9";
  const autoplay = config.autoplay !== false;
  const intervalMs = Math.max(1500, config.intervalMs ?? 4500);
  const rounded = radiusMap[config.rounded ?? "md"];
  const overlayOpacity = Math.min(1, Math.max(0, config.overlayOpacity ?? 0.45));
  const imageAnim: AnimType = config.imageAnim ?? "fade";
  const imageDir: AnimDir = config.imageDir ?? "right";
  const textAnim: AnimType = config.textAnim ?? "slide";
  const textDir: AnimDir = config.textDir ?? "up";
  const ctaAnim: AnimType = config.ctaAnim ?? "fade";
  const ctaDir: AnimDir = config.ctaDir ?? "up";

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

  const cur = items[idx];
  const title = (lang === "en" ? cur.title_en : cur.title_pl) || cur.title_pl || cur.title_en || "";
  const sub   = (lang === "en" ? cur.subtitle_en : cur.subtitle_pl) || cur.subtitle_pl || "";
  const cta   = (lang === "en" ? cur.cta_en : cur.cta_pl) || cur.cta_pl || "";
  const href  = safeUrl(cur.href ?? "") || undefined;

  const go = (delta: number) =>
    setIdx((i) => (i + delta + items.length) % items.length);

  const aspectStyle: CSSProperties = { aspectRatio: ratio.replace("/", " / ") };
  const wrapStyle: CSSProperties = { borderRadius: rounded, overflow: "hidden" };

  const Arrows = ({ size = "md" }: { size?: "sm" | "md" | "lg" }) => {
    const cls =
      size === "lg"
        ? "h-12 w-12"
        : size === "sm"
        ? "h-7 w-7"
        : "h-9 w-9";
    if (items.length < 2) return null;
    return (
      <>
        <button
          type="button"
          aria-label="Poprzedni"
          onClick={() => go(-1)}
          className={`absolute left-2 top-1/2 -translate-y-1/2 ${cls} inline-flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 text-white backdrop-blur transition`}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          aria-label="Następny"
          onClick={() => go(1)}
          className={`absolute right-2 top-1/2 -translate-y-1/2 ${cls} inline-flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 text-white backdrop-blur transition`}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </>
    );
  };

  const Dots = ({ tone = "light" }: { tone?: "light" | "dark" }) => (
    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-10">
      {items.map((_, i) => (
        <button
          key={i}
          type="button"
          aria-label={`Slajd ${i + 1}`}
          onClick={() => setIdx(i)}
          className={`h-1.5 rounded-full transition-all ${
            i === idx ? "w-5" : "w-1.5"
          } ${tone === "dark" ? (i === idx ? "bg-foreground" : "bg-foreground/30") : (i === idx ? "bg-white" : "bg-white/50")}`}
        />
      ))}
    </div>
  );

  // Helpers: build per-element animation styles
  const dirOffset = (dir: AnimDir, dist: number): string => {
    switch (dir) {
      case "left":  return `translateX(-${dist}px)`;
      case "right": return `translateX(${dist}px)`;
      case "up":    return `translateY(-${dist}px)`;
      case "down":  return `translateY(${dist}px)`;
    }
  };

  // Image transition between slides
  const imageStyle = (active: boolean): CSSProperties => {
    const base: CSSProperties = {
      transition:
        "opacity 900ms cubic-bezier(.22,.61,.36,1), transform 1400ms cubic-bezier(.22,.61,.36,1), filter 900ms cubic-bezier(.22,.61,.36,1), clip-path 900ms cubic-bezier(.22,.61,.36,1)",
    };
    if (imageAnim === "none") return { ...base, opacity: 1 };
    if (imageAnim === "fade") return { ...base, opacity: active ? 1 : 0 };
    if (imageAnim === "zoom") return { ...base, opacity: active ? 1 : 0, transform: active ? "scale(1)" : "scale(1.08)" };
    if (imageAnim === "blur") return { ...base, opacity: active ? 1 : 0, filter: active ? "blur(0px)" : "blur(10px)" };
    if (imageAnim === "slide") return { ...base, opacity: active ? 1 : 0, transform: active ? "translate(0,0)" : dirOffset(imageDir, 60) };
    if (imageAnim === "reveal") {
      const hidden =
        imageDir === "left"  ? "inset(0 0 0 100%)" :
        imageDir === "right" ? "inset(0 100% 0 0)" :
        imageDir === "up"    ? "inset(100% 0 0 0)" :
                               "inset(0 0 100% 0)";
      return { ...base, clipPath: active ? "inset(0 0 0 0)" : hidden };
    }
    return base;
  };

  // Layered renderer: all slides stacked, configurable transition.
  const Layers = ({ kenBurns = false }: { kenBurns?: boolean }) => (
    <>
      {items.map((it, i) => {
        const active = i === idx;
        return (
          <img
            key={i}
            src={safeImageUrl(it.image) || it.image}
            alt=""
            draggable={false}
            className={`absolute inset-0 w-full h-full object-cover will-change-transform ${kenBurns && active ? "animate-[kenburns_8s_ease-in-out_infinite_alternate]" : ""}`}
            style={imageStyle(active)}
          />
        );
      })}
    </>
  );

  // Build a keyframe name + style for an element entrance animation
  const buildEntryAnim = (type: AnimType, dir: AnimDir, duration = 700): CSSProperties => {
    if (type === "none") return {};
    const name = `slideEl_${type}_${dir}`;
    return { animation: `${name} ${duration}ms cubic-bezier(.22,.61,.36,1) both` };
  };

  // Generate keyframes for all combinations (kept minimal — only those used)
  const entryKeyframes = (
    <style>{`
      @keyframes slideEl_fade_left { from { opacity: 0 } to { opacity: 1 } }
      @keyframes slideEl_fade_right { from { opacity: 0 } to { opacity: 1 } }
      @keyframes slideEl_fade_up { from { opacity: 0 } to { opacity: 1 } }
      @keyframes slideEl_fade_down { from { opacity: 0 } to { opacity: 1 } }
      @keyframes slideEl_slide_left  { from { opacity: 0; transform: translateX(-24px) } to { opacity: 1; transform: none } }
      @keyframes slideEl_slide_right { from { opacity: 0; transform: translateX(24px) }  to { opacity: 1; transform: none } }
      @keyframes slideEl_slide_up    { from { opacity: 0; transform: translateY(-18px) } to { opacity: 1; transform: none } }
      @keyframes slideEl_slide_down  { from { opacity: 0; transform: translateY(18px) }  to { opacity: 1; transform: none } }
      @keyframes slideEl_zoom_left   { from { opacity: 0; transform: scale(.92) } to { opacity: 1; transform: scale(1) } }
      @keyframes slideEl_zoom_right  { from { opacity: 0; transform: scale(.92) } to { opacity: 1; transform: scale(1) } }
      @keyframes slideEl_zoom_up     { from { opacity: 0; transform: scale(.92) } to { opacity: 1; transform: scale(1) } }
      @keyframes slideEl_zoom_down   { from { opacity: 0; transform: scale(1.08) } to { opacity: 1; transform: scale(1) } }
      @keyframes slideEl_blur_left   { from { opacity: 0; filter: blur(8px); transform: translateX(-12px) } to { opacity: 1; filter: blur(0); transform: none } }
      @keyframes slideEl_blur_right  { from { opacity: 0; filter: blur(8px); transform: translateX(12px) }  to { opacity: 1; filter: blur(0); transform: none } }
      @keyframes slideEl_blur_up     { from { opacity: 0; filter: blur(8px); transform: translateY(-10px) } to { opacity: 1; filter: blur(0); transform: none } }
      @keyframes slideEl_blur_down   { from { opacity: 0; filter: blur(8px); transform: translateY(10px) }  to { opacity: 1; filter: blur(0); transform: none } }
      @keyframes slideEl_reveal_left  { from { clip-path: inset(0 0 0 100%) } to { clip-path: inset(0 0 0 0) } }
      @keyframes slideEl_reveal_right { from { clip-path: inset(0 100% 0 0) } to { clip-path: inset(0 0 0 0) } }
      @keyframes slideEl_reveal_up    { from { clip-path: inset(100% 0 0 0) } to { clip-path: inset(0 0 0 0) } }
      @keyframes slideEl_reveal_down  { from { clip-path: inset(0 0 100% 0) } to { clip-path: inset(0 0 0 0) } }
    `}</style>
  );

  const sharedKeyframes = entryKeyframes;
  const captionAnim: CSSProperties = buildEntryAnim(textAnim, textDir, 700);
  const ctaAnimStyle: CSSProperties = { ...buildEntryAnim(ctaAnim, ctaDir, 800), animationDelay: "120ms" };
  };


  switch (variant) {
    case "fade":
      return (
        <div className="relative w-full" style={wrapStyle}>
          {sharedKeyframes}
          <div className="relative w-full" style={aspectStyle}>
            <Layers />
            <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${overlayOpacity})` }} />
            {(title || sub) && (
              <div key={idx} className="absolute inset-0 flex flex-col items-center justify-center text-center text-white p-6 z-10" style={captionAnim}>
                {title && <h3 className="text-xl md:text-3xl font-bold drop-shadow">{title}</h3>}
                {sub && <p className="mt-2 text-sm md:text-base opacity-90 max-w-2xl">{sub}</p>}
                {cta && href && (
                  <a href={href} className="mt-4 inline-flex items-center gap-1.5 px-5 py-2 rounded-full bg-white/95 text-black text-sm font-semibold tracking-wide shadow-sm hover:bg-white hover:shadow-md transition">{cta} <span aria-hidden>→</span></a>
                )}
              </div>
            )}
            <Arrows />
            <Dots />
          </div>
        </div>
      );


    case "ken-burns":
      return (
        <div className="relative w-full" style={wrapStyle}>
          <style>{`@keyframes kenburns{from{transform:scale(1) translate(0,0)}to{transform:scale(1.12) translate(-2%,-1%)}}`}</style>
          {sharedKeyframes}
          <div className="relative w-full overflow-hidden" style={aspectStyle}>
            <Layers kenBurns />
            <div key={idx} className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 text-white z-10" style={captionAnim}>
              {title && <h3 className="text-base md:text-xl font-semibold">{title}</h3>}
              {sub && <p className="text-xs md:text-sm opacity-85 mt-0.5">{sub}</p>}
            </div>

            <Arrows />
            <Dots />
          </div>
        </div>
      );

    case "hero-overlay":
      return (
        <div className="relative w-full" style={wrapStyle}>
          {sharedKeyframes}
          <div className="relative w-full" style={aspectStyle}>
            <Layers />
            <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, rgba(0,0,0,${overlayOpacity*0.5}) 0%, rgba(0,0,0,${overlayOpacity}) 100%)` }} />
            <div key={idx} className="absolute inset-0 flex flex-col justify-end p-6 md:p-10 text-white z-10" style={captionAnim}>
              {title && <h2 className="text-2xl md:text-5xl font-bold leading-tight max-w-3xl">{title}</h2>}
              {sub && <p className="mt-2 md:mt-3 text-sm md:text-lg opacity-90 max-w-2xl">{sub}</p>}
              {cta && href && (
                <a href={href} className="mt-4 self-start inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-white text-black text-sm font-semibold tracking-wide shadow-sm hover:shadow-md hover:bg-white/95 transition">{cta} <span aria-hidden>→</span></a>
              )}
            </div>
            <Arrows size="lg" />
            <Dots />
          </div>
        </div>
      );

    case "split": {
      return (
        <div className="relative w-full overflow-hidden border border-border" style={{ borderRadius: rounded }}>
          {sharedKeyframes}
          <div className="grid grid-cols-1 md:grid-cols-2">
            <div className="relative w-full overflow-hidden" style={aspectStyle}>
              <Layers />
            </div>
            <div key={idx} className="relative bg-card p-5 md:p-8 flex flex-col justify-center" style={captionAnim}>
              {title && <h3 className="text-lg md:text-2xl font-bold text-foreground">{title}</h3>}
              {sub && <p className="mt-2 text-sm md:text-base text-muted-foreground">{sub}</p>}
              {cta && href && (
                <a href={href} className="mt-4 self-start inline-flex items-center gap-1.5 px-5 py-2 rounded-full bg-foreground text-background text-sm font-semibold tracking-wide hover:opacity-90 transition">{cta} <span aria-hidden>→</span></a>
              )}
              {items.length > 1 && (
                <div className="mt-5 flex items-center gap-2">
                  <button type="button" onClick={() => go(-1)} className="h-8 w-8 inline-flex items-center justify-center rounded-full border border-border hover:bg-muted">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => go(1)} className="h-8 w-8 inline-flex items-center justify-center rounded-full border border-border hover:bg-muted">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <span className="text-xs text-muted-foreground ml-2">{idx + 1} / {items.length}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    case "minimal-dots":
      return (
        <div className="relative w-full" style={wrapStyle}>
          <div className="relative w-full" style={aspectStyle}>
            <Layers />
            <Dots />
          </div>
        </div>
      );

    case "bold-arrows":
      return (
        <div className="relative w-full" style={wrapStyle}>
          {sharedKeyframes}
          <div className="relative w-full" style={aspectStyle}>
            <Layers />
            {(title || sub) && (
              <div key={idx} className="absolute inset-x-0 bottom-0 p-4 md:p-6 bg-gradient-to-t from-black/70 to-transparent text-white" style={captionAnim}>
                {title && <h3 className="text-lg md:text-2xl font-bold">{title}</h3>}
                {sub && <p className="text-xs md:text-sm opacity-85">{sub}</p>}
              </div>
            )}
            <Arrows size="lg" />
          </div>
        </div>
      );

    case "card-stack":
      return (
        <div className="relative w-full px-6 md:px-10">
          {sharedKeyframes}
          <div className="relative w-full" style={{ ...aspectStyle, borderRadius: rounded, overflow: "hidden", boxShadow: "0 24px 48px -16px rgba(0,0,0,.35)" }}>
            <Layers />
            {(title || sub) && (
              <div key={idx} className="absolute inset-x-0 bottom-0 p-4 md:p-6 bg-gradient-to-t from-black/75 to-transparent text-white" style={captionAnim}>
                {title && <h3 className="text-base md:text-xl font-semibold">{title}</h3>}
                {sub && <p className="text-xs md:text-sm opacity-85 mt-0.5">{sub}</p>}
              </div>
            )}
            <Arrows />
            <Dots />
          </div>
        </div>
      );

    case "polaroid":
      return (
        <div className="relative w-full bg-white p-3 pb-10 shadow-xl mx-auto" style={{ maxWidth: 640, borderRadius: 4 }}>
          {sharedKeyframes}
          <div className="relative w-full bg-black overflow-hidden" style={aspectStyle}>
            <Layers />
            <Arrows size="sm" />
          </div>
          <div key={idx} className="mt-3 text-center font-serif italic text-neutral-700 text-sm md:text-base min-h-[1.5em]" style={captionAnim}>
            {title}
          </div>
          {items.length > 1 && (
            <div className="mt-2 flex items-center justify-center gap-1.5">
              {items.map((_, i) => (
                <button key={i} type="button" onClick={() => setIdx(i)}
                  className={`h-1.5 rounded-full ${i === idx ? "w-5 bg-neutral-800" : "w-1.5 bg-neutral-400"}`} />
              ))}
            </div>
          )}
        </div>
      );

    case "thumbnail-strip":
      return (
        <div className="w-full">
          {sharedKeyframes}
          <div className="relative w-full" style={{ ...aspectStyle, borderRadius: rounded, overflow: "hidden" }}>
            <Layers />
            {(title || sub) && (
              <div key={idx} className="absolute inset-x-0 bottom-0 p-3 md:p-4 bg-gradient-to-t from-black/70 to-transparent text-white" style={captionAnim}>
                {title && <h3 className="text-base md:text-lg font-semibold">{title}</h3>}
                {sub && <p className="text-xs opacity-85">{sub}</p>}
              </div>
            )}
            <Arrows />
          </div>
          <div className="mt-2 grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(items.length, 8)}, minmax(0, 1fr))` }}>
            {items.slice(0, 8).map((it, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIdx(i)}
                className={`relative overflow-hidden rounded transition-all duration-300 ${i === idx ? "ring-2 ring-foreground scale-[1.03]" : "opacity-60 hover:opacity-100 hover:scale-[1.02]"}`}
                style={{ aspectRatio: "4 / 3" }}
              >
                <img src={safeImageUrl(it.image) || it.image} alt="" className="absolute inset-0 w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      );

    case "classic":
    default:
      return (
        <div className="relative w-full" style={wrapStyle}>
          {sharedKeyframes}
          <div className="relative w-full" style={aspectStyle}>
            <Layers />
            {(title || sub) && (
              <div key={idx} className="absolute inset-x-0 bottom-0 bg-black/55 backdrop-blur-sm text-white px-4 py-3 z-10" style={captionAnim}>
                {title && <div className="text-sm md:text-base font-semibold">{title}</div>}
                {sub && <div className="text-xs opacity-85">{sub}</div>}
              </div>
            )}
            <Arrows />
            <Dots />
          </div>
        </div>
      );
  }
}
