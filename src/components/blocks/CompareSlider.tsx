// Interactive before/after slider (client-side).
import { useRef, useState } from "react";

interface Props {
  before: string;
  after: string;
  labelBefore?: string;
  labelAfter?: string;
}

export function CompareSlider({
  before,
  after,
  labelBefore = "Before",
  labelAfter = "After",
}: Props) {
  const [pos, setPos] = useState(50);
  const dragging = useRef(false);
  const ref = useRef<HTMLDivElement>(null);

  const updateFromClientX = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    setPos((x / rect.width) * 100);
  };

  return (
    <div
      ref={ref}
      className="relative w-full aspect-video overflow-hidden rounded-lg select-none touch-none"
      onPointerDown={(e) => {
        dragging.current = true;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        updateFromClientX(e.clientX);
      }}
      onPointerMove={(e) => {
        if (dragging.current) updateFromClientX(e.clientX);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pos)}
      aria-label={`${labelBefore} / ${labelAfter}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") setPos((p) => Math.max(0, p - 2));
        if (e.key === "ArrowRight") setPos((p) => Math.min(100, p + 2));
      }}
    >
      <img
        src={after}
        alt={labelAfter}
        className="absolute inset-0 w-full h-full object-cover"
        draggable={false}
      />
      <div className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${pos}%` }}>
        <img
          src={before}
          alt={labelBefore}
          className="absolute inset-0 h-full w-auto max-w-none object-cover"
          style={{ width: `${10000 / Math.max(pos, 1)}%` }}
          draggable={false}
        />
      </div>
      <span className="absolute top-2 left-2 text-xs px-2 py-0.5 rounded bg-black/60 text-white">
        {labelBefore}
      </span>
      <span className="absolute top-2 right-2 text-xs px-2 py-0.5 rounded bg-black/60 text-white">
        {labelAfter}
      </span>
      <div
        className="absolute inset-y-0 w-0.5 bg-white pointer-events-none"
        style={{ left: `${pos}%`, transform: "translateX(-50%)" }}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white shadow-lg flex items-center justify-center text-black text-xs font-bold">
          ⇆
        </div>
      </div>
    </div>
  );
}
