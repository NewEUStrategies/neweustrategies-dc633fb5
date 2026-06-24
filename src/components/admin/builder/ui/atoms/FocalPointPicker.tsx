// Atom: visual focal-point picker. Click anywhere on the image preview to set
// the object-position percentages. Uses a draggable crosshair overlay.
import { useCallback, useRef, type CSSProperties } from "react";
import { safeImageUrl } from "@/lib/sanitize";

interface Props {
  image: string;
  x: number;
  y: number;
  onChange: (x: number, y: number) => void;
  /** Aspect-ratio class (Tailwind). */
  aspectCls?: string;
  placeholderColor?: string;
}

const clamp = (n: number): number => Math.min(100, Math.max(0, n));

export function FocalPointPicker({
  image, x, y, onChange, aspectCls = "aspect-[16/10]", placeholderColor,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  const update = useCallback((ev: { clientX: number; clientY: number }): void => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = clamp(((ev.clientX - rect.left) / rect.width) * 100);
    const ny = clamp(((ev.clientY - rect.top) / rect.height) * 100);
    onChange(Math.round(nx), Math.round(ny));
  }, [onChange]);

  const img = safeImageUrl(image);
  const style: CSSProperties = placeholderColor ? { background: placeholderColor } : {};
  const dotStyle: CSSProperties = {
    left: `${clamp(x)}%`, top: `${clamp(y)}%`,
    transform: "translate(-50%, -50%)",
  };

  return (
    <div
      ref={ref}
      className={`${aspectCls} relative overflow-hidden rounded-md border border-border bg-muted cursor-crosshair select-none`}
      style={style}
      onMouseDown={(e) => { dragging.current = true; update(e); }}
      onMouseMove={(e) => { if (dragging.current) update(e); }}
      onMouseUp={() => { dragging.current = false; }}
      onMouseLeave={() => { dragging.current = false; }}
      onTouchStart={(e) => {
        const t = e.touches[0];
        if (t) update({ clientX: t.clientX, clientY: t.clientY });
      }}
      onTouchMove={(e) => {
        const t = e.touches[0];
        if (t) update({ clientX: t.clientX, clientY: t.clientY });
      }}
      role="application"
      aria-label="Focal point picker"
    >
      {img ? (
        <img
          src={img}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          style={{ objectPosition: `${clamp(x)}% ${clamp(y)}%` }}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground">
          Brak obrazu - dodaj URL powyżej
        </div>
      )}
      <div
        className="absolute w-6 h-6 rounded-full border-2 border-white shadow-md pointer-events-none"
        style={{
          ...dotStyle,
          background: "color-mix(in srgb, var(--brand) 60%, transparent)",
          boxShadow: "0 0 0 2px rgba(0,0,0,.35), 0 2px 8px rgba(0,0,0,.4)",
        }}
      />
    </div>
  );
}
