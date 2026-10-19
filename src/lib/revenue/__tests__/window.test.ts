// Okno czasu huba (SPEC §5.3, AD-04).
//
// DATY BUDUJEMY KONSTRUKTOREM LOKALNYM (`new Date(2026, 9, 1)`) WEWNĄTRZ
// `underTimeZone`, jak `period.test.ts`: model kotwiczy okresy w strefie
// oglądającego, więc oczekiwania liczone tym samym zegarem są poprawne w każdej
// strefie. Dwie strefy (UTC i Europe/Warsaw) zamiast jednej, bo błąd typu
// `toISOString().slice(0, 10)` jest niewidoczny w UTC - wychodzi dopiero tam,
// gdzie północ lokalna nie jest północą UTC (wzór: `calendarTime.test.ts`).
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { quantizeNow, resolveDashboardRange } from "@/lib/admin/dashboard/period";
import { bezKomentarzy } from "@/lib/ci/sourceScan";
import { revenueKeys } from "../keys";
import { REVENUE_CUSTOM_COMPARE_MAX_DAYS, resolveRevenueRange } from "../window";

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
const DELEGOWANE = ["week", "month", "prev-month", "quarter", "half-year", "year"] as const;

const ms = (iso: string) => Date.parse(iso);

describe("resolveRevenueRange - okresy pulpitu", () => {
  it.each(STREFY)("%s: week…year to DOKŁADNIE okno pulpitu (po kwantowaniu)", (tz) => {
    underTimeZone(tz, () => {
      const now = new Date(2026, 9, 19, 13, 47, 12).getTime();
      for (const p of DELEGOWANE) {
        const pulpit = resolveDashboardRange(p, quantizeNow(p, now));
        const hub = resolveRevenueRange(p, now);
        expect(hub, p).toEqual({
          period: p,
          current: pulpit.current,
          previous: pulpit.previous,
          bucket: pulpit.bucket,
          offsetMinutes: pulpit.offsetMinutes,
          complete: pulpit.complete,
        });
      }
    });
  });

  it("klucz zapytania jest stabilny w obrębie kwantu i zmienia się po nim", () => {
    const start = new Date(2026, 9, 19, 13, 45, 0).getTime();
    const klucz = (now: number) => revenueKeys.query("mrr", "t", resolveRevenueRange("month", now));
    // Kwant „miesiąca" to 5 minut - render co sekundę nie może odpytywać bazy.
    expect(klucz(start + 1_000)).toEqual(klucz(start + 4 * 60_000));
    expect(klucz(start + 5 * 60_000)).not.toEqual(klucz(start));
  });
});

describe("resolveRevenueRange - ltm", () => {
  it.each(STREFY)("%s: w styczniu to 12 pełnych miesięcy poprzedniego roku", (tz) => {
    underTimeZone(tz, () => {
      const r = resolveRevenueRange("ltm", new Date(2027, 0, 15, 9, 30).getTime());
      expect(ms(r.current.sinceIso)).toBe(new Date(2026, 0, 1).getTime());
      expect(ms(r.current.untilIso)).toBe(new Date(2027, 0, 1).getTime());
      expect(ms(r.previous!.sinceIso)).toBe(new Date(2025, 0, 1).getTime());
      expect(ms(r.previous!.untilIso)).toBe(new Date(2026, 0, 1).getTime());
      expect(r).toMatchObject({ period: "ltm", bucket: "month", complete: true });
    });
  });

  it("nie zależy od dnia w miesiącu - cały miesiąc ma ten sam klucz", () => {
    const pierwszy = resolveRevenueRange("ltm", new Date(2026, 9, 1, 0, 1).getTime());
    const ostatni = resolveRevenueRange("ltm", new Date(2026, 9, 31, 23, 59).getTime());
    expect(ostatni).toEqual(pierwszy);
  });

  it("strefa Warszawy: granice na lokalnej północy, przesunięcie z początku okna", () => {
    underTimeZone("Europe/Warsaw", () => {
      const r = resolveRevenueRange("ltm", new Date(2026, 9, 19, 12).getTime());
      // 1 października 2025, 00:00 CEST = 30 września 22:00 UTC.
      expect(r.current.sinceIso).toBe("2025-09-30T22:00:00.000Z");
      expect(r.offsetMinutes).toBe(120);
    });
  });
});

describe("resolveRevenueRange - okres własny", () => {
  it.each(STREFY)("%s: `to` włącznie - koniec to lokalna północ dnia następnego", (tz) => {
    underTimeZone(tz, () => {
      const now = new Date(2026, 11, 1).getTime();
      const r = resolveRevenueRange("custom", now, "2026-10-01", "2026-10-31");
      expect(ms(r.current.sinceIso)).toBe(new Date(2026, 9, 1).getTime());
      expect(ms(r.current.untilIso)).toBe(new Date(2026, 10, 1).getTime());
      // Poprzednie okno: te same 31 dób kalendarzowych bezpośrednio wcześniej.
      expect(ms(r.previous!.sinceIso)).toBe(new Date(2026, 7, 31).getTime());
      expect(ms(r.previous!.untilIso)).toBe(new Date(2026, 9, 1).getTime());
      expect(r).toMatchObject({ period: "custom", bucket: "day", complete: true });
    });
  });

  it("zmiana czasu CEST→CET (25.10.2026) nie przesuwa doby", () => {
    underTimeZone("Europe/Warsaw", () => {
      // Doba 25 października ma 25 godzin; granice nadal stoją o północy.
      const r = resolveRevenueRange(
        "custom",
        ms("2026-12-01T00:00:00Z"),
        "2026-10-25",
        "2026-10-25",
      );
      expect(r.current).toEqual({
        sinceIso: "2026-10-24T22:00:00.000Z",
        untilIso: "2026-10-25T23:00:00.000Z",
      });
      expect(r.previous).toEqual({
        sinceIso: "2026-10-23T22:00:00.000Z",
        untilIso: "2026-10-24T22:00:00.000Z",
      });
      expect(r.offsetMinutes).toBe(120);

      const poZmianie = resolveRevenueRange(
        "custom",
        ms("2026-12-01T00:00:00Z"),
        "2026-11-02",
        "2026-11-08",
      );
      expect(poZmianie.current.sinceIso).toBe("2026-11-01T23:00:00.000Z");
      expect(poZmianie.offsetMinutes).toBe(60);
    });
  });

  it("KONTROLA: data UTC z `toISOString()` przesuwa dzień w Warszawie", () => {
    // Bez tej kontroli testy wyżej przechodziłyby także wtedy, gdyby podmiana
    // strefy nie działała - i nie dowodziłyby niczego.
    const dzien = underTimeZone("Europe/Warsaw", () =>
      new Date(2026, 9, 1).toISOString().slice(0, 10),
    );
    expect(dzien).toBe("2026-09-30");
  });

  it(`dłuższy niż ${REVENUE_CUSTOM_COMPARE_MAX_DAYS} dni nie ma okna porównawczego`, () => {
    const now = new Date(2027, 5, 1).getTime();
    const max = resolveRevenueRange("custom", now, "2025-01-01", "2026-02-04");
    expect(max.previous).not.toBeNull();
    const zaDlugi = resolveRevenueRange("custom", now, "2025-01-01", "2026-02-05");
    expect(zaDlugi.previous).toBeNull();
    expect(zaDlugi.bucket).toBe("month");
  });

  it("okno sięgające jutra rośnie z zegarem (`complete: false`)", () => {
    const now = new Date(2026, 9, 19, 12).getTime();
    expect(resolveRevenueRange("custom", now, "2026-10-01", "2026-10-19").complete).toBe(false);
    expect(resolveRevenueRange("custom", now, "2026-10-01", "2026-10-18").complete).toBe(true);
  });

  it("zdeformowany okres własny rozstrzyga się jak `month` i tak się nazywa", () => {
    const now = new Date(2026, 9, 19, 12).getTime();
    const miesiac = resolveRevenueRange("month", now);
    for (const [from, to] of [
      [undefined, undefined],
      ["2026-10-01", undefined],
      ["2026-02-30", "2026-03-10"],
      ["2026-10-10", "2026-10-01"],
      ["01.10.2026", "2026-10-31"],
    ] as const) {
      expect(resolveRevenueRange("custom", now, from, to), `${from}..${to}`).toEqual(miesiac);
    }
  });
});

describe("window.ts - daty lokalne (AGENTS)", () => {
  it("źródło nie tnie napisów ISO na daty", () => {
    const kod = bezKomentarzy(readFileSync("src/lib/revenue/window.ts", "utf8"));
    expect(kod).not.toMatch(/toISOString\(\)\s*\.\s*(slice|substring|substr|split)\b/);
    expect(kod).not.toMatch(/\bDate\.now\(\)/);
  });
});
