// Zakładka „Wskaźniki" (S7) - podmiana zaślepki I0, słownik S6 z wartościami
// i oceną benchmarku z rejestru, „brak danych" z powodem i odnośnikiem do
// Danych wejściowych, arkusz wskaźnika sterowany adresem `?metric=&ctx=`.
//
// CO TEN PLIK DOWODZI.
//   1. Zakładka zachowuje `data-testid="revenue-tab-metrics"` i nazwę
//      eksportu; zamiast stanu „w przygotowaniu" - sekcja słownika (`h2`).
//   2. Przed hydratacją nic; rola spoza huba - `RoleGateNotice` bez żądań.
//   3. Wartości z migawki oceniane PRAWDZIWYM rejestrem benchmarków S6
//      (5 progów, `evaluateMetricValue`) - zakładka nie zna liczb progów.
//   4. „Brak danych" mówi, czego brakuje: brakujące dane wejściowe
//      z odnośnikiem do Danych wejściowych (administrator), redaktor -
//      „widzi administrator" bez odczytu ekonomiki i bez odnośnika.
//   5. `?metric=` otwiera pełne objaśnienie w arkuszu; nazwa w wierszu
//      słownika i przycisk w karcie braków piszą `?metric=` do adresu
//      (zamiast lokalnego arkusza), zamknięcie usuwa `metric` i `ctx`.
//   6. axe bez naruszeń.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fetchSnapshot: vi.fn(),
  fetchEconomics: vi.fn(),
  navigate: vi.fn(),
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
  useNavigate: () => h.navigate,
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
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
  getRevenueEconomics: (...args: unknown[]) => h.fetchEconomics(...args),
}));
// Treść benchmarków jak z serwera: PRAWDZIWY rejestr zlokalizowany przez
// `buildGroupPayload` (fikstura S6) - ocena w teście to ocena produkcyjna.
vi.mock("@/lib/analytics/semantic/benchmarks/benchmarks.functions", async () => {
  const { payloadFor } = await import(
    "@/components/admin/analytics/semantic/__tests__/benchmarkFixtures"
  );
  return {
    getBenchmarkGroup: async ({ data }: { data: { group: never; lang: never } }) =>
      payloadFor(data.group, data.lang),
  };
});

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { RevenueMetricsTab } from "@/components/admin/revenue/tabs/RevenueMetricsTab";
import { localized } from "@/components/admin/analytics/semantic/__tests__/benchmarkFixtures";
import { evaluateMetricValue } from "@/components/admin/analytics/semantic/hooks/useBenchmark";
import { primaryBenchmarkFor } from "@/lib/analytics/semantic/benchmarks/index";
import { NOW_MS, TENANT, clone } from "../../overview/__tests__/hubFixtures";
import { ECONOMICS, metricsSnapshot } from "./metricsFixtures";

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <RevenueMetricsTab />
      </QueryClientProvider>,
    ),
    queryClient,
  };
}

/** Wywołanie `navigate` jako wynik: nowy adres z poprzedniego i opcja `replace`. */
function lastNavigation(prev: Record<string, unknown> = {}) {
  const call = h.navigate.mock.calls.at(-1)?.[0] as {
    search: (p: Record<string, unknown>) => Record<string, unknown>;
    replace?: boolean;
  };
  return { search: call.search(prev), replace: call.replace };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW_MS);
  h.fetchSnapshot.mockReset().mockResolvedValue(metricsSnapshot("admin"));
  h.fetchEconomics.mockReset().mockResolvedValue({ state: "ready", data: clone(ECONOMICS) });
  h.navigate.mockReset();
  h.hydrated = true;
  h.search = {};
  h.auth = { roles: ["admin"], tenantId: TENANT };
  await i18n.changeLanguage("pl");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RevenueMetricsTab - zaślepka podmieniona, role i hydratacja", () => {
  it("zachowuje data-testid i pokazuje słownik zamiast stanu „w przygotowaniu”", async () => {
    renderTab();
    const tab = screen.getByTestId("revenue-tab-metrics");
    expect(
      await within(tab).findByRole("heading", { level: 2, name: "Słownik wskaźników" }),
    ).toBeVisible();
    expect(tab.textContent).not.toContain("w przygotowaniu");
    expect(within(tab).getByTestId("metrics-scope")).toHaveTextContent(
      "Kontekst porównania: Wszystkie segmenty",
    );
  });

  it("przed hydratacją nic nie pyta", () => {
    h.hydrated = false;
    renderTab();
    expect(screen.queryByTestId("revenue-metrics-view")).toBeNull();
    expect(h.fetchSnapshot).not.toHaveBeenCalled();
  });

  it("autor dostaje RoleGateNotice bez jednego żądania", async () => {
    h.auth = { roles: ["author"], tenantId: TENANT };
    renderTab();
    expect(await screen.findByTestId("revenue-role-gate")).toBeInTheDocument();
    expect(h.fetchSnapshot).not.toHaveBeenCalled();
    expect(h.fetchEconomics).not.toHaveBeenCalled();
  });
});

describe("wartości z oceną benchmarku z rejestru S6", () => {
  it("churn klientów: „teraz” z migawki i ocena 5 progami prawdziwego rejestru", async () => {
    renderTab();
    const dictionaryRow = await screen.findByText(
      (_, el) => el?.matches('tr[data-metric="logo_churn_monthly"]') ?? false,
    );
    expect(dictionaryRow.querySelector("[data-now]")?.textContent).toBe("3 %");

    const entry = primaryBenchmarkFor("logo_churn_monthly");
    if (!entry) throw new Error("rejestr: churn klientów bez benchmarku");
    const expected = evaluateMetricValue(
      "logo_churn_monthly",
      0.03,
      localized(entry.group, entry.key, "pl"),
      { currency: "PLN" },
    );
    expect(["critical", "weak", "normal", "good", "optimal"]).toContain(expected.tier);
    await vi.waitFor(() =>
      expect(dictionaryRow.querySelector("[data-tier]")?.getAttribute("data-tier")).toBe(
        expected.tier,
      ),
    );
  });

  it("kwoty w walucie wiodącej - podpis waluty, MRR bez sumy walut", async () => {
    renderTab();
    expect(await screen.findByText(/Kwoty w walucie PLN/)).toBeVisible();
    const mrr = await screen.findByText(
      (_, el) => el?.matches('tr[data-metric="mrr"] [data-now]') ?? false,
    );
    expect(mrr.textContent).toMatch(/12\s?000,00\s?zł/);
  });
});

describe("„brak danych” mówi, czego brakuje", () => {
  it("administrator: brakujące dane wejściowe z odnośnikiem do Danych wejściowych", async () => {
    renderTab();
    const card = await screen.findByTestId("metrics-missing");
    const inputs = await within(card).findByText(/brakuje danych wejściowych: Marża EBITDA/);
    const group = inputs.closest("[data-reason]") as HTMLElement;
    expect(group).toHaveAttribute("data-reason", "inputs");
    expect(within(group).getByRole("button", { name: /Reguła 40/ })).toBeVisible();
    expect(within(group).getByRole("link", { name: "Uzupełnij dane wejściowe" })).toHaveAttribute(
      "href",
      "/admin/revenue/inputs",
    );
    // Pozostałe powody z odpowiedzi producentów.
    const reasons = [...card.querySelectorAll("[data-reason]")].map((el) =>
      el.getAttribute("data-reason"),
    );
    expect(reasons).toEqual(
      expect.arrayContaining(["inputs", "full_year", "not_configured", "no_base", "not_measured"]),
    );
  });

  it("NRR przed rokiem od początku księgi - „historia od … - wynik pełny od …”", async () => {
    h.fetchSnapshot.mockResolvedValue(metricsSnapshot("admin", { dataSince: "2026-03-01" }));
    renderTab();
    const card = await screen.findByTestId("metrics-missing");
    expect(
      await within(card).findByText(/historia od 2026-03-01 - wynik pełny od 2027-03-01/),
    ).toBeVisible();
  });

  it("redaktor: „widzi administrator”, bez odczytu ekonomiki i bez odnośnika", async () => {
    h.auth = { roles: ["editor"], tenantId: TENANT };
    h.fetchSnapshot.mockResolvedValue(metricsSnapshot("editor"));
    renderTab();
    const card = await screen.findByTestId("metrics-missing");
    expect(
      await within(card).findByText(/widzi wyłącznie administrator/),
    ).toBeVisible();
    expect(card.querySelector('[data-reason="inputs"]')).toBeNull();
    expect(within(card).queryByRole("link", { name: "Uzupełnij dane wejściowe" })).toBeNull();
    expect(h.fetchEconomics).not.toHaveBeenCalled();
  });

  it("przycisk wskaźnika w karcie braków otwiera arkusz przez adres", async () => {
    renderTab();
    const card = await screen.findByTestId("metrics-missing");
    fireEvent.click(await within(card).findByRole("button", { name: /Reguła 40/ }));
    expect(lastNavigation({ w: "prev-month" }).search).toEqual({
      w: "prev-month",
      metric: "rule_of_40",
      ctx: undefined,
    });
  });
});

describe("arkusz wskaźnika z adresu ?metric=&ctx=", () => {
  it("?metric= otwiera pełne objaśnienie; zamknięcie usuwa metric i ctx", async () => {
    h.search = { metric: "net_revenue_retention", ctx: "nieznany" };
    renderTab();
    const sheet = await screen.findByRole("dialog");
    expect(await within(sheet).findByText((_, el) => el?.getAttribute("data-explainer-mode") === "full")).toBeInTheDocument();
    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(lastNavigation({ w: "prev-month", metric: "net_revenue_retention", ctx: "x" })).toEqual({
      search: { w: "prev-month", metric: undefined, ctx: undefined },
      replace: undefined,
    });
  });

  it("nieznany ?metric= nie otwiera arkusza", async () => {
    h.search = { metric: "nope" };
    renderTab();
    await screen.findByTestId("metrics-missing");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("nazwa wskaźnika w wierszu słownika pisze ?metric= zamiast lokalnego arkusza", async () => {
    renderTab();
    const row = await screen.findByText(
      (_, el) => el?.matches('tr[data-metric="logo_churn_monthly"]') ?? false,
    );
    fireEvent.click(within(row).getAllByRole("button")[0]);
    expect(lastNavigation({}).search).toEqual({ metric: "logo_churn_monthly", ctx: undefined });
    // Lokalny arkusz słownika się nie otworzył - jedyny arkusz to ten z adresu.
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("dostępność", () => {
  it("axe bez naruszeń - słownik z wartościami i karta braków", async () => {
    const view = renderTab();
    await screen.findByText((_, el) => el?.matches('tr[data-metric="mrr"] [data-now]') ?? false);
    await screen.findByTestId("metrics-missing");
    await act(async () => undefined);
    expect(summarize(await axeViolations(view.container))).toBe("");
  });
});
