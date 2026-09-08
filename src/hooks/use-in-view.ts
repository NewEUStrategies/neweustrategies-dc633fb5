import { startTransition, useEffect, useRef, useState } from "react";

/** Trigger when element first scrolls into the viewport. */
export function useInView<T extends HTMLElement>(
  options: { rootMargin?: string; threshold?: number; once?: boolean; enabled?: boolean } = {},
) {
  const { rootMargin = "0px 0px -10% 0px", threshold = 0.1, once = true, enabled = true } = options;
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    // Most public widgets have no entrance animation and no attached ref.
    // Updating those widgets after mount interrupted their lazy hydration.
    if (!enabled) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      startTransition(() => setInView(true));
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            startTransition(() => setInView(true));
            if (once) obs.disconnect();
          } else if (!once) {
            startTransition(() => setInView(false));
          }
        }
      },
      { rootMargin, threshold },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [rootMargin, threshold, once, enabled]);

  return { ref, inView: !enabled || inView };
}
