import { describe, expect, it } from "vitest";
import {
  buildLeadExport,
  leadExportCells,
  leadExportColumns,
  leadExportFileName,
} from "@/lib/events/leadExport";
import type { LeadExportRow } from "@/lib/events/onsiteApi";

const withConsent: LeadExportRow = {
  sponsor_name: "Acme",
  first_name: "Anna",
  last_name: "Nowak",
  company: "NES",
  job_title: "Analityk",
  email: "anna@example.org",
  phone: "+48 500 100 200",
  consent: true,
  consent_snapshot_at: "2026-05-01T09:10:00Z",
  interest_rating: 4,
  note: "Zainteresowana raportem",
  scan_count: 2,
  first_scanned_at: "2026-05-01T09:10:00Z",
  last_scanned_at: "2026-05-01T14:02:00Z",
  device_label: "Stoisko A",
};

// Wygenerowane typy bazy nie znaja NULL-i w kolumnach RPC, a te kolumny bywaja
// puste wlasnie wtedy, gdy uczestnik nie wyrazil zgody - dlatego rzutujemy
// przez `unknown`, zeby test sprawdzil realny ksztalt danych, a nie deklaracje.
const withoutConsent = {
  ...withConsent,
  first_name: "Jan",
  last_name: "Kowalski",
  email: null,
  phone: null,
  consent: false,
  consent_snapshot_at: null,
  note: null,
  interest_rating: null,
} as unknown as LeadExportRow;

describe("leadExportColumns", () => {
  it("ma te sama liczbe kolumn w obu jezykach", () => {
    expect(leadExportColumns("pl")).toHaveLength(leadExportColumns("en").length);
    expect(leadExportColumns("en")[0]).toBe("Sponsor");
  });
});

describe("leadExportCells", () => {
  it("liczba komorek zgadza sie z liczba kolumn", () => {
    expect(leadExportCells(withConsent, "pl")).toHaveLength(leadExportColumns("pl").length);
  });

  it("wiersz bez zgody ma puste kontakty i jawne 'nie'", () => {
    const cells = leadExportCells(withoutConsent, "pl");
    expect(cells[5]).toBeNull();
    expect(cells[6]).toBeNull();
    expect(cells[7]).toBe("nie");
  });

  it("zgoda tlumaczy sie na jezyk interfejsu", () => {
    expect(leadExportCells(withConsent, "en")[7]).toBe("yes");
    expect(leadExportCells(withConsent, "pl")[7]).toBe("tak");
  });
});

describe("leadExportFileName", () => {
  it("slugifikuje prefiks i dokleja dzien", () => {
    expect(leadExportFileName("Leady sponsorów", "2026-05-01T14:00:00Z", "csv")).toBe(
      "leady-sponsorow-2026-05-01.csv",
    );
  });

  it("pusty prefiks nie tworzy pliku zaczynajacego sie od myslnika", () => {
    expect(leadExportFileName("!!!", "2026-05-01T00:00:00Z", "xlsx")).toBe("leady-2026-05-01.xlsx");
  });
});

describe("buildLeadExport", () => {
  it("CSV zaczyna sie od BOM i zawiera oba wiersze", async () => {
    const file = await buildLeadExport([withConsent, withoutConsent], {
      format: "csv",
      lang: "pl",
      prefix: "leady",
      nowIso: "2026-05-01T10:00:00Z",
    });
    expect(file.mimeType).toBe("text/csv;charset=utf-8");
    expect(typeof file.data).toBe("string");
    const text = file.data as string;
    expect(text.startsWith("\uFEFF")).toBe(true);
    expect(text).toContain("anna@example.org");
    expect(text).toContain("Kowalski");
  });

  it("XLSX zwraca bajty i nazwe z rozszerzeniem arkusza", async () => {
    const file = await buildLeadExport([withConsent], {
      format: "xlsx",
      lang: "en",
      prefix: "sponsor leads",
      nowIso: "2026-05-01T10:00:00Z",
    });
    expect(file.fileName).toBe("sponsor-leads-2026-05-01.xlsx");
    expect(file.data).toBeInstanceOf(ArrayBuffer);
    expect((file.data as ArrayBuffer).byteLength).toBeGreaterThan(0);
  });
});
