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
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { cn } from "@/lib/utils";

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

/**
 * `prefers-reduced-motion` na żywo (nasłuch zmiany preferencji). SSR i pierwszy
 * render klienta zwracają `false` - to bezpieczny kierunek, bo do hydratacji
 * i tak nie ma timerów, a po niej stan dociąga się z matchMedia.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
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
  const [index, setIndex] = useState(0);
  const [entered, setEntered] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const advance = useCallback(
    (dir: 1 | -1) => {
      setEntered(false);
      // Kolejny tekst zaczyna sie od stanu "przed" - ustawiamy `entered=true`
      // dopiero po zamontowaniu nowych segmentow, zeby transition sie wyzwolil.
      setIndex((i) => {
        const n = safeTexts.length;
        const raw = i + dir;
        if (!loop) return Math.max(0, Math.min(n - 1, raw));
        return (raw + n) % n;
      });
    },
    [loop, safeTexts.length],
  );

  useImperativeHandle(
    ref,
    () => ({
      next: () => advance(1),
      previous: () => advance(-1),
      jumpTo: (i: number) => {
        setEntered(false);
        setIndex(Math.max(0, Math.min(safeTexts.length - 1, i)));
      },
      reset: () => {
        setEntered(false);
        setIndex(0);
      },
    }),
    [advance, safeTexts.length],
  );

  // Zawsze uruchamiaj wejscie po zmianie index (rAF, zeby CSS transition zlapal
  // "przed" -> "po").
  useEffect(() => {
    let raf = 0;
    raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => setEntered(true));
    });
    return () => cancelAnimationFrame(raf);
  }, [index]);

  // Auto-rotacja. Przy prefers-reduced-motion nie startuje wcale - rotujący
  // tekst to ruch w rozumieniu preferencji, klasa motion-reduce nie wyłączy
  // timera ani stylów inline.
  useEffect(() => {
    if (!auto || reducedMotion || safeTexts.length <= 1) return;
    clearTimer();
    timerRef.current = setTimeout(() => advance(1), rotationInterval);
    return clearTimer;
  }, [auto, advance, clearTimer, index, reducedMotion, rotationInterval, safeTexts.length]);

  const current = safeTexts[index] ?? "";
  const segments = useMemo(() => splitText(current, splitBy), [current, splitBy]);

  return (
    <span
      className={cn("relative inline-block align-baseline", mainClassName)}
      aria-label={ariaLabel ?? current}
    >
      {/* SR czyta pelny tekst; wizualnie renderujemy animowane segmenty. */}
      <span className="sr-only">{current}</span>
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
                key={`${index}-${i}`}
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
              key={`${index}-${i}`}
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
