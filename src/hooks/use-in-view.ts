import { useEffect, useRef, useState } from "react";

/** Trigger when element first scrolls into the viewport. */
export function useInView<T extends HTMLElement>(
  options: { rootMargin?: string; threshold?: number; once?: boolean } = {},
) {
  const { rootMargin = "0px 0px -10% 0px", threshold = 0.1, once = true } = options;
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            if (once) obs.disconnect();
          } else if (!once) {
            setInView(false);
          }
        }
      },
      { rootMargin, threshold },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [rootMargin, threshold, once]);

  return { ref, inView };
}
