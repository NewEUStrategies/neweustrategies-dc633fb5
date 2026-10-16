// `TrafficGeoDashboard` - ruch własny i mapa pochodzenia na /admin/analytics/bi.
//
// PO CO. Plik stał na zerze, a jego jedyna racja bytu to PARYTET z pulpitem
// /admin: te same panele, ta sama funkcja serwerowa, te same stany sekcji.
// Rozjazd między dwoma ekranami pokazującymi tę samą liczbę jest gorszy niż
// brak jednego z nich, więc ten plik dowodzi, że warsztat składa sekcje TAK
// SAMO jak pulpit:
//
//   1. OKNO CZASU. Start od „Ten miesiąc", a zakładka okresu przestawia okno
//      OBU odczytów (ruch i kontakty CRM) - mapa nie może zestawić krajów ruchu
//      z maja z kontaktami z roku.
//   2. TRZY STANY SEKCJI z pulpitu: ładowanie, awaria z ponowieniem, brak
//      źródła. Mapa czeka na OBA odczyty, a jej awaria i ponowienie idą za
//      ruchem (warstwa CRM jest dodatkiem, nie warunkiem mapy).
//   3. REZERWA WYSOKOŚCI W TOKU ODCZYTU (NAPRAWA). Pulpit dawał sekcjom ruchu
//      i mapy `pendingMinHeight` 420 px (CLS 0,532 na /admin), a warsztat -
//      nie, więc po wczytaniu chunku obie sekcje miały wiersz migotki (~56 px)
//      i po odczycie rosły o kilkaset pikseli, spychając w dół Web Vitals
//      i resztę dashboardów. Stała mieszka teraz we wspólnym
//      `dashboard/sectionReserve.ts`, a asercja niżej oblewa na kodzie bez
//      rezerwy. Moduł jest ATRAPĄ z wartościami-wartownikami (401/402), bo
//      asercja na „420px" przepuszczała literał 420 wpisany tu z ręki - czyli
//      dokładnie ten rozjazd, któremu wspólny moduł ma zapobiec - i zamianę
//      kluczy ruch/mapa (obie są dziś równe). Prawdziwe wartości przypina na
//      pulpicie `adminDashboard.test.tsx` - zmiana w `sectionReserve.ts`
//      oblewa tamte asercje.
//   4. DANE DO PANELI: raport i okno do `TrafficPanel`, dwie warstwy krajów do
//      `GeoPanel`. Awaria CRM nie gasi mapy - warstwa kontaktów jest wtedy
//      pustą tablicą, a nie `undefined`, i nie ma alertu.
//
// GRANICA DOWODU. Hooki odczytu są atrapami (ich klucze, okna i funkcje
// serwerowe dowodzi `dashboard/__tests__/adminDashboard.test.tsx`), panele -
// instrumentami zapisującymi propsy (ich render dowodzi `dashboardPanels`).
// `DashboardSection`, `DashboardPeriodTabs` i słownik są PRAWDZIWE, bo to ich
// napisy i stany widzi administrator.
//
// CZEGO TU NIE MA. Pustej warstwy RUCHU jako scenariusza: mapa rysuje się
// wyłącznie po udanym odczycie ruchu (w toku i po awarii sekcja nie renderuje
// dzieci), a react-query v5 nie zna sukcesu bez danych - `queryFn` oddające
// `undefined` kończy się błędem. `?? []` po stronie ruchu to obrona typów
// (propsy JSX liczą się zawczasu, także w toku odczytu), nie stan ekranu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { DashboardPeriodId, DashboardRange } from "@/lib/admin/dashboard/period";

interface QueryState {
  isPending: boolean;
  isError: boolean;
  data: { available: boolean; report: { countries: unknown[] } } | undefined;
  refetch: () => Promise<unknown>;
}

const h = vi.hoisted(() => ({
  periods: [] as string[],
  ranges: new Map<string, unknown>(),
  trafficRanges: [] as unknown[],
  crmRanges: [] as unknown[],
  traffic: null as unknown as QueryState,
  crm: null as unknown as QueryState,
  trafficPanel: [] as { report: unknown; range: unknown }[],
  geoPanel: [] as { traffic: unknown[]; leads: unknown[] }[],
  fixedT: null as null | ((key: string) => string),
  // Wartownicy zamiast prawdziwych 420/420: różne od siebie i od wartości
  // produkcyjnej, więc przechodzą tylko przez import wspólnej stałej.
  reserve: { traffic: 401, geo: 402 },
}));

// Prawdziwy słownik przez `realT` - wzorem `adminDashboard.test.tsx`. Fabryka
// NIE importuje `@/test/i18nReal` sama: ten sięga po `@/lib/i18n`, a ten po
// atrapowany właśnie `react-i18next`, i rozwiązywanie modułów staje bez
// komunikatu. `t` dojeżdża więc przez `h` po imporcie z góry pliku.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT, i18n: { language: "pl" }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));

vi.mock("@/components/admin/dashboard/useDashboardData", () => ({
  // Jedno okno na okres, o STAŁEJ tożsamości - asercja „panel dostał to samo
  // okno, co odczyt" porównuje referencje, nie kształt.
  useDashboardRange: (period: string) => {
    h.periods.push(period);
    if (!h.ranges.has(period)) h.ranges.set(period, { period, marker: `okno-${period}` });
    return h.ranges.get(period);
  },
  useTrafficQuery: (range: unknown) => {
    h.trafficRanges.push(range);
    return h.traffic;
  },
  useCrmQuery: (range: unknown) => {
    h.crmRanges.push(range);
    return h.crm;
  },
}));

vi.mock("@/components/admin/dashboard/sectionReserve", () => ({
  SECTION_RESERVE_PX: h.reserve,
}));

vi.mock("@/components/admin/dashboard/TrafficPanel", () => ({
  TrafficPanel: (props: { report: unknown; range: unknown }) => {
    h.trafficPanel.push(props);
    return <div data-testid="traffic-panel" />;
  },
}));
vi.mock("@/components/admin/dashboard/GeoPanel", () => ({
  GeoPanel: (props: { traffic: unknown[]; leads: unknown[] }) => {
    h.geoPanel.push(props);
    return <div data-testid="geo-panel" />;
  },
}));

import { realT } from "@/test/i18nReal";
import { TrafficGeoDashboard } from "../TrafficGeoDashboard";

h.fixedT = realT("pl");

const TRAFFIC_COUNTRIES = [{ code: "PL", sessions: 12, pageViews: 30 }];
const CRM_COUNTRIES = [{ code: "DE", leads: 4 }];
const TRAFFIC_REPORT = { countries: TRAFFIC_COUNTRIES, marker: "raport-ruchu" };

function pending(): QueryState {
  return { isPending: true, isError: false, data: undefined, refetch: vi.fn() };
}
function failed(): QueryState {
  return { isPending: false, isError: true, data: undefined, refetch: vi.fn() };
}
function answered(report: { countries: unknown[] }, available = true): QueryState {
  return { isPending: false, isError: false, data: { available, report }, refetch: vi.fn() };
}

/** Sekcja po tytule `<h2>` - tak, jak czyta ją administrator. */
function section(title: string): HTMLElement {
  const node = screen.getByRole("heading", { level: 2, name: title }).closest("section");
  if (!(node instanceof HTMLElement)) throw new Error(`Brak sekcji "${title}"`);
  return node;
}
const trafficSection = () => section("Ruch na stronie");
const geoSection = () => section("Mapa pochodzenia");

const last = <T,>(list: readonly T[]): T | undefined => list[list.length - 1];

beforeEach(() => {
  h.periods.length = 0;
  h.ranges.clear();
  h.trafficRanges.length = 0;
  h.crmRanges.length = 0;
  h.trafficPanel.length = 0;
  h.geoPanel.length = 0;
  h.traffic = answered(TRAFFIC_REPORT);
  h.crm = answered({ countries: CRM_COUNTRIES });
});

afterEach(cleanup);

describe("TrafficGeoDashboard - okno czasu", () => {
  it("startuje od miesiąca i czyta oba odczyty z TEGO SAMEGO okna", () => {
    render(<TrafficGeoDashboard />);

    expect(h.periods[0]).toBe("month");
    expect(screen.getByRole("button", { name: "Ten miesiąc" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    const month = h.ranges.get("month");
    expect(last(h.trafficRanges)).toBe(month);
    expect(last(h.crmRanges)).toBe(month);
  });

  it("zakładka okresu przestawia okno ruchu, kontaktów i panelu naraz", () => {
    render(<TrafficGeoDashboard />);

    fireEvent.click(screen.getByRole("button", { name: "Rok" }));

    const year = h.ranges.get("year" satisfies DashboardPeriodId);
    expect(last(h.periods)).toBe("year");
    expect(screen.getByRole("button", { name: "Rok" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Ten miesiąc" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(last(h.trafficRanges)).toBe(year);
    expect(last(h.crmRanges)).toBe(year);
    expect(last(h.trafficPanel)?.range).toBe(year);
  });
});

describe("TrafficGeoDashboard - stany sekcji", () => {
  it("w toku odczytu obie sekcje rezerwują wysokość pulpitu i nie pokazują paneli", () => {
    h.traffic = pending();
    h.crm = pending();
    render(<TrafficGeoDashboard />);

    for (const [node, reserve] of [
      [trafficSection(), h.reserve.traffic],
      [geoSection(), h.reserve.geo],
    ] as const) {
      expect(node.getAttribute("aria-busy")).toBe("true");
      const status = within(node).getByRole("status");
      expect(status.textContent).toContain("Wczytywanie...");
      // Ta sama rezerwa, co na /admin - bez niej sekcja rośnie z wiersza
      // migotki do kilkuset pikseli i spycha w dół resztę dashboardów BI.
      expect(status.style.minHeight).toBe(`${reserve}px`);
    }
    expect(screen.queryByTestId("traffic-panel")).toBeNull();
    expect(screen.queryByTestId("geo-panel")).toBeNull();
  });

  it("mapa czeka także na kontakty CRM, choć ruch już dojechał", () => {
    h.crm = pending();
    render(<TrafficGeoDashboard />);

    expect(trafficSection().getAttribute("aria-busy")).toBeNull();
    expect(within(trafficSection()).getByTestId("traffic-panel")).toBeTruthy();
    expect(geoSection().getAttribute("aria-busy")).toBe("true");
    expect(within(geoSection()).getByRole("status").style.minHeight).toBe(`${h.reserve.geo}px`);
    expect(screen.queryByTestId("geo-panel")).toBeNull();
  });

  it("awaria ruchu gasi obie sekcje alertem, a ponowienie odpytuje ruch", () => {
    h.traffic = failed();
    render(<TrafficGeoDashboard />);

    for (const node of [trafficSection(), geoSection()]) {
      expect(within(node).getByRole("alert").textContent).toContain(
        "Nie udało się wczytać danych.",
      );
      fireEvent.click(within(node).getByRole("button", { name: "Spróbuj ponownie" }));
    }

    expect(h.traffic.refetch).toHaveBeenCalledTimes(2);
    expect(h.crm.refetch).not.toHaveBeenCalled();
    expect(screen.queryByTestId("traffic-panel")).toBeNull();
    expect(screen.queryByTestId("geo-panel")).toBeNull();
  });

  it("brak źródła ruchu to napis o migracji, nie awaria - i tylko w sekcji ruchu", () => {
    h.traffic = answered(TRAFFIC_REPORT, false);
    render(<TrafficGeoDashboard />);

    expect(within(trafficSection()).getByRole("status").textContent).toContain(
      "Źródło jeszcze niedostępne",
    );
    expect(within(trafficSection()).queryByRole("alert")).toBeNull();
    // Parytet z pulpitem: mapa nie powtarza tej informacji.
    expect(within(geoSection()).queryByRole("status")).toBeNull();
  });
});

describe("TrafficGeoDashboard - dane do paneli", () => {
  it("TrafficPanel dostaje raport ruchu i okno, GeoPanel - kraje ruchu i kontaktów", () => {
    render(<TrafficGeoDashboard />);

    expect(within(trafficSection()).getByTestId("traffic-panel")).toBeTruthy();
    expect(last(h.trafficPanel)?.report).toBe(TRAFFIC_REPORT);
    expect(last(h.trafficPanel)?.range).toBe(h.ranges.get("month") as DashboardRange);
    expect(within(geoSection()).getByTestId("geo-panel")).toBeTruthy();
    expect(last(h.geoPanel)).toEqual({ traffic: TRAFFIC_COUNTRIES, leads: CRM_COUNTRIES });
  });

  it("awaria kontaktów CRM nie gasi mapy: zostaje warstwa ruchu, kontakty są puste", () => {
    // Warstwa CRM jest dodatkiem, nie warunkiem mapy (parytet z pulpitem):
    // administrator widzi „skąd nas czytają" bez alertu, a `GeoPanel` dostaje
    // pustą tablicę zamiast padać na `undefined.length`.
    h.crm = failed();
    render(<TrafficGeoDashboard />);

    expect(within(trafficSection()).getByTestId("traffic-panel")).toBeTruthy();
    expect(geoSection().getAttribute("aria-busy")).toBeNull();
    expect(within(geoSection()).getByTestId("geo-panel")).toBeTruthy();
    expect(within(geoSection()).queryByRole("alert")).toBeNull();
    expect(last(h.geoPanel)).toEqual({ traffic: TRAFFIC_COUNTRIES, leads: [] });
  });
});
