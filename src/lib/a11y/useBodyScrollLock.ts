import { useEffect } from "react";

// Popup hosts share one lock. Closing one host must not unlock the document
// while another host still owns it; pre-existing inline styles are restored.
let lockCount = 0;
let restore: (() => void) | null = null;

export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (lockCount === 0) {
      const root = document.documentElement;
      const body = document.body;
      const bodyOverflow = body.style.overflow;
      const rootOverflow = root.style.overflow;
      const gutter = root.style.scrollbarGutter;
      root.style.scrollbarGutter = "stable";
      root.style.overflow = "hidden";
      body.style.overflow = "hidden";
      restore = () => {
        body.style.overflow = bodyOverflow;
        root.style.overflow = rootOverflow;
        root.style.scrollbarGutter = gutter;
      };
    }
    lockCount += 1;
    return () => {
      lockCount -= 1;
      if (lockCount === 0) {
        restore?.();
        restore = null;
      }
    };
  }, [active]);
}
