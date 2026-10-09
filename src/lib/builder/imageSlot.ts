import type { ColumnNode, InnerSectionNode, SectionChild, SectionNode } from "./types";

/** Upper bounds known during SSR, before a browser can measure the widget. */
export interface ImageSlot {
  desktop: { vw: number; cap: number };
  tablet: { vw: number; cap: number };
}

export function columnImageSlot(
  section: SectionNode | InnerSectionNode,
  column: ColumnNode,
  siblings: readonly SectionChild[],
  parent?: ImageSlot,
): ImageSlot {
  const maxWidth =
    section.layout?.contentWidth === "full" ? Infinity : Math.max(1, section.layout?.width || 1140);
  const fallback = section.kind === "inner-section" ? 6 : 12;
  const slot = (device: "desktop" | "tablet") => {
    const span = (c: SectionChild) =>
      c.kind === "column" ? Math.max(1, c.span?.[device] ?? c.span?.desktop ?? fallback) : 12;
    const share =
      span(column) /
      Math.max(
        1,
        siblings.reduce((sum, c) => sum + span(c), 0),
      );
    return {
      vw: (parent?.[device].vw ?? 100) * share,
      cap: Math.min(maxWidth, parent?.[device].cap ?? Infinity) * share,
    };
  };
  return { desktop: slot("desktop"), tablet: slot("tablet") };
}

/**
 * Margines kolumny buildera na telefonie, po JEDNEJ stronie (P3.2a, LP-7): cztery
 * warstwy po 8 px, niezależne od treści - inline `paddingLeft/Right` kontenera
 * sekcji (`SECTION_SAFE_AREA_PX`, `sectionStyles.tsx`), `[data-sec-id] > * > *`
 * (`padding: max(8px, env(safe-area-inset-*)) !important`) oraz slot i ciało
 * kolumny (`[data-col-id] { padding: 8px !important }` trafia oba, bo oba niosą
 * `data-col-id`) - reguły `@media (max-width: 767px)` w `src/styles.css`.
 * Zmierzone: hero `/` przy 412 px ma `left: 32, width: 348` (Lighthouse
 * produkcji i fixture; e2e `hero-srcset.boot-home.spec.ts` przypina to na
 * artefakcie). Wewnętrzne sekcje i kolumny (`INNER_SECTION_SAFE_AREA_PX`,
 * `COLUMN_SAFE_AREA_PX`) i paddingi z panelu tylko POWIĘKSZAJĄ margines, więc
 * 32 px to dolna granica: `sizes` szacuje szerokość z góry i nigdy nie wybiera
 * kandydata za małego (najwyżej o stopień za duży, jak dawne `100vw`).
 */
export const MOBILE_COLUMN_GUTTER_PX = 32;

/** Mobilna część `sizes` obrazu w kolumnie buildera (bez slotu - render poza rendererem). */
export function mobileSlotSize(slot?: ImageSlot): string {
  return slot ? `calc(100vw - ${2 * MOBILE_COLUMN_GUTTER_PX}px)` : "100vw";
}

export function imageSlotSizes(
  slot?: ImageSlot,
  desktopColumns = 1,
  mobileColumns = 1,
  mobile = mobileSlotSize(slot),
): string {
  if (!slot)
    return desktopColumns === 1
      ? "100vw"
      : `(max-width: 767px) ${100 / mobileColumns}vw, ${100 / desktopColumns}vw`;
  const size = (value: ImageSlot["desktop"]) => {
    const vw = Math.round((value.vw / desktopColumns) * 100) / 100;
    return Number.isFinite(value.cap)
      ? `min(${vw}vw, ${Math.ceil(value.cap / desktopColumns)}px)`
      : `${vw}vw`;
  };
  return `(max-width: 767px) ${mobileColumns === 1 ? mobile : `${100 / mobileColumns}vw`}, (max-width: 1023px) ${size(slot.tablet)}, ${size(slot.desktop)}`;
}
