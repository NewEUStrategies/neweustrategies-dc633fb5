// Molekuła UI: karuzela okrężna (elipsa) - karty rozłożone po łuku,
// aktywna na środku. Bez framer-motion (biblioteki nie ma w projekcie):
// pozycje liczone są czysto (`getItemPosition`) i animowane transitionem CSS.
// Kolory wyłącznie z tokenów (`--card`, `--border`, `--foreground`, akcent
// przez `--circular-carousel-accent`), więc dark/light działa bez zmian.
//
// Klawiatura: strzałki lewo/prawo oraz Home/End na całym regionie. Gdy
// ognisko stoi w liście kart, przechodzi za aktywną kartą (roving tabindex) -
// inaczej po trzech krokach zostawało na karcie, która wypadła z widoku
// i znikała z DOM, a ognisko lądowało na <body>.
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { ChevronLeft, ChevronRight } from "@/lib/lucide-shim";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

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

/** Tytuł + opis karty - wspólne dla wariantu z linkiem i bez. */
function CardBody({ title, description }: { title: string; description: string }) {
  return (
    <>
      <p className="truncate text-sm font-semibold text-foreground">{title}</p>
      {description ? (
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
    </>
  );
}

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
  // Kursor i ognisko pauzują niezależnie: zjazd myszą z karuzeli nie może
  // wznowić rotacji, gdy ognisko klawiatury nadal jest w środku (WCAG 2.2.2).
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const reducedMotion = usePrefersReducedMotion(autoPlay);
  const listRef = useRef<HTMLDivElement | null>(null);
  // Ustawiane przez obsługę klawiatury, gdy ognisko było w liście kart. Zapamiętane
  // PRZED zmianą indeksu, bo po renderze karta z ogniskiem może już nie istnieć.
  const focusActiveRef = useRef(false);
  const listId = useId();

  const total = items.length;
  const activeIndex = Math.max(0, Math.min(controlledIndex ?? internalIndex, total - 1));

  const goTo = useCallback(
    (index: number) => {
      // `total` > 0: przy pustej liście komponent nie renderuje niczego, czym
      // dałoby się tu dojść, a auto-play wymaga co najmniej dwóch kart.
      const nextIdx = ((index % total) + total) % total;
      if (controlledIndex === undefined) setInternalIndex(nextIdx);
      onActiveChange?.(nextIdx);
    },
    [total, controlledIndex, onActiveChange],
  );

  const next = useCallback(() => goTo(activeIndex + 1), [activeIndex, goTo]);
  const prev = useCallback(() => goTo(activeIndex - 1), [activeIndex, goTo]);

  const rotating = autoPlay && !reducedMotion && !hovered && !focused && total > 1;

  useEffect(() => {
    if (!rotating) return;
    const id = setInterval(next, Math.max(1000, autoPlayInterval));
    return () => clearInterval(id);
  }, [rotating, autoPlayInterval, next]);

  useEffect(() => {
    if (!focusActiveRef.current) return;
    focusActiveRef.current = false;
    listRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.focus();
  }, [activeIndex]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let target: number | null = null;
    if (e.key === "ArrowLeft") target = activeIndex - 1;
    else if (e.key === "ArrowRight") target = activeIndex + 1;
    else if (e.key === "Home") target = 0;
    else if (e.key === "End") target = total - 1;
    if (target === null) return;
    e.preventDefault();
    // Flaga tylko przy realnej zmianie: inaczej zostałaby wisząca i ukradła
    // ognisko przy następnej zmianie, np. kliknięciu strzałki pod kartami.
    const changes = ((target % total) + total) % total !== activeIndex;
    focusActiveRef.current = changes && listRef.current?.contains(document.activeElement) === true;
    goTo(target);
  };

  const handleBlur = (e: FocusEvent<HTMLDivElement>) => {
    // Przejście ogniska między elementami karuzeli to nie jest wyjście z niej.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setFocused(false);
    focusActiveRef.current = false;
  };

  if (total === 0) return null;

  const trackHeight = radiusY * 2 + 160;

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label={labels.region}
      tabIndex={0}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className={cn(
        "relative flex w-full flex-col items-center justify-center gap-6 outline-none",
        className,
      )}
    >
      <div
        ref={listRef}
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
                // Enter na linku karty bąbelkuje tutaj - nie wolno go zjeść
                // `preventDefault`-em, bo link przestałby nawigować.
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  goTo(i);
                }
              }}
              className={cn(
                "absolute left-1/2 top-8 flex h-32 w-48 cursor-pointer flex-col items-start justify-between rounded-[6px] border border-border bg-card p-4 text-left transition-all duration-500 ease-out motion-reduce:transition-none",
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
              {item.href ? (
                // Link karty: klik w treść nawiguje, klik w kartę nadal tylko
                // aktywuje (stopPropagation). Poza aktywną kartą link wypada
                // z taba, żeby nie rozbić nawigacji po listboxie.
                <a
                  href={item.href}
                  tabIndex={isActive ? 0 : -1}
                  onClick={(e) => e.stopPropagation()}
                  className="min-w-0 rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <CardBody title={item.title} description={item.description} />
                </a>
              ) : (
                <div className="min-w-0">
                  <CardBody title={item.title} description={item.description} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showCounter ? (
        <p
          aria-live={rotating ? "off" : "polite"}
          aria-atomic="true"
          className="flex items-baseline gap-1 text-foreground"
        >
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
