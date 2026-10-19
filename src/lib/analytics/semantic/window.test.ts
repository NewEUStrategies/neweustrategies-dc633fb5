// Kanoniczne okno czasowe. Testy pilnują trzech naprawionych klas błędów:
//  1. okno poprzednie NIE nakłada się na bieżące (dzień graniczny nie może
//     wpaść do obu przedziałów - to zawyżało bazę każdej delty % w GA4),
//  2. zakres dat GA4 jest wyprowadzony z TYCH SAMYCH instantów co granice ISO,
//  3. okno, na którym porównanie międzystrumieniowe jest nieuczciwe (dzień
//     otwarty, ziarno godzinowe), jest jawnie oznaczone.
import { afterEach, describe, expect, it } from "vitest";
import {
  ga4RangeFromInstants,
  legacyRpcWindow,
  previousWindow,
  resolveCalendarWindow,
  resolveCustomWindow,
  resolveWindow,
  toLocalIsoDate,
  utcDateString,
  windowsOverlap,
} from ".";

// Środa, 2026-07-15 14:37:00 UTC - „teraz” wstrzykiwane do wszystkich testów.
const NOW = Date.parse("2026-07-15T14:37:00.000Z");

describe("resolveWindow - presety dobowe", () => {
  it("28 dni obejmuje 28 PEŁNYCH dni UTC i kończy się wczoraj", () => {
    const w = resolveWindow({ presetId: "28d", nowMs: NOW });
    expect(w.sinceIso).toBe("2026-06-17T00:00:00.000Z");
    expect(w.untilIso).toBe("2026-07-14T23:59:59.999Z");
    expect(w.days).toBe(28);
    expect(w.grain).toBe("day");
    expect(w.crossStreamSafe).toBe(true);
    expect(w.notes).toContain("excludes_open_day");
    expect(w.notes).not.toContain("ga4_open_day");
  });

  it("zakres GA4 pokrywa się dokładnie z granicami ISO", () => {
    const w = resolveWindow({ presetId: "7d", nowMs: NOW });
    expect(w.ga4).toEqual({ startDate: "2026-07-08", endDate: "2026-07-14" });
    expect(utcDateString(Date.parse(w.sinceIso))).toBe(w.ga4.startDate);
    expect(utcDateString(Date.parse(w.untilIso))).toBe(w.ga4.endDate);
  });

  it("dołączenie dnia otwartego wyłącza porównania międzystrumieniowe", () => {
    const w = resolveWindow({ presetId: "30d", nowMs: NOW, includeOpenDay: true });
    expect(w.ga4.endDate).toBe("2026-07-15");
    expect(w.untilIso).toBe(new Date(NOW).toISOString());
    expect(w.crossStreamSafe).toBe(false);
    expect(w.notes).toContain("ga4_open_day");
  });

  it("każdy preset dobowy zwraca dokładnie tyle dni, ile obiecuje etykieta", () => {
    for (const [preset, days] of [
      ["7d", 7],
      ["28d", 28],
      ["30d", 30],
      ["90d", 90],
    ] as const) {
      const w = resolveWindow({ presetId: preset, nowMs: NOW });
      const spanMs = Date.parse(w.untilIso) - Date.parse(w.sinceIso) + 1;
      expect(w.days, preset).toBe(days);
      expect(spanMs / 86_400_000, preset).toBe(days);
    }
  });
});

describe("resolveWindow - preset godzinowy", () => {
  it("24 h jest kroczące i NIE nadaje się do uzgadniania z GA4", () => {
    const w = resolveWindow({ presetId: "24h", nowMs: NOW });
    expect(w.grain).toBe("instant");
    expect(w.crossStreamSafe).toBe(false);
    expect(w.sinceIso).toBe("2026-07-14T14:37:00.000Z");
    expect(w.untilIso).toBe("2026-07-15T14:37:00.000Z");
    expect(w.notes).toContain("instant_grain_not_available_in_ga4");
  });
});

describe("previousWindow", () => {
  it("okno poprzednie jest ROZŁĄCZNE z bieżącym", () => {
    const current = resolveWindow({ presetId: "28d", nowMs: NOW });
    const prev = previousWindow(current);
    expect(windowsOverlap(current, prev)).toBe(false);
    expect(prev.untilIso).toBe("2026-06-16T23:59:59.999Z");
    expect(prev.sinceIso).toBe("2026-05-20T00:00:00.000Z");
  });

  it("zakresy dat GA4 dla obu okien nie mają wspólnego dnia", () => {
    // Regresja: `[28daysAgo, today]` vs `[56daysAgo, 28daysAgo]` dzieliły dzień
    // graniczny, bo oba przedziały GA4 są domknięte.
    const current = resolveWindow({ presetId: "28d", nowMs: NOW });
    const prev = previousWindow(current);
    expect(prev.ga4.endDate < current.ga4.startDate).toBe(true);
    expect(prev.ga4).toEqual({ startDate: "2026-05-20", endDate: "2026-06-16" });
  });

  it("okno poprzednie ma tę samą długość co bieżące", () => {
    for (const preset of ["7d", "28d", "30d", "90d"] as const) {
      const current = resolveWindow({ presetId: preset, nowMs: NOW });
      const prev = previousWindow(current);
      const curSpan = Date.parse(current.untilIso) - Date.parse(current.sinceIso);
      const prevSpan = Date.parse(prev.untilIso) - Date.parse(prev.sinceIso);
      expect(prevSpan, preset).toBe(curSpan);
    }
  });

  it("okno poprzednie jest zawsze domknięte, więc wraca do porównywalności", () => {
    const current = resolveWindow({ presetId: "7d", nowMs: NOW, includeOpenDay: true });
    expect(current.crossStreamSafe).toBe(false);
    const prev = previousWindow(current);
    expect(prev.crossStreamSafe).toBe(true);
    expect(prev.notes).not.toContain("ga4_open_day");
  });

  it("dla okna kroczącego przesuwa granice o dokładnie jedną długość", () => {
    const current = resolveWindow({ presetId: "24h", nowMs: NOW });
    const prev = previousWindow(current);
    expect(windowsOverlap(current, prev)).toBe(false);
    expect(Date.parse(current.sinceIso) - Date.parse(prev.sinceIso)).toBe(86_400_000);
  });
});

describe("resolveCustomWindow", () => {
  it("przycina dowolne instanty do pełnych dni UTC", () => {
    const w = resolveCustomWindow("2026-07-01T09:15:00.000Z", "2026-07-05T21:44:00.000Z", NOW);
    expect(w.sinceIso).toBe("2026-07-01T00:00:00.000Z");
    expect(w.untilIso).toBe("2026-07-05T23:59:59.999Z");
    expect(w.days).toBe(5);
    expect(w.ga4).toEqual({ startDate: "2026-07-01", endDate: "2026-07-05" });
    expect(w.crossStreamSafe).toBe(true);
  });

  it("normalizuje odwrócone granice", () => {
    const forward = resolveCustomWindow(
      "2026-07-01T00:00:00.000Z",
      "2026-07-05T00:00:00.000Z",
      NOW,
    );
    const backward = resolveCustomWindow(
      "2026-07-05T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
      NOW,
    );
    expect(backward.sinceIso).toBe(forward.sinceIso);
    expect(backward.untilIso).toBe(forward.untilIso);
  });

  it("zakres sięgający dzisiaj traci porównywalność międzystrumieniową", () => {
    const w = resolveCustomWindow("2026-07-10T00:00:00.000Z", "2026-07-15T00:00:00.000Z", NOW);
    expect(w.crossStreamSafe).toBe(false);
    expect(w.notes).toContain("ga4_open_day");
  });

  it("jednodniowy zakres to jeden dzień, nie zero", () => {
    const w = resolveCustomWindow("2026-07-02T05:00:00.000Z", "2026-07-02T18:00:00.000Z", NOW);
    expect(w.days).toBe(1);
  });

  it("rzuca dla niepoprawnych granic ISO", () => {
    expect(() => resolveCustomWindow("nie-data", "2026-07-05T00:00:00.000Z", NOW)).toThrow(
      /invalid ISO bounds/,
    );
  });
});

describe("legacyRpcWindow", () => {
  it("dokłada notę, gdy RPC liczy okno jako now() - N dni", () => {
    const w = resolveWindow({ presetId: "28d", nowMs: NOW });
    const legacy = legacyRpcWindow(w);
    expect(legacy.days).toBe(28);
    expect(legacy.notes).toContain("legacy_rpc_window_ends_now");
  });

  it("nie dokłada noty, gdy okno i tak kończy się teraz", () => {
    const w = resolveWindow({ presetId: "28d", nowMs: NOW, includeOpenDay: true });
    expect(legacyRpcWindow(w).notes).not.toContain("legacy_rpc_window_ends_now");
  });
});

describe("domyślne „teraz”", () => {
  it("resolveWindow bez nowMs bierze zegar systemowy i nadal domyka okno", () => {
    const w = resolveWindow({ presetId: "7d" });
    expect(w.days).toBe(7);
    expect(w.crossStreamSafe).toBe(true);
    // Okno dobowe zawsze kończy się o 23:59:59.999 UTC ostatniego pełnego dnia.
    expect(w.untilIso.endsWith("T23:59:59.999Z")).toBe(true);
    expect(Date.parse(w.untilIso)).toBeLessThan(Date.now());
  });

  it("resolveCustomWindow bez nowMs rozpoznaje zakres historyczny jako porównywalny", () => {
    const w = resolveCustomWindow("2020-01-01T00:00:00.000Z", "2020-01-07T00:00:00.000Z");
    expect(w.days).toBe(7);
    expect(w.crossStreamSafe).toBe(true);
    expect(w.notes).toContain("excludes_open_day");
  });
});

describe("ga4RangeFromInstants", () => {
  it("mapuje instanty na dni UTC", () => {
    expect(
      ga4RangeFromInstants(
        Date.parse("2026-01-31T23:59:59.999Z"),
        Date.parse("2026-02-01T00:00:00.000Z"),
      ),
    ).toEqual({ startDate: "2026-01-31", endDate: "2026-02-01" });
  });
});

// ---------------------------------------------------------------------------
// D13: okno z DAT kalendarzowych. Dwie strefy procesu (UTC i Europe/Warsaw),
// bo błąd „lokalna północ przez instant” jest w UTC NIEWIDOCZNY - wychodzi
// dopiero tam, gdzie północ lokalna nie jest północą UTC (wzór:
// `src/lib/revenue/__tests__/window.test.ts`). Daty lokalne budujemy
// konstruktorem `new Date(r, m, d)` WEWNĄTRZ strefy.
// ---------------------------------------------------------------------------

const ORIGINAL_TZ = process.env.TZ;

/** Uruchamia `fn` pod wskazaną strefą PROCESU. */
function underTimeZone<T>(tz: string, fn: () => T): T {
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    process.env.TZ = ORIGINAL_TZ;
  }
}

afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const STREFY = ["UTC", "Europe/Warsaw"] as const;

/** Czwartek, 2026-08-13 10:00 UTC - po wybranym tygodniu, więc okno jest domknięte. */
const PO_TYGODNIU = Date.parse("2026-08-13T10:00:00.000Z");

describe("toLocalIsoDate - data z lokalnych komponentów", () => {
  it.each(STREFY)("%s: lokalna północ zostaje TYM SAMYM dniem", (tz) => {
    underTimeZone(tz, () => {
      expect(toLocalIsoDate(new Date(2026, 7, 3))).toBe("2026-08-03");
      expect(toLocalIsoDate(new Date(2026, 7, 9, 23, 59, 59, 999))).toBe("2026-08-09");
      expect(toLocalIsoDate(new Date(2026, 0, 1))).toBe("2026-01-01");
    });
  });

  it("w Warszawie `toISOString().slice(0, 10)` dla lokalnej północy podaje dzień WCZEŚNIEJ", () => {
    // Dowód, że pomocnik nie jest kosmetyką: to jest dokładnie ten błąd, który usuwa.
    underTimeZone("Europe/Warsaw", () => {
      const polnoc = new Date(2026, 7, 3);
      expect(polnoc.toISOString().slice(0, 10)).toBe("2026-08-02");
      expect(toLocalIsoDate(polnoc)).toBe("2026-08-03");
    });
  });
});

describe("resolveCalendarWindow - granice z napisów dat", () => {
  it.each(STREFY)("%s: 3-9 VIII to te same dni w Postgresie i w GA4", (tz) => {
    underTimeZone(tz, () => {
      const w = resolveCalendarWindow("2026-08-03", "2026-08-09", PO_TYGODNIU);
      expect(w.sinceIso).toBe("2026-08-03T00:00:00.000Z");
      expect(w.untilIso).toBe("2026-08-09T23:59:59.999Z");
      expect(w.ga4).toEqual({ startDate: "2026-08-03", endDate: "2026-08-09" });
      expect(w.days).toBe(7);
      expect(w.rpcDays).toBe(7);
      expect(w.presetId).toBe("custom");
      expect(w.grain).toBe("day");
      expect(w.crossStreamSafe).toBe(true);
      expect(w.notes).toEqual(["ga4_property_timezone", "excludes_open_day"]);
    });
  });

  it("REGRESJA D13: lokalne 00:00 przez `resolveCustomWindow` przesuwa dzień, przez daty - nie", () => {
    underTimeZone("Europe/Warsaw", () => {
      // Tak `TimeRangeFilter` buduje granice zakresu „3-9 sierpnia”.
      const od = new Date(2026, 7, 3, 0, 0, 0, 0);
      const doo = new Date(2026, 7, 9, 23, 59, 59, 999);

      const przezInstant = resolveCustomWindow(od.toISOString(), doo.toISOString(), PO_TYGODNIU);
      // Lokalna północ 3 VIII to 2 VIII 22:00 UTC - okno zyskuje dzień z przodu.
      expect(przezInstant.ga4.startDate).toBe("2026-08-02");
      expect(przezInstant.days).toBe(8);

      const przezDaty = resolveCalendarWindow(toLocalIsoDate(od), toLocalIsoDate(doo), PO_TYGODNIU);
      expect(przezDaty.ga4).toEqual({ startDate: "2026-08-03", endDate: "2026-08-09" });
      expect(przezDaty.days).toBe(7);
    });
  });

  it("w UTC obie drogi dają to samo okno - stąd defekt był utajony", () => {
    underTimeZone("UTC", () => {
      const od = new Date(2026, 7, 3, 0, 0, 0, 0);
      const doo = new Date(2026, 7, 9, 23, 59, 59, 999);
      const przezInstant = resolveCustomWindow(od.toISOString(), doo.toISOString(), PO_TYGODNIU);
      const przezDaty = resolveCalendarWindow(toLocalIsoDate(od), toLocalIsoDate(doo), PO_TYGODNIU);
      expect(przezDaty).toEqual(przezInstant);
    });
  });

  it("zmiana czasu CEST → CET (25 X 2026) nie gubi ani nie dubluje dnia", () => {
    underTimeZone("Europe/Warsaw", () => {
      // Doba 25 października ma 25 godzin; jej ostatnia lokalna godzina to wciąż ten dzień.
      expect(toLocalIsoDate(new Date(2026, 9, 25, 23, 30))).toBe("2026-10-25");
      const od = new Date(2026, 9, 24);
      const doo = new Date(2026, 9, 26, 23, 59, 59, 999);

      const w = resolveCalendarWindow(
        toLocalIsoDate(od),
        toLocalIsoDate(doo),
        Date.parse("2026-11-02T08:00:00Z"),
      );
      expect(w.ga4).toEqual({ startDate: "2026-10-24", endDate: "2026-10-26" });
      expect(w.days).toBe(3);
      expect(w.sinceIso).toBe("2026-10-24T00:00:00.000Z");
      expect(w.untilIso).toBe("2026-10-26T23:59:59.999Z");

      // Ta sama para przez instanty: początek w CEST (−2 h) przesuwa się na 23 X.
      const przezInstant = resolveCustomWindow(
        od.toISOString(),
        doo.toISOString(),
        Date.parse("2026-11-02T08:00:00Z"),
      );
      expect(przezInstant.ga4.startDate).toBe("2026-10-23");
    });
  });

  it("odwrócone granice są porządkowane, nie oddawane na wspak", () => {
    const w = resolveCalendarWindow("2026-08-09", "2026-08-03", PO_TYGODNIU);
    expect(w.ga4).toEqual({ startDate: "2026-08-03", endDate: "2026-08-09" });
    expect(w.days).toBe(7);
  });

  it("jeden dzień to okno jednodniowe, nie zerowe", () => {
    const w = resolveCalendarWindow("2026-08-05", "2026-08-05", PO_TYGODNIU);
    expect(w.days).toBe(1);
    expect(Date.parse(w.untilIso) - Date.parse(w.sinceIso)).toBe(86_399_999);
  });

  it("data spoza kalendarza albo zły format rzuca, zamiast przeskoczyć w inny dzień", () => {
    expect(() => resolveCalendarWindow("2026-02-30", "2026-03-02", PO_TYGODNIU)).toThrow(
      /not a calendar date/,
    );
    expect(() => resolveCalendarWindow("2026-8-3", "2026-08-09", PO_TYGODNIU)).toThrow(
      /expected YYYY-MM-DD/,
    );
    expect(() =>
      resolveCalendarWindow("2026-08-03T00:00:00Z", "2026-08-09", PO_TYGODNIU),
    ).toThrow();
  });

  it("okno kończące się w bieżącej dobie UTC traci porównywalność międzystrumieniową", () => {
    const dzis = Date.parse("2026-08-09T15:00:00.000Z");
    const w = resolveCalendarWindow("2026-08-03", "2026-08-09", dzis);
    expect(w.crossStreamSafe).toBe(false);
    expect(w.notes).toEqual(["ga4_property_timezone", "ga4_open_day"]);
  });

  it.each(STREFY)(
    "%s: granice wyniku odtwarza `resolveCustomWindow` - konsument server fn nic nie traci",
    (tz) => {
      underTimeZone(tz, () => {
        // `getSemanticSnapshot` przyjmuje `sinceIso/untilIso` i tnie je do dni UTC.
        // Okno z dat leży na północy UTC, więc ta droga jest bezstratna.
        const w = resolveCalendarWindow("2026-10-24", "2026-10-26", PO_TYGODNIU);
        expect(resolveCustomWindow(w.sinceIso, w.untilIso, PO_TYGODNIU)).toEqual(w);
      });
    },
  );

  it("okno poprzednie jest rozłączne i tej samej długości", () => {
    const w = resolveCalendarWindow("2026-08-03", "2026-08-09", PO_TYGODNIU);
    const prev = previousWindow(w);
    expect(prev.ga4).toEqual({ startDate: "2026-07-27", endDate: "2026-08-02" });
    expect(prev.days).toBe(7);
    expect(windowsOverlap(w, prev)).toBe(false);
  });
});
