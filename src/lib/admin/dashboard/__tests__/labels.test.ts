import { describe, it, expect } from "vitest";
import { bucketLabel, countryNamer, dashboardRangeLabel, labelOrKey } from "../labels";
import type { DashboardRange } from "../period";

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

describe("dashboardRangeLabel", () => {
  const WAW = "Europe/Warsaw";
  // ICU wstawia wokół myślnika zakresu cienkie spacje (U+2009) - asercja
  // sprawdza treść, nie wybór znaku odstępu.
  const flat = (text: string) => text.replace(/\s+/g, " ");

  function range(over: Partial<DashboardRange>): DashboardRange {
    return {
      period: "month",
      bucket: "day",
      current: { sinceIso: "2026-08-31T22:00:00.000Z", untilIso: "2026-09-23T10:15:00.000Z" },
      previous: { sinceIso: "2026-07-31T22:00:00.000Z", untilIso: "2026-08-23T10:15:00.000Z" },
      offsetMinutes: 120,
      complete: false,
      ...over,
    };
  }

  it("okres trwający kończy się na teraz, bez godzin", () => {
    expect(dashboardRangeLabel(range({}), "pl", WAW)).toBe("1–23 wrz 2026");
  });

  // Regresja: przesunięcie „teraz” (CET, +60) doklejone do początku
  // października (CEST, +120) dawało w podpisie 30 września.
  it("miesiąc przez zmianę czasu zaczyna się pierwszego, nie dzień wcześniej", () => {
    const october = range({
      period: "prev-month",
      current: { sinceIso: "2026-09-30T22:00:00.000Z", untilIso: "2026-10-31T23:00:00.000Z" },
      offsetMinutes: 60,
      complete: true,
    });
    expect(dashboardRangeLabel(october, "pl", WAW)).toBe("1–31 paź 2026");
  });

  // Górna granica okna domkniętego jest wyłączna (północ 1 listopada) - podpis
  // nie może obiecywać danych z dnia, którego okno nie obejmuje.
  it("okno domknięte kończy się ostatnim dniem okresu", () => {
    const october = range({
      period: "prev-month",
      current: { sinceIso: "2026-09-30T22:00:00.000Z", untilIso: "2026-10-31T23:00:00.000Z" },
      complete: true,
    });
    expect(flat(dashboardRangeLabel(october, "en", WAW))).toBe("1 – 31 Oct 2026");
  });

  it("dziś i na żywo pokazują godziny", () => {
    const today = range({
      period: "today",
      bucket: "hour",
      current: { sinceIso: "2026-09-22T22:00:00.000Z", untilIso: "2026-09-23T10:15:00.000Z" },
    });
    expect(dashboardRangeLabel(today, "pl", WAW)).toBe("23 wrz 2026, 00:00–12:15");
  });

  it("puste okno nie odwraca granic", () => {
    const empty = range({
      period: "realtime",
      bucket: "minute",
      current: { sinceIso: "2026-09-23T10:00:00.000Z", untilIso: "2026-09-23T10:00:00.000Z" },
      complete: true,
    });
    expect(() => dashboardRangeLabel(empty, "pl", WAW)).not.toThrow();
  });
});
