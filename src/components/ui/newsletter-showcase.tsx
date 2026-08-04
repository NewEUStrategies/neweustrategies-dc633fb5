// Panel wizualny popupu newslettera w wariancie "showcase":
// mozaika 4 kafli, rotujacy fokus + podpis, kropki nawigacyjne.
// Bez zewnetrznych zaleznosci animacyjnych - czysty CSS + rAF-free interval.
// 6px rounding, kolory dziedziczone z tokenow popupu (--nl-*).
import { useEffect, useState } from "react";

export interface ShowcaseImage {
  url: string;
  caption?: string;
}

interface Props {
  images: ShowcaseImage[];
  brand: string;
  tagline?: string;
  rotateMs?: number;
  /** Etykieta a11y dla kropek, np. "Pokaz slajd" / "Show slide". */
  dotLabel: string;
  /** Kolory gradientu tla; fallback do tokenow --nl-accent / --nl-bg. */
  gradFrom?: string | null;
  gradTo?: string | null;
  showBrand?: boolean;
  showCaption?: boolean;
  showDots?: boolean;
}

const TILE_CLASSES = [
  "col-span-2 row-span-2",
  "col-span-1 row-span-1",
  "col-span-1 row-span-1",
  "col-span-2 row-span-1",
];

export function NewsletterShowcase({
  images,
  brand,
  tagline,
  rotateMs = 2600,
  dotLabel,
  gradFrom,
  gradTo,
  showBrand = true,
  showCaption = true,
  showDots = true,
}: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const count = images.length;

  useEffect(() => {
    if (count < 2) return;
    const ms = Math.min(30000, Math.max(800, rotateMs));
    const id = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % count);
    }, ms);
    return () => window.clearInterval(id);
  }, [count, rotateMs]);

  useEffect(() => {
    if (activeIndex >= count) setActiveIndex(0);
  }, [activeIndex, count]);

  const active = images[Math.min(activeIndex, Math.max(0, count - 1))];

  return (
    <div
      className="relative flex h-full flex-col justify-between gap-4 p-5 sm:p-6 md:p-8"
      style={{
        background: `linear-gradient(160deg, ${gradFrom || "var(--nl-accent)"} 0%, ${gradTo || "var(--nl-bg)"} 78%)`,
      }}
    >
      {showBrand && brand && (
        <div
          className="text-[11px] font-semibold uppercase tracking-[0.28em]"
          style={{ color: "var(--nl-fg)" }}
        >
          {brand}
        </div>
      )}

      {count > 0 && (
        <div className="grid grid-cols-3 grid-rows-3 gap-2 min-h-[180px] sm:min-h-[240px] md:min-h-[300px]">
          {images.slice(0, 4).map((img, index) => (
            <ShowcaseTile
              key={`${img.url}-${index}`}
              src={img.url}
              active={index === activeIndex}
              className={TILE_CLASSES[index] ?? "col-span-1 row-span-1"}
            />
          ))}
        </div>
      )}

      {showCaption && active?.caption && (
        <p
          className="text-xs leading-relaxed line-clamp-4 transition-opacity duration-500"
          style={{ color: "var(--nl-muted)" }}
        >
          {active.caption}
        </p>
      )}

      {tagline && (
        <p className="font-display text-lg sm:text-xl leading-snug" style={{ color: "var(--nl-fg)" }}>
          {tagline}
        </p>
      )}

      {showDots && count > 1 && (
        <div className="flex items-center gap-1.5">
          {images.slice(0, 4).map((_, index) => (
            <button
              key={index}
              type="button"
              onClick={() => setActiveIndex(index)}
              aria-label={`${dotLabel} ${index + 1}`}
              aria-current={index === activeIndex}
              className="h-1 rounded-full transition-all duration-300"
              style={{
                width: index === activeIndex ? 40 : 16,
                backgroundColor: index === activeIndex ? "var(--nl-fg)" : "var(--nl-muted)",
                opacity: index === activeIndex ? 1 : 0.5,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ShowcaseTile({
  src,
  active,
  className,
}: {
  src: string;
  active: boolean;
  className: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-[6px] transition-all duration-500 ${className}`}
      style={{
        outline: active ? "1px solid var(--nl-fg)" : "1px solid transparent",
        outlineOffset: 2,
      }}
    >
      <img
        src={src}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover transition-transform duration-700"
        style={{
          transform: active ? "scale(1.04)" : "scale(1)",
          filter: active ? "none" : "saturate(0.75) brightness(0.8)",
        }}
      />
    </div>
  );
}
