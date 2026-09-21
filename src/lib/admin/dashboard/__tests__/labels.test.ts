import { describe, it, expect } from "vitest";
import { bucketLabel, countryNamer, labelOrKey } from "../labels";

describe("bucketLabel", () => {
  it("minuta i godzina pokazują godzinę", () => {
    expect(bucketLabel("2026-03-10 14:35", "minute")).toBe("14:35");
    expect(bucketLabel("2026-03-10 14:00", "hour")).toBe("14:00");
  });

  it("doba i tydzień pokazują miesiąc-dzień", () => {
    expect(bucketLabel("2026-03-10 00:00", "day")).toBe("03-10");
    expect(bucketLabel("2026-03-09 00:00", "week")).toBe("03-09");
  });

  it("miesiąc pokazuje rok-miesiąc", () => {
    expect(bucketLabel("2026-03-01 00:00", "month")).toBe("2026-03");
  });

  // Kubełek jest czasem ŚCIENNYM - przesunięcie doliczył już SQL. Etykieta nie
  // może więc parsować go do `Date`, bo doliczyłaby strefę drugi raz.
  it("nie przelicza stref - czyta napis dosłownie", () => {
    expect(bucketLabel("2026-03-10 23:30", "hour")).toBe("23:30");
  });

  it("znosi zapis niepełny", () => {
    expect(() => bucketLabel("", "day")).not.toThrow();
  });
});

describe("labelOrKey", () => {
  // Etapy lejka i role przybywają migracją, a słownik panelu jest osobnym
  // plikiem. Brak tłumaczenia ma dać BRZYDKI wiersz, nigdy znikający wiersz.
  it("nieprzetłumaczony klucz wraca jako wartość surowa", () => {
    expect(
      labelOrKey("adminDashboard.crm.stage.nowy", "adminDashboard.crm.stage.nowy", "nowy"),
    ).toBe("nowy");
  });

  it("przetłumaczony klucz wraca jako tłumaczenie", () => {
    expect(labelOrKey("Nowy", "adminDashboard.crm.stage.new", "new")).toBe("Nowy");
  });
});

describe("countryNamer", () => {
  it("tłumaczy kod kraju na nazwę", () => {
    expect(countryNamer("en")("PL")).toBe("Poland");
  });

  it("nieznany kod wraca jako kod, a nie jako pustka", () => {
    const name = countryNamer("en")("ZZ");
    expect(name).toBeTruthy();
  });
});
