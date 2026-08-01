// Atom/molecule layer: progresywny slider (auto-play + pasek postępu na
// przyciskach). Bez zewnętrznych zależności animacyjnych - progres liczony
// requestAnimationFrame, przejścia slajdów w czystym CSS, 6px rounding przez
// token --radius. Szanuje prefers-reduced-motion (auto-play wyłączony).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
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

const ProgressSliderContext = createContext<ProgressSliderContextValue | undefined>(undefined);

export function useProgressSliderContext(): ProgressSliderContextValue {
  const ctx = useContext(ProgressSliderContext);
  if (!ctx) {
    throw new Error("useProgressSliderContext must be used within a ProgressSlider");
  }
  return ctx;
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
  const frame = useRef(0);
  const startedAt = useRef(0);
  const fastTarget = useRef<string | null>(null);

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

  const autoPlay = !paused && !reducedMotion && !hovered && values.length > 1;

  useEffect(() => {
    if (!autoPlay && fastTarget.current === null) {
      setProgress(0);
      return;
    }
    if (typeof window === "undefined") return;
    startedAt.current = performance.now();

    const step = (now: number) => {
      const isFast = fastTarget.current !== null;
      const total = isFast ? fastDuration : duration;
      const fraction = (now - startedAt.current) / Math.max(1, total);
      if (fraction <= 1) {
        setProgress(Math.min(100, fraction * 100));
        frame.current = requestAnimationFrame(step);
        return;
      }
      if (isFast) {
        const target = fastTarget.current;
        fastTarget.current = null;
        if (target) setActive(target);
      } else {
        const i = values.indexOf(active);
        setActive(values[(i + 1) % values.length]);
      }
      setProgress(0);
      startedAt.current = now;
      frame.current = requestAnimationFrame(step);
    };

    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [autoPlay, active, values, duration, fastDuration]);

  const handleButtonClick = useCallback(
    (value: string) => {
      if (value === active) return;
      if (reducedMotion) {
        setActive(value);
        setProgress(0);
        return;
      }
      fastTarget.current = value;
      startedAt.current = typeof window === "undefined" ? 0 : performance.now();
    },
    [active, reducedMotion],
  );

  const ctx = useMemo<ProgressSliderContextValue>(
    () => ({ active, progress, vertical, handleButtonClick, register, unregister }),
    [active, progress, vertical, handleButtonClick, register, unregister],
  );

  return (
    <ProgressSliderContext.Provider value={ctx}>
      <section
        aria-label={ariaLabel}
        aria-roledescription="carousel"
        className={cn("relative", className)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocusCapture={() => setHovered(true)}
        onBlurCapture={() => setHovered(false)}
      >
        {children}
      </section>
    </ProgressSliderContext.Provider>
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
  const { active, register, unregister } = useProgressSliderContext();
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

export const SliderBtn: FC<{
  children: ReactNode;
  value: string;
  className?: string;
  progressBarClass?: string;
}> = ({ children, value, className, progressBarClass }) => {
  const { active, progress, handleButtonClick, vertical } = useProgressSliderContext();
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
        <span
          data-testid="progress-bar"
          style={
            vertical
              ? { height: isActive ? `${progress}%` : "0%" }
              : { width: isActive ? `${progress}%` : "0%" }
          }
          className={cn(
            "block bg-[color:var(--progress-carousel-accent,var(--brand))]",
            vertical ? "w-full" : "h-full",
            progressBarClass,
          )}
        />
      </div>
    </button>
  );
};
