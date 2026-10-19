// Cross-tab clipboard for sections / columns / widgets using sessionStorage.
// Stored as a tagged envelope so paste knows what kind of node to insert.
import type { SectionNode, ColumnNode, WidgetNode, InnerSectionNode } from "./types";

const KEY = "builder.clipboard.v1";

type ClipKind = "section" | "inner-section" | "column" | "widget";
type ClipNode = SectionNode | InnerSectionNode | ColumnNode | WidgetNode;
export interface ClipEnvelope {
  kind: ClipKind;
  node: ClipNode;
}

/**
 * Zapisuje kopertę i zwraca, czy się udało. Nieudany zapis (limit miejsca,
 * tryb prywatny, zablokowane dane witryny) KASUJE poprzednią zawartość -
 * inaczej następne wklejenie cicho wstawiłoby wcześniej skopiowany węzeł
 * zamiast nowego. Wyjątek nie wychodzi poza funkcję (uchwyt Ctrl+C).
 */
export function copyToClipboard(env: ClipEnvelope): boolean {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(env));
    return true;
  } catch {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* magazyn niedostępny w całości - nie ma czego czyścić */
    }
    return false;
  }
}

export function readClipboard(): ClipEnvelope | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ClipEnvelope;
    if (!parsed || !parsed.kind || !parsed.node) return null;
    return parsed;
  } catch {
    return null;
  }
}
