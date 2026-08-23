// Renders the "Przypisy źródłowe" list at the bottom of an article and wires
// up hover tooltips for the [N] markers inserted by processHtmlFootnotes /
// processDocFootnotes.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { sanitizeHtml } from "@/lib/sanitize";
import type { Footnote } from "@/lib/footnotes";
import { resolveFootnoteTargetId, scrollToFootnoteId } from "@/lib/footnotes/navigation";

/**
 * Przechwytuje kliknięcia w odsyłacze przypisów w całym dokumencie i zamienia
 * natywny skok kotwicy na płynne przewinięcie z offsetem pod sticky header.
 * Działa w obie strony: marker w treści -> sekcja "Przypisy źródłowe",
 * numer/strzałka w sekcji -> miejsce w treści.
 */
export function useFootnoteNavigation(): void {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      const id = resolveFootnoteTargetId(e.target as Element | null);
      if (!id) return;
      if (scrollToFootnoteId(id)) e.preventDefault();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
}

const FN_LIST_LABELS = {
  pl: {
    title: "Przypisy źródłowe:",
    back: (id: number) => `Wróć do odsyłacza ${id}`,
    backTitle: "Wróć do czytanego fragmentu",
  },
  en: {
    title: "Source notes:",
    back: (id: number) => `Back to reference ${id}`,
    backTitle: "Back to the passage you were reading",
  },
} as const;

export function FootnotesList({ notes, lang = "pl" }: { notes: Footnote[]; lang?: "pl" | "en" }) {
  if (!notes.length) return null;
  const L = FN_LIST_LABELS[lang] ?? FN_LIST_LABELS.pl;
  return (
    <section
      className="mt-12 pt-6 border-t border-border"
      aria-labelledby="footnotes-heading"
      lang={lang}
    >
      <h2
        id="footnotes-heading"
        data-footnotes-title
        className="font-display text-xl mb-4 scroll-mt-28"
      >
        {L.title}
      </h2>
      <ol data-footnotes-list className="space-y-2 text-sm text-muted-foreground">
        {notes.map((n) => (
          <li key={n.id} id={`fn-${n.id}`} className="leading-relaxed scroll-mt-28">
            {/* Numer jest klikalny i wraca do markera w treści - to najbardziej
                naturalny cel kliknięcia, strzałka ↩ zostaje jako duplikat. */}
            <a
              href={`#fnref-${n.id}`}
              data-fn-marker
              data-footnote-backlink
              className="text-foreground/80 font-medium mr-1 hover:underline"
              aria-label={L.back(n.id)}
              title={L.backTitle}
            >
              [{n.id}]
            </a>
            <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(n.html) }} />{" "}
            <a
              href={`#fnref-${n.id}`}
              data-footnote-backlink
              className="text-brand-ink hover:underline ml-1"
              aria-label={L.back(n.id)}
              title={L.backTitle}
            >
              ↩
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

// Tooltip overlay. Mount once near the article; it attaches mouse handlers to
// every [data-fn] anchor inside `containerRef` and shows a small popover with
// the matching note text.
export function FootnoteTooltips({
  notes,
  containerRef,
}: {
  notes: Footnote[];
  containerRef: React.RefObject<HTMLElement | null>;
}) {
  const [state, setState] = useState<{
    id: number;
    anchorLeft: number;
    anchorRight: number;
    anchorTop: number;
    anchorBottom: number;
  } | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number; ready: boolean }>({
    left: 12,
    top: 12,
    ready: false,
  });
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);
  useFootnoteNavigation();

  const cancelHide = () => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  const scheduleHide = () => {
    cancelHide();
    hideTimer.current = window.setTimeout(() => setState(null), 200);
  };

  useEffect(() => {
    const root = containerRef.current;
    if (!root || notes.length === 0) return;
    const byId = new Map(notes.map((n) => [n.id, n.html]));
    const enter = (e: Event) => {
      const a = (e.target as Element).closest?.("a[data-fn]") as HTMLAnchorElement | null;
      if (!a) return;
      const id = Number(a.dataset.fn);
      if (!byId.has(id)) return;
       cancelHide();
      const r = a.getBoundingClientRect();
       setPosition((current) => ({ ...current, ready: false }));
       setState({
         id,
         anchorLeft: r.left,
         anchorRight: r.right,
         anchorTop: r.top,
         anchorBottom: r.bottom,
       });
    };
    root.addEventListener("mouseenter", enter, true);
    root.addEventListener("focusin", enter, true);
     root.addEventListener("mouseleave", scheduleHide, true);
     root.addEventListener("focusout", scheduleHide, true);
    return () => {
      root.removeEventListener("mouseenter", enter, true);
      root.removeEventListener("focusin", enter, true);
       root.removeEventListener("mouseleave", scheduleHide, true);
       root.removeEventListener("focusout", scheduleHide, true);
       cancelHide();
    };
  }, [notes, containerRef]);

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!state || !tooltip) return;

    const VIEWPORT_GUTTER = 12;
    const ANCHOR_GAP = 8;
    const rect = tooltip.getBoundingClientRect();
    const anchorCenter = (state.anchorLeft + state.anchorRight) / 2;
    const left = Math.min(
      Math.max(anchorCenter - rect.width / 2, VIEWPORT_GUTTER),
      Math.max(VIEWPORT_GUTTER, window.innerWidth - rect.width - VIEWPORT_GUTTER),
    );
    const roomAbove = state.anchorTop - VIEWPORT_GUTTER;
    const top =
      roomAbove >= rect.height + ANCHOR_GAP
        ? state.anchorTop - rect.height - ANCHOR_GAP
        : Math.min(
            state.anchorBottom + ANCHOR_GAP,
            Math.max(VIEWPORT_GUTTER, window.innerHeight - rect.height - VIEWPORT_GUTTER),
          );

    setPosition({ left, top, ready: true });
  }, [state]);

  if (!state) return null;
  const note = notes.find((n) => n.id === state.id);
  if (!note) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={tooltipRef}
      role="tooltip"
      data-footnote-tooltip
      className="fixed z-[100] w-max max-w-[min(34rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-1.5rem)] overflow-y-auto overscroll-contain whitespace-normal break-words rounded-[6px] border border-brand bg-popover px-3 py-2 text-popover-foreground shadow-lg"
      style={{
        left: position.left,
        top: position.top,
        visibility: position.ready ? "visible" : "hidden",
      }}
      onMouseEnter={cancelHide}
      onMouseLeave={scheduleHide}
    >
      <span className="font-medium mr-1">[{state.id}]</span>
      <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(note.html) }} />
    </div>,
    document.body,
  );
}
