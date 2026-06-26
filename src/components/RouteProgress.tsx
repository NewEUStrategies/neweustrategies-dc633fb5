import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";

/**
 * Slim top-of-viewport progress bar that visualises any in-flight work:
 *  - route navigation / loaders (TanStack Router)
 *  - query fetching (TanStack Query)
 *  - mutations (TanStack Query)
 *
 * Renders a 2px GPU-accelerated bar that fades in after a short delay so
 * fast sub-200ms transitions never flash, then crawls toward 90% while work
 * is pending and snaps to 100% + fades out on completion.
 */
export function RouteProgress() {
  const routerBusy = useRouterState({
    select: (s) => s.isLoading || s.isTransitioning,
  });
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const busy = routerBusy || fetching > 0 || mutating > 0;

  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clearTick = () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
    const clearShow = () => {
      if (showRef.current) {
        clearTimeout(showRef.current);
        showRef.current = null;
      }
    };
    const clearFade = () => {
      if (fadeRef.current) {
        clearTimeout(fadeRef.current);
        fadeRef.current = null;
      }
    };

    if (busy) {
      clearFade();
      if (!visible && !showRef.current) {
        showRef.current = setTimeout(() => {
          setVisible(true);
          setProgress(8);
          tickRef.current = setInterval(() => {
            setProgress((p) => {
              if (p >= 90) return p;
              // Eased crawl: large jump early, small jumps near 90%.
              const delta = Math.max(0.5, (90 - p) * 0.08);
              return p + delta;
            });
          }, 220);
        }, 120);
      }
      return () => undefined;
    }

    // Done -> snap to 100% then fade out.
    clearShow();
    clearTick();
    if (visible) {
      setProgress(100);
      fadeRef.current = setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 280);
    }
    return () => undefined;
  }, [busy, visible]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[9999] h-[2px]"
      style={{ contain: "layout style" }}
    >
      <div
        className="h-full origin-left bg-[var(--accent,#FA9346)] shadow-[0_0_8px_rgba(250,147,70,0.6)]"
        style={{
          width: `${progress}%`,
          opacity: visible ? 1 : 0,
          transition: "width 220ms cubic-bezier(.22,1,.36,1), opacity 280ms ease-out",
          willChange: "width, opacity",
        }}
      />
    </div>
  );
}
