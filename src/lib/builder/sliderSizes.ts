import { imageSlotSizes, type ImageSlot } from "./imageSlot";
// Shared by SSR image preloads and the rendered slider. Keep this module
// independent of React and the slider implementation.
export const SLIDER_FULL_BLEED_SIZES = "100vw";
export const SLIDER_SPLIT_SIZES = "(max-width: 767px) 100vw, 50vw";

/** Card counts follow container queries, including before hydration. */
export function sliderMultiCardSizes(columns: number, slot?: ImageSlot): string {
  const cols = Math.min(4, Math.max(1, Math.round(columns)));
  if (cols === 1) return imageSlotSizes(slot);
  // Match the container-query card count already applied to the SSR HTML.
  const ranges = [
    { end: 767, value: { vw: 100, cap: Infinity } },
    { end: 1023, value: slot?.tablet ?? { vw: 100, cap: Infinity } },
    { end: Infinity, value: slot?.desktop ?? { vw: 100, cap: Infinity } },
  ];
  const result: { end: number; size: string }[] = [];
  let start = 0;
  for (const { end, value } of ranges) {
    for (const [limit, count] of [
      [640, 1],
      [1024, Math.min(cols, 2)],
      [Infinity, cols],
    ]) {
      const bound = Math.min(
        end,
        value.cap <= limit ? Infinity : Math.floor((limit * 100) / value.vw),
      );
      if (bound <= start) continue;
      const vw = Math.round((value.vw / count) * 100) / 100;
      const size = Number.isFinite(value.cap)
        ? `min(${vw}vw, ${Math.ceil(value.cap / count)}px)`
        : `${vw}vw`;
      const previous = result.at(-1);
      if (previous?.size === size) previous.end = bound;
      else result.push({ end: bound, size });
      start = bound;
      if (bound === end) break;
    }
  }
  return result
    .map(({ end, size }) => (Number.isFinite(end) ? `(max-width: ${end}px) ${size}` : size))
    .join(", ");
}

/** Same slot bounds and configured columns on the server and on first render. */
export function sliderImageSizes(variant: string, columns: number, slot?: ImageSlot): string {
  if (variant === "multi-card") return sliderMultiCardSizes(columns, slot);
  if (variant === "split-feature") return slot ? imageSlotSizes(slot, 2) : SLIDER_SPLIT_SIZES;
  return slot ? imageSlotSizes(slot) : SLIDER_FULL_BLEED_SIZES;
}
