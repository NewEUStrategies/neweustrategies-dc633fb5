// Molekuła UI: karuzela okrężna (elipsa) - karty rozłożone po łuku,
// aktywna na środku. Bez framer-motion (biblioteki nie ma w projekcie):
// pozycje liczone są czysto (`getItemPosition`) i animowane transitionem CSS.
// Kolory wyłącznie z tokenów (`--card`, `--border`, `--foreground`, akcent
// przez `--circular-carousel-accent`), więc dark/light działa bez zmian.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CircularCarouselItem {
  id: string;
  title: string;
  description: string;
  tag?: string;
  href?: string;
}

export interface CircularCarouselLabels {
  /** Etykieta licznika, np. "z" / "of". */
  of: string;
  previous: string;
  next: string;
  /** Szablon etykiety kropki, `{{n}}` zostanie podmienione na numer. */
  goTo: string;
  region: string;
}

export interface CircularCarouselProps {
  items: CircularCarouselItem[];
  activeIndex?: number;
  onActiveChange?: (index: number) => void;
  autoPlay?: boolean;
  autoPlayInterval?: number;
  /** Nieparzysta liczba widocznych kart (3-7). */
  visibleCount?: number;
  radiusX?: number;
  radiusY?: number;
  showCounter?: boolean;
  showDots?: boolean;
  showArrows?: boolean;
  labels: CircularCarouselLabels;
  className?: string;
}

export interface CircularCarouselPosition {
  x: number;
  y: number;
  scale: number;
  opacity: number;
  zIndex: number;
  adjustedOffset: number;
}

/**
 * Pozycja karty na elipsie względem aktywnego indeksu. `null` = poza widokiem.
 * Czysta funkcja - testowana bez DOM.
 */
export function getItemPosition(
  index: number,
  activeIndex: number,
  total: number,
  visibleCount: number,
  radiusX: number,
  radiusY: number,
): CircularCarouselPosition | null {
  if (total <= 0) return null;
  const half = Math.floor(visibleCount / 2);
  const offset = index - activeIndex;
  let adjustedOffset = offset;
  if (offset > total / 2) adjustedOffset = offset - total;
  if (offset < -total / 2) adjustedOffset = offset + total;
  if (Math.abs(adjustedOffset) > half) return null;

  const angle = (adjustedOffset / visibleCount) * Math.PI;
  const x = Math.sin(angle) * radiusX;
  const y = -Math.cos(angle) * radiusY + radiusY;

  const distance = Math.abs(adjustedOffset);
  const maxDistance = half + 1;
  const scale = Math.max(0.5, 1 - (distance / maxDistance) * 0.3);
  const opacity = Math.max(0.3, 1 - (distance / maxDistance) * 0.7);
  const zIndex = visibleCount - distance;

  return { x, y, scale, opacity, zIndex, adjustedOffset };
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

export function CircularCarousel({
  items,
  activeIndex: controlledIndex,
  onActiveChange,
  autoPlay = true,
  autoPlayInterval = 4000,
  visibleCount = 5,
  radiusX = 220,
  radiusY = 100,
  showCounter = true,
  showDots = true,
  showArrows = true,
  labels,
  className,
}: CircularCarouselProps) {
  const [internalIndex, setInternalIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const total = items.length;
  const activeIndex = Math.min(controlledIndex ?? internalIndex, Math.max(total - 1, 0));

  const goTo = useCallback(
    (index: number) => {
      if (total <= 0) return;
      const nextIdx = ((index % total) + total) % total;
      if (controlledIndex === undefined) setInternalIndex(nextIdx);
      onActiveChange?.(nextIdx);
    },
    [total, controlledIndex, onActiveChange],
  );

  const next = useCallback(() => goTo(activeIndex + 1), [activeIndex, goTo]);
  const prev = useCallback(() => goTo(activeIndex - 1), [activeIndex, goTo]);

  useEffect(() => {
    if (!autoPlay || paused || total <= 1) return;
    const id = setInterval(next, Math.max(1000, autoPlayInterval));
    return () => clearInterval(id);
  }, [autoPlay, autoPlayInterval, paused, next, total]);

  if (total === 0) return null;

  const trackHeight = radiusY * 2 + 160;

  return (
    <div
      ref={containerRef}
      role="region"
      aria-roledescription="carousel"
      aria-label={labels.region}
      tabIndex={0}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          prev();
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          next();
        }
      }}
      className={cn(
        "relative flex w-full flex-col items-center justify-center gap-6 outline-none",
        className,
      )}
    >
      <div
        id={listId}
        role="listbox"
        aria-label={labels.region}
        className="relative w-full overflow-hidden"
        style={{ height: trackHeight }}
      >
        {items.map((item, i) => {
          const pos = getItemPosition(i, activeIndex, total, visibleCount, radiusX, radiusY);
          if (!pos) return null;
          const isActive = i === activeIndex;
          return (
            <div
              key={item.id}
              role="option"
              tabIndex={isActive ? 0 : -1}
              aria-selected={isActive}
              aria-label={item.title}
              onClick={() => goTo(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  goTo(i);
                }
              }}
              className={cn(
                "absolute left-1/2 top-8 flex h-32 w-48 cursor-pointer flex-col items-start justify-between rounded-[6px] border border-border bg-card p-4 text-left transition-all duration-500 ease-out",
                isActive ? "shadow-lg" : "shadow-sm hover:shadow-md",
              )}
              style={{
                zIndex: pos.zIndex,
                opacity: pos.opacity,
                transform: `translate(-50%, 0) translate(${pos.x}px, ${pos.y}px) scale(${pos.scale})`,
                borderColor: isActive ? "var(--circular-carousel-accent, var(--brand))" : undefined,
              }}
            >
              {item.tag ? (
                <span
                  className="rounded-[6px] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
                  style={{
                    color: "var(--circular-carousel-accent, var(--brand))",
                    background:
                      "color-mix(in oklab, var(--circular-carousel-accent, var(--brand)) 12%, transparent)",
                  }}
                >
                  {item.tag}
                </span>
              ) : null}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{item.title}</p>
                {item.description ? (
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    {item.description}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {showCounter ? (
        <p className="flex items-baseline gap-1 text-foreground">
          <span
            className="text-2xl font-semibold tabular-nums"
            style={{ color: "var(--circular-carousel-accent, var(--brand))" }}
          >
            {pad2(activeIndex + 1)}
          </span>
          <span className="text-xs text-muted-foreground">
            {labels.of} {pad2(total)}
          </span>
        </p>
      ) : null}

      <div className="flex items-center gap-4">
        {showArrows ? (
          <button
            type="button"
            onClick={prev}
            aria-label={labels.previous}
            aria-controls={listId}
            className="flex h-8 w-8 items-center justify-center rounded-[6px] border border-border bg-card text-foreground transition-colors hover:bg-muted"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}

        {showDots ? (
          <div className="flex items-center gap-1.5">
            {items.map((item, i) => (
              <button
                key={item.id}
                type="button"
                onClick={() => goTo(i)}
                aria-label={labels.goTo.replace("{{n}}", String(i + 1))}
                aria-current={i === activeIndex}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  i === activeIndex
                    ? "w-6"
                    : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60",
                )}
                style={
                  i === activeIndex
                    ? { background: "var(--circular-carousel-accent, var(--brand))" }
                    : undefined
                }
              />
            ))}
          </div>
        ) : null}

        {showArrows ? (
          <button
            type="button"
            onClick={next}
            aria-label={labels.next}
            aria-controls={listId}
            className="flex h-8 w-8 items-center justify-center rounded-[6px] border border-border bg-card text-foreground transition-colors hover:bg-muted"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default CircularCarousel;
