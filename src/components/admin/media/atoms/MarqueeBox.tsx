import type { MarqueeRect } from "../types";

interface MarqueeBoxProps {
  rect: MarqueeRect;
}

/** Atom: the translucent rubber-band rectangle drawn during marquee drag. */
export function MarqueeBox({ rect }: MarqueeBoxProps) {
  return (
    <div
      aria-hidden
      className="absolute pointer-events-none bg-brand/10 border border-brand/60 rounded-sm"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    />
  );
}
