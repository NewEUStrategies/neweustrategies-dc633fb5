// Schedules work for *after* the critical first-paint / LCP window.
//
// Ads are a classic Core Web Vitals killer: if their payload (image, raw HTML,
// or a third-party <script> such as AdSense) runs during the first paint it
// competes with the Largest Contentful Paint element for the main thread and
// the network, regressing LCP and INP. We defer that work to the browser's
// idle time via `requestIdleCallback`, falling back to a short `setTimeout`
// where the API is unavailable (Safari, SSR-hydration edge cases, test envs).

/** Cancels a previously scheduled idle callback. Safe to call more than once. */
export type CancelIdle = () => void;

interface IdleCapableWindow {
  requestIdleCallback?: (
    callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void,
    options?: { timeout?: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
}

// When `requestIdleCallback` is missing we still want to yield past the first
// paint, but without stalling the slot for the full idle timeout. One macrotask
// (~32ms) is enough to let the LCP element commit first.
const FALLBACK_DELAY_MS = 32;

/**
 * Runs `callback` once the main thread is idle, or after `timeout` ms at the
 * latest (whichever comes first). Returns a canceller; on the server it is a
 * no-op so callers can use it unconditionally inside effects.
 */
export function whenIdle(callback: () => void, timeout = 2500): CancelIdle {
  if (typeof window === "undefined") return () => {};

  const win = window as Window & IdleCapableWindow;

  if (typeof win.requestIdleCallback === "function") {
    const handle = win.requestIdleCallback(() => callback(), { timeout });
    return () => win.cancelIdleCallback?.(handle);
  }

  const handle = window.setTimeout(callback, Math.min(timeout, FALLBACK_DELAY_MS));
  return () => window.clearTimeout(handle);
}
