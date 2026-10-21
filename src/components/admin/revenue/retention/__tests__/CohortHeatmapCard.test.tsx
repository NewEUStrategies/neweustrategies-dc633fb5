// `CohortHeatmapCard` - kohorty miesięczne jako mapa ciepła (S7, SPEC §6.2:
// „kohorty `heatmap`"; karta S7: „kohorty przed 12 m od data_since = „dane
// od …”, nigdy 0").
//
// CO TEN PLIK DOWODZI.
//   1. Zakres miesięcy wynika z okna huba (koniec = miesiąc ostatniego dnia
//      okna, `COHORT_ROWS` miesięcy) i trafia do RPC jako `YYYY-MM-01`.
//   2. Rama silnika dostaje rodzaj `heatmap`: wiersz = kohorta, kolumna =
//      miesiąc życia; komórka miesiąca, który nie minął, jest PUSTA (`null`),
//      nigdy 0 - i podpis mówi to wprost.
//   3. Przed 12 mies. od początku księgi - „Historia od … - wynik pełny od …".
//   4. Brak kohort - zdanie; redaktor - kafel zablokowany bez RPC; stany
//      karty; axe bez naruszeń.
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ fetchCohorts: vi.fn() }));

vi.mock("@/lib/revenue/finance/finance.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue/finance/finance.functions")>()),
  getRevenueCohorts: (...args: unknown[]) => h.fetchCohorts(...args),
}));
vi.mock("@/components/admin/analytics/ChartCard", () => ({
  ChartCard: (props: {
    title: string;
    config: {
      kind: string;
      unit: string;
      categories: string[];
      series: { name: string; values: (number | null)[] }[];
    };
    csv?: { headers: string[]; rows: readonly (readonly unknown[])[] };
    footer?: ReactNode;
  }) => (
    <figure
      data-testid="cohort-chart"
      data-kind={props.config.kind}
      data-unit={props.config.unit}
      data-categories={props.config.categories.join("|")}
      data-rows={props.config.series.map((s) => s.name).join("|")}
      data-values={props.config.series.map((s) => s.values.join(",")).join("|")}
      data-csv={JSON.stringify(props.csv?.rows ?? [])}
    >
      <figcaption>{props.title}</figcaption>
      {props.footer}
    </figure>
  ),
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { CohortHeatmapCard } from "@/components/admin/revenue/retention/CohortHeatmapCard";
import type { SnapshotMeta } from "@/components/admin/revenue/mrr/useSnapshotMeta";
import { NOW_MS, TENANT, clone, testRange } from "../../overview/__tests__/hubFixtures";
import { COHORTS, DATA_SINCE } from "../../mrr/__tests__/financeFixtures";

const META: SnapshotMeta = { dataSince: DATA_SINCE, leadingCurrency: "PLN", winback12m: null };

function renderCard(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW_MS);
  h.fetchCohorts.mockReset().mockResolvedValue({ state: "ready", data: clone(COHORTS) });
  await i18n.changeLanguage("pl");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CohortHeatmapCard", () => {
  it("zakres z okna huba: 10 miesięcy do miesiąca ostatniego dnia okna", async () => {
    renderCard(
      <CohortHeatmapCard
        tenantId={TENANT}
        roles={["admin"]}
        range={testRange("prev-month")}
        meta={META}
      />,
    );
    expect(await screen.findByTestId("cohorts-range")).toHaveTextContent(
      "Kohorty od gru 2025 do wrz 2026",
    );
    expect(h.fetchCohorts).toHaveBeenCalledWith({
      data: { fromMonth: "2025-12-01", toMonth: "2026-09-01" },
    });
  });

  it("mapa ciepła: wiersz = kohorta, kolumna = miesiąc; puste pole, nigdy 0", async () => {
    renderCard(
      <CohortHeatmapCard
        tenantId={TENANT}
        roles={["admin"]}
        range={testRange("prev-month")}
        meta={META}
      />,
    );
    const chart = await screen.findByTestId("cohort-chart");
    expect(chart).toHaveAttribute("data-kind", "heatmap");
    expect(chart).toHaveAttribute("data-unit", "%");
    expect(chart.getAttribute("data-categories")?.split("|")).toHaveLength(13);
    expect(chart.getAttribute("data-categories")?.startsWith("Miesiąc 0|Miesiąc 1")).toBe(true);
    expect(chart).toHaveAttribute("data-rows", "sie 2026|wrz 2026");
    const [august, september] = (chart.getAttribute("data-values") ?? "").split("|");
    // Sierpień: M0 100 %, M1 80 %, dalej puste pola; wrzesień: tylko M0.
    expect(august?.split(",").slice(0, 3)).toEqual(["100", "80", ""]);
    expect(september?.split(",").slice(0, 2)).toEqual(["100", ""]);
    expect((chart.getAttribute("data-values") ?? "").split(/[,|]/)).not.toContain("0");
    // Eksport CSV: puste pole zostaje puste (null), z liczebnością kohorty.
    const csv = JSON.parse(chart.getAttribute("data-csv") ?? "[]") as unknown[][];
    expect(csv[0]?.slice(0, 5)).toEqual(["2026-08", 10, 100, 80, null]);
    expect(screen.getByTestId("cohorts-not-elapsed")).toHaveTextContent(
      "Puste pola to miesiące, które jeszcze nie minęły - to nie jest zero.",
    );
  });

  it("przed 12 mies. od początku księgi: „Historia od … - wynik pełny od …”", async () => {
    renderCard(
      <CohortHeatmapCard
        tenantId={TENANT}
        roles={["admin"]}
        range={testRange("prev-month")}
        meta={META}
      />,
    );
    expect(
      await screen.findByText("Historia od 1 marca 2026 - wynik pełny od 1 marca 2027"),
    ).toBeVisible();
  });

  it("brak kohort w zakresie: zdanie zamiast mapy", async () => {
    h.fetchCohorts.mockResolvedValue({
      state: "ready",
      data: { ...(clone(COHORTS) as object), cohorts: [] },
    });
    renderCard(
      <CohortHeatmapCard tenantId={TENANT} roles={["admin"]} range={testRange()} meta={META} />,
    );
    expect(
      await screen.findByText(
        "Brak kohort w tym zakresie - kohorta powstaje z pierwszym nowym zakupem w miesiącu.",
      ),
    ).toBeVisible();
    expect(screen.queryByTestId("cohort-chart")).toBeNull();
  });

  it("odmowa: zdanie w karcie, nie toast", async () => {
    h.fetchCohorts.mockResolvedValue({ state: "forbidden" });
    renderCard(
      <CohortHeatmapCard tenantId={TENANT} roles={["admin"]} range={testRange()} meta={META} />,
    );
    expect(
      await screen.findByText("Kwoty przychodu widzą wyłącznie administratorzy."),
    ).toBeVisible();
  });

  it("redaktor: kafel zablokowany, RPC niewołane", async () => {
    renderCard(
      <CohortHeatmapCard tenantId={TENANT} roles={["editor"]} range={testRange()} meta={META} />,
    );
    expect(screen.getByTestId("cohort-heatmap")).toHaveAttribute("data-locked", "admin_only");
    await act(async () => undefined);
    expect(h.fetchCohorts).not.toHaveBeenCalled();
  });

  it("po angielsku i bez naruszeń dostępności", async () => {
    await i18n.changeLanguage("en");
    const { container } = renderCard(
      <CohortHeatmapCard
        tenantId={TENANT}
        roles={["admin"]}
        range={testRange("prev-month")}
        meta={META}
      />,
    );
    const card = await screen.findByTestId("cohort-heatmap");
    expect(await within(card).findByTestId("cohort-chart")).toHaveTextContent(
      "Empty cells are months that have not passed yet - they are not zero.",
    );
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
