import { useEffect, useRef, useState } from "react";

/** Zwłoka przeliczenia po zmianie szerokości - wykres nie przerysowuje się co klatkę. */
export const RESIZE_DEBOUNCE_MS = 160;
/** Zmiany węższe niż tyle pikseli są ignorowane (pasek przewijania, zaokrąglenia). */
export const RESIZE_MIN_DELTA_PX = 4;

/**
 * Szerokość kontenera przez ResizeObserver - wykresy SVG renderują się w
 * prawdziwych pikselach (ostre teksty osi, responsywna gęstość podziałek)
 * zamiast skalować typografię przez viewBox.
 *
 * SSR i pierwszy render klienta zwracają `initial` (spójna hydracja);
 * po zamontowaniu wymiar jest korygowany do rzeczywistego OD RAZU, a każda
 * późniejsza zmiana - z opóźnieniem 160 ms i tylko wtedy, gdy różni się
 * o co najmniej 4 px. Przeciąganie okna nie przerysowuje wykresu w każdej
 * klatce, a pojawienie się paska przewijania nie przestawia geometrii.
 * Wysokość kontenera pozostaje stała, więc korekta nie powoduje CLS.
 */
export function useContainerWidth<T extends HTMLElement>(
  initial = 720,
): { ref: React.RefObject<T | null>; width: number } {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(initial);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const apply = () => {
      const w = node.clientWidth;
      if (w > 0) {
        setWidth((prev) => (Math.abs(prev - w) >= RESIZE_MIN_DELTA_PX ? w : prev));
      }
    };
    // Pierwszy pomiar natychmiast: pierwsze malowanie po hydracji ma już
    // właściwą szerokość, a nie tę z serwera.
    const first = node.clientWidth;
    if (first > 0) setWidth((prev) => (Math.abs(prev - first) > 0.5 ? first : prev));
    const obs = new ResizeObserver(() => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(apply, RESIZE_DEBOUNCE_MS);
    });
    obs.observe(node);
    return () => {
      obs.disconnect();
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  return { ref, width };
}
