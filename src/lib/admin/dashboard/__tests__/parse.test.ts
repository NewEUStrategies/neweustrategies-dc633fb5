// Testy odczytu jsonb -> kształty pulpitu.
//
// SEDNO TEGO PLIKU: parser ma przeżyć bazę ze STARSZĄ i z NOWSZĄ wersją funkcji
// agregującej, bo migracje wdrażają się osobno od aplikacji i przez kilka minut
// każdego wdrożenia obie strony się nie zgadzają.
import { describe, it, expect } from "vitest";
import {
  parseAudienceReport,
  parseContentReport,
  parseCrmReport,
  parseMarketingReport,
  parseRealtimeReport,
  parseTrafficReport,
} from "../parse";

describe("parse - brak danych nie wywraca pulpitu", () => {
  it.each([
    ["traffic", parseTrafficReport],
    ["crm", parseCrmReport],
    ["marketing", parseMarketingReport],
    ["audience", parseAudienceReport],
    ["realtime", parseRealtimeReport],
    ["content", parseContentReport],
  ])("%s: null daje pusty raport, nie wyjątek", (_name, parse) => {
    expect(() => parse(null)).not.toThrow();
    expect(() => parse(undefined)).not.toThrow();
    expect(() => parse("nonsens")).not.toThrow();
    expect(() => parse([])).not.toThrow();
  });

  it("pusty raport ruchu ma same zera i puste listy", () => {
    const r = parseTrafficReport(null);
    expect(r.current).toEqual({
      pageViews: 0,
      events: 0,
      sessions: 0,
      visitors: 0,
      members: 0,
      countries: 0,
    });
    expect(r.series).toEqual([]);
    expect(r.countries).toEqual([]);
  });
});

describe("parse - bigint z Postgresa", () => {
  // Sterownik oddaje `count(*)` raz liczbą, raz napisem (zależnie od wielkości).
  // Czytanie samego `typeof === "number"` gubiłoby duże liczniki po cichu.
  it("czyta licznik podany napisem", () => {
    const r = parseTrafficReport({ current: { sessions: "123456789", pageViews: 42 } });
    expect(r.current.sessions).toBe(123456789);
    expect(r.current.pageViews).toBe(42);
  });

  it("napis, który nie jest liczbą, schodzi do zera", () => {
    expect(parseTrafficReport({ current: { sessions: "dużo" } }).current.sessions).toBe(0);
  });
});

describe("parse - zgodność wprzód i wstecz", () => {
  it("brakujące pole (starsza funkcja w bazie) schodzi do zera", () => {
    const r = parseTrafficReport({ current: { sessions: 10 } });
    expect(r.current.sessions).toBe(10);
    expect(r.current.visitors).toBe(0);
  });

  it("nadmiarowe pole (nowsza funkcja w bazie) jest ignorowane", () => {
    const r = parseTrafficReport({ current: { sessions: 10, czegoNieZnamy: 99 } });
    expect(r.current.sessions).toBe(10);
    expect(Object.keys(r.current)).not.toContain("czegoNieZnamy");
  });
});

describe("parse - kody krajów", () => {
  it("normalizuje do wielkich liter", () => {
    const r = parseTrafficReport({ countries: [{ code: "pl", sessions: 5, page_views: 9 }] });
    expect(r.countries).toEqual([{ code: "PL", sessions: 5, pageViews: 9 }]);
  });

  // Wiersz bez poprawnego kodu nie ma jak trafić na mapę - odpada w parserze,
  // a nie w widoku, żeby każdy konsument dostał ten sam, czysty zbiór.
  it("odrzuca wiersze bez poprawnego kodu ISO-2", () => {
    const r = parseTrafficReport({
      countries: [
        { code: "PL", sessions: 1 },
        { code: "", sessions: 2 },
        { code: "POL", sessions: 3 },
        { code: null, sessions: 4 },
      ],
    });
    expect(r.countries.map((c) => c.code)).toEqual(["PL"]);
  });

  it("ten sam filtr działa dla kontaktów CRM i podglądu na żywo", () => {
    expect(parseCrmReport({ countries: [{ code: "de", leads: 2 }] }).countries).toEqual([
      { code: "DE", leads: 2 },
    ]);
    expect(parseRealtimeReport({ countries: [{ code: "x", sessions: 1 }] }).countries).toEqual([]);
  });
});

describe("parse - pieniądze", () => {
  it("czyta kwoty rozbite po walucie", () => {
    const r = parseMarketingReport({
      current: { revenue: [{ currency: "pln", cents: "150000", orders: 3 }] },
    });
    expect(r.current.revenue).toEqual([{ currency: "PLN", cents: 150000, orders: 3 }]);
  });

  // Kwota bez waluty nie jest kwotą: nie da się jej wypisać ani dodać do innej.
  it("odrzuca wiersz bez poprawnego kodu waluty", () => {
    const r = parseMarketingReport({
      current: {
        revenue: [
          { currency: "", cents: 100 },
          { currency: "EURO", cents: 200 },
        ],
      },
    });
    expect(r.current.revenue).toEqual([]);
  });
});

describe("parse - nazwy kolumn SQL na camelCase", () => {
  it("mapuje snake_case z jsonb na pola raportu", () => {
    const r = parseMarketingReport({
      campaigns: [
        {
          name: "Marzec",
          sent_count: 100,
          failed_count: 2,
          recipient_count: 102,
          finished_at: "2026-03-10 12:00",
          opens: 40,
          clicks: 9,
        },
      ],
    });
    expect(r.campaigns[0]).toEqual({
      name: "Marzec",
      sentCount: 100,
      failedCount: 2,
      recipientCount: 102,
      finishedAt: "2026-03-10 12:00",
      opens: 40,
      clicks: 9,
    });
  });

  it("szereg ruchu bierze page_views, nie pageViews", () => {
    const r = parseTrafficReport({
      series: [{ bucket: "2026-03-10 00:00", page_views: 7, sessions: 3, visitors: 2 }],
    });
    expect(r.series[0]).toEqual({
      bucket: "2026-03-10 00:00",
      pageViews: 7,
      sessions: 3,
      visitors: 2,
    });
  });
});
