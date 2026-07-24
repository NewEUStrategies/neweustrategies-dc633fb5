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

interface CanvasScale {
  x: number;
  y: number;
}

const MIN_H = 40;
const MAX_H = 4000;

type HandleKind = "top" | "bottom";

/**
 * Elementor-style resize handles rendered as an absolutely-positioned overlay
 * on top of the currently selected widget in the builder canvas. Drag = live
 * height preview via inline style, drop = commit to the widget document. Both
 * the top and bottom edges are draggable; the badge in the corner shows the
 * current height and updates live while dragging.
 */
export function WidgetResizeOverlay({ containerRef, widgetId, device, onResize }: Props) {
  const [rect, setRect] = useState<Rect | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const draggingRef = useRef<{
    kind: HandleKind;
    startY: number;
    startH: number;
  } | null>(null);
  const [liveH, setLiveH] = useState<number | null>(null);
  const scaleRef = useRef<CanvasScale>({ x: 1, y: 1 });

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
      const scaleX = container.offsetWidth > 0 ? parent.width / container.offsetWidth : 1;
      const scaleY = container.offsetHeight > 0 ? parent.height / container.offsetHeight : scaleX;
      const safeScaleX = Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1;
      const safeScaleY = Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1;
      scaleRef.current = { x: safeScaleX, y: safeScaleY };
      setRect({
        left: (r.left - parent.left) / safeScaleX,
        top: (r.top - parent.top) / safeScaleY,
        width: r.width / safeScaleX,
        height: r.height / safeScaleY,
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

  const beginDrag = (kind: HandleKind) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = targetRef.current;
    if (!el) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    draggingRef.current = {
      kind,
      startY: e.clientY,
      startH: el.offsetHeight,
    };
    setLiveH(Math.round(el.offsetHeight));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = draggingRef.current;
    const el = targetRef.current;
    if (!state || !el) return;
    const delta = (e.clientY - state.startY) / scaleRef.current.y;
    // Top handle shrinks/grows in the opposite direction so dragging up
    // grows the widget upward.
    const raw = state.kind === "top" ? state.startH - delta : state.startH + delta;
    const next = Math.max(MIN_H, Math.min(MAX_H, Math.round(raw)));
    // Live preview: paint directly on the DOM so drag is smooth without
    // waiting for a React round-trip through document state.
    el.style.setProperty("height", `${next}px`, "important");
    setLiveH(next);
    const container = containerRef.current;
    if (container) {
      const parent = container.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      setRect({
        left: (r.left - parent.left) / scaleRef.current.x,
        top: (r.top - parent.top) / scaleRef.current.y,
        width: r.width / scaleRef.current.x,
        height: r.height / scaleRef.current.y,
      });
    }
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = draggingRef.current;
    const el = targetRef.current;
    draggingRef.current = null;
    if (!state || !el || !widgetId) {
      setLiveH(null);
      return;
    }
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    const next = Math.max(MIN_H, Math.min(MAX_H, Math.round(el.offsetHeight)));
    // Clear inline preview - the committed document + frame style repaint it.
    el.style.removeProperty("height");
    onResize(widgetId, next, device);
    setLiveH(null);
  };

  if (!rect || !widgetId) return null;

  const dragging = liveH !== null;
  const displayH = liveH ?? Math.round(rect.height);
  const handleBase =
    "absolute z-[70] bg-[color:var(--brand,#ff6a00)] text-white shadow-md rounded-[3px] " +
    "flex items-center justify-center select-none pointer-events-auto";

  return (
    <div
      aria-hidden
      data-builder-chrome
      className="pointer-events-none absolute inset-0"
      style={{ zIndex: 65 }}
    >
      {/* Selection frame */}
      <div
        className="absolute border-2 border-[color:var(--brand,#ff6a00)] rounded-[3px]"
        style={{
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          boxShadow: "0 0 0 1px rgba(0,0,0,0.04)",
        }}
      />
      {/* Height label chip — always visible, updates live */}
      <div
        className="absolute rounded bg-[color:var(--brand,#ff6a00)] text-white text-[10px] font-semibold px-1.5 py-0.5 shadow-md pointer-events-none"
        style={{
          left: Math.max(0, rect.left + rect.width - 62),
          top: Math.max(0, rect.top - 20),
          lineHeight: 1.2,
          letterSpacing: "0.02em",
        }}
      >
        H: {displayH}px
      </div>
      {/* Top (height) handle */}
      <div
        role="slider"
        aria-orientation="vertical"
        aria-label="Zmień wysokość widgetu (górna krawędź)"
        aria-valuenow={displayH}
        title={`Wysokość: ${displayH} px - przeciągnij, aby zmienić`}
        onPointerDown={beginDrag("top")}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        className={`${handleBase} cursor-ns-resize`}
        style={{
          left: rect.left + rect.width / 2 - 22,
          top: rect.top - 6,
          width: 44,
          height: 12,
        }}
      >
        <span className="text-[10px] leading-none font-bold">═</span>
      </div>
      {/* Bottom (height) handle */}
      <div
        role="slider"
        aria-orientation="vertical"
        aria-label="Zmień wysokość widgetu (dolna krawędź)"
        aria-valuenow={displayH}
        title={`Wysokość: ${displayH} px - przeciągnij, aby zmienić`}
        onPointerDown={beginDrag("bottom")}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        className={`${handleBase} cursor-ns-resize`}
        style={{
          left: rect.left + rect.width / 2 - 22,
          top: rect.top + rect.height - 6,
          width: 44,
          height: 12,
        }}
      >
        <span className="text-[10px] leading-none font-bold">═</span>
      </div>
      {dragging && (
        <div
          className="absolute pointer-events-none rounded bg-[color:var(--brand,#ff6a00)] text-white text-[11px] font-semibold px-2 py-0.5 shadow-md"
          style={{
            left: rect.left + rect.width / 2 - 34,
            top: rect.top + rect.height + 10,
            width: 68,
            textAlign: "center",
          }}
        >
          {displayH} px
        </div>
      )}
    </div>
  );
}
