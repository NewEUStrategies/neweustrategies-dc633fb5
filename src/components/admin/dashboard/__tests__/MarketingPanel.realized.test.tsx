// Pulpit admina, sekcja Marketing: kafel „Przychód zrealizowany" (karta S7).
//
// CO TEN PLIK DOWODZI.
//   1. Pulpit, hub (kafel Kokpitu) i BI (`RevenueInsightSection`) czytają
//      przychód zrealizowany spod IDENTYCZNEGO klucza dla tego samego okna -
//      porównanie `queryKey` dla każdego okresu wspólnego pulpitu i huba,
//      a po zamontowaniu trzech ekranów naraz: jeden wpis cache, jedno
//      żądanie, ta sama kwota w trzech miejscach.
//   2. Kafel z rejestru: etykieta `metricById("revenue_realized")`, kwoty
//      per waluta (nigdy suma), odnośnik do zakładki Przychód; kafel
//      zamówień zostaje obok jako drugie źródło.
//   3. Redaktor - `LockedMetricTile` bez żądania; okres, którego hub nie
//      liczy (`realtime`, `today`) - „-" z powodem, bez żądania.
//   4. axe bez naruszeń.
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fetchSnapshot: vi.fn(),
  auth: {
    roles: ["admin"] as string[],
    tenantId: "11111111-1111-4111-8111-111111111111" as string | undefined,
  },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useHydrated: () => true,
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@/lib/tenant", () => ({ useCurrentTenantId: () => h.auth.tenantId ?? null }));
vi.mock("@/lib/analytics/semantic/revenueSnapshot.functions", async (importOriginal) => {
  const orig =
    await importOriginal<typeof import("@/lib/analytics/semantic/revenueSnapshot.functions")>();
  return {
    ...orig,
    revenueSnapshotQueryOptions: (
      ...args: Parameters<typeof orig.revenueSnapshotQueryOptions>
    ) => ({
      ...orig.revenueSnapshotQueryOptions(...args),
      queryFn: () => h.fetchSnapshot(...args),
    }),
  };
});
vi.mock("@/components/admin/analytics/semantic/hooks/useBenchmark", async (importOriginal) => {
  const { noBenchmark } = await import("@/components/admin/revenue/funnel/__tests__/funnelTestKit");
  return {
    ...(await importOriginal<
      typeof import("@/components/admin/analytics/semantic/hooks/useBenchmark")
    >()),
    useBenchmark: noBenchmark,
  };
});
// Silnik wykresów ma własne testy - tu liczy się kafel przychodu.
vi.mock("@/components/admin/analytics/ChartCard", () => ({
  ChartCard: (props: { title: string; footer?: ReactNode }) => (
    <figure data-testid="chart">
      <figcaption>{props.title}</figcaption>
    </figure>
  ),
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { MarketingPanel } from "../MarketingPanel";
import { RevenueInsightSection } from "@/components/admin/analytics/semantic/organisms/RevenueInsightSection";
import { OverviewKpiTiles } from "@/components/admin/revenue/overview/OverviewKpiTiles";
import { hubWindowOf, snapshotFiltersOf } from "@/components/admin/revenue/overview/hubWindow";
import { dashboardRevenueRange } from "@/components/admin/revenue/metrics/dashboardRealized";
import { OVERVIEW_ADMIN_TILES } from "@/lib/admin/revenue/overviewTiles";
import { parseMarketingReport } from "@/lib/admin/dashboard/parse";
import {
  DASHBOARD_PERIODS,
  quantizeNow,
  resolveDashboardRange,
  type DashboardPeriodId,
  type DashboardRange,
} from "@/lib/admin/dashboard/period";
import type { MarketingReport } from "@/lib/admin/dashboard/types";
import { revenueSnapshotQueryOptions } from "@/lib/analytics/semantic/revenueSnapshot.functions";
import { metricById } from "@/lib/analytics/semantic/metrics";
import { REVENUE_PERIODS, type RevenuePeriod } from "@/lib/revenue/search";
import { resolveRevenueRange } from "@/lib/revenue/window";
import { NOW_MS, TENANT } from "@/components/admin/revenue/overview/__tests__/hubFixtures";
import { snapshot } from "@/components/admin/revenue/overview/__tests__/overviewMocks";

/** Okno pulpitu dokładnie jak `useDashboardRange` (kwantowane „teraz"). */
function dashboardRange(period: DashboardPeriodId): DashboardRange {
  return resolveDashboardRange(period, quantizeNow(period, NOW_MS));
}

function report(): MarketingReport {
  const base = parseMarketingReport(null);
  return {
    ...base,
    current: {
      ...base.current,
      orders: 7,
      revenue: [{ currency: "PLN", cents: 1_234_567, orders: 7 }],
    },
  };
}

function renderWith(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
    queryClient,
  };
}

const SHARED_PERIODS = DASHBOARD_PERIODS.filter((p): p is DashboardPeriodId & RevenuePeriod =>
  (REVENUE_PERIODS as readonly string[]).includes(p),
);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW_MS);
  h.fetchSnapshot.mockReset().mockResolvedValue(snapshot("admin"));
  h.auth = { roles: ["admin"], tenantId: TENANT };
  await i18n.changeLanguage("pl");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ten sam klucz przychodu zrealizowanego - pulpit, hub i BI", () => {
  it("okresy wspólne pulpitu i huba to dokładnie tydzień … rok", () => {
    expect(SHARED_PERIODS).toEqual(["week", "month", "prev-month", "quarter", "half-year", "year"]);
  });

  it.each(SHARED_PERIODS)("%s: queryKey pulpitu = Kokpitu huba = sekcji BI", (period) => {
    const panelRange = dashboardRevenueRange(dashboardRange(period));
    if (panelRange === null) throw new Error("okres wspólny bez okna huba");
    const hub = hubWindowOf("overview", { w: period }, NOW_MS);
    const panel = revenueSnapshotQueryOptions(TENANT, panelRange);
    const hubTile = revenueSnapshotQueryOptions(TENANT, hub.range, snapshotFiltersOf(null, null));
    const biTile = revenueSnapshotQueryOptions(TENANT, resolveRevenueRange(period, NOW_MS));
    expect(panel.queryKey).toEqual(hubTile.queryKey);
    expect(panel.queryKey).toEqual(biTile.queryKey);
    // Także to, co jedzie do serwera (poprzednie okno, strefa), jest tym samym oknem.
    expect(panelRange).toEqual(resolveRevenueRange(period, NOW_MS));
  });

  it.each(["realtime", "today"] as const)("%s: okres spoza huba - bez okna", (period) => {
    expect(dashboardRevenueRange(dashboardRange(period))).toBeNull();
  });

  it("pulpit + Kokpit + BI naraz: jeden wpis cache, jedno żądanie, ta sama kwota", async () => {
    const { queryClient } = renderWith(
      <>
        <MarketingPanel report={report()} range={dashboardRange("month")} />
        <OverviewKpiTiles
          tenantId={TENANT}
          roles={["admin"]}
          range={hubWindowOf("overview", {}, NOW_MS).range}
          currency={null}
          segment={null}
          tiles={OVERVIEW_ADMIN_TILES}
        />
        <RevenueInsightSection />
      </>,
    );
    const panel = await screen.findByTestId("marketing-realized");
    const panelTile = await within(panel).findByText(
      (_, el) => el?.getAttribute("data-state") === "ready",
    );
    const hubTile = await screen.findByText(
      (_, el) =>
        el?.getAttribute("data-tile") === "revenue_realized" &&
        el.closest('[data-testid="overview-kpi"]') !== null,
    );
    const biTile = await screen.findByText(
      (_, el) =>
        el?.getAttribute("data-tile") === "revenue_realized" &&
        el.closest('[data-testid="overview-kpi"]') === null &&
        el.closest('[data-testid="marketing-realized"]') === null,
    );
    const amount = (el: Element) =>
      el.querySelector('[data-money="primary"]')?.textContent?.replace(/\s/g, " ");
    expect(amount(panelTile)).toMatch(/13\s000,00\szł/);
    expect(amount(hubTile)).toBe(amount(panelTile));
    expect(amount(biTile)).toBe(amount(panelTile));
    expect(h.fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(
      queryClient.getQueryCache().findAll({ queryKey: ["admin-revenue", "snapshot"] }),
    ).toHaveLength(1);
  });
});

describe("kafel pulpitu", () => {
  it("etykieta z rejestru, odnośnik do Przychodu, kafel zamówień zostaje", async () => {
    renderWith(<MarketingPanel report={report()} range={dashboardRange("month")} />);
    const panel = await screen.findByTestId("marketing-realized");
    await within(panel).findByText((_, el) => el?.getAttribute("data-state") === "ready");
    expect(within(panel).getByText(metricById("revenue_realized").labelPl)).toBeVisible();
    expect(
      within(panel)
        .getAllByRole("link")
        .some((a) => a.getAttribute("href") === "/admin/revenue/mrr"),
    ).toBe(true);
    // Drugie źródło: przychód z zamówień pulpitu.
    expect(screen.getByText("Przychód", { selector: "span" })).toBeVisible();
  });

  it("redaktor: LockedMetricTile bez żądania", async () => {
    h.auth = { roles: ["editor"], tenantId: TENANT };
    renderWith(<MarketingPanel report={report()} range={dashboardRange("month")} />);
    const panel = await screen.findByTestId("marketing-realized");
    expect(
      await within(panel).findByText((_, el) => el?.getAttribute("data-locked") === "admin_only"),
    ).toBeInTheDocument();
    expect(h.fetchSnapshot).not.toHaveBeenCalled();
  });

  it.each(["realtime", "today"] as const)("%s: „-” z powodem, bez żądania", async (period) => {
    renderWith(<MarketingPanel report={report()} range={dashboardRange(period)} />);
    const panel = await screen.findByTestId("marketing-realized");
    expect(await within(panel).findByText(/od tygodnia wzwyż/)).toBeVisible();
    expect(h.fetchSnapshot).not.toHaveBeenCalled();
  });

  it("axe bez naruszeń", async () => {
    const view = renderWith(<MarketingPanel report={report()} range={dashboardRange("month")} />);
    const panel = await screen.findByTestId("marketing-realized");
    await within(panel).findByText((_, el) => el?.getAttribute("data-state") === "ready");
    expect(summarize(await axeViolations(view.container))).toBe("");
  });
});
