// Panel wizualny popupu rejestracji w wariancie "showcase" - wierne odwzorowanie
// referencyjnego layoutu auth-section-2: mozaika 4 kafli, ramki fokusa w rogach
// aktywnego kafla, karta z podpisem + strzalka, tagline i kropki nawigacyjne.
// Bez zewnetrznych zaleznosci animacyjnych - czysty CSS + interval.
// 6px rounding, kolory dziedziczone z tokenow popupu (--nl-*).
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

export interface ShowcaseImage {
  url: string;
  /** Opis kafla (renderowany nad tytulem). */
  caption?: string;
  /** Tytul kafla (renderowany pod opisem). */
  title?: string;
}

interface Props {
  images: ShowcaseImage[];
  brand: string;
  /** URL logotypu marki; fallback do wbudowanego znaku graficznego. */
  logoUrl?: string | null;
  tagline?: string;
  rotateMs?: number;
  /** Etykieta a11y dla kropek, np. "Pokaz slajd" / "Show slide". */
  dotLabel: string;
  /** Etykieta a11y strzalki "nastepny slajd". */
  nextLabel?: string;
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
  "col-span-3 row-span-1",
];

export function NewsletterShowcase({
  images,
  brand,
  logoUrl,
  tagline,
  rotateMs = 2600,
  dotLabel,
  nextLabel,
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
      className="relative flex h-full flex-col items-center justify-between gap-5 p-5 sm:p-6 md:p-8"
      style={{
        background: `linear-gradient(160deg, ${gradFrom || "var(--nl-accent)"} 0%, ${gradTo || "var(--nl-bg)"} 78%)`,
      }}
    >
      {showBrand && (brand || logoUrl) && (
        <div
          className="flex items-center justify-center gap-2 text-base font-medium tracking-tight"
          style={{ color: "var(--nl-fg)" }}
        >
          {logoUrl ? (
            <img src={logoUrl} alt={brand} className="h-6 w-auto max-w-[160px] object-contain" />
          ) : (
            <BrandMark className="h-5 w-5" />
          )}
          {brand && <span>{brand}</span>}
        </div>
      )}

      {count > 0 && (
        <div className="grid w-full grid-cols-3 grid-rows-3 gap-2 min-h-[180px] sm:min-h-[240px] md:min-h-[300px]">
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

      {showCaption && (active?.caption || active?.title) && (
        <div
          className="flex w-full items-end gap-3 rounded-[6px] border p-3 transition-opacity duration-500"
          style={{
            borderColor: "color-mix(in srgb, var(--nl-fg) 16%, transparent)",
            backgroundColor: "color-mix(in srgb, var(--nl-fg) 6%, transparent)",
          }}
        >
          <div className="min-w-0 flex-1 space-y-1">
            {active?.caption && (
              <p className="text-xs leading-relaxed line-clamp-3" style={{ color: "var(--nl-muted)" }}>
                {active.caption}
              </p>
            )}
            {active?.title && (
              <p
                className="truncate font-display text-sm font-medium leading-snug"
                style={{ color: "var(--nl-fg)" }}
              >
                {active.title}
              </p>
            )}
          </div>
          {count > 1 && (
            <button
              type="button"
              onClick={() => setActiveIndex((c) => (c + 1) % count)}
              aria-label={nextLabel ?? `${dotLabel} ${((activeIndex + 1) % count) + 1}`}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-105"
              style={{ backgroundColor: "var(--nl-fg)", color: "var(--nl-bg)" }}
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {tagline && (
        <p
          className="max-w-[22ch] text-center font-display text-lg leading-snug sm:text-xl"
          style={{ color: "var(--nl-fg)" }}
        >
          {tagline}
        </p>
      )}

      {showDots && count > 1 && (
        <div className="flex items-center justify-center gap-1.5">
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
                opacity: index === activeIndex ? 1 : 0.45,
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
    <div className={`relative overflow-hidden rounded-[6px] ${className}`}>
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
      <FocusCorners active={active} />
    </div>
  );
}

/** Cztery narozniki "celownika" pojawiajace sie na aktywnym kaflu. */
function FocusCorners({ active }: { active: boolean }) {
  const base = `pointer-events-none absolute h-4 w-4 transition-all duration-500 ease-out ${
    active ? "opacity-100" : "opacity-0"
  }`;
  const border = "color-mix(in srgb, var(--nl-fg) 65%, transparent)";
  return (
    <>
      <span
        className={`${base} left-1 top-1 border-l-2 border-t-2 ${active ? "translate-x-0 translate-y-0" : "-translate-x-2 -translate-y-2"}`}
        style={{ borderColor: border }}
      />
      <span
        className={`${base} right-1 top-1 border-r-2 border-t-2 ${active ? "translate-x-0 translate-y-0" : "translate-x-2 -translate-y-2"}`}
        style={{ borderColor: border }}
      />
      <span
        className={`${base} bottom-1 left-1 border-b-2 border-l-2 ${active ? "translate-x-0 translate-y-0" : "-translate-x-2 translate-y-2"}`}
        style={{ borderColor: border }}
      />
      <span
        className={`${base} bottom-1 right-1 border-b-2 border-r-2 ${active ? "translate-x-0 translate-y-0" : "translate-x-2 translate-y-2"}`}
        style={{ borderColor: border }}
      />
    </>
  );
}

function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M2 20L12 4l10 16H2z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M7.5 20l4.5-7 4.5 7" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
