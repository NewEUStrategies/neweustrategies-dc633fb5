import { useEffect, useRef, useState } from "react";

/**
 * Szerokość kontenera przez ResizeObserver - wykresy SVG renderują się w
 * prawdziwych pikselach (ostre teksty osi, responsywna gęstość podziałek)
 * zamiast skalować typografię przez viewBox.
 *
 * SSR i pierwszy render klienta zwracają `initial` (spójna hydracja);
 * po zamontowaniu wymiar jest korygowany do rzeczywistego. Wysokość
 * kontenera pozostaje stała, więc korekta nie powoduje CLS.
 */
export function useContainerWidth<T extends HTMLElement>(
  initial = 720,
): { ref: React.RefObject<T | null>; width: number } {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(initial);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const w = node.clientWidth;
      if (w > 0) setWidth((prev) => (Math.abs(prev - w) > 0.5 ? w : prev));
    };
    update();
    const obs = new ResizeObserver(update);
    obs.observe(node);
    return () => obs.disconnect();
  }, []);

  return { ref, width };
}
