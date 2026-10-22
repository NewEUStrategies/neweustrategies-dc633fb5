// Tabela maili ścieżki (S8-B) - liczby, oceny rejestru S6, MPP; RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. `caption` i `scope` (kolumny i wiersze), wiersze w kolejności numeracji
//      kanwy, nazwa kroku i temat wariantu A w nagłówku wiersza, przewijany
//      region z nazwą.
//   2. Każdy wskaźnik dostaje ocenę z rejestru S6 (`BenchmarkTierBadge`):
//      poziom przy dużej próbie, jawny powód przy małej („za mała próba”);
//      CTOR z dopiskiem, że to benchmark kampanii.
//   3. Dymek MPP przy otwarciach ludzkich i CTOR - przycisk z nazwą, treść
//      dymka mówi o górnej granicy (Z-S5-06).
//   4. Mail bez wysyłek w oknie: jedno zdanie zamiast rzędu zer; pusta lista -
//      „ta wersja nie wysyła maili”. axe bez naruszeń.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
  bench: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.("pl"), i18n: { language: "pl" }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/lib/analytics/semantic/benchmarks/benchmarks.functions", async () => {
  const { payloadFor } =
    await import("@/components/admin/analytics/semantic/__tests__/benchmarkFixtures");
  return {
    getBenchmarkGroup: ({ data }: { data: { group: "email"; lang: "pl" | "en" } }) => {
      h.bench(data);
      return Promise.resolve(payloadFor(data.group, data.lang));
    },
  };
});

import { JourneyEmailsTable } from "../JourneyEmailsTable";
import { journeyEmailRows, type JourneyEmailRow } from "@/lib/admin/journeys/results";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import { RPC_SHAPES } from "@/lib/journeys/__tests__/rpcShapes.fixture";
import { parseJourneyStats } from "@/lib/journeys/parse";
import "@/lib/i18n-admin-revenue-shell";
import "@/lib/i18n-admin-journeys";
import "@/lib/i18n-admin-journeys-results";

h.fixedT = realT;
const t = realT("pl");

function clone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

const GRAPH = {
  nodes: [
    { id: "t", type: "trigger" as const, params: {} },
    { id: "m1", type: "send_email" as const, params: {} },
    { id: "m2", type: "send_email" as const, params: {} },
    { id: "m3", type: "send_email" as const, params: {} },
    { id: "x", type: "exit" as const, params: {} },
  ],
  edges: [
    { from: "t", to: "m1", branch: "next" as const },
    { from: "m1", to: "m2", branch: "next" as const },
    { from: "m2", to: "m3", branch: "next" as const },
    { from: "m3", to: "x", branch: "next" as const },
  ],
};

function email(sent: number, humanOpens: number, clicks: number) {
  return {
    ctor: humanOpens > 0 ? clicks / humanOpens : null,
    sent,
    queued: sent + 5,
    bounced: 2,
    complained: 1,
    suppressed: 0,
    unique_opens: humanOpens + 10,
    unsubscribed: 3,
    unique_clicks: clicks,
    fallback_locale: 4,
    unique_human_opens: humanOpens,
  };
}

function rows(): JourneyEmailRow[] {
  const raw = clone(RPC_SHAPES.statsEmail) as { nodes: Record<string, unknown>[] };
  const base = raw.nodes[0];
  raw.nodes = [
    { ...base, node_id: "m1", entered: 600, email: email(602, 300, 60) },
    { ...base, node_id: "m2", entered: 20, email: email(20, 8, 1) },
  ];
  return journeyEmailRows(GRAPH, parseJourneyStats(raw));
}

const SUBJECTS = new Map([
  ["m1", "Witaj na pokładzie"],
  ["m2", "Twój pierwszy krok"],
]);

function mount(list: readonly JourneyEmailRow[] = rows(), templateKey: string | null = null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <JourneyEmailsTable
        rows={list}
        templateKey={templateKey}
        subjects={SUBJECTS}
        stepLabel={(row) => `Krok ${row.number}`}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  h.bench.mockReset();
});

describe("struktura tabeli", () => {
  it("caption, scope kolumn i wierszy, kolejność numeracji, temat w nagłówku wiersza", () => {
    mount();
    expect(
      screen.getByRole("region", { name: t("adminJourneys.results.emails.scrollRegion") }),
    ).toHaveAttribute("tabindex", "0");
    const table = screen.getByRole("table", { name: t("adminJourneys.results.emails.caption") });
    const headers = within(table).getAllByRole("columnheader");
    expect(headers).toHaveLength(10);
    for (const header of headers) expect(header).toHaveAttribute("scope", "col");
    const body = within(table).getAllByRole("row").slice(1);
    expect(body.map((row) => row.getAttribute("data-node-id"))).toEqual(["m1", "m2", "m3"]);
    const first = within(body[0]).getByRole("rowheader");
    expect(first).toHaveAttribute("scope", "row");
    expect(first).toHaveTextContent("Krok 2");
    expect(first).toHaveTextContent("Witaj na pokładzie");
    expect(within(body[2]).getByRole("rowheader")).toHaveTextContent(
      t("adminJourneys.results.emails.subjectMissing"),
    );
  });

  it("liczby: kolejka, wysłane, otwarcia ludzkie z udziałem od doręczonych, CTOR", () => {
    mount();
    const row = screen.getAllByRole("row")[1];
    const cells = within(row).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("607");
    expect(cells[1]).toHaveTextContent("602");
    // 300 otwarć ludzkich / (602 - 2 odbite) = 50%.
    expect(cells[2]).toHaveTextContent("300");
    expect(cells[2]).toHaveTextContent("50%");
    expect(cells[4]).toHaveTextContent("20%");
    expect(cells[8]).toHaveTextContent("4");
  });

  it("mail bez wysyłek w oknie - jedno zdanie zamiast zer", () => {
    mount();
    const row = screen.getAllByRole("row")[3];
    const cells = within(row).getAllByRole("cell");
    expect(cells).toHaveLength(1);
    expect(cells[0]).toHaveAttribute("colspan", "9");
    expect(cells[0]).toHaveTextContent(t("adminJourneys.results.emails.noSends"));
    expect(row.textContent).not.toMatch(/\b0\b/);
  });

  it("pusta lista - ta wersja nie wysyła maili, bez zapytania o benchmarki", () => {
    mount([]);
    expect(screen.getByText(t("adminJourneys.results.emails.empty"))).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(h.bench).not.toHaveBeenCalled();
  });
});

describe("oceny rejestru S6 i MPP", () => {
  it("duża próba - poziom; mała próba - jawny powód; CTOR z dopiskiem kampanii", async () => {
    mount();
    const body = screen.getAllByRole("row").slice(1);
    await waitFor(() => expect(body[0].querySelectorAll("[data-tier]").length).toBe(6));
    const tiers = [...body[0].querySelectorAll("[data-tier]")].map((el) =>
      el.getAttribute("data-tier"),
    );
    expect(tiers.filter((tier) => tier !== "none").length).toBeGreaterThan(0);
    expect(within(body[0]).getByText(t("adminJourneys.results.emails.campaignBench"))).toBeTruthy();
    // Drugi mail: 20 wysłanych < próg rejestru - „za mała próba”, nie poziom.
    const small = [...body[1].querySelectorAll("[data-tier]")];
    expect(small.length).toBeGreaterThan(0);
    for (const badge of small) {
      expect(badge.getAttribute("data-tier")).toBe("none");
      expect(badge.getAttribute("data-why")).toBe("small_sample");
    }
    // Wszystkie wpisy z jednej grupy rejestru - jedno zapytanie na język.
    expect(h.bench).toHaveBeenCalledTimes(1);
    expect(h.bench).toHaveBeenCalledWith({ group: "email", lang: "pl" });
  });

  it("dymek MPP: przycisk z nazwą przy otwarciach i CTOR, treść o górnej granicy", async () => {
    mount();
    const hints = screen.getAllByRole("button", {
      name: t("adminJourneys.results.emails.mppLabel"),
    });
    expect(hints).toHaveLength(2);
    fireEvent.focus(hints[0]);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(t("adminJourneys.results.emails.mppBody"));
  });

  it("axe bez naruszeń", async () => {
    const { container } = mount();
    await waitFor(() =>
      expect(container.querySelectorAll("[data-tier]").length).toBeGreaterThan(6),
    );
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
