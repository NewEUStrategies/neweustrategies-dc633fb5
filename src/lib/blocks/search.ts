// Wspólne wyszukiwanie bloków dla insertera i menu slash - jedna logika
// filtrowania (etykieta i18n + typ + opis), jedno źródło dostępnych bloków.

import { BLOCK_LIST, IMPLEMENTED_BLOCKS, type BlockSpec } from "./registry";
import type { BlockType } from "./types";

/** Bloki oferowane w UI (tylko zaimplementowane) przefiltrowane zapytaniem. */
export function searchBlockSpecs(query: string, label: (type: BlockType) => string): BlockSpec[] {
  const available = BLOCK_LIST.filter((s) => IMPLEMENTED_BLOCKS.includes(s.type));
  const q = query.trim().toLowerCase();
  if (!q) return available;
  return available.filter(
    (s) =>
      label(s.type).toLowerCase().includes(q) ||
      s.type.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q),
  );
}

/**
 * Zapytanie slash z tekstu akapitu: "/nag" -> "nag", "/" -> "".
 * `null` = menu ma się zamknąć (tekst nie zaczyna się od "/", zawiera spację
 * albo kolejny "/" - użytkownik pisze zwykłą treść).
 */
export function parseSlashQuery(plain: string): string | null {
  const text = plain.replace(/\u00A0/g, " ");
  const m = text.match(/^\/([^\s/]*)$/);
  return m ? m[1] : null;
}
