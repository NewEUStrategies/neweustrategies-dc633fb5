// Atom: liczba dowodowa hero kariery z odliczaniem przy wejściu w viewport.
//
// SSR i crawler dostają od razu wartość KOŃCOWĄ (brak IntersectionObservera =
// brak animacji), `prefers-reduced-motion` również wyłącza odliczanie.
// Markup to poprawna para <dt>/<dd> wewnątrz <div> - rodzic renderuje <dl>.
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { easeOutCubic, parseStatValue } from "@/lib/careers/stats";
import { useInView } from "@/hooks/use-in-view";

const COUNT_MS = 1400;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function CareerStat({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const { target, suffix } = parseStatValue(value);
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: 0.4 });
  const [display, setDisplay] = useState<number | null>(target);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!inView || startedRef.current) return;
    startedRef.current = true;
    if (
      target === null ||
      target === 0 ||
      typeof IntersectionObserver === "undefined" ||
      prefersReducedMotion()
    ) {
      return;
    }
    let raf = 0;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const progress = easeOutCubic((now - startedAt) / COUNT_MS);
      setDisplay(Math.round(target * progress));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    setDisplay(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, target]);

  return (
    <div ref={ref} className={cn("flex min-w-0 flex-col-reverse", className)}>
      <dt className="mt-1 text-xs leading-snug text-muted-foreground sm:text-sm">{label}</dt>
      <dd className="text-2xl font-black leading-none tracking-tight text-foreground tabular-nums sm:text-3xl">
        {target === null ? value : `${display ?? target}${suffix}`}
      </dd>
    </div>
  );
}
