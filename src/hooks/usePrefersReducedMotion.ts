import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * SSR/hydration-safe `prefers-reduced-motion` detector.
 *
 * Returns `false` on the server AND on the first client render (so hydration
 * never mismatches), then syncs to the real media-query value in an effect and
 * tracks live changes. Consumers should treat `true` as "skip the animation
 * and show the final state immediately".
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(QUERY);
    setReduced(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
