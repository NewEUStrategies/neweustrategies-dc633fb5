// Decides *when* an ad slot may load its payload, protecting LCP and INP.
//
// A slot only renders its creative once BOTH gates open:
//   - idle gate: the main thread has gone idle past the first paint, so the ad
//     never competes with the LCP element (see `whenIdle`);
//   - viewport gate: the slot is within `rootMargin` of the viewport, so we
//     never pay for off-screen ads (lazy loading reduces INP and bandwidth).
//
// The slot's layout box is reserved by <AdContainer> regardless of this hook,
// so deferring the payload costs zero CLS - the space is already held.

import { useEffect, useRef, useState } from "react";
import { whenIdle } from "./idle";

export interface DeferredAdOptions {
  /** Pre-load distance from the viewport edge. Default keeps a small lead. */
  rootMargin?: string;
  /** Upper bound (ms) before the idle gate opens regardless of main-thread load. */
  idleTimeout?: number;
  /**
   * Skip all gating and never report ready (e.g. when consent is missing and
   * only a placeholder is shown). Keeps observers from attaching needlessly.
   */
  disabled?: boolean;
}

export interface DeferredAdState<T extends HTMLElement> {
  /** Attach to the slot's reserved container so the viewport gate can observe it. */
  containerRef: React.RefObject<T | null>;
  /** True once both the idle and viewport gates have opened. */
  shouldRender: boolean;
}

export function useDeferredAd<T extends HTMLElement = HTMLDivElement>(
  options: DeferredAdOptions = {},
): DeferredAdState<T> {
  const { rootMargin = "200px 0px", idleTimeout = 2500, disabled = false } = options;

  const containerRef = useRef<T | null>(null);
  const [idleReady, setIdleReady] = useState(false);
  const [inView, setInView] = useState(false);

  // Idle gate - yield past the critical first paint before touching the ad.
  useEffect(() => {
    if (disabled) return;
    const cancel = whenIdle(() => setIdleReady(true), idleTimeout);
    return cancel;
  }, [disabled, idleTimeout]);

  // Viewport gate - load only when the slot approaches the viewport. Browsers
  // without IntersectionObserver (or SSR) treat the slot as immediately visible
  // so they degrade to "idle-only" rather than never loading.
  useEffect(() => {
    if (disabled) return;
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [disabled, rootMargin]);

  return { containerRef, shouldRender: !disabled && idleReady && inView };
}
