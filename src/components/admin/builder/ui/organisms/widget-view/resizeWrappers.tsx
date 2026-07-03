// Inline resize wrappers for the builder canvas, extracted from SimpleWidgets.
// ResizableImageWrap preserves image aspect ratio; ResizableBox resizes both
// axes freely (buttons/CTAs). Both no-op (or just apply size) when not editable.
import { useRef, useState, type CSSProperties, type ReactNode } from "react";

export function ResizableImageWrap({
  enabled,
  currentPx,
  onCommit,
  children,
}: {
  enabled: boolean;
  currentPx: number | undefined;
  onCommit: (px: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [livePx, setLivePx] = useState<number | undefined>(undefined);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    ratio: number;
  } | null>(null);

  if (!enabled) return <>{children}</>;

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = ref.current;
    if (!el) return;
    const img = el.querySelector("img") as HTMLImageElement | null;
    const rect = (img ?? el).getBoundingClientRect();
    const ratio = rect.height > 0 ? rect.width / rect.height : 1;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: rect.width,
      startH: rect.height,
      ratio,
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    // Use larger delta for natural feel; preserve aspect ratio.
    const newW = Math.max(20, d.startW + Math.max(dx, dy * d.ratio));
    setLivePx(newW);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d && livePx !== undefined) onCommit(livePx);
    dragRef.current = null;
    setLivePx(undefined);
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

  const displayPx = livePx ?? currentPx;
  const wrapStyle: CSSProperties = {
    position: "relative",
    display: "inline-block",
    maxWidth: "100%",
    width: displayPx ? `min(100%, ${displayPx}px)` : "100%",
  };
  return (
    <div ref={ref} style={wrapStyle}>
      {children}
      <div
        role="slider"
        aria-label="Zmień rozmiar obrazka (zachowuje proporcje)"
        title={`Przeciągnij aby zmienić rozmiar${livePx ? ` - ${Math.round(livePx)}px` : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          right: -6,
          bottom: -6,
          width: 14,
          height: 14,
          borderRadius: 3,
          background: "hsl(var(--brand, 220 90% 56%))",
          border: "2px solid white",
          boxShadow: "0 1px 3px rgba(0,0,0,.3)",
          cursor: "nwse-resize",
          zIndex: 20,
          touchAction: "none",
        }}
      />
      {livePx !== undefined && (
        <div
          style={{
            position: "absolute",
            top: 4,
            left: 4,
            background: "rgba(0,0,0,.7)",
            color: "white",
            fontSize: 10,
            padding: "2px 6px",
            borderRadius: 3,
            pointerEvents: "none",
            zIndex: 20,
          }}
        >
          {Math.round(livePx)}px
        </div>
      )}
    </div>
  );
}

/**
 * Generic 2-axis resize wrapper for inline widgets (buttons, CTAs).
 * - When `enabled` is false, renders children as-is.
 * - Width / height are independent (corner handle resizes both axes freely).
 * - `display: inline-block` so it doesn't stretch full row width by default.
 */
export function ResizableBox({
  enabled,
  widthPx,
  heightPx,
  minW = 40,
  minH = 24,
  onCommit,
  children,
}: {
  enabled: boolean;
  widthPx?: number;
  heightPx?: number;
  minW?: number;
  minH?: number;
  onCommit: (w: number, h: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<{ w: number; h: number } | undefined>(undefined);
  const dragRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(
    null,
  );

  const baseStyle: CSSProperties = {
    position: "relative",
    display: "inline-flex",
    alignItems: "stretch",
    justifyContent: "stretch",
    width: (live?.w ?? widthPx) ? `${live?.w ?? widthPx}px` : "auto",
    height: (live?.h ?? heightPx) ? `${live?.h ?? heightPx}px` : "auto",
    maxWidth: "100%",
    verticalAlign: "top",
  };

  if (!enabled) {
    // Still apply user-chosen size so production renders respect resize.
    if (widthPx || heightPx) {
      return <div style={baseStyle}>{children}</div>;
    }
    return <>{children}</>;
  }

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: rect.width,
      startH: rect.height,
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const w = Math.max(minW, d.startW + (e.clientX - d.startX));
    const h = Math.max(minH, d.startH + (e.clientY - d.startY));
    setLive({ w, h });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const l = live;
    if (dragRef.current && l) onCommit(Math.round(l.w), Math.round(l.h));
    dragRef.current = null;
    setLive(undefined);
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

  return (
    <div ref={ref} style={baseStyle}>
      <div style={{ width: "100%", height: "100%", display: "flex" }}>{children}</div>
      <div
        role="slider"
        aria-label="Zmień rozmiar"
        title={`Przeciągnij aby zmienić rozmiar${live ? ` - ${Math.round(live.w)}×${Math.round(live.h)}px` : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          right: -6,
          bottom: -6,
          width: 12,
          height: 12,
          borderRadius: 3,
          background: "hsl(var(--brand, 220 90% 56%))",
          border: "2px solid white",
          boxShadow: "0 1px 3px rgba(0,0,0,.3)",
          cursor: "nwse-resize",
          zIndex: 20,
          touchAction: "none",
        }}
      />
      {live && (
        <div
          style={{
            position: "absolute",
            top: -18,
            left: 0,
            background: "rgba(0,0,0,.7)",
            color: "white",
            fontSize: 10,
            padding: "1px 5px",
            borderRadius: 3,
            pointerEvents: "none",
            zIndex: 20,
            whiteSpace: "nowrap",
          }}
        >
          {Math.round(live.w)}×{Math.round(live.h)}px
        </div>
      )}
    </div>
  );
}
