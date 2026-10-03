// Inwariant cache'u panelu analityki: KLUCZ ZAPYTANIA ZAWIERA TENANTA.
//
// Siostra `src/lib/admin/dashboard/__tests__/queryKeys.test.ts`. Do 2026-10
// pasek BI, mini-panel RUM, trzy odczyty statusu i analityka kuponów miały
// klucze bez najemcy (`["analytics-status"]`, `["admin-bi-strip", …]`), czyli
// po przełączeniu obszaru roboczego cache oddawał stan POPRZEDNIEGO najemcy.
// W komponencie - opakowany w `useQuery` i wymagający DOM-u - ten jeden
// argument wypada bez śladu w typach i na ekranie; tutaj jest zwykłą asercją.
//
// Trzy własności, każda dla KAŻDEGO klucza z fabryki:
//   1) dwóch najemców nigdy nie dzieli klucza,
//   2) tenant stoi w kluczu - na indeksie 1, żeby prefiks najemcy działał,
//   3) korzeń jest prefiksem, bo unieważnianie po zapisie ustawień idzie
//      właśnie po korzeniu - klucz spoza korzenia przestałby się odświeżać.
import { describe, expect, it } from "vitest";
import { partialMatchKey } from "@tanstack/react-query";

import {
  analyticsBiStripKey,
  analyticsCouponsKey,
  analyticsCouponsPrefixKey,
  analyticsRootKey,
  analyticsStatusKey,
  analyticsTenantKey,
  analyticsVitalsMiniKey,
} from "../queryKeys";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

/** Każdy klucz fabryki jako funkcja najemcy - jedna lista dla wszystkich asercji. */
const KLUCZE: ReadonlyArray<readonly [string, (tenantId: string) => readonly unknown[]]> = [
  ["tenant", (t) => analyticsTenantKey(t)],
  ["status", (t) => analyticsStatusKey(t)],
  ["vitals-mini", (t) => analyticsVitalsMiniKey(t, 7)],
  ["bi-strip vitals", (t) => analyticsBiStripKey(t, "vitals", 14)],
  ["bi-strip errors", (t) => analyticsBiStripKey(t, "errors", 14)],
  ["kupony", (t) => analyticsCouponsKey(t, "2026-07-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z")],
  ["kupony bez granic", (t) => analyticsCouponsKey(t, null, null)],
  ["prefiks kuponów", (t) => analyticsCouponsPrefixKey(t)],
];

describe("klucze analityki - izolacja najemców w cache'u", () => {
  it.each(KLUCZE)("%s: dwóch najemców NIGDY nie dzieli klucza", (_, klucz) => {
    expect(klucz(TENANT_A)).not.toEqual(klucz(TENANT_B));
  });

  it.each(KLUCZE)("%s: tenant jest w kluczu, na indeksie 1", (_, klucz) => {
    expect(klucz(TENANT_A)).toContain(TENANT_A);
    expect(klucz(TENANT_A)[1]).toBe(TENANT_A);
  });

  it.each(KLUCZE)("%s: korzeń i prefiks najemcy są prefiksem klucza", (_, klucz) => {
    const root = analyticsRootKey();
    const key = klucz(TENANT_A);
    expect(key.slice(0, root.length)).toEqual(root);
    expect(key.slice(0, 2)).toEqual(analyticsTenantKey(TENANT_A));
  });

  it("korzeń nie niesie najemcy - unieważnia analitykę każdego obszaru roboczego", () => {
    expect(analyticsRootKey()).toEqual(["admin-analytics"]);
  });
});

describe("klucze analityki - rozdzielczość parametrów", () => {
  // Kształt klucza statusu przypięty dosłownie: bez parametrów poza najemcą,
  // więc trzy ekrany wołające fabrykę dostają JEDEN wpis na najemcę. Że
  // naprawdę ją wołają (a nie liczą klucza po swojemu), dowodzą testy tras -
  // `adminAnalyticsRoute`, `adminAnalyticsBiRoute`, `adminSettingsAnalyticsRoute`;
  // tutaj „równy samemu sobie" przeszedłby dla każdej funkcji deterministycznej.
  it("status to prefiks najemcy + „status”, bez innych parametrów", () => {
    expect(analyticsStatusKey(TENANT_A)).toEqual([...analyticsTenantKey(TENANT_A), "status"]);
    expect(analyticsStatusKey(TENANT_A)).toEqual(["admin-analytics", TENANT_A, "status"]);
  });

  it("okno mini-panelu RUM jest w kluczu", () => {
    expect(analyticsVitalsMiniKey(TENANT_A, 7)).not.toEqual(analyticsVitalsMiniKey(TENANT_A, 28));
  });

  it("dwa źródła paska BI i dwa okna to cztery różne klucze", () => {
    const keys = [
      analyticsBiStripKey(TENANT_A, "vitals", 14),
      analyticsBiStripKey(TENANT_A, "errors", 14),
      analyticsBiStripKey(TENANT_A, "vitals", 30),
      analyticsBiStripKey(TENANT_A, "errors", 30),
    ].map((k) => JSON.stringify(k));
    expect(new Set(keys).size).toBe(4);
  });

  it("zakresy kuponów o wspólnym początku rozróżnia koniec", () => {
    const od = "2026-07-01T00:00:00.000Z";
    expect(analyticsCouponsKey(TENANT_A, od, "2026-08-01T00:00:00.000Z")).not.toEqual(
      analyticsCouponsKey(TENANT_A, od, "2026-09-01T00:00:00.000Z"),
    );
    expect(analyticsCouponsKey(TENANT_A, od, null)).not.toEqual(
      analyticsCouponsKey(TENANT_A, od, "2026-09-01T00:00:00.000Z"),
    );
  });

  it("różne dziedziny tego samego najemcy nie kolidują", () => {
    const keys = [
      analyticsStatusKey(TENANT_A),
      analyticsVitalsMiniKey(TENANT_A, 7),
      analyticsBiStripKey(TENANT_A, "vitals", 7),
      analyticsCouponsKey(TENANT_A, null, null),
    ].map((k) => JSON.stringify(k));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("klucze analityki - prefiks kuponów do unieważniania po mutacji", () => {
  // Mutacja kuponu nie zna zakresu dat zapamiętanego na /admin/coupons/analytics,
  // więc unieważnia PREFIKS. Dopasowanie liczy `partialMatchKey` - ta sama
  // funkcja, którą `invalidateQueries({ queryKey })` filtruje cache - więc
  // asercja mierzy dokładnie to, w co trafi unieważnienie.
  it.each<[string, string | null, string | null]>([
    ["zakres domknięty", "2026-07-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"],
    ["bez początku", null, "2026-10-01T00:00:00.000Z"],
    ["bez końca", "2026-07-01T00:00:00.000Z", null],
    ["bez granic", null, null],
  ])("%s: prefiks trafia w klucz zakresu", (_, od, doIso) => {
    expect(
      partialMatchKey(
        analyticsCouponsKey(TENANT_A, od, doIso),
        analyticsCouponsPrefixKey(TENANT_A),
      ),
    ).toBe(true);
  });

  it("prefiks kuponów NIE trafia w cudzego najemcę ani w inne dziedziny analityki", () => {
    const prefix = analyticsCouponsPrefixKey(TENANT_A);
    const obce = [
      analyticsCouponsKey(TENANT_B, null, null),
      analyticsStatusKey(TENANT_A),
      analyticsBiStripKey(TENANT_A, "vitals", 14),
    ];
    for (const key of obce) expect(partialMatchKey(key, prefix)).toBe(false);
  });
});
