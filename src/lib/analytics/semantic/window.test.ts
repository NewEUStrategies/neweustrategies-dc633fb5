// Kanoniczne okno czasowe. Testy pilnują trzech naprawionych klas błędów:
//  1. okno poprzednie NIE nakłada się na bieżące (dzień graniczny nie może
//     wpaść do obu przedziałów - to zawyżało bazę każdej delty % w GA4),
//  2. zakres dat GA4 jest wyprowadzony z TYCH SAMYCH instantów co granice ISO,
//  3. okno, na którym porównanie międzystrumieniowe jest nieuczciwe (dzień
//     otwarty, ziarno godzinowe), jest jawnie oznaczone.
import { describe, expect, it } from "vitest";
import {
  ga4RangeFromInstants,
  legacyRpcWindow,
  previousWindow,
  resolveCustomWindow,
  resolveWindow,
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
