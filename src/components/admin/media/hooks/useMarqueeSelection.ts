/**
 * Rubber-band (marquee) selection over the media canvas, with edge
 * auto-scroll. Hit-tests any element carrying `data-media-item` against the
 * dragged rectangle and merges the hits with the selection captured at
 * pointer-down according to the modifier held:
 *   - no modifier   -> replace
 *   - Shift          -> add to the existing selection
 *   - Cmd/Ctrl       -> toggle the hits against the existing selection
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { MarqueeRect } from "../types";

const DRAG_THRESHOLD = 5;
const EDGE = 32;
const MAX_SCROLL_STEP = 22;

type MarqueeMode = "replace" | "add" | "toggle";

interface MarqueeStart {
  x: number;
  y: number;
  clientX: number;
  clientY: number;
  pointerId: number;
  mode: MarqueeMode;
  baseline: Set<string>;
  active: boolean;
}

export interface UseMarqueeSelectionArgs {
  canvasRef: React.RefObject<HTMLDivElement | null>;
  selectedIds: Set<string>;
  setSelectedIds: (ids: Set<string>) => void;
  clearSelection: () => void;
}

export interface UseMarqueeSelectionResult {
  marquee: MarqueeRect | null;
  onCanvasPointerDown: (e: ReactPointerEvent) => void;
  onCanvasPointerMove: (e: ReactPointerEvent) => void;
  onCanvasPointerUp: (e: ReactPointerEvent) => void;
}

export function useMarqueeSelection(args: UseMarqueeSelectionArgs): UseMarqueeSelectionResult {
  const { canvasRef, selectedIds, setSelectedIds, clearSelection } = args;

  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const startRef = useRef<MarqueeStart | null>(null);
  const autoScrollRef = useRef<number | null>(null);
  const lastClientRef = useRef<{ x: number; y: number } | null>(null);

  // Latest selection, read at pointer-down for the baseline without making the
  // handlers depend on it (keeps their identities stable).
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRef.current !== null) {
      cancelAnimationFrame(autoScrollRef.current);
      autoScrollRef.current = null;
    }
  }, []);

  const computeMarquee = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      const start = startRef.current;
      if (!canvas || !start) return;
      const rect = canvas.getBoundingClientRect();
      const cx = clientX - rect.left + canvas.scrollLeft;
      const cy = clientY - rect.top + canvas.scrollTop;
      const x = Math.min(cx, start.x);
      const y = Math.min(cy, start.y);
      const w = Math.abs(cx - start.x);
      const h = Math.abs(cy - start.y);
      setMarquee({ x, y, w, h });

      const items = canvas.querySelectorAll<HTMLElement>("[data-media-item]");
      const hits = new Set<string>();
      for (const el of Array.from(items)) {
        const r = el.getBoundingClientRect();
        const ix = r.left - rect.left + canvas.scrollLeft;
        const iy = r.top - rect.top + canvas.scrollTop;
        if (ix < x + w && ix + r.width > x && iy < y + h && iy + r.height > y) {
          const id = el.getAttribute("data-media-item");
          if (id) hits.add(id);
        }
      }

      const merged = new Set<string>();
      if (start.mode === "add") {
        for (const id of start.baseline) merged.add(id);
        for (const id of hits) merged.add(id);
      } else if (start.mode === "toggle") {
        for (const id of start.baseline) if (!hits.has(id)) merged.add(id);
        for (const id of hits) if (!start.baseline.has(id)) merged.add(id);
      } else {
        for (const id of hits) merged.add(id);
      }
      setSelectedIds(merged);
    },
    [canvasRef, setSelectedIds],
  );

  const runAutoScroll = useCallback(() => {
    const canvas = canvasRef.current;
    const start = startRef.current;
    const last = lastClientRef.current;
    if (!canvas || !start || !start.active || !last) {
      autoScrollRef.current = null;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (last.y < rect.top + EDGE)
      dy = -Math.ceil(((rect.top + EDGE - last.y) / EDGE) * MAX_SCROLL_STEP);
    else if (last.y > rect.bottom - EDGE)
      dy = Math.ceil(((last.y - (rect.bottom - EDGE)) / EDGE) * MAX_SCROLL_STEP);
    if (last.x < rect.left + EDGE)
      dx = -Math.ceil(((rect.left + EDGE - last.x) / EDGE) * MAX_SCROLL_STEP);
    else if (last.x > rect.right - EDGE)
      dx = Math.ceil(((last.x - (rect.right - EDGE)) / EDGE) * MAX_SCROLL_STEP);
    if (dx || dy) {
      canvas.scrollLeft += dx;
      canvas.scrollTop += dy;
      computeMarquee(last.x, last.y);
    }
    autoScrollRef.current = requestAnimationFrame(runAutoScroll);
  }, [canvasRef, computeMarquee]);

  const onCanvasPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("[data-media-item]")) return;
      if (target.closest("[data-folder-item]")) return;
      if (target.closest("[data-nomarquee]")) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mode: MarqueeMode = e.shiftKey ? "add" : e.metaKey || e.ctrlKey ? "toggle" : "replace";
      startRef.current = {
        x: e.clientX - rect.left + canvas.scrollLeft,
        y: e.clientY - rect.top + canvas.scrollTop,
        clientX: e.clientX,
        clientY: e.clientY,
        pointerId: e.pointerId,
        mode,
        baseline: new Set(selectedRef.current),
        active: false,
      };
      lastClientRef.current = { x: e.clientX, y: e.clientY };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* pointer capture is best-effort */
      }
    },
    [canvasRef],
  );

  const onCanvasPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const start = startRef.current;
      if (!start) return;
      lastClientRef.current = { x: e.clientX, y: e.clientY };
      if (!start.active) {
        const dx = e.clientX - start.clientX;
        const dy = e.clientY - start.clientY;
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        start.active = true;
        if (start.mode === "replace") clearSelection();
        if (autoScrollRef.current === null) {
          autoScrollRef.current = requestAnimationFrame(runAutoScroll);
        }
      }
      computeMarquee(e.clientX, e.clientY);
    },
    [clearSelection, computeMarquee, runAutoScroll],
  );

  const onCanvasPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      const start = startRef.current;
      const canvas = canvasRef.current;
      if (start && canvas) {
        // Plain click on empty canvas (no drag) -> clear selection.
        if (!start.active && start.mode === "replace") clearSelection();
        try {
          canvas.releasePointerCapture(start.pointerId);
        } catch {
          /* pointer capture is best-effort */
        }
      }
      startRef.current = null;
      lastClientRef.current = null;
      stopAutoScroll();
      setMarquee(null);
      void e;
    },
    [canvasRef, clearSelection, stopAutoScroll],
  );

  // Cancel any in-flight auto-scroll frame on unmount.
  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  return { marquee, onCanvasPointerDown, onCanvasPointerMove, onCanvasPointerUp };
}
