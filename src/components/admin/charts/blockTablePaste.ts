// WKLEJENIE TABELI NA KANWIE W ZAZNACZONY BLOK WYKRESU ALBO MAPY.
//
// Do PR2 zakres z Excela wklejony przy zaznaczonym bloku wykresu stawał się
// NOWYM blokiem tabeli pod nim - redaktor musiał go usunąć i przepisać liczby
// do arkusza wykresu ręcznie. Schowek kanwy (`useBlockClipboard`) nie zna
// jednak edytorów bloków i nie powinien: nie wie, jak wykres czyta tabelę,
// ani jak mapa rozwiązuje nazwy krajów.
//
// Dlatego to jest MOST ZDARZEŃ: hak schowka ogłasza „tabela dla bloku X",
// a edytor bloku X - jeśli jest zamontowany i umie tabelę przyjąć - ZGŁASZA
// ją sobie (`preventDefault`) i otwiera podgląd. Gdy nikt jej nie zgłosi
// (blok innego typu, edytor jeszcze bez obsługi), schowek robi to, co robił:
// wstawia blok tabeli. Żadna ze stron nie importuje drugiej.
import { useEffect, useRef } from "react";
import type { ClipboardTable } from "@/lib/charts/clipboardTable";

export const BLOCK_TABLE_PASTE_EVENT = "neh:block-table-paste";

export interface BlockTablePasteDetail {
  blockId: string;
  table: ClipboardTable;
}

/** Typy bloków, którym schowek kanwy proponuje wklejoną tabelę. */
export const TABLE_PASTE_BLOCK_TYPES: readonly string[] = ["chart", "data-map"];

/**
 * Ogłasza tabelę dla bloku. Zwraca `true`, gdy edytor bloku ją przyjął -
 * wtedy wołający nie wkleja niczego sam.
 */
export function dispatchBlockTablePaste(blockId: string, table: ClipboardTable): boolean {
  const event = new CustomEvent<BlockTablePasteDetail>(BLOCK_TABLE_PASTE_EVENT, {
    cancelable: true,
    detail: { blockId, table },
  });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

/** Edytor bloku przyjmuje tabele ogłoszone dla SWOJEGO identyfikatora. */
export function useBlockTablePaste(
  blockId: string,
  onTable: (table: ClipboardTable) => void,
): void {
  const handler = useRef(onTable);
  handler.current = onTable;
  useEffect(() => {
    const listener = (e: Event) => {
      const detail = (e as CustomEvent<BlockTablePasteDetail>).detail;
      if (detail === null || detail === undefined || detail.blockId !== blockId) return;
      e.preventDefault();
      handler.current(detail.table);
    };
    window.addEventListener(BLOCK_TABLE_PASTE_EVENT, listener);
    return () => window.removeEventListener(BLOCK_TABLE_PASTE_EVENT, listener);
  }, [blockId]);
}
