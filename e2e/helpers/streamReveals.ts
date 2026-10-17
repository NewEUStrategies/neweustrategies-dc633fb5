// ZAPADKA NA ODSŁONIĘCIACH STRUMIENIA SSR (React 19.2 Fizz) - wspólna dla specyfikacji, które
// muszą same ustalić kolejność „hydratacja -> odsłonięcie" zamiast liczyć na wyścig.
//
// React odsłania granice Suspense partiami: `$RC` zbiera pary (granica, segment) i woła `$RV`
// (funkcję odsłaniającą partię) w najbliższej klatce albo `setTimeout`-em >= 300 ms po
// poprzedniej partii. Skrypt inicjujący przechwytuje przypisanie `$RV` i trzyma wywołania
// w kolejce, aż test zwolni je `window.__releaseReveals()`; potem przepuszcza wszystko od razu.
// Segment czekający na odsłonięcie to `<div hidden id="S:…">` w `<body>` - `$RV` go usuwa.
// Stałe opóźnienie zamiast zapadki ścigało się z odpytywaniem gotowości na wolniejszym
// runnerze (recenzja 1d0f11a).
import type { Page } from "@playwright/test";

import { PENDING_STREAM_SEGMENT } from "../../src/lib/scroll/restoreAfterReveal";

export { PENDING_STREAM_SEGMENT };

declare global {
  interface Window {
    __releaseReveals?: () => void;
    __revealQueued?: number;
  }
}

/**
 * Wstrzymuje odsłanianie partii granic do `window.__releaseReveals()` - od NASTĘPNEGO dokumentu
 * strony (`addInitScript` nie dotyczy dokumentu już wczytanego), więc wywołane po pierwszym
 * wejściu, a przed `page.reload()`, trzyma wyłącznie odsłonięcia przeładowania.
 */
export async function holdReveals(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const queue: Array<() => void> = [];
    let released = false;
    let reveal: unknown;
    window.__revealQueued = 0;
    window.__releaseReveals = () => {
      released = true;
      for (const run of queue.splice(0)) run();
    };
    Object.defineProperty(window, "$RV", {
      configurable: true,
      get: () => reveal,
      set: (fn: (...args: unknown[]) => void) => {
        reveal = (...args: unknown[]) => {
          if (released) return fn(...args);
          window.__revealQueued = (window.__revealQueued ?? 0) + 1;
          queue.push(() => fn(...args));
        };
      },
    });
  });
}

/** Liczba segmentów strumienia, które nadal czekają na odsłonięcie. */
export function pendingStreamSegments(page: Page): Promise<number> {
  return page.evaluate(
    (selector) => document.querySelectorAll(selector).length,
    PENDING_STREAM_SEGMENT,
  );
}
