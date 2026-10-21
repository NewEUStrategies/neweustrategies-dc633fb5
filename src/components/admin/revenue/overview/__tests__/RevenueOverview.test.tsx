// Kokpit huba (`RevenueOverview`, S7; karta: „każdy kafel to KpiTile
// z metricId i drillHref; editor widzi zestaw niefinansowy i LockedMetricTile
// bez wywołania RPC finansowego; mini lejek i mini most to te same organizmy
// i klucze").
//
// CO TEN PLIK DOWODZI.
//   1. Administrator: sześć kafli z rejestru, każdy z odnośnikiem do zakładki,
//      kwoty per waluta; migawka spod klucza BI.
//   2. Redaktor: zestaw niefinansowy, most MRR jako kafel zablokowany - RPC
//      mostu i przychodu zrealizowanego NIE są wołane (atrapy server fn).
//   3. Mini lejek i mini most czytają klucze zakładek Lejek i Przychód.
//   4. „Zacznij tutaj" z faktów, „Wymaga uwagi", kondycja obszarów (obszar
//      bez faktów = brak danych), karty Ścieżek i Społeczności.
//   5. Bez najemcy - zero zapytań; axe bez naruszeń dla obu ról.
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fetchSnapshot: vi.fn(),
  fetchBridge: vi.fn(),
  fetchRealized: vi.fn(),
  fetchFunnel: vi.fn(),
  fetchFacts: vi.fn(),
  fetchSnoozes: vi.fn(),
  fetchJourneys: vi.fn(),
  fetchEvents: vi.fn(),
  fetchClubs: vi.fn(),
  auth: { roles: ["admin"] as string[], tenantId: "11111111-1111-4111-8111-111111111111" },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useNavigate: () => vi.fn(),
  useHydrated: () => true,
  useSearch: () => ({}),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
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
vi.mock("@/lib/revenue/finance/finance.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue/finance/finance.functions")>()),
  getRevenueMrrBridge: (...args: unknown[]) => h.fetchBridge(...args),
  getRevenueRealized: (...args: unknown[]) => h.fetchRealized(...args),
}));
vi.mock("@/lib/revenue/funnel/funnel.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue/funnel/funnel.functions")>()),
  getRevenueFunnel: (...args: unknown[]) => h.fetchFunnel(...args),
}));
vi.mock("@/lib/revenue/diagnostics/diagnostics.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue/diagnostics/diagnostics.functions")>()),
  getRevenueFacts: () => h.fetchFacts(),
  getRevenueSnoozes: () => h.fetchSnoozes(),
}));
vi.mock("@/lib/journeys/journeys.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/journeys/journeys.functions")>()),
  listJourneys: (...args: unknown[]) => h.fetchJourneys(...args),
}));
vi.mock("@/lib/revenue/community/community.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue/community/community.functions")>()),
  getRevenueEventsSummary: (...args: unknown[]) => h.fetchEvents(...args),
  getRevenueClubsSummary: (...args: unknown[]) => h.fetchClubs(...args),
}));
vi.mock("@/components/admin/analytics/semantic/hooks/useBenchmark", async (importOriginal) => {
  const { noBenchmark } = await import("../../funnel/__tests__/funnelTestKit");
  return {
    ...(await importOriginal<
      typeof import("@/components/admin/analytics/semantic/hooks/useBenchmark")
    >()),
    useBenchmark: noBenchmark,
  };
});

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { RevenueOverview } from "@/components/admin/revenue/overview/RevenueOverview";
import { RevenueOverviewTab } from "@/components/admin/revenue/tabs/RevenueOverviewTab";
import { funnelFiltersOf } from "@/components/admin/revenue/funnel/funnelStageKeys";
import {
  MRR_KPI_TILES,
  OVERVIEW_ADMIN_TILES,
  OVERVIEW_EDITOR_TILES,
} from "@/lib/admin/revenue/overviewTiles";
import { OverviewKpiTiles } from "@/components/admin/revenue/overview/OverviewKpiTiles";
import { revenueSnapshotQueryOptions } from "@/lib/analytics/semantic/revenueSnapshot.functions";
import { revenueMrrBridgeQueryOptions } from "@/lib/revenue/finance/queries";
import { revenueFunnelQueryOptions } from "@/lib/revenue/funnel/queries";
import { FUNNEL_DTO, MRR_BRIDGE, TENANT, clone, testRange } from "./hubFixtures";
import { CLUBS_SUMMARY, EVENTS_SUMMARY, FACTS, JOURNEYS, snapshot } from "./overviewMocks";

function renderOverview(roles: string[], tenantId: string | null = TENANT) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = (
    <RevenueOverview
      tenantId={tenantId}
      roles={roles}
      range={testRange()}
      currency={null}
      segment={null}
    />
  );
  return {
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
    queryClient,
  };
}

beforeEach(async () => {
  h.fetchSnapshot.mockReset().mockImplementation(async () => snapshot("admin"));
  h.fetchBridge.mockReset().mockResolvedValue({ state: "ready", data: clone(MRR_BRIDGE) });
  h.fetchRealized.mockReset();
  h.fetchFunnel.mockReset().mockResolvedValue({ state: "ready", funnel: clone(FUNNEL_DTO) });
  h.fetchFacts.mockReset().mockResolvedValue({ state: "ready", facts: clone(FACTS) });
  h.fetchSnoozes.mockReset().mockResolvedValue({ state: "ready", snoozes: [] });
  h.fetchJourneys.mockReset().mockResolvedValue({ state: "ready", data: clone(JOURNEYS) });
  h.fetchEvents.mockReset().mockResolvedValue({ state: "ready", summary: clone(EVENTS_SUMMARY) });
  h.fetchClubs.mockReset().mockResolvedValue({ state: "ready", summary: clone(CLUBS_SUMMARY) });
  await i18n.changeLanguage("pl");
});

afterEach(() => cleanup());

async function tiles(): Promise<string[]> {
  const kpi = await screen.findByTestId("overview-kpi");
  await waitFor(() => expect(kpi.querySelectorAll("[data-tile]").length).toBe(6));
  return [...kpi.querySelectorAll("[data-tile]")].map((el) => el.getAttribute("data-tile") ?? "");
}

describe("Kokpit - administrator", () => {
  it("sześć kafli zestawu administratora, każdy z odnośnikiem do zakładki", async () => {
    renderOverview(["admin"]);
    expect(await tiles()).toEqual(OVERVIEW_ADMIN_TILES.map((t) => t.metricId));
    const kpi = screen.getByTestId("overview-kpi");
    const drills = [...kpi.querySelectorAll("[data-drill]")].map((a) => a.getAttribute("href"));
    expect(drills).toEqual(OVERVIEW_ADMIN_TILES.map((t) => t.drillHref));
    expect(kpi.querySelector('[data-tile="mrr"]')?.textContent).toMatch(/12\s?000,00\s?zł/);
  });

  it("migawka spod klucza BI, mini lejek i mini most spod kluczy zakładek", async () => {
    const { queryClient } = renderOverview(["admin"]);
    await tiles();
    await screen.findAllByText(/^Początek /);
    const range = testRange();
    const cache = queryClient.getQueryCache();
    expect(
      cache.find({ queryKey: revenueSnapshotQueryOptions(TENANT, range).queryKey }),
    ).toBeTruthy();
    expect(
      cache.find({
        queryKey: revenueFunnelQueryOptions(TENANT, range, funnelFiltersOf(null)).queryKey,
        exact: true,
      }),
    ).toBeTruthy();
    expect(
      cache.find({ queryKey: revenueMrrBridgeQueryOptions(TENANT, range).queryKey, exact: true }),
    ).toBeTruthy();
    const compactMap = screen.getByTestId("funnel-stage-map");
    expect(compactMap).toHaveAttribute("data-variant", "compact");
    expect(screen.getByTestId("mrr-bridge")).toHaveAttribute("data-variant", "compact");
  });

  it("„Zacznij tutaj”, „Wymaga uwagi”, kondycja obszarów i karty skrótu", async () => {
    renderOverview(["admin"]);
    const start = await screen.findByTestId("revenue-getting-started");
    expect(within(start).getByRole("heading", { level: 2, name: "Zacznij tutaj" })).toBeVisible();
    expect(await screen.findByTestId("revenue-attention")).toBeInTheDocument();
    const system = screen.getByTestId("overview-system");
    await waitFor(() => expect(system.querySelectorAll("li[data-area]").length).toBe(16));
    // Obszar bez faktów (np. kupony) = brak danych, nie 100.
    expect(system.querySelector('[data-area="coupons"] [data-score]')).toHaveAttribute(
      "data-score",
      "none",
    );
    const journeys = await screen.findByTestId("overview-journeys");
    expect(await within(journeys).findByText("2 aktywne ścieżki")).toBeVisible();
    expect(
      within(journeys).getByText("42 osoby weszły w ścieżki w ostatnich 30 dniach"),
    ).toBeVisible();
    const community = screen.getByTestId("overview-community");
    expect(await within(community).findByText("3 wydarzenia")).toBeVisible();
    expect(within(community).getByText(/Frekwencja: 80\s?%/)).toBeVisible();
    expect(within(community).getByText("2 zgłoszenia czekają na decyzję")).toBeVisible();
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = renderOverview(["admin"]);
    await tiles();
    await screen.findAllByText(/^Początek /);
    await screen.findByText("2 aktywne ścieżki");
    expect(summarize(await axeViolations(container))).toBe("");
  });
});

describe("Kokpit - redaktor", () => {
  beforeEach(() => {
    h.fetchSnapshot.mockImplementation(async () => snapshot("editor"));
    h.fetchEvents.mockResolvedValue({
      state: "ready",
      summary: { ...EVENTS_SUMMARY, moneyVisible: false, byCurrency: null },
    });
  });

  it("zestaw niefinansowy i most jako kafel zablokowany - bez RPC finansowego", async () => {
    renderOverview(["editor"]);
    expect(await tiles()).toEqual(OVERVIEW_EDITOR_TILES.map((t) => t.metricId));
    expect(screen.getByTestId("overview-kpi")).toHaveAttribute("data-tile-set", "editor");
    expect(screen.getByTestId("overview-editor-note")).toBeVisible();
    const bridge = screen.getByTestId("mrr-bridge");
    expect(bridge).toHaveAttribute("data-locked", "admin_only");
    expect(within(bridge).getByRole("group", { name: "Most MRR" })).toBeInTheDocument();
    await screen.findByText("2 aktywne ścieżki");
    expect(h.fetchSnapshot).toHaveBeenCalled();
    expect(h.fetchBridge).not.toHaveBeenCalled();
    expect(h.fetchRealized).not.toHaveBeenCalled();
    // Kwot nie ma nigdzie na Kokpicie redaktora.
    expect(screen.getByTestId("revenue-overview").textContent).not.toMatch(/\d,\d{2}\s?(zł|€)/);
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = renderOverview(["editor"]);
    await tiles();
    await screen.findByText("2 aktywne ścieżki");
    expect(summarize(await axeViolations(container))).toBe("");
  });
});

describe("Kokpit - bez najemcy", () => {
  it("karty mówią „wybierz obszar roboczy” i nie wysyłają zapytań", async () => {
    renderOverview(["admin"], null);
    expect(
      screen.getAllByText("Wybierz obszar roboczy, żeby zobaczyć dane huba.").length,
    ).toBeGreaterThan(0);
    await act(async () => undefined);
    for (const fn of [
      h.fetchSnapshot,
      h.fetchBridge,
      h.fetchFunnel,
      h.fetchFacts,
      h.fetchJourneys,
      h.fetchEvents,
      h.fetchClubs,
    ]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});

describe("RevenueOverviewTab - podmiana zaślepki", () => {
  function renderTab() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <RevenueOverviewTab />
      </QueryClientProvider>,
    );
  }

  it("zachowuje testid, pokazuje Kokpit (h2), nie stan „w przygotowaniu”", async () => {
    h.auth = { roles: ["admin"], tenantId: TENANT };
    renderTab();
    const tab = screen.getByTestId("revenue-tab-overview");
    expect(
      within(tab).getByRole("heading", { level: 2, name: "Najważniejsze wskaźniki" }),
    ).toBeVisible();
    expect(tab).not.toHaveTextContent("Ta sekcja huba jest w przygotowaniu.");
    await tiles();
  });

  it("autor: RoleGateNotice, bez zapytań", async () => {
    h.auth = { roles: ["author"], tenantId: TENANT };
    renderTab();
    expect(screen.getByTestId("revenue-role-gate")).toBeInTheDocument();
    await act(async () => undefined);
    expect(h.fetchSnapshot).not.toHaveBeenCalled();
  });
});

describe("OverviewKpiTiles - wiersz KPI zakładek (S7-C)", () => {
  function renderRow(roles: string[]) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <OverviewKpiTiles
          tenantId={TENANT}
          roles={roles}
          range={testRange()}
          currency={null}
          segment={null}
          tiles={MRR_KPI_TILES}
          titleKey="adminRevenue.mrr.kpiHeading"
        />
      </QueryClientProvider>,
    );
  }

  it("zestaw podany z zewnątrz i własny nagłówek sekcji", async () => {
    renderRow(["admin"]);
    expect(screen.getByRole("heading", { level: 2, name: "Wskaźniki przychodu" })).toBeVisible();
    const kpi = screen.getByTestId("overview-kpi");
    await waitFor(() =>
      expect(kpi.querySelectorAll("[data-tile]").length).toBe(MRR_KPI_TILES.length),
    );
    expect(kpi.querySelectorAll("[data-locked]")).toHaveLength(0);
  });

  it("kafel spoza ról sesji = LockedMetricTile, nie liczba", async () => {
    h.fetchSnapshot.mockImplementation(async () => snapshot("editor"));
    renderRow(["editor"]);
    const kpi = screen.getByTestId("overview-kpi");
    await waitFor(() =>
      expect(kpi.querySelectorAll("[data-locked='admin_only']").length).toBe(MRR_KPI_TILES.length),
    );
    expect(kpi.textContent).not.toMatch(/\d,\d{2}\s?(zł|€)/);
  });
});
