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
    if (!enabled) {
      // Wyłączenie animacji w trakcie życia komponentu (autor przestawia pole
      // "Animacja wejścia" na kanwie buildera) MUSI rozbroić stan. Bez tego
      // element uzbrojony wcześniej (poza foldem, więc CSS ustawił mu stan
      // początkowy: opacity 0 / scale) zostawał niewidoczny aż do remontu -
      // czyli wyłączenie animacji kasowało treść zamiast ją pokazać.
      setState("static");
      return;
    }
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      // Ten sam pas bezpieczeństwa: gdy użytkownik włączy "ogranicz ruch" po
      // uzbrojeniu, wracamy do stanu końcowego zamiast zostawić pustkę.
      setState("static");
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
