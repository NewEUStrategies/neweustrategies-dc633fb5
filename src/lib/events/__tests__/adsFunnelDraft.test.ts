// Szkice ekranu lejka (`src/lib/events/adsFunnelDraft.ts`): kampania, koszt,
// wklejony raport.
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. KWOTA "1 234,56" ZAPISANA JAKO 1,23 ZL - separator tysiecy pomylony
//      z dziesietnym; albo 0,1 + 0,2 daje grosze obok przez arytmetyke float.
//   2. 30 LUTEGO PRZECHODZI do bazy (odmowa bez numeru wiersza w formularzu).
//   3. WKLEJKA Z NAGLOWKIEM Z GOOGLE ADS odrzucona w calosci albo naglowek
//      zapisany jako koszt.
//   4. NAZWA KONWERSJI Z PRZECINKIEM przechodzi formularz i psuje plik importu.
import { describe, expect, it } from "vitest";

import { freezeClock } from "@/test/time";
import {
  AD_COST_MAX_ROWS,
  adCampaignDraftFrom,
  adCampaignDraftToInput,
  adCostRowFromDraft,
  emptyAdCampaignDraft,
  microsToAmountText,
  parseAmount,
  parseAmountToMicros,
  parseCostDay,
  parseCostsPaste,
  validateAdCampaignDraft,
} from "@/lib/events/adsFunnelDraft";

freezeClock();

const EVENT = "3f1a0c8e-0000-4000-8000-000000000042";

describe("szkic kampanii", () => {
  it("pusty szkic: dopasowanie po utm_campaign, bez identyfikatora", () => {
    expect(emptyAdCampaignDraft()).toEqual({
      id: null,
      matchKind: "utm_campaign",
      matchValue: "",
      label: "",
      conversionActionName: "",
    });
  });

  it("szkic z kampanii i z powrotem do ladunku (zmiana niesie id, nie wydarzenie)", () => {
    const draft = adCampaignDraftFrom({
      id: "c1",
      matchKind: "google_ads_campaign_id",
      matchValue: "987654321",
      label: "PMax",
      conversionActionName: null,
      costs: [],
    });
    expect(draft.conversionActionName).toBe("");
    expect(adCampaignDraftToInput({ ...draft, label: " PMax 2 " }, EVENT)).toEqual({
      id: "c1",
      matchKind: "google_ads_campaign_id",
      matchValue: "987654321",
      label: "PMax 2",
      conversionActionName: null,
    });
    expect(
      adCampaignDraftFrom({ ...draftCampaign(), conversionActionName: "Bilet" })
        .conversionActionName,
    ).toBe("Bilet");
  });

  it("nowa kampania niesie wydarzenie, nazwa konwersji przycieta", () => {
    expect(
      adCampaignDraftToInput(
        {
          id: null,
          matchKind: "utm_campaign",
          matchValue: " Wiosna ",
          label: "W",
          conversionActionName: " Bilet ",
        },
        EVENT,
      ),
    ).toEqual({
      eventId: EVENT,
      matchKind: "utm_campaign",
      matchValue: "Wiosna",
      label: "W",
      conversionActionName: "Bilet",
    });
  });

  it("walidacja: kazda regula z kluczem bledu", () => {
    const base = {
      id: null,
      matchKind: "utm_campaign" as const,
      label: "Etykieta",
      conversionActionName: "",
    };
    expect(validateAdCampaignDraft({ ...base, matchValue: "wiosna" })).toEqual([]);
    expect(validateAdCampaignDraft({ ...base, matchValue: "  " })).toEqual([
      { field: "matchValue", errorKey: "matchValueRequired" },
    ]);
    expect(validateAdCampaignDraft({ ...base, matchValue: "jan@firma.pl" })).toEqual([
      { field: "matchValue", errorKey: "matchValueInvalid" },
    ]);
    expect(
      validateAdCampaignDraft({ ...base, matchKind: "google_ads_campaign_id", matchValue: "12a" }),
    ).toEqual([{ field: "matchValue", errorKey: "matchValueDigits" }]);
    expect(
      validateAdCampaignDraft({ ...base, matchKind: "google_ads_campaign_id", matchValue: "123" }),
    ).toEqual([]);
    expect(validateAdCampaignDraft({ ...base, matchValue: "x", label: " " })).toEqual([
      { field: "label", errorKey: "labelRequired" },
    ]);
    expect(validateAdCampaignDraft({ ...base, matchValue: "x", label: "a".repeat(121) })).toEqual([
      { field: "label", errorKey: "labelTooLong" },
    ]);
    expect(
      validateAdCampaignDraft({ ...base, matchValue: "x", conversionActionName: "Bilet, VIP" }),
    ).toEqual([{ field: "conversionActionName", errorKey: "conversionNameInvalid" }]);
  });
});

function draftCampaign() {
  return {
    id: "c1",
    matchKind: "utm_campaign" as const,
    matchValue: "wiosna",
    label: "Wiosna",
    conversionActionName: null,
    costs: [],
  };
}

describe("kwoty i dni", () => {
  it("parseAmountToMicros: separatory tysiecy i dziesietne, bez float", () => {
    expect(parseAmountToMicros("123")).toBe(123_000_000);
    expect(parseAmountToMicros("123,45")).toBe(123_450_000);
    expect(parseAmountToMicros("1 234,56")).toBe(1_234_560_000);
    expect(parseAmountToMicros("1\u00a0234.5")).toBe(1_234_500_000);
    expect(parseAmountToMicros("1,234.56")).toBe(1_234_560_000);
    expect(parseAmountToMicros("1.234,56")).toBe(1_234_560_000);
    expect(parseAmountToMicros("0.000001")).toBe(1);
    expect(parseAmountToMicros("0,1")).toBe(100_000);
  });

  it("parseAmountToMicros: odrzuca smieci", () => {
    for (const bad of ["", "abc", "12,", "-5", "1.2345678", "1".repeat(13), "1e5"]) {
      expect(parseAmountToMicros(bad)).toBeNull();
    }
  });

  it("parseAmountToMicros: ten sam separator kilka razy to tysiace, nie ulamek", () => {
    // Dotad ostatni separator byl dziesietny: "1,234,567" dawalo 1234,567.
    expect(parseAmountToMicros("1,234,567")).toBe(1_234_567_000_000);
    expect(parseAmountToMicros("1.234.567")).toBe(1_234_567_000_000);
    expect(parseAmountToMicros("12.345.678,9")).toBe(12_345_678_900_000);
    expect(parseAmountToMicros("1\u202f234\u202f567,5")).toBe(1_234_567_500_000);
  });

  it("parseAmountToMicros: zle grupy, dwa ulamki i zapis niejednoznaczny - null", () => {
    // "1,234" to 1234 albo 1,234 - bez zgadywania (dotad cicho 1,234).
    for (const bad of ["1.2.3", "1,234", "1.234", "12,34,567", "1,2.5", "1.234,5,6", "1,234."]) {
      expect(parseAmountToMicros(bad)).toBeNull();
    }
    // Trzy cyfry po separatorze nie sa niejednoznaczne, gdy czesc calkowita to 0
    // albo ma wiecej niz trzy cyfry.
    expect(parseAmountToMicros("0,123")).toBe(123_000);
    expect(parseAmountToMicros("1234.567")).toBe(1_234_567_000);
    expect(parseAmountToMicros("1,2345")).toBe(1_234_500);
  });

  it("parseAmount: jeden znacznik waluty na poczatku albo na koncu", () => {
    expect(parseAmount("12,50 zł")).toEqual({ micros: 12_500_000, currency: "PLN" });
    expect(parseAmount("PLN 12.50")).toEqual({ micros: 12_500_000, currency: "PLN" });
    expect(parseAmount("€1.234,56")).toEqual({ micros: 1_234_560_000, currency: "EUR" });
    expect(parseAmount("$1,234.56")).toEqual({ micros: 1_234_560_000, currency: null });
    expect(parseAmount("12.50eur")).toEqual({ micros: 12_500_000, currency: "EUR" });
    expect(parseAmount("12")).toEqual({ micros: 12_000_000, currency: null });
    for (const bad of ["PLN 12 zł", "PLN", "zł", "12 PL"]) expect(parseAmount(bad)).toBeNull();
  });

  it("microsToAmountText: z powrotem do pola formularza", () => {
    expect(microsToAmountText(123_000_000)).toBe("123");
    expect(microsToAmountText(123_450_000)).toBe("123.45");
    expect(microsToAmountText(123_500_000)).toBe("123.50");
    expect(microsToAmountText(1)).toBe("0.000001");
  });

  it("parseCostDay: ISO i zapis kropkowy, tylko istniejace dni", () => {
    expect(parseCostDay(" 2099-06-14 ")).toBe("2099-06-14");
    expect(parseCostDay("14.06.2099")).toBe("2099-06-14");
    expect(parseCostDay("2099-02-29")).toBeNull();
    expect(parseCostDay("2096-02-29")).toBe("2096-02-29");
    expect(parseCostDay("2100-02-29")).toBeNull();
    expect(parseCostDay("2000-02-29")).toBe("2000-02-29");
    expect(parseCostDay("2099-13-01")).toBeNull();
    expect(parseCostDay("2099-00-10")).toBeNull();
    expect(parseCostDay("2099-04-31")).toBeNull();
    expect(parseCostDay("2099-04-00")).toBeNull();
    expect(parseCostDay("14/06/2099")).toBeNull();
  });

  it("adCostRowFromDraft: wiersz albo pierwszy blad", () => {
    expect(adCostRowFromDraft({ day: "2099-06-14", amount: "12,5", currency: " pln " })).toEqual({
      row: { day: "2099-06-14", costMicros: 12_500_000, currency: "PLN" },
    });
    expect(adCostRowFromDraft({ day: "x", amount: "1", currency: "PLN" })).toEqual({
      errorKey: "dayInvalid",
    });
    expect(adCostRowFromDraft({ day: "2099-06-14", amount: "x", currency: "PLN" })).toEqual({
      errorKey: "amountInvalid",
    });
    expect(adCostRowFromDraft({ day: "2099-06-14", amount: "1", currency: "zl" })).toEqual({
      errorKey: "currencyInvalid",
    });
    // Waluta przy kwocie zgodna z waluta wiersza - przechodzi; niezgodna - blad waluty.
    expect(adCostRowFromDraft({ day: "2099-06-14", amount: "12,50 zł", currency: "PLN" })).toEqual({
      row: { day: "2099-06-14", costMicros: 12_500_000, currency: "PLN" },
    });
    expect(adCostRowFromDraft({ day: "2099-06-14", amount: "EUR 5", currency: "PLN" })).toEqual({
      errorKey: "currencyInvalid",
    });
  });
});

describe("parseCostsPaste - wklejony raport", () => {
  it("srednik (polski Excel), naglowek pominiety, waluta domyslna i liczniki", () => {
    const got = parseCostsPaste(
      [
        "Dzien;Koszt;Waluta;Klikniecia;Wyswietlenia",
        "2099-06-13;123,45;;40;1 000",
        "",
        "2099-06-14;10;eur",
      ].join("\r\n"),
      "PLN",
    );
    expect(got.errors).toEqual([]);
    expect(got.rows).toEqual([
      {
        day: "2099-06-13",
        costMicros: 123_450_000,
        currency: "PLN",
        clicks: 40,
        impressions: 1000,
      },
      {
        day: "2099-06-14",
        costMicros: 10_000_000,
        currency: "EUR",
        clicks: null,
        impressions: null,
      },
    ]);
  });

  it("tabulator (kopia z arkusza) i przecinek (kwota z kropka), cudzyslowy zdjete", () => {
    expect(parseCostsPaste("2099-06-13\t5.5\tPLN", "PLN").rows[0]?.costMicros).toBe(5_500_000);
    expect(parseCostsPaste('"2099-06-13","5.25","PLN"', "PLN").rows[0]?.costMicros).toBe(5_250_000);
  });

  it("bledy z numerem wiersza; druga linia bez daty to blad, nie naglowek", () => {
    const got = parseCostsPaste(
      [
        "2099-06-13;1;PLN",
        "naglowek w srodku;1",
        "2099-06-14;abc;PLN",
        "2099-06-15;1;zlote",
        "2099-06-16;1;PLN;-3",
        "2099-06-17;1;PLN;1;x",
        "2099-06-13;2;PLN",
      ].join("\n"),
      "PLN",
    );
    expect(got.errors).toEqual([
      { line: 2, errorKey: "dayInvalid" },
      { line: 3, errorKey: "amountInvalid" },
      { line: 4, errorKey: "currencyInvalid" },
      { line: 5, errorKey: "countInvalid" },
      { line: 6, errorKey: "countInvalid" },
      { line: 7, errorKey: "dayDuplicate" },
    ]);
    expect(got.rows).toHaveLength(1);
  });

  it("kwota z waluta: zgodna przechodzi, niezgodna z kolumna/domyslna to blad waluty", () => {
    const got = parseCostsPaste(
      ["2099-06-13;12,50 zł", "2099-06-14;EUR 5;PLN", "2099-06-15;1,234"].join("\n"),
      "PLN",
    );
    expect(got.rows).toEqual([
      {
        day: "2099-06-13",
        costMicros: 12_500_000,
        currency: "PLN",
        clicks: null,
        impressions: null,
      },
    ]);
    expect(got.errors).toEqual([
      { line: 2, errorKey: "currencyInvalid" },
      { line: 3, errorKey: "amountInvalid" },
    ]);
  });

  it("wiersz z sama data (bez kwoty) to zla kwota, nie wyjatek", () => {
    expect(parseCostsPaste("2099-06-13", "PLN").errors).toEqual([
      { line: 1, errorKey: "amountInvalid" },
    ]);
  });

  it("naglowek po bledzie nie jest juz naglowkiem", () => {
    expect(parseCostsPaste("2099-06-13;x\nDzien;Koszt", "PLN").errors).toEqual([
      { line: 1, errorKey: "amountInvalid" },
      { line: 2, errorKey: "dayInvalid" },
    ]);
  });

  it("pusta wklejka i sam naglowek to 'brak wierszy'", () => {
    expect(parseCostsPaste("", "PLN").errors).toEqual([{ line: 1, errorKey: "noRows" }]);
    expect(parseCostsPaste("Day,Cost", "PLN").errors).toEqual([{ line: 1, errorKey: "noRows" }]);
  });

  it("wiecej niz 500 dni to blad calego wsadu", () => {
    const lines: string[] = [];
    for (let i = 0; i <= AD_COST_MAX_ROWS; i += 1) {
      const day = new Date(Date.UTC(2090, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
      lines.push(`${day};1;PLN`);
    }
    const got = parseCostsPaste(lines.join("\n"), "PLN");
    expect(got.rows).toHaveLength(AD_COST_MAX_ROWS + 1);
    expect(got.errors).toEqual([{ line: AD_COST_MAX_ROWS + 1, errorKey: "tooManyRows" }]);
  });
});
