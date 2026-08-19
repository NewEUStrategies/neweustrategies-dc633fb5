// Reguły listy wykluczeń i wspólne cytowanie CSV - warstwa czysta.
//
// Lista wykluczeń jest hamulcem bezpieczeństwa wysyłki: adres, który tu trafia,
// przestaje dostawać pocztę. Dlatego dwie reguły muszą być pewne:
//   * FILTR, bo jeśli zgubi wiersz, operator uzna, że adresu na liście nie ma,
//     i wyśle do niego kampanię,
//   * EKSPORT, bo diagnostyka dostawcy zawiera przecinki („550, mailbox full") -
//     bez cytowania plik rozjeżdża się o kolumnę i przypisuje komuś cudzy
//     powód blokady.
import { describe, it, expect } from "vitest";
import { csvCell, csvFileNameFor, toCsv } from "@/lib/csv/formatCsv";
import {
  canAddSuppression,
  filterSuppressions,
  isSuppressionListCapped,
  normalizeSuppressionEmail,
  suppressionCsvFileName,
  suppressionsToCsv,
  SUPPRESSION_CSV_COLUMNS,
  SUPPRESSION_LIST_LIMIT,
} from "@/components/admin/newsletter/deliverability/suppressionTable";
import type { SuppressionRow } from "@/lib/newsletter-deliverability.functions";

function suppression(overrides: Partial<SuppressionRow> = {}): SuppressionRow {
  return {
    id: "sup-1",
    email: "martwy@example.test",
    reason: "hard_bounce",
    scope: "permanent",
    source: "webhook",
    occurrences: 3,
    diagnostic: "550 no such user",
    note: null,
    campaignId: null,
    expiresAt: null,
    firstSeenAt: "2026-08-01T10:00:00.000Z",
    lastSeenAt: "2026-08-10T10:00:00.000Z",
    releasedAt: null,
    ...overrides,
  };
}

const LIST = [
  suppression({ id: "a", email: "anna@example.test" }),
  suppression({ id: "b", email: "borys@example.test", reason: "complaint" }),
];

// ---------------------------------------------------------------------------
// WSPÓLNA REGUŁA CYTOWANIA
// ---------------------------------------------------------------------------
describe("csvCell - wspólna reguła dla całego repo", () => {
  it("zwykła wartość idzie bez cytowania", () => {
    expect(csvCell("anna@example.test")).toBe("anna@example.test");
    expect(csvCell(42)).toBe("42");
  });

  it("przecinek w DIAGNOSTYCE dostawcy wymusza cytowanie", () => {
    // Realny przykład: „550, mailbox full" bez cytowania przesuwa cały wiersz.
    expect(csvCell("550, mailbox full")).toBe('"550, mailbox full"');
  });

  it("cudzysłów jest podwajany, nie usuwany", () => {
    expect(csvCell('powód "nieznany"')).toBe('"powód ""nieznany"""');
  });

  it("nowa linia w wartości wymusza cytowanie", () => {
    expect(csvCell("linia1\nlinia2")).toBe('"linia1\nlinia2"');
  });

  it("brak wartości daje pustą komórkę", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("toCsv", () => {
  it("pierwszy wiersz to nagłówek, dalej wiersze danych", () => {
    const csv = toCsv(
      ["a", "b"],
      [
        ["1", "2"],
        ["3", "4"],
      ],
    );

    expect(csv).toBe("a,b\n1,2\n3,4");
    expect(csv.split("\n")).toHaveLength(3);
  });

  it("bez wierszy zostaje sam nagłówek", () => {
    expect(toCsv(["a", "b"], [])).toBe("a,b");
  });

  it("liczby i braki są zapisywane bez rzutowania na „null”", () => {
    expect(toCsv(["n", "x"], [[3, null]])).toBe("n,x\n3,");
  });
});

describe("csvFileNameFor", () => {
  it("skleja prefiks z dniem eksportu", () => {
    expect(csvFileNameFor("suppressions", "2026-08-18T15:30:00.000Z")).toBe(
      "suppressions-2026-08-18.csv",
    );
  });

  it("godzina nie trafia do nazwy pliku", () => {
    expect(csvFileNameFor("newsletter", "2026-08-18T15:30:00.000Z")).not.toContain("15");
  });
});

// ---------------------------------------------------------------------------
// REGUŁY LISTY WYKLUCZEŃ
// ---------------------------------------------------------------------------
describe("filterSuppressions", () => {
  it("zawęża po fragmencie adresu, bez wielkości liter", () => {
    expect(filterSuppressions(LIST, "BORYS").map((r) => r.id)).toEqual(["b"]);
  });

  it("pusta fraza nie filtruje", () => {
    expect(filterSuppressions(LIST, "")).toHaveLength(2);
    expect(filterSuppressions(LIST, "   ")).toHaveLength(2);
  });

  it("fraza bez trafień daje pustą listę, nie całą", () => {
    expect(filterSuppressions(LIST, "nie-ma")).toEqual([]);
  });

  it("dopasowanie po domenie łapie wszystkich z tej domeny", () => {
    expect(filterSuppressions(LIST, "example.test")).toHaveLength(2);
  });
});

describe("isSuppressionListCapped", () => {
  it("poniżej limitu lista jest pełna", () => {
    expect(isSuppressionListCapped(0)).toBe(false);
    expect(isSuppressionListCapped(SUPPRESSION_LIST_LIMIT - 1)).toBe(false);
  });

  it("na limicie ostrzegamy - nie wiemy, czy nie ucięło", () => {
    expect(isSuppressionListCapped(SUPPRESSION_LIST_LIMIT)).toBe(true);
    expect(SUPPRESSION_LIST_LIMIT).toBe(300);
  });
});

describe("canAddSuppression", () => {
  it("przyjmuje adres z małpą", () => {
    expect(canAddSuppression("martwy@example.test")).toBe(true);
    expect(canAddSuppression("  martwy@example.test  ")).toBe(true);
  });

  it("odrzuca puste pole - nie wysyłamy żądania bez adresu", () => {
    expect(canAddSuppression("")).toBe(false);
    expect(canAddSuppression("   ")).toBe(false);
  });

  it("odrzuca wartość bez małpy", () => {
    expect(canAddSuppression("martwy")).toBe(false);
  });

  it("warunek jest LUŹNY z rozmysłu - twarda walidacja stoi po stronie serwera", () => {
    // Operator zakłada blokadę na podstawie logu dostawcy, gdzie bywają adresy,
    // których walidator formularza by nie przyjął.
    expect(canAddSuppression("dziwny adres@example.test")).toBe(true);
    expect(canAddSuppression("a@b")).toBe(true);
  });
});

describe("normalizeSuppressionEmail", () => {
  it("sprowadza adres do małych liter i obcina białe znaki", () => {
    expect(normalizeSuppressionEmail("  Martwy@Example.TEST ")).toBe("martwy@example.test");
  });

  it("adres już znormalizowany zostaje bez zmian", () => {
    expect(normalizeSuppressionEmail("martwy@example.test")).toBe("martwy@example.test");
  });
});

describe("suppressionsToCsv", () => {
  it("nagłówek niesie wszystkie kolumny audytu blokady", () => {
    const csv = suppressionsToCsv([suppression()]);

    expect(csv.split("\n")[0]).toBe(SUPPRESSION_CSV_COLUMNS.join(","));
    expect(SUPPRESSION_CSV_COLUMNS).toContain("diagnostic");
    expect(SUPPRESSION_CSV_COLUMNS).toContain("released_at");
  });

  it("każdy wpis to jeden wiersz z powodem i liczbą wystąpień", () => {
    const csv = suppressionsToCsv(LIST);
    const lines = csv.split("\n");

    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("hard_bounce");
    expect(lines[2]).toContain("complaint");
  });

  it("DIAGNOSTYKA z przecinkiem nie rozjeżdża kolumn", () => {
    const csv = suppressionsToCsv([suppression({ diagnostic: "550, mailbox full" })]);

    expect(csv).toContain('"550, mailbox full"');
    expect(csv.split("\n")[1]?.split('"')).toHaveLength(3);
  });

  it("brakujące pola stają się pustymi komórkami", () => {
    const csv = suppressionsToCsv([
      suppression({ diagnostic: null, expiresAt: null, releasedAt: null }),
    ]);

    expect(csv.split("\n")[1]?.endsWith(",,")).toBe(true);
  });

  it("pusta lista daje sam nagłówek", () => {
    expect(suppressionsToCsv([])).toBe(SUPPRESSION_CSV_COLUMNS.join(","));
  });
});

describe("suppressionCsvFileName", () => {
  it("plik nazywa się od listy wykluczeń, nie od newslettera", () => {
    expect(suppressionCsvFileName("2026-08-18T00:00:00.000Z")).toBe("suppressions-2026-08-18.csv");
  });

  it("nazwa nie myli się z eksportem subskrybentów", () => {
    expect(suppressionCsvFileName("2026-08-18T00:00:00.000Z")).not.toContain("newsletter");
  });
});
