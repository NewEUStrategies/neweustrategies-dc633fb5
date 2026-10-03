// TextRotate - lekki, samowystarczalny komponent rotujący teksty z animacją
// per znak / słowo / linia. Bez `motion/react` - używamy prostych transitions
// CSS (opacity + translateY), zgodnych z prefers-reduced-motion i naszymi
// tokenami koloru. Kompatybilny z SSR (efekt uruchamia sie po hydracji).
//
// API zbliżone do popularnego `TextRotate` z ekosystemu Framer Motion, ale
// przycięte do rzeczywistych potrzeb widgetu CMS:
//   - `texts` (co najmniej 1 element),
//   - `splitBy` - "characters" | "words" | "lines",
//   - `rotationInterval` (ms) - domyślnie 2200,
//   - `staggerDurationMs` - opóźnienie między segmentami (per element),
//   - `transitionMs` - czas trwania pojedynczej animacji,
//   - `loop`, `auto`, `mainClassName`, `elementLevelClassName`.
//
// Jednostki i kolory pochodzą z klas Tailwind / tokenów - nigdy nie hardkodujemy
// wartości w JSX.
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

export type TextRotateSplitBy = "characters" | "words" | "lines";

export interface TextRotateProps {
  /** Lista tekstów do rotacji (co najmniej 1). */
  texts: readonly string[];
  /** Sposób podziału tekstu na segmenty. */
  splitBy?: TextRotateSplitBy;
  /** Ms między kolejnymi zmianami. */
  rotationInterval?: number;
  /** Opóźnienie startu każdego segmentu (ms). */
  staggerDurationMs?: number;
  /** Czas trwania pojedynczej animacji segmentu (ms). */
  transitionMs?: number;
  /** Pętla rotacji. */
  loop?: boolean;
  /** Automatyczne przewijanie. */
  auto?: boolean;
  /** Kierunek staggeru (od początku / końca / środka). */
  staggerFrom?: "first" | "last" | "center";
  /** Klasa wrappera. */
  mainClassName?: string;
  /** Klasa pojedynczego segmentu (znaku/słowa/linii). */
  elementLevelClassName?: string;
  /** Etykieta a11y (odczytywana przez SR zamiast animowanego bloku). */
  ariaLabel?: string;
}

export interface TextRotateRef {
  next: () => void;
  previous: () => void;
  jumpTo: (i: number) => void;
  reset: () => void;
}

/** Podział tekstu na segmenty zgodnie z `splitBy`. */
function splitText(text: string, mode: TextRotateSplitBy): string[] {
  if (mode === "lines") return text.split(/\r?\n/);
  if (mode === "words") return text.split(/(\s+)/).filter((s) => s.length > 0);
  // characters: zachowaj spacje jako osobne segmenty, żeby stagger był równy.
  return Array.from(text);
}

function staggerDelay(
  index: number,
  total: number,
  base: number,
  from: TextRotateProps["staggerFrom"],
): number {
  if (base <= 0 || total <= 1) return 0;
  if (from === "last") return (total - 1 - index) * base;
  if (from === "center") {
    const mid = (total - 1) / 2;
    return Math.abs(index - mid) * base;
  }
  return index * base;
}

export const TextRotate = forwardRef<TextRotateRef, TextRotateProps>(function TextRotate(
  {
    texts,
    splitBy = "characters",
    rotationInterval = 2200,
    staggerDurationMs = 30,
    transitionMs = 450,
    loop = true,
    auto = true,
    staggerFrom = "first",
    mainClassName,
    elementLevelClassName,
    ariaLabel,
  },
  ref,
) {
  const safeTexts = texts.length > 0 ? texts : [""];
  const count = safeTexts.length;
  const [index, setIndex] = useState(0);
  const [entered, setEntered] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  // Lista może się skrócić pod komponentem (edycja widgetu) - indeks spoza
  // zakresu dawał pusty tekst aż do następnego obrotu.
  const activeIndex = Math.min(index, count - 1);

  // Każda zmiana tekstu przechodzi tędy. Przejście na TEN SAM indeks jest
  // no-opem: dawniej zerowało `entered`, a efekt wejścia (zależny od indeksu)
  // już się nie uruchamiał - przy `loop={false}` ostatni tekst znikał na stałe
  // (opacity 0), tak samo `previous()` na pierwszym i `reset()` na zerowym.
  const goTo = useCallback(
    (target: number) => {
      const next = Math.max(0, Math.min(count - 1, target));
      if (next === activeIndex) return;
      // Kolejny tekst zaczyna sie od stanu "przed" - `entered=true` ustawia
      // efekt wejścia po zamontowaniu nowych segmentow.
      setEntered(false);
      setIndex(next);
    },
    [activeIndex, count],
  );

  const advance = useCallback(
    (dir: 1 | -1) => {
      const raw = activeIndex + dir;
      goTo(loop ? (raw + count) % count : raw);
    },
    [activeIndex, count, goTo, loop],
  );

  useImperativeHandle(
    ref,
    () => ({
      next: () => advance(1),
      previous: () => advance(-1),
      jumpTo: goTo,
      reset: () => goTo(0),
    }),
    [advance, goTo],
  );

  // Zawsze uruchamiaj wejscie po zmianie index (rAF, zeby CSS transition zlapal
  // "przed" -> "po").
  useEffect(() => {
    let raf = 0;
    raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => setEntered(true));
    });
    return () => cancelAnimationFrame(raf);
  }, [activeIndex]);

  // Auto-rotacja. Przy prefers-reduced-motion nie startuje wcale - rotujący
  // tekst to ruch w rozumieniu preferencji, klasa motion-reduce nie wyłączy
  // timera ani stylów inline. Bez pętli staje na ostatnim tekście.
  const rotating = auto && !reducedMotion && count > 1 && (loop || activeIndex < count - 1);
  useEffect(() => {
    if (!rotating) return;
    const timer = setTimeout(() => advance(1), rotationInterval);
    return () => clearTimeout(timer);
  }, [rotating, advance, rotationInterval]);

  const current = safeTexts[activeIndex];
  const segments = useMemo(() => splitText(current, splitBy), [current, splitBy]);

  return (
    <span className={cn("relative inline-block align-baseline", mainClassName)}>
      {/* SR czyta pelny tekst (albo jawna etykiete); wizualnie renderujemy
          animowane segmenty. `aria-label` na <span> bez roli jest w ARIA 1.2
          zakazany i czytniki go pomijaja albo czytaja podwojnie z tym tekstem. */}
      <span className="sr-only">{ariaLabel ?? current}</span>
      <span aria-hidden="true" className="inline-flex flex-wrap justify-inherit">
        {segments.map((seg, i) => {
          const delay = staggerDelay(i, segments.length, staggerDurationMs, staggerFrom);
          // Style inline wygrywają z klasą motion-reduce:transition-none, więc
          // przy reduced-motion nie emitujemy przejść wcale (zmiana skokowa).
          const style: CSSProperties = reducedMotion
            ? { opacity: 1, transform: "none" }
            : {
                transitionProperty: "opacity, transform",
                transitionDuration: `${transitionMs}ms`,
                transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                transitionDelay: `${delay}ms`,
                opacity: entered ? 1 : 0,
                transform: entered ? "translateY(0)" : "translateY(0.4em)",
                willChange: "transform, opacity",
              };
          if (splitBy === "lines") {
            return (
              <span
                key={`${activeIndex}-${i}`}
                className={cn("block motion-reduce:transition-none", elementLevelClassName)}
                style={style}
              >
                {seg}
              </span>
            );
          }
          const isWhitespace = /^\s+$/.test(seg);
          return (
            <span
              key={`${activeIndex}-${i}`}
              className={cn(
                "inline-block motion-reduce:transition-none",
                isWhitespace ? "whitespace-pre" : undefined,
                elementLevelClassName,
              )}
              style={style}
            >
              {seg}
            </span>
          );
        })}
      </span>
    </span>
  );
});
