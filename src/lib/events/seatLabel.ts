// Etykieta miejsca na sali - JEDEN formatter dla wszystkich powierzchni.
//
// PO CO. To samo miejsce pokazuje panel (plotno, tabela, szczegol, lista
// zgloszen), karta uczestnika, strona biletu, druk listy przy drzwiach i -
// w przyszlosci - identyfikator, skaner i przepustka w portfelu. Kazda
// powierzchnia skladajaca napis po swojemu to "Rzad A, 12" w jednym miejscu
// i "A/12" w drugim, czyli pytanie przy wejsciu "to gdzie ja siedze?".
//
// ZWRACAMY KLUCZ I PARAMETRY, NIE NAPIS. Zdanie zyje w nakladce
// `i18n-event-seating.ts` (PL/EN), a modul nie zna i18next - dzieki temu jest
// czysty, testowalny i bezpieczny dla renderu serwerowego. Klucze sa literalami
// z zamknietej mapy (bramki i18n widza je w calosci), nie szablonem.
import type { SeatSectionKind } from "@/lib/events/seatingApi";

export interface SeatLabelParts {
  sectionKind: SeatSectionKind;
  sectionLabel: string;
  rowLabel: string | null;
  seatNumber: number;
}

export const SEAT_LABEL_KEYS = {
  rows: "eventSeating.label.rows",
  table: "eventSeating.label.table",
} as const satisfies Record<SeatSectionKind, string>;

export type SeatLabelKey = (typeof SEAT_LABEL_KEYS)[SeatSectionKind];

export interface SeatLabelMessage {
  key: SeatLabelKey;
  params: { section: string; row: string; seat: number };
}

/** Czesci miejsca -> klucz zdania i jego parametry. */
export function seatLabelMessage(parts: SeatLabelParts): SeatLabelMessage {
  return {
    key: SEAT_LABEL_KEYS[parts.sectionKind],
    params: {
      section: parts.sectionLabel,
      row: parts.rowLabel ?? "",
      seat: parts.seatNumber,
    },
  };
}

/** Wiersz RPC (lookup, eksport) z kolumnami sekcji i miejsca. */
export interface SeatLabelRow {
  section_kind: string;
  section_label: string;
  row_label: string | null;
  seat_number: number;
}

/**
 * Wiersz `admin_event_seat_lookup` / `admin_event_seating_export` -> zdanie.
 * Rodzaj sekcji spoza CHECK-a traktujemy jak rzedy (bezpieczniejszy napis:
 * pokazuje i rzad, i numer).
 */
export function seatLabelMessageFromRow(row: SeatLabelRow): SeatLabelMessage {
  return seatLabelMessage({
    sectionKind: row.section_kind === "table" ? "table" : "rows",
    sectionLabel: row.section_label,
    rowLabel: row.row_label,
    seatNumber: row.seat_number,
  });
}
