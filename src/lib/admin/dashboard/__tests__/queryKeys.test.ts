// Inwariant cache'u pulpitu: KLUCZ ZAPYTANIA ZAWIERA TENANTA.
//
// Ten plik jest następcą jednej asercji ze starego `platformDashboardRoute.test.tsx`
// ("nie pokazuje zapamiętanych liczb poprzedniego tenanta"). Stary pulpit trzymał
// tenanta w kluczu wprost (`["admin-stats", tenantId]`); nowy woła sześć funkcji
// agregujących i klucz składa się z większej liczby części - czyli jest więcej
// miejsc, z których tenant może wypaść bez śladu w typach i bez śladu na ekranie.
import { describe, it, expect } from "vitest";
import { dashboardQueryKey, realtimeQueryKey, type DashboardDomain } from "../queryKeys";
import { resolveDashboardRange, DASHBOARD_PERIODS } from "../period";

const NOW = new Date(2026, 2, 12, 10, 30, 0, 0).getTime();
const range = resolveDashboardRange("month", NOW);

const DOMAINS: DashboardDomain[] = [
  "traffic",
  "crm",
  "marketing",
  "audience",
  "content",
  "realtime",
];

describe("dashboardQueryKey - izolacja najemców w cache'u", () => {
  it("dwa obszary robocze NIGDY nie dzielą klucza", () => {
    for (const domain of DOMAINS) {
      const a = dashboardQueryKey("tenant-a", domain, range);
      const b = dashboardQueryKey("tenant-b", domain, range);
      expect(a).not.toEqual(b);
    }
  });

  it("tenant jest w kluczu każdej dziedziny", () => {
    for (const domain of DOMAINS) {
      expect(dashboardQueryKey("tenant-a", domain, range)).toContain("tenant-a");
    }
  });

  it("podgląd na żywo też rozdziela najemców", () => {
    expect(realtimeQueryKey("tenant-a", 5, 30)).not.toEqual(realtimeQueryKey("tenant-b", 5, 30));
    expect(realtimeQueryKey("tenant-a", 5, 30)).toContain("tenant-a");
  });
});

describe("dashboardQueryKey - rozdzielczość okna", () => {
  it("dwie dziedziny tego samego okna mają różne klucze", () => {
    expect(dashboardQueryKey("t", "traffic", range)).not.toEqual(
      dashboardQueryKey("t", "crm", range),
    );
  });

  it("każdy okres ma własny klucz", () => {
    const keys = DASHBOARD_PERIODS.map((p) =>
      JSON.stringify(dashboardQueryKey("t", "traffic", resolveDashboardRange(p, NOW))),
    );
    expect(new Set(keys).size).toBe(DASHBOARD_PERIODS.length);
  });

  it("okresy o wspólnym POCZĄTKU rozróżnia koniec okna", () => {
    // 1 stycznia kwartał, półrocze i rok zaczynają się w tym samym momencie.
    const nowyRok = new Date(2026, 0, 1, 9, 0, 0, 0).getTime();
    const kwartal = resolveDashboardRange("quarter", nowyRok);
    const polrocze = resolveDashboardRange("half-year", nowyRok);
    expect(kwartal.current.sinceIso).toBe(polrocze.current.sinceIso);
    expect(dashboardQueryKey("t", "traffic", kwartal)).not.toEqual(
      dashboardQueryKey("t", "traffic", polrocze),
    );
  });

  it("treść rozdziela też język, bo tytuły wpisów wracają przetłumaczone", () => {
    expect(dashboardQueryKey("t", "content", range, ["pl"])).not.toEqual(
      dashboardQueryKey("t", "content", range, ["en"]),
    );
  });

  it("ten sam tenant, okres i dziedzina dają klucz STABILNY", () => {
    expect(dashboardQueryKey("t", "traffic", range)).toEqual(
      dashboardQueryKey("t", "traffic", resolveDashboardRange("month", NOW)),
    );
  });
});
