import { whenIdle, type CancelIdle } from "@/lib/ads/idle";

/** CPU idle can occur while the LCP image is still downloading. Optional
 * imports wait for load first, then yield to a paint and an idle period.
 * The deadline recovers from a hanging third-party resource. User-triggered
 * work should bypass this scheduler and run immediately.
 */
export function afterPageLoad(callback: () => void, idleTimeout = 3000): CancelIdle {
  if (typeof window === "undefined") return () => {};
  let started = false;
  let cancelled = false;
  let frame = 0;
  let cancelIdle: CancelIdle = () => {};
  const start = () => {
    if (started || cancelled) return;
    started = true;
    window.removeEventListener("load", start);
    window.clearTimeout(deadline);
    frame = window.requestAnimationFrame(() => {
      cancelIdle = whenIdle(() => {
        if (!cancelled) callback();
      }, idleTimeout);
    });
  };
  const deadline = window.setTimeout(start, 10_000);
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener("load", start);
    window.clearTimeout(deadline);
    window.cancelAnimationFrame(frame);
    cancelIdle();
  };
}
