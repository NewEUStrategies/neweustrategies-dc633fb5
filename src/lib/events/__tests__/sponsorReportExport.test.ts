// Eksport raportu dla sponsorów (`sponsorReportExport.ts`) - pliki metryk.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. FORMUŁA W PLIKU. Nazwa sponsora pochodzi od ludzi; `=HYPERLINK(...)`
//      albo `+cmd` w komórce wykonałby się w arkuszu organizatora albo
//      sponsora. CSV i XLSX muszą neutralizować KAŻDĄ komórkę tekstową,
//      a liczby zostawić liczbami.
//   2. POLSKIE ZNAKI W EXCELU. CSV bez BOM otwiera się w Excelu jako
//      „krzaczki".
//   3. CTR 0% PRZY ZERZE WYŚWIETLEŃ - w pliku to pusta komórka, nie zero.
import { beforeEach, describe, expect, it, vi } from "vitest";

const sheet = vi.hoisted(() => ({
  calls: [] as { name: string; rows: unknown[][] }[],
}));

vi.mock("@/lib/files/spreadsheetWorker", () => ({
  writeSpreadsheetInWorker: async (name: string, rows: unknown[][]) => {
    sheet.calls.push({ name, rows });
    return new Uint8Array([1, 2, 3]);
  },
}));

import {
  adminMetricsRows,
  buildSponsorReportExport,
  publicMetricsRows,
} from "@/lib/events/sponsorReportExport";
import type { SponsorReportSeriesRow } from "@/lib/events/sponsorReportApi";

const NOW = "2099-06-15T12:00:00.000Z";

beforeEach(() => {
  sheet.calls = [];
});

describe("buildSponsorReportExport", () => {
  it("CSV: BOM, nagłówki, neutralizacja formuły, nazwa pliku z dniem", async () => {
    const file = await buildSponsorReportExport(
      ["Dzień", "Sponsor", "Wyświetlenia"],
      [
        ["2099-06-15", '=HYPERLINK("x")', 5],
        ["2099-06-16", "Żółw S.A.", null],
      ],
      { format: "csv", prefix: "Raport sponsorów", sheetName: "Raport", nowIso: NOW },
    );
    expect(file.fileName).toBe("raport-sponsorow-2099-06-15.csv");
    expect(file.mimeType).toBe("text/csv;charset=utf-8");
    const text = file.data as string;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).split(/\r?\n/);
    expect(lines[0]).toBe("Dzień,Sponsor,Wyświetlenia");
    expect(lines[1]).toContain("'=HYPERLINK");
    expect(lines[1].endsWith(",5")).toBe(true);
    expect(lines[2]).toBe("2099-06-16,Żółw S.A.,");
    expect(sheet.calls).toEqual([]);
  });

  it("XLSX: każda komórka tekstowa (także nagłówek) zneutralizowana, liczby i null bez zmian", async () => {
    const file = await buildSponsorReportExport(
      ["=Dzień", "Sponsor", "CTR"],
      [
        ["2099-06-15", "+cmd|' /C calc'!A0", 12.5],
        ["-1", "@SUM(A1)", null],
      ],
      { format: "xlsx", prefix: "sponsor-report", sheetName: "Report", nowIso: NOW },
    );
    expect(file.fileName).toBe("sponsor-report-2099-06-15.xlsx");
    expect(file.mimeType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(file.data).toEqual(new Uint8Array([1, 2, 3]));
    expect(sheet.calls).toEqual([
      {
        name: "Report",
        rows: [
          ["'=Dzień", "Sponsor", "CTR"],
          ["2099-06-15", "'+cmd|' /C calc'!A0", 12.5],
          // Zwykła liczba ujemna jako tekst nie jest formułą.
          ["-1", "'@SUM(A1)", null],
        ],
      },
    ]);
  });
});

describe("wiersze metryk", () => {
  const row = (patch: Partial<SponsorReportSeriesRow>): SponsorReportSeriesRow => ({
    clicks_total: 0,
    clicks_unique: 0,
    day: "2099-06-15",
    material_opens: 0,
    placement: "home_strip",
    sponsor_id: "s1",
    views_total: 0,
    views_unique: 0,
    ...patch,
  });

  it("panel: dzień x sponsor x miejsce, CTR w procentach, zero wyświetleń to pusty CTR", () => {
    const rows = adminMetricsRows(
      [
        row({
          views_unique: 3,
          views_total: 4,
          clicks_unique: 1,
          clicks_total: 2,
          material_opens: 1,
        }),
        row({ day: "2099-06-16", sponsor_id: "s2", placement: "materials", material_opens: 2 }),
        row({ views_total: null as unknown as number }),
      ],
      (id) => (id === "s1" ? "Acme" : "Beta"),
      (placement) => `L:${placement}`,
    );
    expect(rows).toEqual([
      ["2099-06-15", "Acme", "L:home_strip", 3, 4, 1, 2, 33.3, 1],
      ["2099-06-16", "Beta", "L:materials", 0, 0, 0, 0, null, 2],
      ["2099-06-15", "Acme", "L:home_strip", 0, 0, 0, 0, null, 0],
    ]);
  });

  it("strona sponsora: dzień po dniu z nowymi kontaktami", () => {
    expect(
      publicMetricsRows([
        { day: "2099-06-15", viewsUnique: 4, clicksUnique: 1, materialOpens: 2, leadsNew: 3 },
        { day: "2099-06-16", viewsUnique: 0, clicksUnique: 0, materialOpens: 0, leadsNew: 1 },
      ]),
    ).toEqual([
      ["2099-06-15", 4, 1, 25, 2, 3],
      ["2099-06-16", 0, 0, null, 0, 1],
    ]);
  });
});
