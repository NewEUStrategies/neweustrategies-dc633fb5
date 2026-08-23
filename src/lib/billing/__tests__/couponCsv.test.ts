// Arkusze CSV powierzchni kuponów - kody kampanii i historia realizacji.
//
// CO TEN PLIK DOWODZI.
//   1. KONTRAKT KOLUMN. Nagłówek realizacji nazywa kolumny po ZNACZENIU
//      (`discount` = rabat, `paid` = original - applied). Odwrócenie tych dwóch
//      kolumn nie psuje żadnego typu i nie widać go w recenzji - widać dopiero
//      w arkuszu księgowej, miesiąc później.
//   2. WARTOŚCI PUSTE. `name`, `max_redemptions`, `user_id`, `order_id` i kod
//      kuponu mogą być NULL-em; każdy z nich musi dać PUSTE POLE między
//      średnikami, a nie napis „null" ani przesunięcie kolumny.
//   3. RÓŻNICA MIĘDZY EKRANEM A EKSPORTEM. Identyfikator użytkownika jest na
//      ekranie skracany do ośmiu znaków, a do arkusza leci W CAŁOŚCI. To jest
//      decyzja o danych osobowych, nie szczegół formatowania.
//   4. DEFEKT: pola NIE SĄ CYTOWANE, a nazwa pliku nie jest sanityzowana.
//      Oba zgłoszone przez `it.fails` z sąsiadującym `it()` opisującym stan
//      faktyczny.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Arytmetyki `couponPaidCents` - ma własny plik
// (`couponMoney.test.ts`); tutaj dowodzimy wyłącznie tego, że arkusz jej UŻYWA.
// Pobrania pliku (Blob, adres obiektowy, kotwica) - to dowodzą testy tras.
//
// RODO: wszystkie identyfikatory w fixture'ach są jawnie fałszywe, bez e-maili.
import { describe, expect, it } from "vitest";
import {
  campaignCodesCsv,
  campaignCodesCsvFileName,
  redemptionsCsv,
  redemptionsCsvFileName,
  type CampaignCodeCsvRow,
  type RedemptionCsvRow,
} from "@/lib/billing/couponCsv";

function codeRow(overrides: Partial<CampaignCodeCsvRow> = {}): CampaignCodeCsvRow {
  return {
    code: "NES-A1B2",
    name: "VIP",
    active: true,
    valid_until: "2026-12-31T23:59:59.000Z",
    max_redemptions: 5,
    redemptions_count: 2,
    ...overrides,
  };
}

function redRow(overrides: Partial<RedemptionCsvRow> = {}): RedemptionCsvRow {
  return {
    created_at: "2026-08-20T10:00:00.000Z",
    user_id: "9f8e7d6c-1111-2222-3333-444455556666",
    order_id: "ord-1",
    original_cents: 10000,
    applied_cents: 2000,
    currency: "PLN",
    b2b_coupons: { code: "NES-A1B2" },
    ...overrides,
  };
}

/** Wiersze arkusza bez nagłówka - do asercji „co dokładnie zapisano". */
function bodyLines(csv: string): string[] {
  return csv.split("\n").slice(1);
}

describe("arkusz kodów kampanii", () => {
  it("pierwszy wiersz to KONTRAKT kolumn, nie napis interfejsu", () => {
    expect(campaignCodesCsv([]).split("\n")[0]).toBe(
      "code;name;active;valid_until;max_redemptions;redemptions_count",
    );
  });

  it("eksport pustej kampanii daje sam nagłówek i PUSTĄ linię - plik nie jest pusty", () => {
    expect(campaignCodesCsv([])).toBe(
      "code;name;active;valid_until;max_redemptions;redemptions_count\n",
    );
  });

  it("brak nazwy i brak limitu użyć dają PUSTE pola, nie napis 'null'", () => {
    const csv = campaignCodesCsv([codeRow({ name: null, max_redemptions: null })]);
    expect(bodyLines(csv)[0]).toBe("NES-A1B2;;true;2026-12-31T23:59:59.000Z;;2");
  });

  it("kupon nieaktywny zapisuje się jako 'false', a bezterminowy ma puste valid_until", () => {
    const csv = campaignCodesCsv([codeRow({ active: false, valid_until: null })]);
    expect(bodyLines(csv)[0]).toBe("NES-A1B2;VIP;false;;5;2");
  });

  it("każdy kupon to dokładnie jeden wiersz", () => {
    const csv = campaignCodesCsv([codeRow(), codeRow({ code: "NES-C3D4" })]);
    expect(bodyLines(csv)).toHaveLength(2);
  });
});

describe("arkusz historii realizacji", () => {
  it("nagłówek nazywa kolumny po ZNACZENIU: discount to rabat, paid to kwota zapłacona", () => {
    expect(redemptionsCsv([]).split("\n")[0]).toBe(
      "date;code;user_id;order_id;original;discount;paid;currency",
    );
  });

  it("kwoty idą w jednostkach głównych: 100 zł przed rabatem, 20 rabatu, 80 zapłacone", () => {
    expect(bodyLines(redemptionsCsv([redRow()]))[0]).toBe(
      "2026-08-20T10:00:00.000Z;NES-A1B2;9f8e7d6c-1111-2222-3333-444455556666;ord-1;100;20;80;PLN",
    );
  });

  it("rabat WIĘKSZY niż kwota zamówienia daje zapłacone 0, nie liczbę ujemną", () => {
    const csv = redemptionsCsv([redRow({ original_cents: 1000, applied_cents: 3000 })]);
    expect(bodyLines(csv)[0].split(";")[6]).toBe("0");
  });

  it("realizacja bez użytkownika i bez zamówienia daje puste pola", () => {
    const csv = redemptionsCsv([redRow({ user_id: null, order_id: null })]);
    expect(bodyLines(csv)[0].split(";").slice(2, 4)).toEqual(["", ""]);
  });

  it("EKSPORT NIESIE PEŁNY identyfikator użytkownika, choć ekran pokazuje osiem znaków", () => {
    // Decyzja o danych osobowych: arkusz wychodzi poza panel, a ekran nie.
    const csv = redemptionsCsv([redRow()]);
    expect(bodyLines(csv)[0]).toContain("9f8e7d6c-1111-2222-3333-444455556666");
  });

  it("utrata osadzonego kuponu (kształt tablicowy z PostgREST) daje PUSTY kod, bez błędu", () => {
    const csv = redemptionsCsv([redRow({ b2b_coupons: null })]);
    expect(bodyLines(csv)[0].split(";")[1]).toBe("");
  });

  it("nazwa pliku jest datowana dniem eksportu", () => {
    expect(redemptionsCsvFileName(new Date("2026-08-23T22:15:00.000Z"))).toBe(
      "coupon-redemptions-2026-08-23.csv",
    );
  });
});

describe("nazwa pliku z kodami kampanii", () => {
  it("spacje w nazwie kampanii zamieniają się na podkreślniki", () => {
    expect(campaignCodesCsvFileName("Q1 2026 VIP")).toBe("coupons-Q1_2026_VIP.csv");
  });

  // DEFEKT 1 - nazwa pliku nie jest sanityzowana. Poniższy `it.fails` opisuje
  // zachowanie OCZEKIWANE, a sąsiedni `it()` stan faktyczny. Po naprawie
  // (odfiltrowanie separatorów ścieżki) usuwa się OBA RAZEM.
  it.fails("separator ścieżki NIE POWINIEN trafiać do atrybutu download", () => {
    expect(campaignCodesCsvFileName("Q1/2026")).toBe("coupons-Q1_2026.csv");
  });

  it("STAN FAKTYCZNY: '/' i '..' przechodzą do nazwy pliku żywcem", () => {
    expect(campaignCodesCsvFileName("Q1/2026")).toBe("coupons-Q1/2026.csv");
    expect(campaignCodesCsvFileName("../tajne")).toBe("coupons-../tajne.csv");
  });
});

describe("DEFEKT: pola arkusza nie są cytowane", () => {
  // Poniższe pary `it.fails` + `it()` opisują TĘ SAMĄ wadę z dwóch stron.
  // Po naprawie (cytowanie pól zawierających separator, cudzysłów albo nową
  // linię) usuwa się każdą parę RAZEM.
  it.fails("nazwa kuponu ze ŚREDNIKIEM nie powinna rozsuwać kolumn", () => {
    const csv = campaignCodesCsv([codeRow({ name: "VIP; premium" })]);
    expect(bodyLines(csv)[0].split(";")).toHaveLength(6);
  });

  it("STAN FAKTYCZNY: średnik w nazwie tworzy SIÓDMĄ kolumnę i przesuwa całą resztę", () => {
    const csv = campaignCodesCsv([codeRow({ name: "VIP; premium" })]);
    const pola = bodyLines(csv)[0].split(";");
    expect(pola).toHaveLength(7);
    // Kolumna „active" trzyma teraz drugą połowę nazwy.
    expect(pola[2]).toBe(" premium");
  });

  it.fails("nazwa kuponu z NOWĄ LINIĄ nie powinna rozbijać wiersza na dwa", () => {
    const csv = campaignCodesCsv([codeRow({ name: "VIP\nfirmowy" })]);
    expect(bodyLines(csv)).toHaveLength(1);
  });

  it("STAN FAKTYCZNY: nowa linia w nazwie daje DWA wiersze arkusza z jednego kuponu", () => {
    const csv = campaignCodesCsv([codeRow({ name: "VIP\nfirmowy" })]);
    expect(bodyLines(csv)).toHaveLength(2);
  });

  it.fails("kod zaczynający się od '=' nie powinien trafiać do arkusza jako FORMUŁA", () => {
    const csv = campaignCodesCsv([codeRow({ code: "=1+1" })]);
    expect(bodyLines(csv)[0].startsWith("=")).toBe(false);
  });

  it("STAN FAKTYCZNY: kod z '=' wychodzi bez żadnego prefiksu ochronnego", () => {
    const csv = campaignCodesCsv([codeRow({ code: "=1+1" })]);
    expect(bodyLines(csv)[0].startsWith("=1+1;")).toBe(true);
  });
});
