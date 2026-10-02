// Formatowanie kwot i list benefitów planu na danych, których panel NIE
// waliduje do końca.
//
// RYZYKO. Kolumny `access_plans.currency` i `features_pl/en` są redagowane
// ręcznie. Kod waluty spoza ISO 4217 („zł", „PL", pusty napis) sprawia, że
// `Intl.NumberFormat` rzuca `RangeError` - bez osłony jeden źle wpisany plan
// wywraca całą kartę cennika (a z nią przycisk zakupu WSZYSTKICH planów
// w siatce). Lista benefitów zapisana jako `null` albo z wpisem nie-tekstowym
// nie może trafić do `map()` na karcie. Te osłony są jedyną barierą między
// literówką w panelu a pustą stroną cennika.
import { describe, expect, it } from "vitest";

import {
  formatMoney,
  formatMoneyWhole,
  planDescription,
  planFeatures,
  planName,
} from "@/lib/billing/types";

describe("formatMoney - kwota z groszami (faktury, cena roczna)", () => {
  it("kod waluty spoza ISO NIE rzuca - zostaje kwota z groszami i surowy kod", () => {
    expect(() => formatMoney(4950, "zł", "pl")).not.toThrow();
    expect(formatMoney(4950, "zł", "pl")).toBe("49.50 zł");
  });
});

describe("formatMoneyWhole - kwota przybliżona bez groszy", () => {
  it("poprawny kod waluty formatuje się przez Intl, bez części ułamkowej", () => {
    const out = formatMoneyWhole(4900, "PLN", "pl");

    expect(out).toMatch(/49/);
    expect(out).toMatch(/zł|PLN/);
    expect(out).not.toMatch(/[.,]\d/);
  });

  it("kod waluty spoza ISO (np. „zł” wpisane w panelu) NIE rzuca - zostaje liczba i surowy kod", () => {
    expect(() => formatMoneyWhole(4950, "zł", "pl")).not.toThrow();
    expect(formatMoneyWhole(4950, "zł", "pl")).toBe("50 zł");
  });

  it("zapas zaokrągla do NAJBLIŻSZEJ pełnej jednostki i nie pokazuje ułamka", () => {
    expect(formatMoneyWhole(4949, "PL", "en")).toBe("49 PL");
    expect(formatMoneyWhole(10750, "PL", "pl")).toBe("108 PL");
  });
});

describe("planFeatures - lista benefitów planu", () => {
  it("lista zapisana jako null (pusty jsonb) daje pustą listę zamiast wyjątku", () => {
    const plan = {
      features_pl: null as unknown as string[],
      features_en: ["Analyses"],
    };

    expect(planFeatures(plan, "pl")).toEqual([]);
    expect(planFeatures(plan, "en")).toEqual(["Analyses"]);
  });

  it("obiekt zamiast tablicy też daje pustą listę", () => {
    const plan = {
      features_pl: { 0: "Analizy" } as unknown as string[],
      features_en: [],
    };

    expect(planFeatures(plan, "pl")).toEqual([]);
  });

  it("wpisy nie-tekstowe wypadają, tekstowe zostają w kolejności", () => {
    const plan = {
      features_pl: ["Analizy", 7, null, "Kluby"] as unknown as string[],
      features_en: [],
    };

    expect(planFeatures(plan, "pl")).toEqual(["Analizy", "Kluby"]);
  });
});

describe("planDescription - opis planu w języku strony", () => {
  it("brak opisu w danym języku to pusty napis, nie „null” na karcie", () => {
    const plan = { description_pl: null, description_en: "Full access" };

    expect(planDescription(plan, "pl")).toBe("");
    expect(planDescription(plan, "en")).toBe("Full access");
  });
});

describe("planName - nazwa planu w języku strony", () => {
  it("plan bez angielskiej nazwy pokazuje po angielsku nazwę polską, a nie pusty nagłówek", () => {
    expect(planName({ name_pl: "Członek", name_en: "" }, "en")).toBe("Członek");
  });
});
