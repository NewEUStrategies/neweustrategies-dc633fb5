// Karta testu A/B (S8-B) - werdykt z `z` i „Zostaw A/B” jako nowy szkic; RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Ramiona: wejścia, konwersje i udział; werdykt „A lepsze o 42,5 pp
//      (99 %)” z kształtu bazy; poniżej 100 wejść - „za mało danych (n < 100)”.
//   2. „Zostaw B” (po potwierdzeniu) = `resolveSplit` na SZKICU z detalu
//      i `saveJourneyDraft` z tokenem `updated_at` szkicu: wagi 0/100,
//      struktura i identyfikatory bez zmian; nic się nie publikuje; potem
//      przejście na kanwę z zaznaczonym krokiem.
//   3. Konflikt (`conflict`): karta wczytuje aktualny szkic i prosi o ponowny
//      wybór; uszkodzony szkic i krok usunięty ze szkicu - komunikat zamiast
//      zapisu; brak `aal2` -> `MfaRequiredNotice`.
//   4. Bez prawa zapisu szkicu - sam wynik i wyjaśnienie. axe bez naruszeń.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
  navigate: vi.fn(),
  detail: vi.fn(),
  saveDraft: vi.fn(),
  publish: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.("pl"), i18n: { language: "pl" }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useNavigate: () => h.navigate,
}));
vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireCrmStaff: { __mw: "requireCrmStaff" },
  requireAdmin: { __mw: "requireAdmin" },
}));
vi.mock("@/lib/journeys/journeys.functions", () => ({
  saveJourneyDraft: (input: unknown) => h.saveDraft(input),
  publishJourney: (input: unknown) => h.publish(input),
}));
vi.mock("@/lib/admin/journeys/journeyEditor.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/journeys/journeyEditor.functions")>()),
  getJourneyDetail: (input: unknown) => h.detail(input),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { toast } from "sonner";
import { JourneyAbCard } from "../JourneyAbCard";
import { journeyAbNodes, type JourneyAbNode } from "@/lib/admin/journeys/results";
import type { JourneyGraphLike } from "@/lib/admin/journeys/viewModel";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import { RPC_SHAPES } from "@/lib/journeys/__tests__/rpcShapes.fixture";
import { parseJourneyStats } from "@/lib/journeys/parse";
import "@/lib/i18n-admin-journeys";
import "@/lib/i18n-admin-journeys-list";
import "@/lib/i18n-admin-journeys-results";

h.fixedT = realT;
const t = realT("pl");
const J = "4cab3de7-f976-404a-b54e-c37337942b7e";
const AT = "2026-10-20T09:57:10.333703+00:00";
const AT2 = "2026-10-20T10:15:00.000000+00:00";

function clone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

const GRAPH = {
  nodes: [
    { id: "t", type: "trigger", params: {} },
    { id: "ab", type: "ab_split", params: { weights: { A: 50, B: 50 }, winnerMetric: "goal" } },
    { id: "ma", type: "send_email", params: {} },
    { id: "mb", type: "send_email", params: {} },
    { id: "g", type: "goal", params: {} },
    { id: "x", type: "exit", params: {} },
  ],
  edges: [
    { from: "t", to: "ab", branch: "next" },
    { from: "ab", to: "ma", branch: "A" },
    { from: "ab", to: "mb", branch: "B" },
    { from: "ma", to: "g", branch: "next" },
    { from: "mb", to: "x", branch: "next" },
  ],
} satisfies JourneyGraphLike;

function detailWire(graph: unknown = GRAPH, updatedAt = AT) {
  return {
    state: "ready",
    data: {
      definition: {
        id: J,
        key: "test-ab",
        name: "Test A/B",
        description: null,
        status: "active",
        category: "marketing",
        legalBasis: null,
        templateKey: null,
        publishedVersionId: null,
        createdAt: AT,
        updatedAt,
      },
      draftRaw: { graph, settings: { triggerEventType: "checkout.abandoned.v1" } },
      versions: [],
      contents: [],
      templateMatches: {},
    },
  };
}

const NODE: JourneyAbNode = journeyAbNodes(GRAPH, parseJourneyStats(clone(RPC_SHAPES.statsAb)))[0];

function mount(node: JourneyAbNode = NODE, canEdit = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <JourneyAbCard journeyId={J} node={node} canEdit={canEdit} />
    </QueryClientProvider>,
  );
}

async function keep(variant: "A" | "B") {
  const label = t(
    variant === "A" ? "adminJourneys.common.ops.keepA" : "adminJourneys.common.ops.keepB",
  );
  const button = await screen.findByRole("button", { name: label });
  await waitFor(() => expect(button).not.toBeDisabled());
  fireEvent.click(button);
  const dialog = await screen.findByRole("alertdialog");
  expect(dialog).toHaveTextContent(t("adminJourneys.results.ab.confirmTitle", { variant }));
  fireEvent.click(within(dialog).getByRole("button", { name: label }));
  // Dialog zamyka się po zakończeniu akcji - czekamy, zanim test czyta wynik.
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
}

beforeEach(() => {
  h.navigate.mockReset();
  h.detail.mockReset().mockResolvedValue(detailWire());
  h.saveDraft.mockReset().mockResolvedValue({
    ok: true,
    data: { id: J, updatedAt: AT2, status: "active" },
  });
  h.publish.mockReset();
  vi.mocked(toast.success).mockReset();
});
afterEach(cleanup);

describe("wynik testu", () => {
  it("ramiona i werdykt z `z` bazy", () => {
    mount();
    expect(NODE.nodeId).toBe("ab");
    const card = screen.getByTestId("journey-ab-card");
    const rows = within(card).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.getAttribute("data-variant"))).toEqual(["A", "B"]);
    expect(rows[0]).toHaveTextContent("120");
    expect(rows[0]).toHaveTextContent("81");
    expect(rows[0]).toHaveTextContent("68%");
    expect(rows[1]).toHaveTextContent("25%");
    expect(within(card).getByTestId("journey-ab-verdict")).toHaveTextContent(
      "A lepsze o 42,5 pp (99 %)",
    );
    expect(card).toHaveTextContent(t("adminJourneys.results.ab.metricGoal"));
    expect(card).toHaveTextContent(t("adminJourneys.results.ab.title", { number: "2" }));
  });

  it("poniżej 100 wejść na ramię - za mało danych (n < 100)", () => {
    const raw = clone(RPC_SHAPES.statsAb) as { variants: { entered: number }[] };
    raw.variants[1].entered = 99;
    mount(journeyAbNodes(GRAPH, parseJourneyStats(raw))[0]);
    expect(screen.getByTestId("journey-ab-verdict")).toHaveTextContent("Za mało danych (n < 100)");
  });

  it("bez prawa zapisu szkicu - wynik bez przycisków i z wyjaśnieniem", () => {
    mount(NODE, false);
    expect(screen.queryByRole("button", { name: t("adminJourneys.common.ops.keepB") })).toBeNull();
    expect(screen.getByText(t("adminJourneys.results.ab.readOnly"))).toBeTruthy();
    expect(h.detail).not.toHaveBeenCalled();
  });
});

describe("„Zostaw B” - nowy szkic, nie publikacja", () => {
  it("resolveSplit na szkicu + saveJourneyDraft z tokenem szkicu; potem kanwa na kroku", async () => {
    mount();
    await keep("B");
    await waitFor(() => expect(h.saveDraft).toHaveBeenCalledTimes(1));
    const call = h.saveDraft.mock.calls[0][0] as {
      data: {
        journeyId: string;
        expectedUpdatedAt: string;
        draft: { graph: typeof GRAPH; settings: unknown };
      };
    };
    expect(call.data.journeyId).toBe(J);
    expect(call.data.expectedUpdatedAt).toBe(AT);
    const split = call.data.draft.graph.nodes.find((node) => node.id === "ab");
    expect(split?.params).toEqual({ weights: { A: 0, B: 100 }, winnerMetric: "goal" });
    // Struktura i identyfikatory bez zmian - statystyki obu ramion zostają czytelne.
    expect(call.data.draft.graph.edges).toEqual(GRAPH.edges);
    expect(call.data.draft.graph.nodes.map((node) => node.id)).toEqual(
      GRAPH.nodes.map((node) => node.id),
    );
    expect(h.publish).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(h.navigate).toHaveBeenCalledWith({
        to: "/admin/revenue/journeys/$journeyId",
        params: { journeyId: J },
        search: { view: "canvas", node: "ab" },
      }),
    );
    expect(toast.success).toHaveBeenCalledWith(
      t("adminJourneys.results.ab.saved", { variant: "B" }),
    );
  });

  it("konflikt - wczytuje aktualny szkic i prosi o ponowny wybór (bez nadpisania)", async () => {
    h.detail
      .mockReset()
      .mockResolvedValueOnce(detailWire())
      .mockResolvedValue(detailWire(GRAPH, AT2));
    h.saveDraft.mockResolvedValueOnce({ ok: false, error: "conflict", reason: "conflict" });
    mount();
    await keep("B");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t("adminJourneys.results.ab.conflict"),
    );
    expect(h.detail).toHaveBeenCalledTimes(2);
    expect(h.navigate).not.toHaveBeenCalled();
    // Ponowny wybór idzie już z tokenem wczytanego szkicu, nie z poprzednim.
    await keep("B");
    await waitFor(() => expect(h.saveDraft).toHaveBeenCalledTimes(2));
    const second = h.saveDraft.mock.calls[1][0] as { data: { expectedUpdatedAt: string } };
    expect(second.data.expectedUpdatedAt).toBe(AT2);
  });

  it("szkic uszkodzony - komunikat, bez zapisu", async () => {
    h.detail.mockResolvedValue({
      ...detailWire(),
      data: { ...detailWire().data, draftRaw: { graph: { nodes: [], edges: [] }, settings: {} } },
    });
    mount();
    await keep("A");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t("adminJourneys.results.ab.draftInvalid"),
    );
    expect(h.saveDraft).not.toHaveBeenCalled();
  });

  it("krok usunięty ze szkicu - komunikat, bez zapisu", async () => {
    const withoutSplit = {
      nodes: [
        { id: "t", type: "trigger", params: {} },
        { id: "x", type: "exit", params: {} },
      ],
      edges: [{ from: "t", to: "x", branch: "next" }],
    };
    h.detail.mockResolvedValue(detailWire(withoutSplit));
    mount();
    await keep("B");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t("adminJourneys.results.ab.nodeMissing"),
    );
    expect(h.saveDraft).not.toHaveBeenCalled();
  });

  it("brak aal2 przy zapisie - MfaRequiredNotice", async () => {
    h.saveDraft.mockRejectedValueOnce(new Error("Forbidden: mfa_required (aal2)"));
    mount();
    await keep("B");
    expect(await screen.findByTestId("revenue-mfa-required")).toBeTruthy();
  });

  it("axe bez naruszeń", async () => {
    const { container } = mount();
    const button = await screen.findByRole("button", { name: t("adminJourneys.common.ops.keepB") });
    await waitFor(() => expect(button).not.toBeDisabled());
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
