// Atom/molecule layer: progresywny slider (auto-play + pasek postępu na
// przyciskach). Bez zewnętrznych zależności animacyjnych - progres liczony
// requestAnimationFrame, przejścia slajdów w czystym CSS, 6px rounding przez
// token --radius. Szanuje prefers-reduced-motion (auto-play wyłączony).
//
// Kliknięty slajd jest STANEM Reacta, nie refem. Dawniej klik zapisywał
// wyłącznie dwa refy, a pętla rAF startowała tylko przy auto-play - który pod
// kursorem i przy ognisku jest wyłączony. Skutek: klik nie robił nic, slajd
// przeskakiwał dopiero po zjechaniu kursorem, a w podglądzie edytora
// (`paused`) nawigacja była martwa na stałe.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type FocusEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

interface ProgressSliderContextValue {
  active: string;
  progress: number;
  vertical: boolean;
  handleButtonClick: (value: string) => void;
  register: (value: string) => void;
  unregister: (value: string) => void;
}

type SliderStateValue = Omit<ProgressSliderContextValue, "progress">;

const SliderStateContext = createContext<SliderStateValue | undefined>(undefined);
// Postęp zmienia się co klatkę animacji. Trzymany w osobnym kontekście, żeby
// co klatkę renderował się tylko pasek aktywnego przycisku, a nie każdy slajd
// ze zdjęciem i każdy przycisk nawigacji.
const SliderProgressContext = createContext(0);

function useSliderState(): SliderStateValue {
  const ctx = useContext(SliderStateContext);
  if (!ctx) {
    throw new Error("useProgressSliderContext must be used within a ProgressSlider");
  }
  return ctx;
}

export function useProgressSliderContext(): ProgressSliderContextValue {
  const state = useSliderState();
  const progress = useContext(SliderProgressContext);
  return { ...state, progress };
}

export interface ProgressSliderProps {
  children: ReactNode;
  /** Czas trwania jednego slajdu (ms). */
  duration?: number;
  /** Czas dobiegnięcia paska do końca po kliknięciu (ms). */
  fastDuration?: number;
  vertical?: boolean;
  activeSlider?: string;
  /** Zatrzymanie auto-play (np. podgląd w edytorze). */
  paused?: boolean;
  className?: string;
  "aria-label"?: string;
}

export const ProgressSlider: FC<ProgressSliderProps> = ({
  children,
  duration = 5000,
  fastDuration = 400,
  vertical = false,
  activeSlider,
  paused = false,
  className,
  "aria-label": ariaLabel,
}) => {
  const reducedMotion = usePrefersReducedMotion();
  const [values, setValues] = useState<string[]>([]);
  const [active, setActive] = useState<string>(activeSlider ?? "");
  const [progress, setProgress] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [fastTarget, setFastTarget] = useState<string | null>(null);
  // Ostatnio narysowany postęp - z niego pasek „dobiega" po kliknięciu,
  // zamiast cofać się do zera i zaczynać od nowa.
  const progressRef = useRef(0);

  const register = useCallback((value: string) => {
    setValues((prev) => (prev.includes(value) ? prev : [...prev, value]));
  }, []);
  const unregister = useCallback((value: string) => {
    setValues((prev) => prev.filter((v) => v !== value));
  }, []);

  // Pierwszy zarejestrowany slajd staje się aktywny, gdy nic nie wskazano.
  useEffect(() => {
    if (values.length === 0) return;
    setActive((prev) => (prev && values.includes(prev) ? prev : (activeSlider ?? values[0])));
  }, [values, activeSlider]);

  useEffect(() => {
    if (activeSlider) setActive(activeSlider);
  }, [activeSlider]);

  const autoPlay = !paused && !reducedMotion && !hovered && !focused && values.length > 1;

  const updateProgress = useCallback((next: number) => {
    progressRef.current = next;
    setProgress(next);
  }, []);

  // Jedna pętla na dwa tryby: auto-play (pełny czas slajdu) i dobieg po
  // kliknięciu (`fastDuration`, od bieżącego postępu do 100%). Każde przejście
  // zmienia `active` albo `fastTarget`, więc efekt startuje od nowa sam.
  useEffect(() => {
    if (!autoPlay && fastTarget === null) {
      updateProgress(0);
      return;
    }
    const from = fastTarget === null ? 0 : progressRef.current;
    const total = Math.max(1, fastTarget === null ? duration : fastDuration);
    const startedAt = performance.now();
    let frame = 0;

    const step = (now: number) => {
      const fraction = (now - startedAt) / total;
      if (fraction < 1) {
        updateProgress(from + (100 - from) * fraction);
        frame = requestAnimationFrame(step);
        return;
      }
      updateProgress(0);
      if (fastTarget !== null) {
        setFastTarget(null);
        setActive(fastTarget);
      } else {
        setActive(values[(values.indexOf(active) + 1) % values.length]);
      }
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [autoPlay, fastTarget, active, values, duration, fastDuration, updateProgress]);

  const handleButtonClick = useCallback(
    (value: string) => {
      if (value === active) {
        // Powrót na bieżący slajd w trakcie dobiegu odwołuje dobieg.
        setFastTarget(null);
        return;
      }
      if (reducedMotion) {
        setFastTarget(null);
        setActive(value);
        updateProgress(0);
        return;
      }
      setFastTarget(value);
    },
    [active, reducedMotion, updateProgress],
  );

  const handleBlur = (e: FocusEvent<HTMLElement>) => {
    // Tab między przyciskami nawigacji nie jest wyjściem z karuzeli.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setFocused(false);
  };

  const state = useMemo<SliderStateValue>(
    () => ({ active, vertical, handleButtonClick, register, unregister }),
    [active, vertical, handleButtonClick, register, unregister],
  );

  return (
    <SliderStateContext.Provider value={state}>
      <SliderProgressContext.Provider value={progress}>
        <section
          aria-label={ariaLabel}
          aria-roledescription="carousel"
          className={cn("relative", className)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
        >
          {children}
        </section>
      </SliderProgressContext.Provider>
    </SliderStateContext.Provider>
  );
};

export const SliderContent: FC<{ children: ReactNode; className?: string }> = ({
  children,
  className,
}) => <div className={cn("relative", className)}>{children}</div>;

export const SliderWrapper: FC<{ children: ReactNode; value: string; className?: string }> = ({
  children,
  value,
  className,
}) => {
  const { active, register, unregister } = useSliderState();
  useEffect(() => {
    register(value);
    return () => unregister(value);
  }, [value, register, unregister]);

  const isActive = active === value;
  return (
    <div
      role="group"
      aria-roledescription="slide"
      aria-hidden={!isActive}
      data-active={isActive ? "true" : "false"}
      className={cn(
        "inset-0 transition-opacity duration-500 ease-out motion-reduce:transition-none",
        isActive ? "relative opacity-100" : "pointer-events-none absolute opacity-0",
        className,
      )}
    >
      {children}
    </div>
  );
};

export const SliderBtnGroup: FC<{ children: ReactNode; className?: string }> = ({
  children,
  className,
}) => <div className={cn("flex", className)}>{children}</div>;

interface BarFillProps {
  vertical: boolean;
  className?: string;
}

const BarFill: FC<BarFillProps & { percent: number }> = ({ vertical, className, percent }) => (
  <span
    data-testid="progress-bar"
    style={vertical ? { height: `${percent}%` } : { width: `${percent}%` }}
    className={cn(
      "block bg-[color:var(--progress-carousel-accent,var(--brand))]",
      vertical ? "w-full" : "h-full",
      className,
    )}
  />
);

/** Jedyny konsument postępu - renderuje się co klatkę zamiast całego przycisku. */
const ActiveBarFill: FC<BarFillProps> = (props) => {
  const progress = useContext(SliderProgressContext);
  return <BarFill {...props} percent={progress} />;
};

export const SliderBtn: FC<{
  children: ReactNode;
  value: string;
  className?: string;
  progressBarClass?: string;
}> = ({ children, value, className, progressBarClass }) => {
  const { active, handleButtonClick, vertical } = useSliderState();
  const isActive = active === value;
  return (
    <button
      type="button"
      aria-current={isActive}
      onClick={() => handleButtonClick(value)}
      className={cn(
        "relative overflow-hidden rounded-[6px] text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
      <div
        className={cn(
          "absolute bg-muted",
          vertical ? "left-0 top-0 h-full w-0.5" : "bottom-0 left-0 h-0.5 w-full",
        )}
      >
        {isActive ? (
          <ActiveBarFill vertical={vertical} className={progressBarClass} />
        ) : (
          <BarFill vertical={vertical} className={progressBarClass} percent={0} />
        )}
      </div>
    </button>
  );
};
