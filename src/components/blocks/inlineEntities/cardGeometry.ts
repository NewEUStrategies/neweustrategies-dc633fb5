// Geometria i identyfikatory karty encji inline - czyste funkcje wspólne dla
// nakładki publicznej (`InlineEntityCards`) i podglądu w edytorze.

import type { InlineEntity } from "@/lib/blocks/inlineEntities/model";

export const CARD_WIDTH_PX = 288;
export const EDGE_PADDING_PX = 8;
export const CARD_GAP_PX = 8;

export interface CardPlacement {
  left: number;
  top: number;
  width: number;
  flipUp: boolean;
}

/** Identyfikator elementu karty (cel `aria-controls` wyzwalacza). */
export function cardDomId(entityId: string): string {
  return `nes-ie-card-${entityId}`;
}

/** Link do profilu w serwisie dla osoby zaciągniętej z profilu autora. */
export function entityProfileHref(entity: InlineEntity): string | null {
  if (entity.kind !== "person" || entity.source.type !== "author" || !entity.source.slug) {
    return null;
  }
  return `/people/${encodeURIComponent(entity.source.slug)}`;
}

/**
 * Pozycja karty względem viewportu: pod nazwą, a gdy się nie mieści - nad nią;
 * poziomo wyśrodkowana na nazwie i docięta do krawędzi ekranu.
 */
export function computeCardPlacement(
  trigger: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  cardHeight: number,
  viewport: { width: number; height: number },
): CardPlacement {
  const width = Math.min(CARD_WIDTH_PX, Math.max(viewport.width - EDGE_PADDING_PX * 2, 0));
  const center = (trigger.left + trigger.right) / 2;
  const maxLeft = Math.max(viewport.width - width - EDGE_PADDING_PX, EDGE_PADDING_PX);
  const left = Math.min(Math.max(center - width / 2, EDGE_PADDING_PX), maxLeft);
  const required = cardHeight + CARD_GAP_PX + EDGE_PADDING_PX;
  const spaceBelow = viewport.height - trigger.bottom;
  const spaceAbove = trigger.top;
  const flipUp = spaceBelow < required && spaceAbove >= required;
  const top = flipUp ? trigger.top - CARD_GAP_PX - cardHeight : trigger.bottom + CARD_GAP_PX;
  return { left, top, width, flipUp };
}
