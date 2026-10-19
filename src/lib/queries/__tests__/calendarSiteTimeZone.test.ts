// KALENDARZ PUBLIKACJI LICZY MIESIĄC W STREFIE SERWISU, NIE PROCESU.
//
// Blok `calendar` budował granice zapytania z `new Date(rok, miesiąc - 1, 1)`,
// czyli o północy w strefie MASZYNY. Na Workers to UTC, w przeglądarce strefa
// czytelnika - a serwis datuje wpisy w strefie redakcji (`SITE_TIME_ZONE`,
// `lib/i18n/format.ts`). Wpis opublikowany 2026-03-31T23:30Z to 01:30
// 1 kwietnia w Warszawie: strona wpisu pokazuje „1 kwietnia", a kalendarz
// kwietnia pytał od 2026-04-01T00:00Z i tego wpisu nie dostawał wcale.
// Do tego SSR (UTC) i klient (strefa czytelnika) liczyły RÓŻNE okna i różny
// „bieżący miesiąc" - inny klucz zapytania po obu stronach hydratacji.
//
// Każdy przypadek przechodzi pod DWIEMA strefami procesu (UTC i Los Angeles)
// i wymaga tego samego wyniku. Kontrola na końcu pokazuje, że podmiana
// `process.env.TZ` naprawdę zmienia strefę `Date` - inaczej zgodność wyników
// nie dowodziłaby niczego (ten sam sposób dowodzenia co
// `lib/dock/__tests__/calendarTime.test.ts`).
//
// GRANICE. Zaślepiony jest wyłącznie klient Supabase (wspólny harness
// łańcucha PostgREST); moduł zapytań jest prawdziwy.
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { SupabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({ from: null as SupabaseFromStub | null }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase/chain");
  const from = supabaseFromStub();
  h.from = from;
  return { supabase: { from: from.from } };
});

import { ok } from "@/test/supabaseChain";
import {
  calendarBlockQueryOptions,
  calendarPublishedDay,
  calendarTarget,
} from "@/lib/queries/blocks";

const ORIGINAL_TZ = process.env.TZ;
const ZONES = ["UTC", "America/Los_Angeles"] as const;

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
  vi.useRealTimers();
});

function stub(): SupabaseFromStub {
  if (!h.from) throw new Error("test: atrapa Supabase nie została podpięta");
  return h.from;
}

/** Granice `[gte, lt)` okna, o które kalendarz zapytał bazę. */
async function windowFor(year: number, month: number): Promise<[string, string]> {
  stub().setResponse("posts", ok([]));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await client.fetchQuery(calendarBlockQueryOptions({ year, month }));
  const chain = stub().lastChain("posts");
  if (!chain) throw new Error("test: kalendarz nie zbudował zapytania");
  return [String(chain.argsOf("gte")?.[1]), String(chain.argsOf("lt")?.[1])];
}

// 2026-03-31T23:30Z = 1 kwietnia, 01:30 czasu warszawskiego (CEST od 29 marca).
const AFTER_MIDNIGHT_WARSAW = "2026-03-31T23:30:00.000Z";

describe.each(ZONES)("granice zapytania kalendarza pod TZ=%s", (zone) => {
  it("kwiecień zaczyna się o północy w Warszawie i obejmuje wpis z 01:30 1 kwietnia", async () => {
    process.env.TZ = zone;
    const [start, end] = await windowFor(2026, 4);
    expect([start, end]).toEqual(["2026-03-31T22:00:00.000Z", "2026-04-30T22:00:00.000Z"]);
    expect(start <= AFTER_MIDNIGHT_WARSAW && AFTER_MIDNIGHT_WARSAW < end).toBe(true);
  });

  it("marzec NIE obejmuje wpisu, który w Warszawie jest już 1 kwietnia", async () => {
    process.env.TZ = zone;
    // Zmiana czasu 29 marca: początek miesiąca w CET (+1), koniec w CEST (+2).
    const [start, end] = await windowFor(2026, 3);
    expect([start, end]).toEqual(["2026-02-28T23:00:00.000Z", "2026-03-31T22:00:00.000Z"]);
    expect(AFTER_MIDNIGHT_WARSAW < end).toBe(false);
  });

  it("grudzień kończy się o północy 1 stycznia następnego roku w Warszawie", async () => {
    process.env.TZ = zone;
    const [start, end] = await windowFor(2026, 12);
    expect([start, end]).toEqual(["2026-11-30T23:00:00.000Z", "2026-12-31T23:00:00.000Z"]);
  });
});

describe.each(ZONES)("dzień publikacji w siatce pod TZ=%s", (zone) => {
  it("wpis z 01:30 1 kwietnia (Warszawa) należy do 1 kwietnia, nie do 31 marca", () => {
    process.env.TZ = zone;
    expect(calendarPublishedDay(AFTER_MIDNIGHT_WARSAW, { year: 2026, month: 4 })).toBe(1);
    expect(calendarPublishedDay(AFTER_MIDNIGHT_WARSAW, { year: 2026, month: 3 })).toBeNull();
  });

  it("wpis z 23:30 30 kwietnia (Warszawa) zostaje w kwietniu", () => {
    process.env.TZ = zone;
    expect(calendarPublishedDay("2026-04-30T21:30:00.000Z", { year: 2026, month: 4 })).toBe(30);
  });

  it("nieczytelna data nie zapala żadnego dnia", () => {
    process.env.TZ = zone;
    expect(calendarPublishedDay("nie-data", { year: 2026, month: 4 })).toBeNull();
  });
});

describe("koszt dnia publikacji na publicznym SSR", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Siatka woła `calendarPublishedDay` dla każdego z do 500 wierszy zapytania.
  // Nowy `Intl.DateTimeFormat` na wiersz kosztował setki ms CPU na render SSR.
  it("500 wpisów miesiąca nie buduje formatera strefy dla każdego wiersza", () => {
    const rows = Array.from({ length: 500 }, (_, i) =>
      new Date(Date.UTC(2026, 3, 1) + i * 5_000_000).toISOString(),
    );
    const formatter = vi.spyOn(Intl, "DateTimeFormat");
    const days = rows.map((row) => calendarPublishedDay(row, { year: 2026, month: 4 }));
    expect(days[0]).toBe(1);
    expect(days.filter((day) => day !== null)).toHaveLength(rows.length);
    expect(formatter.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe.each(ZONES)("bieżący miesiąc kalendarza pod TZ=%s", (zone) => {
  it("o 01:30 1 kwietnia w Warszawie pusty wybór miesiąca to kwiecień", () => {
    process.env.TZ = zone;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(AFTER_MIDNIGHT_WARSAW));
    expect(calendarTarget("")).toEqual({ year: 2026, month: 4 });
  });
});

describe("KONTROLA podmiany strefy procesu", () => {
  it("lokalny dzień i lokalna północ tej samej chwili zależą od TZ procesu", () => {
    const local = (zone: string) => {
      process.env.TZ = zone;
      return [new Date(AFTER_MIDNIGHT_WARSAW).getDate(), new Date(2026, 3, 1).toISOString()];
    };
    expect(local("UTC")).toEqual([31, "2026-04-01T00:00:00.000Z"]);
    expect(local("America/Los_Angeles")).toEqual([31, "2026-04-01T07:00:00.000Z"]);
    expect(local("Asia/Tokyo")).toEqual([1, "2026-03-31T15:00:00.000Z"]);
  });
});

describe("ustawienie miesiąca spoza 1-12", () => {
  it("jest niepoprawne i bierze bieżący miesiąc, zamiast przewijać rok", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-02-15T12:00:00.000Z"));
    expect(calendarTarget("2026-13")).toEqual({ year: 2026, month: 2 });
    expect(calendarTarget("2026-00")).toEqual({ year: 2026, month: 2 });
    expect(calendarTarget("2026-12")).toEqual({ year: 2026, month: 12 });
  });
});
