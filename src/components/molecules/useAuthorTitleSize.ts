import { useCallback, useEffect, useState } from "react";
import { authorSizeFromTitle } from "@/lib/builder/authorDisplay";

/** Follow the closest material title, including live CMS overrides. */
export function useAuthorTitleSize(enabled: boolean) {
  const [byline, setByline] = useState<HTMLElement | null>(null);
  const ref = useCallback((node: HTMLElement | null) => setByline(node), []);
  const [size, setSize] = useState<number>();
  useEffect(() => {
    if (!enabled || !byline) return;
    let frame = 0;
    let title: Element | null = null;
    const observer = new ResizeObserver(() => schedule());
    const measure = () => {
      let parent = byline.parentElement;
      let nextTitle: Element | null = null;
      while (parent && parent !== document.body) {
        for (const selector of [
          ".cms-post-title",
          "[data-title-root]",
          ".tt-live-title",
          "h1, h2, h3",
        ]) {
          nextTitle =
            Array.from(parent.querySelectorAll(selector)).find(
              (el) => !el.closest("[data-author-byline]"),
            ) ?? null;
          if (nextTitle) break;
        }
        if (nextTitle) break;
        parent = parent.parentElement;
      }
      if (title !== nextTitle) {
        observer.disconnect();
        title = nextTitle;
        if (title) observer.observe(title);
      }
      if (!title) {
        setSize(undefined);
        return;
      }
      const px = Number.parseFloat(getComputedStyle(title).fontSize);
      setSize(Number.isFinite(px) && px > 2 ? authorSizeFromTitle(px) : undefined);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const widget = byline.closest("[data-w-id]") ?? byline.parentElement;
    const changes = new MutationObserver(schedule);
    if (widget)
      changes.observe(widget, {
        attributes: true,
        attributeFilter: ["class", "style"],
        childList: true,
        subtree: true,
      });
    // Theme Design may replace its stylesheet after hydration.
    const themeChanges = new MutationObserver(schedule);
    themeChanges.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
    for (const root of [document.documentElement, document.body]) {
      themeChanges.observe(root, { attributes: true, attributeFilter: ["class", "style"] });
    }
    window.addEventListener("resize", schedule, { passive: true });
    void document.fonts?.ready.then(schedule);
    return () => {
      observer.disconnect();
      changes.disconnect();
      themeChanges.disconnect();
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  }, [enabled, byline]);
  return { ref, size: enabled ? size : undefined };
}
