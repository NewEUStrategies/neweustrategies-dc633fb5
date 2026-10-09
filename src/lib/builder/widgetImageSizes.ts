// Jedno źródło prawdy dla atrybutu `sizes` obrazów widgetów buildera
// (poza sliderem - ten ma własny lib/builder/sliderSizes.ts). Współdzielone
// przez renderery widgetów i budowniczego preloadu LCP (heroImage), żeby
// `imagesizes` preloadu było bajtowo identyczne z `<img sizes>` renderu.
// Wyłącznie czyste helpery - bez zależności od Reacta i rendererów widgetów.
import { imageSlotSizes, mobileSlotSize, type ImageSlot } from "./imageSlot";
import type { WidgetContent } from "./types";

export function imageDimensionPx(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : 0;
  if (typeof value !== "string") return 0;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i.exec(value);
  return match ? Number(match[1]) : 0;
}

/** Image widgets fill their builder column unless the editor caps the width.
 * Shared with the SSR preload; these hints change downloaded pixels, not CSS. */
export function imageWidgetSizes(content: WidgetContent, slot?: ImageSlot): string {
  const widths = [
    imageDimensionPx(content.widthPx) || imageDimensionPx(content.width),
    imageDimensionPx(content.maxWidthPx) || imageDimensionPx(content.maxWidth),
  ].filter((width) => width > 0);
  if (!widths.length) return imageSlotSizes(slot);
  const cap = Math.min(...widths);
  const limit = (device: "desktop" | "tablet") => ({
    vw: slot?.[device].vw ?? 100,
    cap: Math.min(slot?.[device].cap ?? Infinity, cap),
  });
  // Mobilna część przekazana wprost (P3.2a): dawny `.replace("... 100vw")`
  // przestałby po cichu działać przy marginesie kolumny w `imageSlotSizes`.
  return imageSlotSizes(
    { desktop: limit("desktop"), tablet: limit("tablet") },
    1,
    1,
    `min(${mobileSlotSize(slot)}, ${cap}px)`,
  );
}

/** Dark-featured-card: pełna szerokość na mobile, ~pół na desktopie. */
export const WIDGET_MEDIA_SPLIT_SIZES = "(max-width: 767px) 100vw, 50vw";

/** Post-lista, siatka kart 1-4 kolumny (card / minimal / overlay / boxed-grid). */
export const POST_LIST_GRID_COVER_SIZES =
  "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw";

/** Post-lista, wariant "classic" - jedna kolumna z dużą okładką (maks. ~900 px). */
export const POST_LIST_CLASSIC_COVER_SIZES = "(max-width: 1024px) 100vw, 900px";

/** Post-lista, wariant "flex-grid" - duży lead (~58vw) + kompaktowa kolumna boczna. */
export const POST_LIST_FLEX_LEAD_SIZES = "(max-width: 768px) 100vw, 58vw";

/**
 * Karta promocyjna (`promo-card`). Kadr jest ograniczony szerokością z panelu,
 * więc `sizes` musi tę liczbę znać - inaczej przeglądarka pobiera kandydata dla
 * pełnej szerokości ekranu i płaci za piksele, których karta nigdy nie pokaże.
 *
 * `maxWidth = 0` znaczy "pełna szerokość kolumny", a tej nie da się uczciwie
 * wyrazić inaczej niż `100vw` (kolumna zależy od układu sekcji, nie od widgetu).
 */
export function promoCardCoverSizes(maxWidth: number): string {
  return maxWidth > 0 ? `(max-width: ${maxWidth}px) 100vw, ${maxWidth}px` : "100vw";
}
