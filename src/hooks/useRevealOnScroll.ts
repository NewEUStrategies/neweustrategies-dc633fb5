import { useEffect, useRef, useState } from "react";

export type RevealState = "static" | "armed" | "run";

/**
 * Animacja wejścia przy scrollu BEZ kosztów SSR/CLS/no-JS:
 *
 *  - SSR i pierwszy render klienta: stan "static" - element w stanie KOŃCOWYM
 *    (crawler i użytkownik bez JS widzą pełną treść, hydracja bez rozjazdu),
 *  - pierwszy callback IntersectionObservera: jeśli element JUŻ jest w
 *    viewporcie -> zostaje "static" (zero migotania nad foldem),
 *  - jeśli jest poza viewportem -> "armed" (CSS ustawia stan początkowy
 *    animacji - bezpieczne, bo element jest niewidoczny),
 *  - wejście w viewport -> "run" (CSS transition do stanu końcowego).
 *
 * `prefers-reduced-motion` nigdy nie uzbraja animacji (plus pas bezpieczeństwa
 * w CSS). Klasy: revealClassName(state) -> "" | "neh-armed" | "neh-armed neh-run".
 */
export function useRevealOnScroll<T extends Element>(
  enabled: boolean,
): {
  ref: React.RefObject<T | null>;
  state: RevealState;
} {
  const ref = useRef<T | null>(null);
  const [state, setState] = useState<RevealState>("static");

  useEffect(() => {
    if (!enabled) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    let armed = false;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!armed) {
            if (entry.isIntersecting) {
              // Widoczny przy załadowaniu - nie chowamy niczego, co już
              // zostało namalowane.
              obs.disconnect();
              return;
            }
            armed = true;
            setState("armed");
          } else if (entry.isIntersecting) {
            setState("run");
            obs.disconnect();
            return;
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -5% 0px" },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [enabled]);

  return { ref, state };
}

/** Klasy CSS dla stanu reveal (armed zostaje razem z run - patrz styles.css). */
export function revealClassName(state: RevealState): string {
  if (state === "armed") return "neh-armed";
  if (state === "run") return "neh-armed neh-run";
  return "";
}
