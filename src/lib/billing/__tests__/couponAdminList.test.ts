// Reguły listy kuponów B2B - filtr, cztery kafle i formatowanie wartości.
//
// CO TEN PLIK DOWODZI.
//   1. LISTA I KAFEL „WYGASŁE” MÓWIĄ DWIE RÓŻNE RZECZY O TYM SAMYM WIERSZU.
//      Filtr odrzuca wiersz warunkiem `>= now`, licznik przyjmuje go warunkiem
//      `< now`. Dla daty nieparsowalnej (`NaN`) oba są fałszem, więc wiersz
//      WIDNIEJE na liście „Wygasłe”, a kafel „Wygasłe” stoi na zerze. Ten błąd
//      przechodzi przez tsc i recenzję, bo obie linie z osobna wyglądają
//      poprawnie - widać go dopiero z dwóch stron naraz.
//   2. KAFLE LICZĄ SIĘ NA PEŁNYM ZBIORZE, NIE NA PRZEFILTROWANYM: zmiana filtra
//      nie może zmieniać liczby kuponów w systemie.
//   3. TRZY WARTOŚCI FILTRA WYBIERAJĄ ROZŁĄCZNE ZBIORY, a „wygasłe” IGNORUJE
//      flagę aktywności - kupon nieaktywny i przeterminowany jest „wygasły”,
//      nie „nieaktywny”. To decyzja, po której operator ocenia, co jeszcze
//      działa.
//   4. FORMATOWANIE KWOTY KŁAMIE NA WARTOŚCIACH BRZEGOWYCH: brak centów udaje
//      darmowy kupon (0.00), brak waluty zostawia wiszącą liczbę, kwota ujemna
//      wychodzi na ekran, a rabat procentowy bez wartości wypisuje „null%”.
//      Repo ma poprawny formatter z walutą (`formatDiscountLabel`), którego ten
//      panel nie używa.
//   5. DATA NIEPARSOWALNA NIE RZUCA - wypisuje „Invalid Date”.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) `formatDiscountLabel` z `coupons.ts` - ma
// własny dowód i nie jest tu używany (to właśnie jest przedmiotem uwagi).
// (2) Renderu komórek - atomy mają `couponAtoms.test.tsx`. (3) Zapytania listy
// (kolumny, `order`, `limit`) - to test trasy.
import { describe, expect, it } from "vitest";
import {
  couponListStats,
  filterCoupons,
  formatCouponAmount,
  formatCouponDate,
  formatCouponDiscount,
  type CouponListRow,
} from "@/lib/billing/couponAdminList";

/** Chwila odniesienia dla wszystkich testów zakresu ważności. */
const TERAZ = Date.parse("2026-08-23T12:00:00.000Z");

function wiersz(overrides: Partial<CouponListRow> = {}): CouponListRow {
  return {
    code: "NES-B2B-10",
    name: null,
    active: true,
    redemptions_count: 0,
    valid_until: null,
    ...overrides,
  };
}

const AKTYWNY_BIEZACY = wiersz({ code: "A-BIEZ", active: true, valid_until: null });
const NIEAKTYWNY_BIEZACY = wiersz({ code: "N-BIEZ", active: false, valid_until: null });
const AKTYWNY_WYGASLY = wiersz({
  code: "A-WYG",
  active: true,
  valid_until: "2026-01-01T00:00:00.000Z",
});
const NIEAKTYWNY_WYGASLY = wiersz({
  code: "N-WYG",
  active: false,
  valid_until: "2026-01-01T00:00:00.000Z",
});
const WSZYSTKIE = [AKTYWNY_BIEZACY, NIEAKTYWNY_BIEZACY, AKTYWNY_WYGASLY, NIEAKTYWNY_WYGASLY];

function kody(rows: CouponListRow[]): string[] {
  return rows.map((r) => r.code);
}

describe("filtr statusu wybiera rozłączne zbiory", () => {
  it.each([
    ["all", ["A-BIEZ", "N-BIEZ", "A-WYG", "N-WYG"]],
    ["active", ["A-BIEZ", "A-WYG"]],
    ["inactive", ["N-BIEZ", "N-WYG"]],
    ["expired", ["A-WYG", "N-WYG"]],
  ] as const)("filtr %s pokazuje %j", (status, oczekiwane) => {
    expect(kody(filterCoupons(WSZYSTKIE, { search: "", status }, TERAZ))).toEqual(oczekiwane);
  });

  it("„wygasłe” IGNORUJE aktywność - kupon aktywny po terminie też tam jest", () => {
    const wynik = filterCoupons(WSZYSTKIE, { search: "", status: "expired" }, TERAZ);
    expect(kody(wynik)).toContain("A-WYG");
  });

  it("kupon bez daty końcowej NIGDY nie jest wygasły (∞ to nie przeszłość)", () => {
    expect(
      filterCoupons([wiersz({ valid_until: null })], { search: "", status: "expired" }, TERAZ),
    ).toEqual([]);
  });

  it("data końcowa DOKŁADNIE w chwili odniesienia jeszcze NIE jest wygaśnięciem", () => {
    const row = wiersz({ valid_until: new Date(TERAZ).toISOString() });
    expect(filterCoupons([row], { search: "", status: "expired" }, TERAZ)).toEqual([]);
  });
});

describe("szukanie po kodzie i nazwie", () => {
  it("fraza znajduje kupon po KODZIE bez rozróżniania wielkości liter", () => {
    const rows = [wiersz({ code: "NES-VIP" }), wiersz({ code: "NES-STD" })];
    expect(kody(filterCoupons(rows, { search: "vip", status: "all" }, TERAZ))).toEqual(["NES-VIP"]);
  });

  it("ta sama fraza znajduje kupon po NAZWIE", () => {
    const rows = [wiersz({ code: "X-1", name: "Kampania VIP" }), wiersz({ code: "X-2" })];
    expect(kody(filterCoupons(rows, { search: "vip", status: "all" }, TERAZ))).toEqual(["X-1"]);
  });

  it("wiersz bez nazwy nie wywala filtra (null liczy się jak pusty napis)", () => {
    const rows = [wiersz({ code: "X-1", name: null })];
    expect(filterCoupons(rows, { search: "vip", status: "all" }, TERAZ)).toEqual([]);
  });

  it("szukanie łączy się z filtrem statusu (koniunkcja, nie alternatywa)", () => {
    const wynik = filterCoupons(WSZYSTKIE, { search: "wyg", status: "active" }, TERAZ);
    expect(kody(wynik)).toEqual(["A-WYG"]);
  });
});

describe("kafle nad listą", () => {
  it("liczby liczą się na PEŁNYM zbiorze - filtr ich nie rusza", () => {
    expect(couponListStats(WSZYSTKIE, TERAZ)).toEqual({
      total: 4,
      active: 2,
      redemptions: 0,
      expired: 2,
    });
  });

  it("łączne użycia sumują kolumnę realizacji, a brak wartości liczy się jako zero", () => {
    const rows = [
      wiersz({ redemptions_count: 3 }),
      wiersz({ redemptions_count: 0 }),
      wiersz({ redemptions_count: 7 }),
    ];
    expect(couponListStats(rows, TERAZ).redemptions).toBe(10);
  });

  it("pusta lista daje same zera, a nie NaN", () => {
    expect(couponListStats([], TERAZ)).toEqual({
      total: 0,
      active: 0,
      redemptions: 0,
      expired: 0,
    });
  });
});

describe("DEFEKT: data nieparsowalna rozjeżdża listę i kafel", () => {
  const uszkodzony = [wiersz({ code: "USZKODZONY", valid_until: "garbage" })];

  it.fails("wiersz pokazany jako wygasły powinien być policzony w kaflu „Wygasłe”", () => {
    const naLiscie = filterCoupons(uszkodzony, { search: "", status: "expired" }, TERAZ).length;
    expect(couponListStats(uszkodzony, TERAZ).expired).toBe(naLiscie);
  });

  it("STAN FAKTYCZNY: lista pokazuje wiersz, kafel stoi na zerze", () => {
    // `NaN >= now` jest fałszem, więc filtr wiersza NIE odrzuca.
    expect(kody(filterCoupons(uszkodzony, { search: "", status: "expired" }, TERAZ))).toEqual([
      "USZKODZONY",
    ]);
    // `NaN < now` też jest fałszem, więc licznik go NIE liczy.
    expect(couponListStats(uszkodzony, TERAZ).expired).toBe(0);
  });
});

describe("formatowanie rabatu - liczby, po których operator decyduje", () => {
  it("rabat procentowy wypisuje wartość ze znakiem procentu", () => {
    expect(formatCouponDiscount("percent", 20, null, null)).toBe("20%");
  });

  it.fails("rabat procentowy BEZ wartości powinien pokazać znak zastępczy", () => {
    expect(formatCouponDiscount("percent", null, null, null)).not.toContain("null");
  });

  it("STAN FAKTYCZNY: procent null wypisuje literalne „null%”", () => {
    expect(formatCouponDiscount("percent", null, null, null)).toBe("null%");
  });

  it("rabat kwotowy dzieli grosze przez sto i dokleja walutę", () => {
    expect(formatCouponDiscount("fixed", null, 2500, "PLN")).toBe("25.00 PLN");
  });

  it.fails("brak kwoty NIE powinien wyglądać jak kupon darmowy", () => {
    expect(formatCouponAmount(null, "PLN")).not.toBe("0.00 PLN");
  });

  it("STAN FAKTYCZNY: brak kwoty wypisuje 0.00, czyli rabat pełny w oczach operatora", () => {
    expect(formatCouponAmount(null, "PLN")).toBe("0.00 PLN");
  });

  it.fails("kwota bez waluty NIE powinna zostawiać wiszącej liczby", () => {
    expect(formatCouponAmount(1000, null).trim()).not.toBe("10.00");
  });

  it("STAN FAKTYCZNY: brak waluty daje „10.00 ” z wiszącą spacją", () => {
    expect(formatCouponAmount(1000, null)).toBe("10.00 ");
  });

  it.fails("kwota UJEMNA nie powinna wychodzić na ekran jako rabat", () => {
    expect(formatCouponAmount(-2500, "PLN")).not.toContain("-");
  });

  it("STAN FAKTYCZNY: kwota ujemna wypisuje się wprost („-25.00 PLN”)", () => {
    expect(formatCouponAmount(-2500, "PLN")).toBe("-25.00 PLN");
  });
});

describe("formatowanie daty", () => {
  it("ten sam ISO daje RÓŻNE napisy dla polskiego i angielskiego interfejsu", () => {
    const iso = "2026-01-05T10:00:00.000Z";
    expect(formatCouponDate(iso, "pl")).not.toBe(formatCouponDate(iso, "en"));
  });

  it.fails("data nieparsowalna powinna oddać znak zastępczy, nie napis diagnostyczny", () => {
    expect(formatCouponDate("garbage", "pl")).not.toBe("Invalid Date");
  });

  it("STAN FAKTYCZNY: nieparsowalna data NIE rzuca - wypisuje „Invalid Date”", () => {
    expect(() => formatCouponDate("garbage", "pl")).not.toThrow();
    expect(formatCouponDate("garbage", "pl")).toBe("Invalid Date");
  });
});
