// Zakładka „Retencja" (S7) - podmiana zaślepki I0, role, wiersz KPI,
// odejścia z trendem, kohorty, przepływ anulowania, oferty, powody
// i windykacja.
//
// CO TEN PLIK DOWODZI.
//   1. Zakładka zachowuje `data-testid="revenue-tab-retention"` i nazwę
//      eksportu; zamiast stanu „w przygotowaniu" - sekcje (`h2`).
//   2. Przed hydratacją - „wczytywanie"; redaktor, autor i `super_admin`
//      dostają `RoleGateNotice` bez jednego żądania.
//   3. Wiersz KPI = `RETENTION_KPI_TILES` z migawki (jedno żądanie migawki
//      także dla metadanych); waluta wiodąca NRR/GRR podpisana (Z-S2-05).
//   4. NRR/GRR per waluta z poprzednim okresem; waluta bez mianownika = „-"
//      z przypisem, NIGDY 0 %; przed 12 mies. od początku księgi - „Historia
//      od … - wynik pełny od …" (karta S7).
//   5. Przepływ anulowania: 2 kroki przy ofercie, 1 przy wyłączonej retencji;
//      źródło prawdy - Cennik.
//   6. Windykacja per waluta, odnośnik do Rozliczeń; oferty i powody - jedno
//      żądanie przepływu; axe bez naruszeń.
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fetchSnapshot: vi.fn(),
  fetchChurn: vi.fn(),
  fetchCohorts: vi.fn(),
  fetchDunning: vi.fn(),
  fetchOffers: vi.fn(),
  fetchSettings: vi.fn(),
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
  getRevenueChurn: (...args: unknown[]) => h.fetchChurn(...args),
  getRevenueCohorts: (...args: unknown[]) => h.fetchCohorts(...args),
  getRevenueDunning: (...args: unknown[]) => h.fetchDunning(...args),
  getRevenueRetentionOffers: (...args: unknown[]) => h.fetchOffers(...args),
}));
vi.mock("@/lib/retention/queries", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/retention/queries")>();
  return {
    ...orig,
    retentionSettingsQueryOptions: (
      ...args: Parameters<typeof orig.retentionSettingsQueryOptions>
    ) => ({
      ...orig.retentionSettingsQueryOptions(...args),
      queryFn: () => h.fetchSettings(...args),
    }),
  };
});
vi.mock("@/components/admin/analytics/semantic/hooks/useBenchmark", async (importOriginal) => {
  const { noBenchmark } = await import("../../funnel/__tests__/funnelTestKit");
  return {
    ...(await importOriginal<
      typeof import("@/components/admin/analytics/semantic/hooks/useBenchmark")
    >()),
    useBenchmark: noBenchmark,
  };
});
vi.mock("@/components/admin/analytics/ChartCard", () => ({
  ChartCard: (props: { title: string; config: { kind: string }; footer?: ReactNode }) => (
    <figure data-testid="chart" data-kind={props.config.kind}>
      <figcaption>{props.title}</figcaption>
      {props.footer}
    </figure>
  ),
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { RevenueRetentionTab } from "@/components/admin/revenue/tabs/RevenueRetentionTab";
import { RETENTION_KPI_TILES } from "@/lib/admin/revenue/overviewTiles";
import { NOW_MS, TENANT, clone } from "../../overview/__tests__/hubFixtures";
import {
  CHURN,
  CHURN_PREVIOUS,
  COHORTS,
  DUNNING,
  RETENTION_OFFERS,
  RETENTION_SETTINGS,
  adminSnapshot,
} from "../../mrr/__tests__/financeFixtures";

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <RevenueRetentionTab />
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
  h.fetchChurn,
  h.fetchCohorts,
  h.fetchDunning,
  h.fetchOffers,
  h.fetchSettings,
];

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW_MS);
  h.fetchSnapshot.mockReset().mockResolvedValue(adminSnapshot());
  // Bieżące okno (wrzesień) i poprzednie (sierpień) - rozróżnione po granicy.
  h.fetchChurn.mockReset().mockImplementation((input: { data: { sinceIso: string } }) =>
    Promise.resolve({
      state: "ready",
      data: clone(input.data.sinceIso.startsWith("2026-08") ? CHURN_PREVIOUS : CHURN),
    }),
  );
  h.fetchCohorts.mockReset().mockResolvedValue({ state: "ready", data: clone(COHORTS) });
  h.fetchDunning.mockReset().mockResolvedValue({ state: "ready", data: clone(DUNNING) });
  h.fetchOffers.mockReset().mockResolvedValue({ state: "ready", data: clone(RETENTION_OFFERS) });
  h.fetchSettings.mockReset().mockResolvedValue(clone(RETENTION_SETTINGS));
  h.hydrated = true;
  h.search = {};
  h.auth = { roles: ["admin"], tenantId: TENANT };
  await i18n.changeLanguage("pl");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RevenueRetentionTab - podmiana zaślepki i role", () => {
  it("zachowuje testid, pokazuje sekcje (h2), nie stan „w przygotowaniu”", async () => {
    renderTab();
    const tab = screen.getByTestId("revenue-tab-retention");
    expect(
      await within(tab).findByRole("heading", { level: 2, name: "Wskaźniki retencji" }),
    ).toBeVisible();
    expect(
      within(tab).getByRole("heading", { level: 2, name: "Odejścia i kohorty" }),
    ).toBeVisible();
    expect(
      within(tab).getByRole("heading", { level: 2, name: "Anulowanie, powody i windykacja" }),
    ).toBeVisible();
    expect(tab).not.toHaveTextContent("Ta sekcja huba jest w przygotowaniu.");
  });

  it("przed hydratacją: wyłącznie „wczytywanie”, bez żądań", async () => {
    h.hydrated = false;
    renderTab();
    expect(screen.getByTestId("revenue-tab-retention")).toHaveTextContent("Wczytywanie sekcji…");
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

describe("RevenueRetentionTab - KPI, odejścia i „dane od …”", () => {
  it("kafle RETENTION_KPI_TILES; jedno żądanie migawki; waluta wiodąca podpisana", async () => {
    renderTab();
    const kpi = await screen.findByTestId("overview-kpi");
    await vi.waitFor(() =>
      expect(kpi.querySelectorAll("[data-tile]").length).toBe(RETENTION_KPI_TILES.length),
    );
    expect(await screen.findByTestId("tab-scope-notes")).toHaveTextContent(
      "w walucie wiodącej PLN",
    );
    expect(h.fetchSnapshot).toHaveBeenCalledTimes(1);
  });

  it("NRR/GRR per waluta z poprzednim okresem; brak mianownika = „-”, nigdy 0 %", async () => {
    renderTab();
    const table = await screen.findByRole("table", {
      name: "Retencja przychodu według waluty - ten okres i poprzedni",
    });
    const pln = table.querySelector('tr[data-currency="PLN"]') as HTMLElement;
    const nrr = pln.querySelector('[data-ratio="netRevenueRetention"]');
    expect(text(nrr)).toContain("99 %");
    expect(text(nrr)).toContain("poprzednio 96,8 %");
    const eur = table.querySelector('tr[data-currency="EUR"]') as HTMLElement;
    expect(eur.querySelectorAll('[data-value="none"]')).toHaveLength(3);
    expect(text(eur)).not.toMatch(/\b0\s?%/);
    const card = screen.getByTestId("churn-trend");
    expect(within(card).getByTestId("no-value-footnote")).toHaveTextContent(
      "Tej liczby nie da się policzyć",
    );
    // Churn klientów: bieżący i poprzedni okres.
    expect(text(card)).toContain("poprzednio 5 %");
    // Poprzednie okno czytane tą samą fabryką: dwa żądania churnu.
    expect(h.fetchChurn).toHaveBeenCalledTimes(2);
  });

  it("przed 12 mies. od początku księgi: „Historia od … - wynik pełny od …”", async () => {
    renderTab();
    const card = await screen.findByTestId("churn-trend");
    expect(
      await within(card).findByText("Historia od 1 marca 2026 - wynik pełny od 1 marca 2027"),
    ).toBeVisible();
    expect(within(card).getByTestId("churn-winback")).toHaveTextContent("12 %");
    const cohorts = await screen.findByTestId("cohort-heatmap");
    expect(
      await within(cohorts).findByText("Historia od 1 marca 2026 - wynik pełny od 1 marca 2027"),
    ).toBeVisible();
  });
});

describe("RevenueRetentionTab - przepływ anulowania, oferty, powody i windykacja", () => {
  it("przepływ z ofertą: 2 kroki, rabat i okresy; źródło prawdy w Cenniku", async () => {
    renderTab();
    const card = await screen.findByTestId("cancel-flow");
    expect(await within(card).findByTestId("cancel-flow-count")).toHaveTextContent(
      "2 kroki do anulowania",
    );
    const steps = within(within(card).getByTestId("cancel-flow-steps")).getAllByRole("listitem");
    expect(steps.map((s) => s.getAttribute("data-step"))).toEqual(["reason", "offer"]);
    expect(steps[1]).toHaveTextContent("Oferta: 20 % rabatu przez 3 okresy rozliczeniowe");
    expect(card).toHaveTextContent("„Anuluj mimo to” jest dostępne na każdym kroku");
    expect(within(card).getByRole("link", { name: "Otwórz: Cennik - retencja" })).toHaveAttribute(
      "href",
      "/admin/pricing",
    );
  });

  it("retencja wyłączona: 1 krok - samo potwierdzenie", async () => {
    h.fetchSettings.mockResolvedValue({ ...(clone(RETENTION_SETTINGS) as object), enabled: false });
    renderTab();
    const card = await screen.findByTestId("cancel-flow");
    expect(await within(card).findByTestId("cancel-flow-count")).toHaveTextContent(
      "1 krok do anulowania",
    );
    expect(card).toHaveTextContent("Retencja jest wyłączona");
  });

  it("oferty i powody - jedno żądanie przepływu; skuteczność netto bez mianownika = „-”", async () => {
    renderTab();
    const offers = await screen.findByTestId("retention-offers");
    await within(offers).findByText("Skuteczność zatrzymania");
    expect(text(offers.querySelector('[data-rate="saveRateGross"]'))).toContain("37,5 %");
    expect(offers.querySelector('[data-rate="saveRateNet"] [data-value="none"]')).not.toBeNull();
    await screen.findByTestId("churn-reasons-table");
    expect(h.fetchOffers).toHaveBeenCalledTimes(1);
  });

  it("windykacja: kwoty per waluta, mediana bez odzysków = „-”, odnośnik do Rozliczeń", async () => {
    renderTab();
    const card = await screen.findByTestId("dunning");
    await within(card).findByText("Skuteczność odzyskania");
    expect(text(card.querySelector('[data-rate="recoveryRate"]'))).toContain("75 %");
    expect(
      card.querySelector('[data-rate="medianDaysToRecover"] [data-value="none"]'),
    ).not.toBeNull();
    const lost = card.querySelector('[data-amount="lostMrr"]') as HTMLElement;
    expect(lost.querySelector('[data-currency="PLN"]')).not.toBeNull();
    expect(text(lost)).not.toContain("59,00");
    expect(
      within(card).getByRole("link", { name: "Otwórz: Rozliczenia - subskrypcje" }),
    ).toHaveAttribute("href", "/admin/billing");
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = renderTab();
    await screen.findByTestId("churn-trend-table");
    await screen.findByTestId("churn-reasons-table");
    await screen.findByTestId("cancel-flow-steps");
    await screen.findAllByTestId("chart");
    await within(screen.getByTestId("dunning")).findByText("Skuteczność odzyskania");
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
