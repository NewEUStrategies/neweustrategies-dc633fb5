// Eksport CSV planu sali.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. Nazwa firmy „=HYPERLINK(...)” staje się formułą w arkuszu organizatora.
//   2. Lista przy drzwiach zawiera wolne miejsca albo nie jest alfabetyczna -
//      hostessa szuka nazwiska po całym pliku.
//   3. Nazwa pliku z polskimi znakami i spacjami psuje się w katalogu Pobrane.
import { describe, expect, it } from "vitest";

import {
  SEATING_CSV_COLUMNS,
  seatingCsvFileName,
  seatingCsvRows,
  seatingExportToCsv,
  seatingPersonName,
} from "@/lib/events/seatingCsv";
import { seatExportRow } from "@/test/events/seatingFixtures";

const FREE = seatExportRow({
  seat_id: "seat-free",
  registration_id: null,
  first_name: null,
  last_name: null,
  email: null,
  company: null,
  company_id: null,
  ticket_name_pl: null,
  ticket_name_en: null,
  registration_status: null,
  row_label: null,
  category_name_pl: null,
  category_name_en: null,
  seat_status: "held",
  hold_company_name: "Firma Dwa",
  hold_note: "Stół partnera",
  is_accessible: true,
  section_kind: "table",
});

describe("eksport CSV planu sali", () => {
  it("lista przy drzwiach: tylko zajęte, alfabetycznie po nazwisku i imieniu", () => {
    const rows = [
      seatExportRow({ last_name: "Żak", first_name: "Ola", seat_id: "s1" }),
      FREE,
      seatExportRow({ last_name: "Adamska", first_name: "Zofia", seat_id: "s2" }),
      seatExportRow({ last_name: "Adamska", first_name: "Anna", seat_id: "s3" }),
    ];
    expect(seatingCsvRows(rows, "door", "pl").map((row) => row.seat_id)).toEqual([
      "s3",
      "s2",
      "s1",
    ]);
    expect(seatingCsvRows(rows, "door", "en").map((row) => row.seat_id)).toEqual([
      "s3",
      "s2",
      "s1",
    ]);
    expect(seatingCsvRows(rows, "seats", "pl")).toHaveLength(4);
  });

  it("kolumny w stałej kolejności, formuły zneutralizowane, język etykiet", () => {
    const csv = seatingExportToCsv([seatExportRow({ company: '=HYPERLINK("http://zlo")' }), FREE], {
      mode: "seats",
      lang: "en",
      seatText: (row) => `seat ${row.seat_number}`,
    });
    const [header, first, second] = csv.split("\n");
    expect(header).toBe(SEATING_CSV_COLUMNS.join(","));
    expect(first).toContain("'=HYPERLINK");
    expect(first).toContain("VIP zone");
    expect(first).toContain("VIP pass");
    expect(first).toContain(",no,");
    expect(second).toContain(",yes,");
    expect(second).toContain("Firma Dwa");
    const pl = seatingExportToCsv([seatExportRow({ ticket_name_pl: "", category_name_pl: null })], {
      mode: "seats",
      lang: "pl",
      seatText: () => "x",
    });
    // Pusta wartość w języku eksportu -> druga wersja językowa.
    expect(pl).toContain("VIP pass");
    expect(pl).toContain("VIP zone");
  });

  it("nazwa osoby i pliku", () => {
    expect(seatingPersonName(seatExportRow())).toBe("Kowalska Anna");
    expect(seatingPersonName(FREE)).toBe("");
    expect(seatingCsvFileName("kongres", "Sala Główna Łódź", "door", "2099-06-15T12:00:00Z")).toBe(
      "plan-sali-kongres-sala-glowna-lodz-door-2099-06-15.csv",
    );
    expect(seatingCsvFileName("  ", "!!!", "company", "2099-06-15T12:00:00Z")).toBe(
      "plan-sali-event-plan-company-2099-06-15.csv",
    );
  });
});
