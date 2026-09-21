// Publiczne renderery dla Phase 4 batch 11 (sekcje marketingowe).

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Json } from "@/lib/blocks/types";
import { AppLink } from "@/components/atoms/AppLink";
import { DeferredFrame } from "@/components/atoms/DeferredFrame";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";

// ===== Hero =====

type HeroAlign = "left" | "center";
type HeroHeight = "sm" | "md" | "lg" | "screen";

const HERO_HEIGHT_CLS: Record<HeroHeight, string> = {
  sm: "min-h-[320px]",
  md: "min-h-[480px] md:min-h-[560px]",
  lg: "min-h-[600px] md:min-h-[720px]",
  screen: "min-h-[80vh] md:min-h-[90vh]",
};

interface HeroProps {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  bgImage?: string;
  ctaLabel?: string;
  ctaHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
  align?: HeroAlign;
  height?: HeroHeight;
  overlay?: number;
  cls?: string;
}

export function HeroView({
  eyebrow,
  title,
  subtitle,
  bgImage,
  ctaLabel,
  ctaHref,
  secondaryLabel,
  secondaryHref,
  align = "center",
  height = "md",
  overlay = 40,
  cls,
}: HeroProps) {
  const isCenter = align === "center";
  const ov = Math.max(0, Math.min(90, overlay));
  return (
    <section
      className={[
        "relative overflow-hidden rounded-2xl",
        HERO_HEIGHT_CLS[height],
        bgImage
          ? "bg-cover bg-center"
          : "bg-gradient-to-br from-primary/15 via-background to-muted",
        cls ?? "",
      ].join(" ")}
      style={bgImage ? { backgroundImage: `url(${bgImage})` } : undefined}
    >
      {bgImage ? (
        <div className="absolute inset-0 bg-black" style={{ opacity: ov / 100 }} aria-hidden />
      ) : null}
      <div
        className={[
          "relative h-full w-full p-6 md:p-12 flex flex-col justify-center",
          isCenter ? "items-center text-center" : "items-start text-left",
        ].join(" ")}
      >
        <div className={`max-w-3xl ${isCenter ? "mx-auto" : ""} space-y-4`}>
          {eyebrow ? (
            <div
              className={[
                "inline-block px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide",
                bgImage ? "bg-white/10 text-white backdrop-blur" : "bg-primary/10 text-primary",
              ].join(" ")}
            >
              {eyebrow}
            </div>
          ) : null}
          {title ? (
            <h1
              className={[
                "font-serif text-3xl md:text-5xl lg:text-6xl font-bold leading-tight",
                bgImage ? "text-white" : "text-foreground",
              ].join(" ")}
            >
              {title}
            </h1>
          ) : null}
          {subtitle ? (
            <p
              className={[
                "text-base md:text-lg leading-relaxed",
                bgImage ? "text-white/90" : "text-muted-foreground",
              ].join(" ")}
            >
              {subtitle}
            </p>
          ) : null}
          {ctaLabel || secondaryLabel ? (
            <div className={`flex flex-wrap gap-3 ${isCenter ? "justify-center" : ""} pt-2`}>
              {ctaLabel && ctaHref ? (
                <AppLink
                  href={ctaHref}
                  className="inline-flex items-center justify-center px-5 py-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
                >
                  {ctaLabel}
                </AppLink>
              ) : null}
              {secondaryLabel && secondaryHref ? (
                <AppLink
                  href={secondaryHref}
                  className={[
                    "inline-flex items-center justify-center px-5 py-3 rounded-lg border text-sm font-semibold transition-colors",
                    bgImage
                      ? "border-white/30 text-white hover:bg-white/10"
                      : "border-border text-foreground hover:bg-muted",
                  ].join(" ")}
                >
                  {secondaryLabel}
                </AppLink>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ===== CTA Section =====

type CtaVariant = "primary" | "muted" | "gradient" | "outline";

const CTA_CONTAINER: Record<CtaVariant, string> = {
  primary: "bg-primary text-primary-foreground",
  muted: "bg-muted text-foreground",
  gradient: "bg-gradient-to-br from-primary via-primary/80 to-primary/60 text-primary-foreground",
  outline: "border-2 border-primary text-foreground",
};

const CTA_BUTTON: Record<CtaVariant, string> = {
  primary: "bg-primary-foreground text-primary hover:bg-primary-foreground/90",
  muted: "bg-primary text-primary-foreground hover:bg-primary/90",
  gradient: "bg-white text-primary hover:bg-white/90",
  outline: "bg-primary text-primary-foreground hover:bg-primary/90",
};

interface CtaSectionProps {
  title?: string;
  description?: string;
  ctaLabel?: string;
  ctaHref?: string;
  variant?: CtaVariant;
  cls?: string;
}

export function CtaSectionView({
  title,
  description,
  ctaLabel,
  ctaHref,
  variant = "primary",
  cls,
}: CtaSectionProps) {
  return (
    <section
      className={[
        "rounded-2xl p-8 md:p-12 text-center flex flex-col items-center gap-4",
        CTA_CONTAINER[variant],
        cls ?? "",
      ].join(" ")}
    >
      {title ? <h2 className="font-serif text-2xl md:text-3xl font-bold">{title}</h2> : null}
      {description ? (
        <p className="max-w-2xl text-sm md:text-base opacity-90">{description}</p>
      ) : null}
      {ctaLabel && ctaHref ? (
        <AppLink
          href={ctaHref}
          className={[
            "mt-2 inline-flex items-center justify-center px-6 py-3 rounded-lg text-sm font-semibold transition-colors",
            CTA_BUTTON[variant],
          ].join(" ")}
        >
          {ctaLabel}
        </AppLink>
      ) : null}
    </section>
  );
}

// ===== Image Carousel =====

interface SlideLite {
  url: string;
  alt: string;
  caption: string;
  href: string;
}

const ASPECT_CLS: Record<string, string> = {
  "16:9": "aspect-[16/9]",
  "4:3": "aspect-[4/3]",
  "1:1": "aspect-square",
  "21:9": "aspect-[21/9]",
};

interface CarouselProps {
  items?: Json[];
  autoplay?: boolean;
  interval?: number;
  aspect?: string;
  cls?: string;
}

export function ImageCarouselView({
  items,
  autoplay,
  interval = 5000,
  aspect = "16:9",
  cls,
}: CarouselProps) {
  const parsed: SlideLite[] = useMemo(() => {
    if (!Array.isArray(items)) return [];
    return items
      .map((i) => {
        const o = (i ?? {}) as Record<string, Json>;
        return {
          url: String(o.url ?? ""),
          alt: String(o.alt ?? ""),
          caption: String(o.caption ?? ""),
          href: String(o.href ?? ""),
        };
      })
      .filter((s) => s.url.length > 0);
  }, [items]);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const total = parsed.length;

  const go = useCallback(
    (d: number) => {
      if (total === 0) return;
      setIdx((cur) => (cur + d + total) % total);
    },
    [total],
  );

  useEffect(() => {
    if (!autoplay || paused || total < 2) return;
    const t = window.setInterval(
      () => setIdx((cur) => (cur + 1) % total),
      Math.max(1500, interval),
    );
    return () => window.clearInterval(t);
  }, [autoplay, paused, interval, total]);

  if (total === 0) return null;
  const aspectCls = ASPECT_CLS[aspect] ?? ASPECT_CLS["16:9"];

  return (
    <div
      className={`relative overflow-hidden rounded-2xl ${cls ?? ""}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role="region"
      aria-roledescription="karuzela"
    >
      <div className={`relative w-full ${aspectCls} bg-muted`}>
        {parsed.map((s, i) => {
          const visible = i === idx;
          const inner = (
            <>
              <img
                src={s.url}
                alt={s.alt}
                loading={i === 0 ? "eager" : "lazy"}
                className="w-full h-full object-cover"
              />
              {s.caption ? (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 text-sm text-white">
                  {s.caption}
                </div>
              ) : null}
            </>
          );
          return (
            <div
              key={i}
              aria-hidden={!visible}
              className={[
                "absolute inset-0 transition-opacity duration-500",
                visible ? "opacity-100" : "opacity-0 pointer-events-none",
              ].join(" ")}
            >
              {s.href ? (
                <AppLink href={s.href} className="block w-full h-full">
                  {inner}
                </AppLink>
              ) : (
                inner
              )}
            </div>
          );
        })}
      </div>
      {total > 1 ? (
        <>
          <button
            type="button"
            onClick={() => go(-1)}
            className="absolute left-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-9 h-9 rounded-full bg-black/40 text-white backdrop-blur hover:bg-black/60"
            aria-label="Poprzedni slajd"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-9 h-9 rounded-full bg-black/40 text-white backdrop-blur hover:bg-black/60"
            aria-label="Następny slajd"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
            {parsed.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIdx(i)}
                aria-label={`Slajd ${i + 1}`}
                aria-current={i === idx}
                className={[
                  "h-1.5 rounded-full transition-all",
                  i === idx ? "w-6 bg-white" : "w-1.5 bg-white/50 hover:bg-white/80",
                ].join(" ")}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ===== Map (OpenStreetMap iframe, no API key) =====

interface MapProps {
  lat?: number;
  lng?: number;
  zoom?: number;
  height?: number;
  label?: string;
  cls?: string;
}

export function MapView({
  lat = 52.2297,
  lng = 21.0122,
  zoom = 13,
  height = 360,
  label,
  cls,
}: MapProps) {
  // OSM "export" embed - safe, no API key. bbox = ~0.01 degrees around point per zoom level.
  const span = Math.max(0.0008, 0.5 / Math.pow(1.6, Math.max(1, Math.min(18, zoom)) - 1));
  const bbox = `${(lng - span).toFixed(5)},${(lat - span).toFixed(5)},${(lng + span).toFixed(5)},${(lat + span).toFixed(5)}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
  const linkHref = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${zoom}/${lat}/${lng}`;
  return (
    <figure className={`rounded-2xl overflow-hidden border border-border bg-card ${cls ?? ""}`}>
      {/* Deferred mount: the OSM subframe boots its own document + JS, so it
          only mounts when the reader scrolls near. The wrapper reserves the
          exact final height - zero layout shift. */}
      <DeferredFrame
        title={label || "Mapa"}
        src={src}
        referrerPolicy="no-referrer-when-downgrade"
        style={{ height: `${Math.max(160, Math.min(800, height))}px` }}
        placeholder={<MapPin className="h-6 w-6" aria-hidden />}
      />
      <figcaption className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <MapPin className="w-3.5 h-3.5" aria-hidden />
          {label || `${lat.toFixed(4)}, ${lng.toFixed(4)}`}
        </span>
        <a
          href={linkHref}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          Otwórz w OpenStreetMap
        </a>
      </figcaption>
    </figure>
  );
}
