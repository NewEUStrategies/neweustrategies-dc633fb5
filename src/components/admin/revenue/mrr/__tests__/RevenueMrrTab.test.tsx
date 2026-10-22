// Zakładka „Przychód" (S7) - podmiana zaślepki I0, role, wiersz KPI z migawki
// spod klucza BI, szereg MRR, most, ruchy, przychód zrealizowany i zgodność.
//
// CO TEN PLIK DOWODZI.
//   1. Zakładka zachowuje `data-testid="revenue-tab-mrr"` i nazwę eksportu,
//      zamiast stanu „w przygotowaniu" pokazuje sekcje (`h2`).
//   2. Przed hydratacją - wyłącznie „wczytywanie"; role DOKŁADNE: redaktor,
//      autor i sam `super_admin` dostają `RoleGateNotice` bez jednego żądania.
//   3. Wiersz KPI = `MRR_KPI_TILES`, przychód zrealizowany z migawki spod
//      TEGO SAMEGO klucza co BI (`revenueSnapshotQueryOptions(t, okno, {})`);
//      metadane migawki nie dokładają żądania.
//   4. Szereg MRR: ziarno z okna, strefa przeglądarki, wykres per waluta
//      z największą różnicą migawki i księgi; brak migawki nazwany.
//   5. Most i ruchy - jedno żądanie mostu; rozbicie i zgodność - jedno
//      żądanie przychodu zrealizowanego.
//   6. Waluta wiodąca wskaźników ilorazowych (Z-S2-05) i zakres segmentu
//      podpisane; bez najemcy - zero żądań; axe bez naruszeń.
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fetchSnapshot: vi.fn(),
  fetchBridge: vi.fn(),
  fetchSeries: vi.fn(),
  fetchRealized: vi.fn(),
  fetchChurn: vi.fn(),
  hydrated: true,
  search: {} as Record<string, unknown>,
  auth: {
    roles: ["admin"] as string[],
    tenantId: "11111111-1111-4111-8111-111111111111" as string | undefined,
  },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useHydrated: () => h.hydrated,
  useSearch: () => h.search,
  useNavigate: () => vi.fn(),
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
  getRevenueMrrSeries: (...args: unknown[]) => h.fetchSeries(...args),
  getRevenueRealized: (...args: unknown[]) => h.fetchRealized(...args),
  getRevenueChurn: (...args: unknown[]) => h.fetchChurn(...args),
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
// Rama wykresu ma własne testy; tu liczy się, CO karta jej podaje.
vi.mock("@/components/admin/analytics/ChartCard", () => ({
  ChartCard: (props: {
    title: string;
    config: { kind: string; series: { name: string; values: (number | null)[] }[] };
    footer?: ReactNode;
  }) => (
    <figure
      data-testid="chart"
      data-kind={props.config.kind}
      data-series={props.config.series.map((s) => s.name).join("|")}
      data-values={props.config.series.map((s) => s.values.join(",")).join("|")}
    >
      <figcaption>{props.title}</figcaption>
      {props.footer}
    </figure>
  ),
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { RevenueMrrTab } from "@/components/admin/revenue/tabs/RevenueMrrTab";
import { hubWindowOf } from "@/components/admin/revenue/overview/hubWindow";
import { MRR_KPI_TILES } from "@/lib/admin/revenue/overviewTiles";
import { revenueSnapshotQueryOptions } from "@/lib/analytics/semantic/revenueSnapshot.functions";
import { MRR_BRIDGE, NOW_MS, TENANT, clone } from "../../overview/__tests__/hubFixtures";
import { CHURN, MRR_SERIES, REALIZED, adminSnapshot } from "./financeFixtures";

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <RevenueMrrTab />
      </QueryClientProvider>,
    ),
    queryClient,
  };
}

function text(el: Element | null): string {
  return (el?.textContent ?? "").replace(/\s/g, " ");
}

const ALL_FETCHES = () => [
  h.fetchSnapshot,
  h.fetchBridge,
  h.fetchSeries,
  h.fetchRealized,
  h.fetchChurn,
];

beforeEach(async () => {
  // Tylko zegar `Date` - okno huba liczy „teraz" przy wejściu na zakładkę.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW_MS);
  h.fetchSnapshot.mockReset().mockResolvedValue(adminSnapshot());
  h.fetchBridge.mockReset().mockResolvedValue({ state: "ready", data: clone(MRR_BRIDGE) });
  h.fetchSeries.mockReset().mockResolvedValue({ state: "ready", data: clone(MRR_SERIES) });
  h.fetchRealized.mockReset().mockResolvedValue({ state: "ready", data: clone(REALIZED) });
  h.fetchChurn.mockReset().mockResolvedValue({ state: "ready", data: clone(CHURN) });
  h.hydrated = true;
  h.search = {};
  h.auth = { roles: ["admin"], tenantId: TENANT };
  await i18n.changeLanguage("pl");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RevenueMrrTab - podmiana zaślepki i role", () => {
  it("zachowuje testid, pokazuje sekcje (h2), nie stan „w przygotowaniu”", async () => {
    renderTab();
    const tab = screen.getByTestId("revenue-tab-mrr");
    expect(
      await within(tab).findByRole("heading", { level: 2, name: "Wskaźniki przychodu" }),
    ).toBeVisible();
    expect(within(tab).getByRole("heading", { level: 2, name: "Księga MRR" })).toBeVisible();
    expect(
      within(tab).getByRole("heading", {
        level: 2,
        name: "Przychód zrealizowany i zgodność źródeł",
      }),
    ).toBeVisible();
    expect(tab).not.toHaveTextContent("Ta sekcja huba jest w przygotowaniu.");
  });

  it("przed hydratacją: wyłącznie „wczytywanie”, bez żądań", async () => {
    h.hydrated = false;
    renderTab();
    expect(screen.getByTestId("revenue-tab-mrr")).toHaveTextContent("Wczytywanie sekcji…");
    await act(async () => undefined);
    for (const fetch of ALL_FETCHES()) expect(fetch).not.toHaveBeenCalled();
  });

  it.each([[["editor"]], [["author"]], [["super_admin"]]])(
    "role %o: RoleGateNotice (tylko administrator), żadnego żądania",
    async (roles) => {
      h.auth = { roles, tenantId: TENANT };
      renderTab();
      expect(screen.getByTestId("revenue-role-gate")).toHaveAttribute(
        "data-required-role",
        "admin",
      );
      await act(async () => undefined);
      for (const fetch of ALL_FETCHES()) expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("bez najemcy: stany kart, żadnego żądania", async () => {
    h.auth = { roles: ["admin"], tenantId: undefined };
    renderTab();
    expect(
      (await screen.findAllByText("Wybierz obszar roboczy, żeby zobaczyć dane huba.")).length,
    ).toBeGreaterThan(3);
    for (const fetch of ALL_FETCHES()) expect(fetch).not.toHaveBeenCalled();
  });
});

describe("RevenueMrrTab - wiersz KPI z migawki (klucz BI)", () => {
  it("kafle MRR_KPI_TILES; przychód zrealizowany spod klucza BI, jedno żądanie migawki", async () => {
    const { queryClient } = renderTab();
    const kpi = await screen.findByTestId("overview-kpi");
    await vi.waitFor(() =>
      expect(kpi.querySelectorAll("[data-tile]").length).toBe(MRR_KPI_TILES.length),
    );
    const realized = kpi.querySelector('[data-tile="revenue_realized"]');
    expect(text(realized)).toContain("11 800,00 zł");
    // Ten sam klucz, który buduje sekcja BI: okno huba, bez filtrów.
    const { range } = hubWindowOf("mrr", {}, NOW_MS);
    const biKey = revenueSnapshotQueryOptions(TENANT, range, {}).queryKey;
    expect(queryClient.getQueryCache().find({ queryKey: biKey, exact: true })).toBeDefined();
    expect(h.fetchSnapshot).toHaveBeenCalledTimes(1);
  });

  it("waluta wiodąca wskaźników ilorazowych podpisana (Z-S2-05)", async () => {
    renderTab();
    const notes = await screen.findByTestId("tab-scope-notes");
    expect(notes).toHaveTextContent("w walucie wiodącej PLN");
    expect(notes.querySelector('[data-note="all-segments"]')).toBeNull();
  });

  it("filtr segmentu: zdanie o kartach bez segmentu; most zawężony, szereg nie", async () => {
    h.search = { seg: "b2b_institution" };
    renderTab();
    const notes = await screen.findByTestId("tab-scope-notes");
    expect(notes.querySelector('[data-note="all-segments"]')).toHaveTextContent(
      "Szereg MRR, powody odejść i przychód zrealizowany obejmują wszystkie segmenty.",
    );
    await screen.findByTestId("mrr-movements-table");
    expect(h.fetchBridge.mock.calls[0]?.[0]).toMatchObject({
      data: { segment: "b2b_institution" },
    });
    expect(h.fetchSeries.mock.calls[0]?.[0]).not.toHaveProperty("data.segment");
  });
});

describe("RevenueMrrTab - księga MRR i przychód zrealizowany", () => {
  it("szereg: ziarno z okna, strefa przeglądarki, wykres na walutę z różnicą migawki", async () => {
    renderTab();
    const card = await screen.findByTestId("mrr-series");
    expect(within(card).getByRole("heading", { level: 3, name: "MRR w czasie" })).toBeVisible();
    const charts = await within(card).findAllByTestId("chart");
    expect(charts.map((c) => c.querySelector("figcaption")?.textContent)).toEqual([
      "MRR w PLN",
      "MRR w EUR",
    ]);
    expect(charts[0]).toHaveAttribute("data-kind", "line");
    expect(charts[0]).toHaveAttribute("data-series", "Księga|Migawka dzienna");
    // Brak migawki to przerwa w linii, nie zero.
    expect(charts[1]).toHaveAttribute("data-values", "1000|");
    expect(text(charts[0] as Element)).toContain(
      "Największa różnica migawki i księgi: 49,00 zł (1 września 2026).",
    );
    expect(charts[1]).toHaveTextContent(
      "Część punktów nie ma migawki dziennej - tam rysujemy tylko księgę.",
    );
    expect(h.fetchSeries.mock.calls[0]?.[0]).toMatchObject({
      data: { grain: "day", timeZone: "UTC" },
    });
    expect(card).toHaveTextContent("Punkty: dzienne, strefa UTC");
  });

  it("most i ruchy - jedno żądanie mostu; rozbicie i zgodność - jedno żądanie przychodu", async () => {
    renderTab();
    await screen.findByTestId("mrr-movements-table");
    await screen.findByTestId("realized-table");
    await screen.findByTestId("reconciliation-table");
    expect(screen.getByTestId("mrr-bridge")).toHaveAttribute("data-variant", "full");
    expect(h.fetchBridge).toHaveBeenCalledTimes(1);
    expect(h.fetchRealized).toHaveBeenCalledTimes(1);
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = renderTab();
    await screen.findByTestId("mrr-movements-table");
    await screen.findByTestId("realized-table");
    await screen.findByTestId("reconciliation-table");
    await screen.findAllByTestId("chart");
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
