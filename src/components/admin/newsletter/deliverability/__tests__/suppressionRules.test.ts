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
    // Średnik NIE jest separatorem w tym pliku, więc nie wymusza cytowania.
    expect(csvCell("550; mailbox full")).toBe("550; mailbox full");
  });

  it("cudzysłów jest podwajany, nie usuwany", () => {
    expect(csvCell('powód "nieznany"')).toBe('"powód ""nieznany"""');
    // Podwojenie działa też, gdy cudzysłów jest jedynym znakiem wartości.
    expect(csvCell('"')).toBe('""""');
  });

  it("nowa linia w wartości wymusza cytowanie", () => {
    expect(csvCell("linia1\nlinia2")).toBe('"linia1\nlinia2"');
    // Powrót karetki (Windows) liczy się tak samo.
    expect(csvCell("linia1\r\nlinia2")).toBe('"linia1\r\nlinia2"');
  });

  it("brak wartości daje pustą komórkę", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("wiodący znak formuły dostaje apostrof, liczba NIE", () => {
    // Druga połowa wspólnej reguły: neutralizacja wstrzyknięcia formuły.
    // Pełny zestaw znaków i granice wyjątku na liczby stoją w testach modułu
    // `lib/csv/formatCsv` - tu pilnujemy, że TEN panel ich nie omija.
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("@SUM(A1:A9)")).toBe("'@SUM(A1:A9)");
    expect(csvCell("-12.5")).toBe("-12.5");
    expect(csvCell(3)).toBe("3");
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
    // Bez zbędnej pustej linii na końcu - Excel czyta ją jako puste rekordy.
    expect(toCsv(["a", "b"], []).endsWith("\n")).toBe(false);
  });

  it("liczby i braki są zapisywane bez rzutowania na „null”", () => {
    expect(toCsv(["n", "x"], [[3, null]])).toBe("n,x\n3,");
    // `undefined` schodzi na to samo - inaczej w pliku pojawia się słowo.
    expect(toCsv(["n", "x"], [[3, undefined]])).toBe("n,x\n3,");
  });
});

describe("csvFileNameFor", () => {
  it("skleja prefiks z dniem eksportu", () => {
    expect(csvFileNameFor("suppressions", "2026-08-18T15:30:00.000Z")).toBe(
      "suppressions-2026-08-18.csv",
    );
    // Prefiks jest częścią nazwy, nie ozdobą - inny prefiks daje inny plik.
    expect(csvFileNameFor("newsletter", "2026-08-18T15:30:00.000Z")).toBe(
      "newsletter-2026-08-18.csv",
    );
  });

  it("godzina nie trafia do nazwy pliku", () => {
    expect(csvFileNameFor("newsletter", "2026-08-18T15:30:00.000Z")).not.toContain("15:");
    expect(csvFileNameFor("newsletter", "2026-08-18T15:30:00.000Z")).not.toContain("T");
  });
});

// ---------------------------------------------------------------------------
// REGUŁY LISTY WYKLUCZEŃ
// ---------------------------------------------------------------------------
describe("filterSuppressions", () => {
  it("zawęża po fragmencie adresu, bez wielkości liter", () => {
    expect(filterSuppressions(LIST, "BORYS").map((r) => r.id)).toEqual(["b"]);
    // Wielkość liter we WZORCU i w danych nie ma znaczenia w żadną stronę.
    expect(filterSuppressions(LIST, "borys").map((r) => r.id)).toEqual(["b"]);
  });

  it("pusta fraza nie filtruje", () => {
    expect(filterSuppressions(LIST, "")).toHaveLength(2);
    expect(filterSuppressions(LIST, "   ")).toHaveLength(2);
  });

  it("fraza bez trafień daje pustą listę, nie całą", () => {
    expect(filterSuppressions(LIST, "nie-ma")).toEqual([]);
    // Wejście zostaje nietknięte - filtr nie mutuje listy.
    expect(LIST).toHaveLength(2);
  });

  it("dopasowanie po domenie łapie wszystkich z tej domeny", () => {
    expect(filterSuppressions(LIST, "example.test")).toHaveLength(2);
    expect(filterSuppressions(LIST, "example.test").map((r) => r.id)).toEqual(["a", "b"]);
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
    expect(canAddSuppression("example.test")).toBe(false);
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
    // Tabulator i nowa linia też są białymi znakami.
    expect(normalizeSuppressionEmail("\tMartwy@Example.test\n")).toBe("martwy@example.test");
  });

  it("adres już znormalizowany zostaje bez zmian", () => {
    expect(normalizeSuppressionEmail("martwy@example.test")).toBe("martwy@example.test");
    // Funkcja jest idempotentna - drugie przejście nic nie zmienia.
    expect(normalizeSuppressionEmail(normalizeSuppressionEmail("  A@B.TEST "))).toBe("a@b.test");
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

  it("DIAGNOSTYKA od dostawcy nie wykonuje się w arkuszu operatora", () => {
    // `reason`, `source` i `diagnostic` to tekst DOSTAWCY POCZTY, nie nasz -
    // wchodzi do bazy z webhooka, którego treści nie kontrolujemy, a wychodzi
    // do pliku otwieranego lokalnie w arkuszu.
    const csv = suppressionsToCsv([suppression({ diagnostic: '=DDE("cmd";"/c calc")' })]);

    expect(csv).toContain(`"'=DDE(`);
    expect(csv).not.toContain(`,=DDE(`);
  });

  it("liczba wystąpień zostaje liczbą - kolumna nadal się sumuje", () => {
    const csv = suppressionsToCsv([suppression({ occurrences: 12 })]);
    const cells = (csv.split("\n")[1] ?? "").split(",");

    expect(cells[SUPPRESSION_CSV_COLUMNS.indexOf("occurrences")]).toBe("12");
    expect(csv).not.toContain("'12");
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
    // Puste komórki, a nie słowo „null" w pliku dla działu prawnego.
    expect(csv).not.toContain("null");
  });

  it("pusta lista daje sam nagłówek", () => {
    expect(suppressionsToCsv([])).toBe(SUPPRESSION_CSV_COLUMNS.join(","));
    expect(suppressionsToCsv([]).split("\n")).toHaveLength(1);
  });
});

describe("suppressionCsvFileName", () => {
  it("plik nazywa się od listy wykluczeń, nie od newslettera", () => {
    expect(suppressionCsvFileName("2026-08-18T00:00:00.000Z")).toBe("suppressions-2026-08-18.csv");
    expect(suppressionCsvFileName("2026-12-31T23:59:59.000Z")).toBe("suppressions-2026-12-31.csv");
  });

  it("nazwa nie myli się z eksportem subskrybentów", () => {
    expect(suppressionCsvFileName("2026-08-18T00:00:00.000Z")).not.toContain("newsletter");
    expect(suppressionCsvFileName("2026-08-18T00:00:00.000Z")).toContain("suppressions");
  });
});
