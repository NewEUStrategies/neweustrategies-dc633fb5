import { useEffect, useRef, useState } from "react";
import type { Device } from "@/lib/builder/types";

interface Props {
  /** Container the overlay is positioned relative to (VisualCanvas root). */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Currently selected widget id (single-selection). */
  widgetId: string | null;
  /** Active builder device breakpoint. */
  device: Device;
  /** Commit the new height (px) for the given widget on the active device. */
  onResize: (id: string, height: number, device: Device) => void;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MIN_H = 40;
const MAX_H = 4000;

/**
 * Elementor-style resize handles rendered as an absolutely-positioned overlay
 * on top of the currently selected widget in the builder canvas. Drag = live
 * height preview via inline style, drop = commit to the widget document.
 */
export function WidgetResizeOverlay({ containerRef, widgetId, device, onResize }: Props) {
  const [rect, setRect] = useState<Rect | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const draggingRef = useRef<{ startY: number; startH: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Locate the selected widget element + track its box.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !widgetId) {
      targetRef.current = null;
      setRect(null);
      return;
    }
    const el = container.querySelector<HTMLElement>(`[data-widget-id="${widgetId}"]`);
    targetRef.current = el;
    if (!el) {
      setRect(null);
      return;
    }
    const measure = () => {
      const parent = container.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      setRect({
        left: r.left - parent.left,
        top: r.top - parent.top,
        width: r.width,
        height: r.height,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(container);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [containerRef, widgetId, device]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = targetRef.current;
    if (!el) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    draggingRef.current = { startY: e.clientY, startH: el.getBoundingClientRect().height };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = draggingRef.current;
    const el = targetRef.current;
    if (!state || !el) return;
    const next = Math.max(MIN_H, Math.min(MAX_H, Math.round(state.startH + (e.clientY - state.startY))));
    // Live preview: paint directly on the DOM so drag is smooth without
    // waiting for a React round-trip through document state.
    el.style.setProperty("height", `${next}px`, "important");
    const container = containerRef.current;
    if (container) {
      const parent = container.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      setRect({
        left: r.left - parent.left,
        top: r.top - parent.top,
        width: r.width,
        height: r.height,
      });
    }
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = draggingRef.current;
    const el = targetRef.current;
    draggingRef.current = null;
    setDragging(false);
    if (!state || !el || !widgetId) return;
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    const next = Math.max(MIN_H, Math.min(MAX_H, Math.round(el.getBoundingClientRect().height)));
    // Clear inline preview - the committed document + frame style repaint it.
    el.style.removeProperty("height");
    onResize(widgetId, next, device);
  };

  if (!rect || !widgetId) return null;

  const handleBase =
    "absolute z-[70] bg-[color:var(--brand,#ff6a00)] text-white shadow-md rounded-[3px] " +
    "flex items-center justify-center select-none";

  return (
    <div
      aria-hidden
      data-builder-chrome
      className="pointer-events-none absolute inset-0"
      style={{ zIndex: 65 }}
    >
      {/* Selection frame */}
      <div
        className="absolute border border-[color:var(--brand,#ff6a00)]/70 rounded-[3px]"
        style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      />
      {/* Bottom (height) handle */}
      <div
        role="slider"
        aria-orientation="vertical"
        aria-label="Zmień wysokość widgetu"
        aria-valuenow={Math.round(rect.height)}
        title={`Wysokość: ${Math.round(rect.height)} px (przeciągnij, aby zmienić)`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        className={`${handleBase} pointer-events-auto cursor-ns-resize`}
        style={{
          left: rect.left + rect.width / 2 - 18,
          top: rect.top + rect.height - 6,
          width: 36,
          height: 12,
        }}
      >
        <span className="text-[10px] leading-none font-semibold tracking-wide">═</span>
      </div>
      {dragging && (
        <div
          className="absolute pointer-events-none rounded bg-[color:var(--brand,#ff6a00)] text-white text-[11px] font-semibold px-2 py-0.5 shadow-md"
          style={{ left: rect.left + rect.width / 2 - 30, top: rect.top + rect.height + 10, width: 60, textAlign: "center" }}
        >
          {Math.round(rect.height)} px
        </div>
      )}
    </div>
  );
}
