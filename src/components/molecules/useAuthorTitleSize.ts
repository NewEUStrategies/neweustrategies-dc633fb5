import { useEffect, useRef, useState } from "react";
import { authorSizeFromTitle } from "@/lib/builder/authorDisplay";

/** Follow the closest material title, including live CMS overrides. */
export function useAuthorTitleSize(enabled: boolean) {
  const ref = useRef<HTMLElement | null>(null);
  const [size, setSize] = useState<number>();
  useEffect(() => {
    if (!enabled || !ref.current) return;
    const byline = ref.current;
    let frame = 0;
    let title: Element | null = null;
    const measure = () => {
      let parent = byline.parentElement;
      title = null;
      while (parent && parent !== document.body) {
        title = Array.from(parent.querySelectorAll(".cms-post-title, [data-title-root], h1, h2, h3"))
          .find((el) => !el.closest("[data-author-byline]")) ?? null;
        if (title) break;
        parent = parent.parentElement;
      }
      if (!title) return;
      const px = Number.parseFloat(getComputedStyle(title).fontSize);
      if (Number.isFinite(px) && px > 2) setSize(authorSizeFromTitle(px));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(schedule);
    if (title) observer.observe(title);
    const widget = byline.closest("[data-w-id]") ?? byline.parentElement;
    const changes = new MutationObserver(schedule);
    if (widget) changes.observe(widget, { attributes: true, attributeFilter: ["class", "style"], childList: true, subtree: true });
    window.addEventListener("resize", schedule, { passive: true });
    void document.fonts?.ready.then(schedule);
    return () => {
      observer.disconnect();
      changes.disconnect();
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  }, [enabled]);
  return { ref, size: enabled ? size : undefined };
}
