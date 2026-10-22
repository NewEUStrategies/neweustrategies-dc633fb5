// Widok „Wyniki” ścieżki (S8-B) - kafle, seria, lejek, wyjścia, A/B, maile; RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Kafle: wejścia, w toku (z czekającymi), cel, konwersja do celu
//      z `metricId` i oceną rejestru S6 (`BenchmarkTierBadge`), wyjścia.
//   2. Lejek w kolejności numeracji kanwy (1, 2, 3, 4, 4.1.1, 4.1.2, 4.2.1),
//      wyjścia z etykiet silnika, karta A/B z werdyktem z `z`, tabela maili
//      z `caption`/`scope`, tematem wariantu A, dymkiem MPP i „brak wysyłek”
//      zamiast zer.
//   3. Okno z zestawienia dziennego (Z-I9c-06): podpis z dniem pełnych danych
//      (admin czyta retencję), kreski zamiast zer w kaflach, konwersja bez
//      oceny („brak danych”), przerwa w serii; redaktor nie czyta retencji.
//   4. Stany: przed hydratacją wczytywanie, autor -> `RoleGateNotice`,
//      `mfa_required` -> `MfaRequiredNotice`, niewdrożone, brak ścieżki,
//      puste okno z następnym krokiem. axe bez naruszeń.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
  hydrated: true,
  auth: { roles: ["admin"], tenantId: "11111111-1111-4111-8111-111111111111" } as {
    roles: string[];
    tenantId: string | null;
  },
  navigate: vi.fn(),
  stats: vi.fn(),
  series: vi.fn(),
  detail: vi.fn(),
  version: vi.fn(),
  retention: vi.fn(),
  saveDraft: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.("pl"), i18n: { language: "pl" }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useNavigate: () => h.navigate,
  useHydrated: () => h.hydrated,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireCrmStaff: { __mw: "requireCrmStaff" },
  requireAdmin: { __mw: "requireAdmin" },
}));
vi.mock("@/lib/journeys/stats.functions", () => ({
  getJourneyStats: (input: unknown) => h.stats(input),
  getJourneySeries: (input: unknown) => h.series(input),
}));
vi.mock("@/lib/journeys/journeys.functions", () => ({
  saveJourneyDraft: (input: unknown) => h.saveDraft(input),
}));
vi.mock("@/lib/admin/journeys/journeyEditor.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/journeys/journeyEditor.functions")>()),
  getJourneyDetail: (input: unknown) => h.detail(input),
  getJourneyVersion: (input: unknown) => h.version(input),
}));
vi.mock("@/lib/privacy/dataRetention.functions", () => ({
  getDataRetention: () => h.retention(),
}));
vi.mock("@/lib/analytics/semantic/benchmarks/benchmarks.functions", async () => {
  const { payloadFor } =
    await import("@/components/admin/analytics/semantic/__tests__/benchmarkFixtures");
  return {
    getBenchmarkGroup: ({ data }: { data: { group: "email"; lang: "pl" | "en" } }) =>
      Promise.resolve(payloadFor(data.group, data.lang)),
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { JourneyResults } from "../JourneyResults";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import { RPC_SHAPES } from "@/lib/journeys/__tests__/rpcShapes.fixture";
import { parseJourneySeries, parseJourneyStats } from "@/lib/journeys/parse";
import "@/lib/i18n-admin-revenue";
import "@/lib/i18n-admin-revenue-shell";
import "@/lib/i18n-admin-journeys";
import "@/lib/i18n-admin-journeys-list";
import "@/lib/i18n-admin-journeys-results";

h.fixedT = realT;
const t = realT("pl");
const J = "4cab3de7-f976-404a-b54e-c37337942b7e";
const AT = "2026-10-20T09:57:10.333703+00:00";

function clone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

/** Graf z podziałem A/B i zbiegającymi się gałęziami (4.1.2 = cel, 4.2.1 -> chip). */
const GRAPH = {
  nodes: [
    { id: "t", type: "trigger", params: {} },
    { id: "w", type: "wait", params: { mode: "duration", minutes: 60 } },
    { id: "m", type: "send_email", params: {} },
    { id: "ab", type: "ab_split", params: { weights: { A: 50, B: 50 }, winnerMetric: "goal" } },
    { id: "ma", type: "send_email", params: {} },
    { id: "mb", type: "send_email", params: {} },
    { id: "g", type: "goal", params: {} },
  ],
  edges: [
    { from: "t", to: "w", branch: "next" },
    { from: "w", to: "m", branch: "next" },
    { from: "m", to: "ab", branch: "next" },
    { from: "ab", to: "ma", branch: "A" },
    { from: "ab", to: "mb", branch: "B" },
    { from: "ma", to: "g", branch: "next" },
    { from: "mb", to: "g", branch: "next" },
  ],
};

function detailWire(templateKey: string | null = "abandoned_checkout") {
  return {
    state: "ready",
    data: {
      definition: {
        id: J,
        key: "kasa",
        name: "Porzucona kasa",
        description: null,
        status: "active",
        category: "marketing",
        legalBasis: null,
        templateKey,
        publishedVersionId: null,
        createdAt: AT,
        updatedAt: AT,
      },
      draftRaw: { graph: GRAPH, settings: { triggerEventType: "checkout.abandoned.v1" } },
      versions: [],
      contents: [
        {
          nodeId: "m",
          variant: "A",
          subjectPl: "Dokończ zamówienie",
          subjectEn: "Finish your order",
          preheaderPl: null,
          preheaderEn: null,
          doc: {},
          updatedAt: AT,
          matchesTemplate: false,
        },
      ],
      templateMatches: {},
    },
  };
}

type RawStats = {
  source: string;
  nodes: Record<string, unknown>[];
  journey: Record<string, unknown>;
};

function rawNode(nodeId: string, type: string, entered: number, extra: object = {}) {
  return {
    node_id: nodeId,
    type,
    entered,
    succeeded: entered,
    skipped: 0,
    failed: 0,
    dead: 0,
    waiting_now: 0,
    outcomes: {},
    email: null,
    ...extra,
  };
}

const EMAIL = {
  ctor: 0.25,
  sent: 400,
  queued: 410,
  bounced: 0,
  complained: 0,
  suppressed: 0,
  unique_opens: 260,
  unsubscribed: 2,
  unique_clicks: 50,
  fallback_locale: 3,
  unique_human_opens: 200,
};

function statsRaw(source: "raw" | "rollup" = "raw"): RawStats {
  const raw = clone(RPC_SHAPES.statsAb) as RawStats;
  raw.source = source;
  raw.journey = {
    active: 10,
    exited: { unsubscribed: 5, manual: 2 },
    failed: 0,
    waiting: 12,
    enrolled: 400,
    completed: 129,
    goal_rate: 0.2775,
    goal_reached: 111,
  };
  raw.nodes = [
    rawNode("ab", "ab_split", 240, { outcomes: { A: 120, B: 120 } }),
    rawNode("g", "goal", 111),
    rawNode("m", "send_email", 400, { email: EMAIL }),
    rawNode("ma", "send_email", 120),
    rawNode("t", "trigger", 400),
    rawNode("w", "wait", 400, { waiting_now: 12 }),
  ];
  return raw;
}

function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <JourneyResults journeyId={J} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.hydrated = true;
  h.auth = { roles: ["admin"], tenantId: "11111111-1111-4111-8111-111111111111" };
  h.navigate.mockReset();
  h.stats.mockReset().mockResolvedValue({ state: "ready", data: parseJourneyStats(statsRaw()) });
  h.series.mockReset().mockResolvedValue({
    state: "ready",
    data: parseJourneySeries(
      (clone(RPC_SHAPES.series) as Record<string, unknown>[]).map((point, index) => ({
        ...point,
        enrolled: index + 1,
      })),
    ),
  });
  h.detail.mockReset().mockResolvedValue(detailWire());
  h.version.mockReset();
  h.retention
    .mockReset()
    .mockResolvedValue({ state: "ready", data: { journeySealed: "2026-10-18" } });
  h.saveDraft.mockReset();
});
afterEach(cleanup);

describe("treść wyników", () => {
  it("kafle: wejścia, w toku z czekającymi, cel, konwersja z oceną rejestru S6, wyjścia", async () => {
    mount();
    const kpis = await screen.findByTestId("journey-results-kpis");
    expect(within(kpis).getByText(t("adminJourneys.results.kpi.enrolled"))).toBeTruthy();
    expect(within(kpis).getAllByText("400").length).toBeGreaterThan(0);
    expect(within(kpis).getByText("22")).toBeTruthy();
    expect(
      within(kpis).getByText(t("adminJourneys.results.kpi.activeHint", { count: "12" })),
    ).toBeTruthy();
    expect(within(kpis).getByText("111")).toBeTruthy();
    expect(within(kpis).getByText("28%")).toBeTruthy();
    expect(within(kpis).getByText("7")).toBeTruthy();
    // Ocena konwersji z rejestru (porzucona kasa -> wpis `abandoned_cart_*`).
    await waitFor(() => {
      const tier = kpis.querySelector("[data-tier]");
      expect(tier?.getAttribute("data-tier")).not.toBeNull();
      expect(tier?.getAttribute("data-tier")).not.toBe("none");
    });
    // Okno i wersja w podpisie, statystyki dla wszystkich wersji.
    expect(screen.getByTestId("journey-results-window")).toHaveTextContent(
      t("adminJourneys.results.versionAll"),
    );
    expect(h.stats).toHaveBeenCalledWith({
      data: expect.objectContaining({ journeyId: J, versionId: null }),
    });
  });

  it("lejek w kolejności numeracji kanwy, scalenie bez udziału", async () => {
    mount();
    const funnel = await screen.findByTestId("journey-step-funnel");
    const items = within(funnel).getAllByRole("listitem");
    const labels = items.map((item) =>
      item.querySelector("[data-node-id]")?.getAttribute("data-node-id"),
    );
    expect(labels).toEqual(["t", "w", "m", "ab", "ma", "g", "mb"]);
    expect(items[2]).toHaveTextContent(
      t("adminJourneys.results.stepLabel", {
        number: "3",
        type: t("adminJourneys.nodeType.send_email"),
      }),
    );
    expect(items[5]).toHaveTextContent(t("adminJourneys.results.funnel.merge"));
    // Krok 4.2.1 nie ma wiersza statystyk - kreska, nie zero.
    expect(items[6]).toHaveTextContent("-");
  });

  it("wyjścia z etykiet silnika, karta A/B z werdyktem, tabela maili z tematem i MPP", async () => {
    mount();
    expect(await screen.findByText(t("adminJourneys.results.exits.title"))).toBeTruthy();
    expect(document.body.textContent).toContain(t("adminJourneys.exitReason.unsubscribed"));
    const ab = screen.getByTestId("journey-ab-card");
    expect(within(ab).getByTestId("journey-ab-verdict")).toHaveTextContent(
      "A lepsze o 42,5 pp (99 %)",
    );

    const table = screen.getByRole("table", { name: t("adminJourneys.results.emails.caption") });
    const headers = within(table).getAllByRole("columnheader");
    expect(headers[0]).toHaveAttribute("scope", "col");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.getAttribute("data-node-id"))).toEqual(["m", "ma", "mb"]);
    expect(within(rows[0]).getByRole("rowheader")).toHaveTextContent("Dokończ zamówienie");
    expect(rows[0]).toHaveTextContent("200");
    expect(rows[0]).toHaveTextContent("50%");
    expect(rows[1]).toHaveTextContent(t("adminJourneys.results.emails.noSends"));
    expect(
      within(table).getAllByRole("button", { name: t("adminJourneys.results.emails.mppLabel") }),
    ).toHaveLength(2);
    // CTOR oceniony wpisem kampanii - z dopiskiem.
    await waitFor(() =>
      expect(
        within(rows[0]).getByText(t("adminJourneys.results.emails.campaignBench")),
      ).toBeTruthy(),
    );
  });

  it("axe bez naruszeń (pełna treść wyników)", async () => {
    const { container } = mount();
    await screen.findByTestId("journey-results-kpis");
    await waitFor(() => expect(container.querySelector("[data-tier]")).not.toBeNull());
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("okno z zestawienia dziennego (Z-I9c-06)", () => {
  it("admin: dzień pełnych danych z retencji, kreski zamiast zer, konwersja bez oceny, przerwa w serii", async () => {
    const raw = statsRaw("rollup");
    raw.journey.exited = {};
    raw.journey.goal_reached = 0;
    raw.journey.goal_rate = 0;
    h.stats.mockResolvedValue({ state: "ready", data: parseJourneyStats(raw) });
    mount();
    const note = await screen.findByTestId("journey-rollup-note");
    await waitFor(() =>
      expect(note).toHaveTextContent(
        t("adminJourneys.results.rollup.since", { date: "19 października 2026" }),
      ),
    );
    const kpis = screen.getByTestId("journey-results-kpis");
    expect(within(kpis).getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(within(kpis).getByText(t("adminRevenue.benchmark.state.no_data"))).toBeTruthy();
    expect(await screen.findByTestId("journey-trend-gap")).toHaveTextContent(
      t("adminJourneys.results.trend.gap", { date: "19 października 2026" }),
    );
    expect(h.retention).toHaveBeenCalled();
  });

  it("redaktor nie czyta retencji - podpis mówi, gdzie szukać daty", async () => {
    h.auth = { roles: ["editor"], tenantId: "11111111-1111-4111-8111-111111111111" };
    h.stats.mockResolvedValue({ state: "ready", data: parseJourneyStats(statsRaw("rollup")) });
    mount();
    expect(await screen.findByTestId("journey-rollup-note")).toHaveTextContent(
      t("adminJourneys.results.rollup.sinceUnknown"),
    );
    expect(h.retention).not.toHaveBeenCalled();
  });
});

describe("stany zamiast treści", () => {
  it("przed hydratacją - wczytywanie, bez zapytań", () => {
    h.hydrated = false;
    mount();
    expect(screen.getByTestId("journey-results")).toHaveTextContent(
      t("adminRevenue.common.loading"),
    );
    expect(h.stats).not.toHaveBeenCalled();
  });

  it("autor - RoleGateNotice, bez zapytań", () => {
    h.auth = { roles: ["author"], tenantId: "11111111-1111-4111-8111-111111111111" };
    mount();
    expect(screen.getByTestId("revenue-role-gate")).toBeTruthy();
    expect(h.stats).not.toHaveBeenCalled();
  });

  it("brak aal2 (`mfa_required`) - MfaRequiredNotice", async () => {
    h.stats.mockRejectedValue(new Error("Forbidden: mfa_required (aal2)"));
    mount();
    expect(await screen.findByTestId("revenue-mfa-required")).toBeTruthy();
  });

  it("funkcje niewdrożone - komunikat z następnym krokiem", async () => {
    h.stats.mockResolvedValue({ state: "unavailable" });
    mount();
    expect(await screen.findByTestId("journey-results-unavailable")).toHaveTextContent(
      t("adminJourneys.results.unavailableNext"),
    );
  });

  it("brak ścieżki - zdanie zamiast wyników", async () => {
    h.detail.mockResolvedValue({ state: "not_found" });
    mount();
    expect(await screen.findByText(t("adminJourneys.results.notFound"))).toBeTruthy();
  });

  it("puste okno - zdanie z następnym krokiem, bez kafli zer", async () => {
    h.stats.mockResolvedValue({
      state: "ready",
      data: parseJourneyStats({
        ...(clone(RPC_SHAPES.statsEmail) as object),
        nodes: [],
        journey: { ...(clone(RPC_SHAPES.statsEmail) as RawStats).journey, enrolled: 0, waiting: 0 },
      }),
    });
    mount();
    expect(await screen.findByText(t("adminJourneys.results.emptyNext"))).toBeTruthy();
    expect(screen.queryByTestId("journey-results-kpis")).toBeNull();
  });
});
