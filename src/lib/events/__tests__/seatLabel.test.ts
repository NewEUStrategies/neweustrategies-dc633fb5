// Wspólna etykieta miejsca na sali.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. Stół dostaje zdanie z rzędem („rząd , miejsce 3”) - stoły rzędów nie mają.
//   2. Nieznany rodzaj sekcji z RPC daje `undefined` jako klucz i surową ścieżkę.
import { describe, expect, it } from "vitest";

import { SEAT_LABEL_KEYS, seatLabelMessage, seatLabelMessageFromRow } from "@/lib/events/seatLabel";

describe("etykieta miejsca na sali", () => {
  it("rzędy: sekcja, rząd, numer", () => {
    expect(
      seatLabelMessage({ sectionKind: "rows", sectionLabel: "A", rowLabel: "C", seatNumber: 12 }),
    ).toEqual({ key: "eventSeating.label.rows", params: { section: "A", row: "C", seat: 12 } });
  });

  it("stół: bez rzędu (pusty parametr, nie null)", () => {
    expect(
      seatLabelMessage({ sectionKind: "table", sectionLabel: "5", rowLabel: null, seatNumber: 3 }),
    ).toEqual({ key: SEAT_LABEL_KEYS.table, params: { section: "5", row: "", seat: 3 } });
  });

  it("wiersz RPC: `table` to stół, każdy inny rodzaj - rzędy", () => {
    expect(
      seatLabelMessageFromRow({ section_kind: "table", section_label: "S", row_label: null, seat_number: 1 })
        .key,
    ).toBe("eventSeating.label.table");
    expect(
      seatLabelMessageFromRow({ section_kind: "balkon", section_label: "B", row_label: "2", seat_number: 7 }),
    ).toEqual({ key: "eventSeating.label.rows", params: { section: "B", row: "2", seat: 7 } });
  });
});
