import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isVisible(el: HTMLElement): boolean {
  return el.offsetParent !== null || el === document.activeElement;
}

/**
 * Traps Tab/Shift+Tab focus inside `containerRef` while `active` is true,
 * moves focus into the container on activation, and restores focus to
 * whatever had it before on deactivation.
 *
 * Every hand-rolled dialog/drawer in the app (Header mobile drawer,
 * NewsletterPopup, PopupHost, ConsentBanner, FloatingShareBar share sheet,
 * StoryViewer) shares this instead of re-implementing focus management, so
 * none of them leak keyboard focus into the page behind an open overlay.
 * Escape-to-close and body-scroll-lock stay owned by each caller - this hook
 * only does focus.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean): void {
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible);

    // Prefer an element the caller opts in with `data-autofocus`, else the
    // first focusable element, else the container itself.
    const initial = container.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0];
    if (initial) {
      initial.focus();
    } else if (!container.hasAttribute("tabindex")) {
      container.setAttribute("tabindex", "-1");
      container.focus();
    } else {
      container.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      const outside = !activeEl || !container.contains(activeEl);

      if (e.shiftKey) {
        if (outside || activeEl === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (outside || activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };
    container.addEventListener("keydown", onKeyDown);

    return () => {
      container.removeEventListener("keydown", onKeyDown);
      const toRestore = previouslyFocused.current;
      if (toRestore && document.contains(toRestore)) {
        toRestore.focus();
      }
    };
  }, [active, containerRef]);
}
