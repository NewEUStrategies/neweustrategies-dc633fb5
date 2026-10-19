// Parser zdrowia e-mail: kontrakt SQL <-> TS (S1, §4.5).
//
// Trzy własności, których złamanie nie daje błędu kompilacji, tylko złe
// liczby na karcie huba:
//   1. `null` z bazy zostaje `null` (brak danych), a 0 zostaje 0 (wynik) -
//      zamiana jednego w drugie to dokładnie „zero udające wynik";
//   2. zły kształt RZUCA (rozjazd kontraktu ma być głośny, nie zerowy);
//   3. `EMAIL_HEALTH_KEYS` (`// rpc-shape`) = klucze, które naprawdę buduje
//      migracja - inaczej parser czytałby pola, których agregat nie zwraca.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EMAIL_HEALTH_KEYS,
  RevenueEmailHealthShapeError,
  parseRevenueEmailHealth,
} from "@/lib/revenue/email/parse";

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    since: "2026-09-01T00:00:00+02:00",
    until: "2026-10-01T00:00:00+02:00",
    campaigns: {
      sent: 6,
      delivered: 3,
      unique_opens: 3,
      unique_clicks: 2,
      hard_bounces: 1,
      soft_bounces: 1,
      complaints: 1,
      unsubscribes: 1,
    },
    list: { start: 2, end: 4, new: 3, unsubscribed: 1, net_growth: 2 },
    doi: { started: 3, confirmed_7d: 1 },
    ...overrides,
  };
}

describe("parseRevenueEmailHealth - poprawny kształt", () => {
  it("mapuje pola snake_case na DTO camelCase", () => {
    expect(parseRevenueEmailHealth(raw())).toEqual({
      since: "2026-09-01T00:00:00+02:00",
      until: "2026-10-01T00:00:00+02:00",
      campaigns: {
        sent: 6,
        delivered: 3,
        uniqueOpens: 3,
        uniqueClicks: 2,
        hardBounces: 1,
        softBounces: 1,
        complaints: 1,
        unsubscribes: 1,
      },
      list: { start: 2, end: 4, new: 3, unsubscribed: 1, netGrowth: 2 },
      doi: { started: 3, confirmed7d: 1 },
    });
  });

  it("null zostaje null, a zero zostaje zerem - to dwie różne wiadomości", () => {
    const dto = parseRevenueEmailHealth(
      raw({
        campaigns: {
          sent: 0,
          delivered: null,
          unique_opens: null,
          unique_clicks: null,
          hard_bounces: null,
          soft_bounces: null,
          complaints: null,
          unsubscribes: null,
        },
        doi: { started: 0, confirmed_7d: null },
      }),
    );
    expect(dto.campaigns.sent).toBe(0);
    expect(dto.campaigns.delivered).toBeNull();
    expect(dto.campaigns.hardBounces).toBeNull();
    expect(dto.doi).toEqual({ started: 0, confirmed7d: null });

    const zeros = parseRevenueEmailHealth(
      raw({
        campaigns: {
          sent: 4,
          delivered: 4,
          unique_opens: 0,
          unique_clicks: 0,
          hard_bounces: 0,
          soft_bounces: 0,
          complaints: 0,
          unsubscribes: 0,
        },
      }),
    );
    // Zero przy działającym pomiarze to wynik, nie brak danych.
    expect(zeros.campaigns.hardBounces).toBe(0);
    expect(zeros.campaigns.uniqueOpens).toBe(0);
  });

  it("przyrost netto może być ujemny", () => {
    const dto = parseRevenueEmailHealth(
      raw({ list: { start: 10, end: 7, new: 1, unsubscribed: 4, net_growth: -3 } }),
    );
    expect(dto.list.netGrowth).toBe(-3);
  });

  it("licznik bigint przychodzący jako napis cyfr jest przyjmowany", () => {
    const dto = parseRevenueEmailHealth(
      raw({ list: { start: "2", end: "4", new: "3", unsubscribed: "1", net_growth: "2" } }),
    );
    expect(dto.list).toEqual({ start: 2, end: 4, new: 3, unsubscribed: 1, netGrowth: 2 });
  });
});

describe("parseRevenueEmailHealth - zły kształt rzuca", () => {
  const cases: Array<[string, unknown]> = [
    ["nie-obiekt", "ok"],
    ["tablica", [raw()]],
    ["brak sekcji kampanii", raw({ campaigns: undefined })],
    ["sekcja listy nie jest obiektem", raw({ list: [] })],
    ["brak pola w sekcji", raw({ doi: { started: 1 } })],
    ["liczba ujemna", raw({ list: { start: -1, end: 4, new: 3, unsubscribed: 1, net_growth: 2 } })],
    [
      "ułamek",
      raw({
        campaigns: {
          sent: 1.5,
          delivered: 1,
          unique_opens: 1,
          unique_clicks: 1,
          hard_bounces: 0,
          soft_bounces: 0,
          complaints: 0,
          unsubscribes: 0,
        },
      }),
    ],
    ["napis nieliczbowy", raw({ doi: { started: "trzy", confirmed_7d: null } })],
    ["null tam, gdzie agregat zawsze liczy", raw({ doi: { started: null, confirmed_7d: null } })],
    ["zły znacznik czasu", raw({ since: "wczoraj" })],
  ];

  it.each(cases)("%s", (_name, input) => {
    expect(() => parseRevenueEmailHealth(input)).toThrow(RevenueEmailHealthShapeError);
  });

  it("błąd wskazuje ścieżkę pola", () => {
    try {
      parseRevenueEmailHealth(raw({ doi: { started: 1 } }));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RevenueEmailHealthShapeError);
      expect((error as RevenueEmailHealthShapeError).path).toBe("doi.confirmed_7d");
    }
  });
});

describe("EMAIL_HEALTH_KEYS = klucze migracji (rpc-shape)", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/20261020100300_email_health_aggregate.sql"),
    "utf8",
  );

  it("komentarz rpc-shape przy stałej", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/revenue/email/parse.ts"), "utf8");
    expect(source).toMatch(
      /\/\/ rpc-shape: admin_revenue_email_health\nexport const EMAIL_HEALTH_KEYS/,
    );
  });

  it.each(
    Object.values(EMAIL_HEALTH_KEYS)
      .flat()
      .map((key) => [key]),
  )("migracja buduje klucz %s", (key) => {
    expect(sql).toContain(`'${key}', `);
  });

  it("parser czyta dokładnie klucze stałej (pełny przykład bez nadmiarowych pól)", () => {
    const example = raw();
    expect(Object.keys(example).sort()).toEqual([...EMAIL_HEALTH_KEYS.root].sort());
    expect(Object.keys(example.campaigns as object).sort()).toEqual(
      [...EMAIL_HEALTH_KEYS.campaigns].sort(),
    );
    expect(Object.keys(example.list as object).sort()).toEqual([...EMAIL_HEALTH_KEYS.list].sort());
    expect(Object.keys(example.doi as object).sort()).toEqual([...EMAIL_HEALTH_KEYS.doi].sort());
  });
});
