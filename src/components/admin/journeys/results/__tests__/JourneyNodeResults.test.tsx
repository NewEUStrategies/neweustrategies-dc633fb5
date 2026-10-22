// Zakładka „Wyniki” panelu kroku (S8-B) - liczby kroku, wyniki, mail, A/B; RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. To samo okno co kanwa: zapytanie `journeyKeys.stats` z oknem
//      `journeyStatsWindow(period)` - jeden odczyt na edytor.
//   2. Krok maila: liczby kroku, wyniki z etykiet silnika (`stepOutcome`;
//      obcy kod nazwany wprost), mail z ocenami rejestru S6, dymkiem MPP
//      i dopiskiem kampanii przy CTOR.
//   3. Okno z zestawienia dziennego: czekający to kreska z wyjaśnieniem,
//      nie zero; podpis rollupu. Krok bez wejść - zdanie. Podział A/B -
//      karta wyniku testu.
//   4. Stany: przed hydratacją, autor, `mfa_required`, niewdrożone. axe.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
  hydrated: true,
  auth: { roles: ["editor"], tenantId: "11111111-1111-4111-8111-111111111111" } as {
    roles: string[];
    tenantId: string | null;
  },
  stats: vi.fn(),
  detail: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.("pl"), i18n: { language: "pl" }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useNavigate: () => vi.fn(),
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
}));
vi.mock("@/lib/journeys/journeys.functions", () => ({ saveJourneyDraft: vi.fn() }));
vi.mock("@/lib/admin/journeys/journeyEditor.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/journeys/journeyEditor.functions")>()),
  getJourneyDetail: (input: unknown) => h.detail(input),
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

import { JourneyNodeResults } from "../JourneyNodeResults";
import { journeyStatsWindow } from "@/lib/admin/journeys/results";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import { RPC_SHAPES } from "@/lib/journeys/__tests__/rpcShapes.fixture";
import { parseJourneyStats } from "@/lib/journeys/parse";
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

const GRAPH = {
  nodes: [
    { id: "t", type: "trigger", params: {} },
    { id: "w", type: "wait", params: { mode: "duration", minutes: 60 } },
    { id: "m", type: "send_email", params: {} },
    { id: "ab", type: "ab_split", params: { weights: { A: 50, B: 50 }, winnerMetric: "goal" } },
    { id: "ma", type: "goal", params: {} },
    { id: "mb", type: "exit", params: {} },
  ],
  edges: [
    { from: "t", to: "w", branch: "next" },
    { from: "w", to: "m", branch: "next" },
    { from: "m", to: "ab", branch: "next" },
    { from: "ab", to: "ma", branch: "A" },
    { from: "ab", to: "mb", branch: "B" },
  ],
};

const DETAIL = {
  state: "ready",
  data: {
    definition: {
      id: J,
      key: "powitanie",
      name: "Powitanie",
      description: null,
      status: "active",
      category: "marketing",
      legalBasis: null,
      templateKey: "welcome_onboarding",
      publishedVersionId: null,
      createdAt: AT,
      updatedAt: AT,
    },
    draftRaw: { graph: GRAPH, settings: { triggerEventType: "account.registered.v1" } },
    versions: [],
    contents: [],
    templateMatches: {},
  },
};

type Raw = { source: string; nodes: Record<string, unknown>[] };

function statsRaw(source: "raw" | "rollup" = "raw"): Raw {
  const raw = clone(RPC_SHAPES.statsAb) as Raw;
  const emailNode = clone(RPC_SHAPES.statsEmail.nodes[0]) as Record<string, unknown>;
  raw.source = source;
  raw.nodes = [
    ...raw.nodes,
    {
      ...emailNode,
      entered: 640,
      succeeded: 600,
      skipped: 30,
      failed: 7,
      dead: 3,
      outcomes: { next: 600, capped: 30, mystery: 2 },
      email: {
        ...(emailNode.email as object),
        sent: 600,
        queued: 630,
        bounced: 0,
        complained: 0,
        unique_opens: 400,
        unique_human_opens: 300,
        unique_clicks: 90,
        ctor: 0.3,
        unsubscribed: 6,
      },
    },
    {
      ...(clone(RPC_SHAPES.statsEmail.nodes[2]) as object),
      entered: 640,
      waiting_now: 40,
    },
  ];
  return raw;
}

function mount(nodeId: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <JourneyNodeResults journeyId={J} nodeId={nodeId} period="month" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.hydrated = true;
  h.auth = { roles: ["editor"], tenantId: "11111111-1111-4111-8111-111111111111" };
  h.stats.mockReset().mockResolvedValue({ state: "ready", data: parseJourneyStats(statsRaw()) });
  h.detail.mockReset().mockResolvedValue(DETAIL);
});
afterEach(cleanup);

describe("krok maila", () => {
  it("to samo okno co kanwa (`journeyStatsWindow`), wszystkie wersje", async () => {
    mount("m");
    await screen.findByRole("heading", { name: t("adminJourneys.nodeResults.title") });
    const window = journeyStatsWindow("month", Date.now());
    expect(h.stats).toHaveBeenCalledWith({
      data: { journeyId: J, versionId: null, sinceIso: window.sinceIso, untilIso: window.untilIso },
    });
  });

  it("liczby kroku, wyniki z etykiet silnika, mail z ocenami i MPP", async () => {
    mount("m");
    const panel = await screen.findByTestId("journey-node-results");
    await within(panel).findByRole("heading", { name: t("adminJourneys.nodeResults.title") });
    const entered = panel.querySelector('[data-count="entered"]');
    expect(entered).toHaveTextContent(t("adminJourneys.nodeResults.entered"));
    expect(entered).toHaveTextContent("640");
    expect(panel.querySelector('[data-count="dead"]')).toHaveTextContent("3");

    const outcomes = within(panel).getByRole("table", {
      name: t("adminJourneys.nodeResults.outcomesCaption"),
    });
    const rows = within(outcomes).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.getAttribute("data-outcome"))).toEqual([
      "next",
      "capped",
      "mystery",
    ]);
    expect(rows[1]).toHaveTextContent(t("adminJourneys.stepOutcome.capped"));
    expect(rows[2]).toHaveTextContent(
      t("adminJourneys.nodeResults.outcomeOther", { code: "mystery" }),
    );

    const opens = panel.querySelector('[data-email="humanOpens"]') as HTMLElement;
    expect(opens).toHaveTextContent("300");
    expect(opens).toHaveTextContent("50%");
    expect(
      within(opens).getByRole("button", { name: t("adminJourneys.results.emails.mppLabel") }),
    ).toBeTruthy();
    await waitFor(() => expect(opens.querySelector("[data-tier]")).not.toBeNull());
    const ctor = panel.querySelector('[data-email="ctor"]') as HTMLElement;
    expect(ctor).toHaveTextContent("30%");
    await waitFor(() =>
      expect(ctor).toHaveTextContent(t("adminJourneys.results.emails.campaignBench")),
    );
  });

  it("axe bez naruszeń", async () => {
    const { container } = mount("m");
    await waitFor(() => expect(container.querySelector("[data-tier]")).not.toBeNull());
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("inne kroki i stare okna", () => {
  it("okno z zestawienia: czekający to kreska z wyjaśnieniem, podpis rollupu", async () => {
    h.stats.mockResolvedValue({ state: "ready", data: parseJourneyStats(statsRaw("rollup")) });
    mount("w");
    const waiting = await waitFor(() => {
      const found = document.querySelector('[data-count="waitingNow"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(waiting).toHaveTextContent("—");
    expect(waiting).not.toHaveTextContent("40");
    expect(screen.getByText(t("adminJourneys.nodeResults.waitingRollup"))).toBeTruthy();
    expect(screen.getByTestId("journey-rollup-note")).toBeTruthy();
  });

  it("czekający w surowym oknie", async () => {
    mount("w");
    const waiting = await waitFor(() => {
      const found = document.querySelector('[data-count="waitingNow"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(waiting).toHaveTextContent("40");
  });

  it("podział A/B - karta wyniku testu z werdyktem", async () => {
    mount("ab");
    const card = await screen.findByTestId("journey-ab-card");
    expect(within(card).getByTestId("journey-ab-verdict")).toHaveTextContent(
      "A lepsze o 42,5 pp (99 %)",
    );
  });

  it("krok bez wejść w oknie - zdanie, nie tabela zer", async () => {
    mount("mb");
    expect(await screen.findByText(t("adminJourneys.nodeResults.notInStats"))).toBeTruthy();
    expect(document.querySelector("[data-count]")).toBeNull();
  });
});

describe("stany", () => {
  it("przed hydratacją - wczytywanie", () => {
    h.hydrated = false;
    mount("m");
    expect(screen.getByTestId("journey-node-results")).toHaveTextContent(
      t("adminRevenue.common.loading"),
    );
    expect(h.stats).not.toHaveBeenCalled();
  });

  it("autor - RoleGateNotice", () => {
    h.auth = { roles: ["author"], tenantId: "11111111-1111-4111-8111-111111111111" };
    mount("m");
    expect(screen.getByTestId("revenue-role-gate")).toBeTruthy();
  });

  it("brak aal2 - MfaRequiredNotice; niewdrożone - komunikat", async () => {
    // `retry: 1` z `journeyStatsQueryOptions` - odmowa musi przyjść przy każdej próbie.
    h.stats.mockRejectedValue(new Error("Forbidden: mfa_required (aal2)"));
    mount("m");
    expect(await screen.findByTestId("revenue-mfa-required")).toBeTruthy();
    cleanup();
    h.stats.mockResolvedValue({ state: "unavailable" });
    mount("m");
    expect(await screen.findByTestId("journey-results-unavailable")).toBeTruthy();
  });
});
