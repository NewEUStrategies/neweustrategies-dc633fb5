// Symulacja ścieżki (S8.3c2) - RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Komunikat „nic nie zapisuje i nic nie wysyła” i reguły symulacji są
//      zawsze widoczne; wybór kontaktu z `listCrmLeads` (wyszukiwanie na
//      żądanie, „pokazano N z M”).
//   2. Symulacja idzie ze SZKICEM EDYTORA (`simulateJourney({ draft })`),
//      wynik krok po kroku w kolejności ścieżki: numer kroku, opis, wybrana
//      gałąź, werdykt bramki maila, adnotacje; kryteria warunku z oznaczeniem
//      warunków historii; podsumowanie maili i krok końcowy.
//   3. Podświetlenie: `onHighlightPath` dostaje id kroków ścieżki, zamknięcie
//      dialogu gasi je (`null`); „Przejdź do kroku” zamyka dialog.
//   4. Szkic odrzucony przez silnik -> problemy z numerami; szkic
//      niepoprawny lokalnie -> brak wywołania; stany forbidden/unavailable;
//      brak `aal2` -> `MfaRequiredNotice`. axe bez naruszeń.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
  simulate: vi.fn(),
  leads: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.("pl"), i18n: { language: "pl" }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@/lib/journeys/journeys.functions", () => ({
  simulateJourney: (input: unknown) => h.simulate(input),
}));
vi.mock("@/lib/crm.functions", () => ({
  listCrmLeads: (input: unknown) => h.leads(input),
}));

import { JourneySimulateDialog, type JourneySimulateDialogProps } from "../JourneySimulateDialog";
import { buildJourneyView } from "@/lib/admin/journeys/viewModel";
import { RPC_SHAPES } from "@/lib/journeys/__tests__/rpcShapes.fixture";
import { JourneyDraftSchema, type JourneyDraft } from "@/lib/journeys/graph";
import { journeyLabelKey } from "@/lib/journeys/labels";
import { parseSimulation } from "@/lib/journeys/parse";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-journeys";
import "@/lib/i18n-admin-journeys-list";
import "@/lib/i18n-admin-journeys-publish";

h.fixedT = realT;
const t = realT("pl");
const J = "4cab3de7-f976-404a-b54e-c37337942b7e";
const L1 = "434b9215-1ddc-4b35-aaf2-84ed79898881";
const L2 = "434b9215-1ddc-4b35-aaf2-84ed79898882";

/** Fikstury `as const` przez JSON - kopia bez wspólnych referencji. */
const clone = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const ready = <D,>(data: D) => ({ state: "ready" as const, data });

/** Graf zgodny z `RPC_SHAPES.simulation`: wyzwalacz -> czekanie -> mail -> koniec. */
const LINEAR: JourneyDraft = JourneyDraftSchema.parse({
  graph: {
    nodes: [
      { id: "t", type: "trigger", params: {} },
      { id: "w", type: "wait", params: { mode: "duration", minutes: 1440 } },
      { id: "m", type: "send_email", params: {} },
      { id: "x", type: "exit", params: {} },
    ],
    edges: [
      { from: "t", to: "w", branch: "next" },
      { from: "w", to: "m", branch: "next" },
      { from: "m", to: "x", branch: "next" },
    ],
  },
  settings: { triggerEventType: "checkout.abandoned.v1" },
});

/** Warunek po mailu: kliknięcie (historia) i plan - gałąź „Nie”. */
const BRANCHING: JourneyDraft = JourneyDraftSchema.parse({
  graph: {
    nodes: [
      { id: "t", type: "trigger", params: {} },
      { id: "m", type: "send_email", params: {} },
      {
        id: "c",
        type: "if_else",
        params: {
          match: "all",
          predicates: [
            { kind: "email_clicked", nodeId: "m" },
            { kind: "plan", op: "has_paid" },
          ],
        },
      },
      { id: "g", type: "goal", params: {} },
      { id: "x", type: "exit", params: {} },
    ],
    edges: [
      { from: "t", to: "m", branch: "next" },
      { from: "m", to: "c", branch: "next" },
      { from: "c", to: "g", branch: "yes" },
      { from: "c", to: "x", branch: "no" },
    ],
  },
  settings: { triggerEventType: "checkout.abandoned.v1" },
});

const LEADS = [
  { id: L1, email: "anna@nes.example", first_name: "Anna", last_name: "Nowak" },
  { id: L2, email: "jan@nes.example", first_name: null, last_name: null },
];

function mount(overrides: Partial<JourneySimulateDialogProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props: JourneySimulateDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    journeyId: J,
    draft: LINEAR,
    subjects: { m: "Dokończ zamówienie" },
    onHighlightPath: vi.fn(),
    onFocusNode: vi.fn(),
    ...overrides,
  };
  const view = render(
    <QueryClientProvider client={queryClient}>
      <JourneySimulateDialog {...props} />
    </QueryClientProvider>,
  );
  const rerender = (next: Partial<JourneySimulateDialogProps>) =>
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <JourneySimulateDialog {...props} {...next} />
      </QueryClientProvider>,
    );
  return { props, rerender };
}

const leadRadio = (name: RegExp) => screen.findByRole("radio", { name });

beforeEach(() => {
  h.simulate.mockReset();
  h.leads.mockReset();
  h.leads.mockResolvedValue({ json: JSON.stringify(LEADS), total: 2, page: 1, pageSize: 20 });
  h.simulate.mockResolvedValue(ready(parseSimulation(clone(RPC_SHAPES.simulation))));
});
afterEach(cleanup);

describe("JourneySimulateDialog", () => {
  it("komunikat bez zapisu, wybór kontaktu, symulacja szkicu krok po kroku", async () => {
    const { props } = mount();
    const dialog = screen.getByRole("dialog", { name: t("adminJourneys.simulateDialog.title") });
    expect(within(dialog).getByRole("note")).toHaveTextContent(
      t("adminJourneys.simulateDialog.nothingSaved"),
    );
    expect(within(dialog).getByText(t("adminJourneys.simulateDialog.rules"))).toBeVisible();
    expect(h.leads).toHaveBeenCalledWith({
      data: { limit: 20, page: 1, sort: "activity", sort_dir: "desc" },
    });
    expect(screen.getByText(t("adminJourneys.simulateDialog.pickLead"))).toBeVisible();
    fireEvent.click(await leadRadio(/Anna Nowak · anna@nes\.example/));
    await waitFor(() =>
      expect(h.simulate).toHaveBeenCalledWith({
        data: { journeyId: J, leadId: L1, draft: LINEAR },
      }),
    );
    const result = await screen.findByTestId("journey-simulation");
    const steps = within(result).getAllByRole("listitem");
    expect(steps.map((step) => step.getAttribute("data-node-id"))).toEqual(["t", "w", "m", "x"]);
    const numbers = buildJourneyView(LINEAR.graph).numbering;
    expect(
      within(steps[2]).getByText(t("adminJourneys.issuesList.step", { number: numbers.get("m") })),
    ).toBeVisible();
    expect(
      within(steps[2]).getByText(
        t("adminJourneys.common.summary.sendEmail", { subject: "Dokończ zamówienie" }),
      ),
    ).toBeVisible();
    expect(
      within(steps[2]).getByText(
        t("adminJourneys.simulateDialog.verdict", {
          verdict: t(journeyLabelKey("sendVerdict", "no_consent")),
        }),
      ),
    ).toBeVisible();
    expect(
      within(steps[1]).getByText(t(journeyLabelKey("simulationNote", "duration"))),
    ).toBeVisible();
    expect(within(result).getByRole("status")).toHaveTextContent(
      t("adminJourneys.simulateDialog.emailsSummary", { sent: 0, total: 1 }),
    );
    expect(within(result).getByRole("status")).toHaveTextContent(
      t("adminJourneys.simulateDialog.ended", {
        step: t("adminJourneys.issuesList.step", { number: numbers.get("x") }),
      }),
    );
    expect(props.onHighlightPath).toHaveBeenLastCalledWith(["t", "w", "m", "x"]);
    expect(screen.getByText(t("adminJourneys.simulateDialog.highlightHint"))).toBeVisible();
    const violations = await axeViolations(dialog);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("wyszukiwanie na żądanie i „pokazano N z M”", async () => {
    h.leads.mockResolvedValue({ json: JSON.stringify(LEADS), total: 45, page: 1, pageSize: 20 });
    mount();
    expect(
      await screen.findByText(t("adminJourneys.simulateDialog.leadsMore", { shown: 2, total: 45 })),
    ).toBeVisible();
    const search = screen.getByLabelText(t("adminJourneys.simulateDialog.search"));
    fireEvent.change(search, { target: { value: "  anna " } });
    expect(h.leads).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", { name: t("adminJourneys.simulateDialog.searchSubmit") }),
    );
    await waitFor(() =>
      expect(h.leads).toHaveBeenLastCalledWith({
        data: { search: "anna", limit: 20, page: 1, sort: "activity", sort_dir: "desc" },
      }),
    );
    expect(await leadRadio(/^jan@nes\.example$/)).toBeVisible();
  });

  it("zamknięcie gasi podświetlenie; przejście do kroku zamyka dialog", async () => {
    const { props, rerender } = mount();
    fireEvent.click(await leadRadio(/Anna Nowak/));
    const result = await screen.findByTestId("journey-simulation");
    const numbers = buildJourneyView(LINEAR.graph).numbering;
    fireEvent.click(
      within(result).getByRole("button", {
        name: t("adminJourneys.issuesList.goToStep", { number: numbers.get("w") }),
      }),
    );
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onFocusNode).toHaveBeenCalledWith("w");
    rerender({ open: false });
    expect(props.onHighlightPath).toHaveBeenLastCalledWith(null);
  });

  it("warunek: wybrana gałąź, kryteria, warunek historii oznaczony jako niespełniony", async () => {
    h.simulate.mockResolvedValue(
      ready(
        parseSimulation({
          ok: true,
          path: [
            { nodeId: "t", type: "trigger", outcome: "next" },
            { nodeId: "m", type: "send_email", outcome: "next", note: "ok" },
            { nodeId: "c", type: "if_else", outcome: "no", note: "history_predicates_false" },
            { nodeId: "x", type: "exit" },
          ],
          emails: [{ nodeId: "m", verdict: "ok" }],
          errors: [],
          ended_at: "x",
        }),
      ),
    );
    mount({ draft: BRANCHING, subjects: undefined });
    fireEvent.click(await leadRadio(/Anna Nowak/));
    const result = await screen.findByTestId("journey-simulation");
    const condition = within(result)
      .getAllByRole("listitem")
      .find((item) => item.getAttribute("data-node-id") === "c");
    expect(condition).toBeDefined();
    const row = within(condition as HTMLElement);
    expect(
      row.getByText(
        t("adminJourneys.simulateDialog.branch", {
          branch: t(journeyLabelKey("stepOutcome", "no")),
        }),
      ),
    ).toBeVisible();
    expect(row.getByText(t("adminJourneys.simulateDialog.matchAll"))).toBeVisible();
    expect(
      row.getByText(
        `${t(journeyLabelKey("predicate", "email_clicked"))} - ${t("adminJourneys.simulateDialog.predicateHistory")}`,
      ),
    ).toBeVisible();
    expect(row.getByText(t(journeyLabelKey("predicate", "plan")))).toBeVisible();
    expect(
      row.getByText(t(journeyLabelKey("simulationNote", "history_predicates_false"))),
    ).toBeVisible();
    expect(within(result).getByRole("status")).toHaveTextContent(
      t("adminJourneys.simulateDialog.emailsSummary", { sent: 1, total: 1 }),
    );
  });

  it("silnik odrzuca szkic -> problemy z numerami kroków", async () => {
    h.simulate.mockResolvedValue(
      ready(
        parseSimulation({
          ok: false,
          errors: [{ code: "wait_minutes", nodeId: "w" }, { code: "graph_shape" }],
          path: [],
          emails: [],
        }),
      ),
    );
    mount();
    fireEvent.click(await leadRadio(/Anna Nowak/));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(t("adminJourneys.simulateDialog.rejected"));
    expect(within(alert).getByText(t(journeyLabelKey("graphIssue", "wait_minutes")))).toBeVisible();
    expect(within(alert).getByText(t(journeyLabelKey("graphIssue", "graph_shape")))).toBeVisible();
    const number = buildJourneyView(LINEAR.graph).numbering.get("w");
    expect(within(alert).getByText(t("adminJourneys.issuesList.step", { number }))).toBeVisible();
  });

  it("szkic niepoprawny lokalnie - symulacja nie idzie do serwera", async () => {
    mount({ draft: null });
    fireEvent.click(await leadRadio(/Anna Nowak/));
    expect(screen.getByText(t("adminJourneys.simulateDialog.draftInvalid"))).toBeVisible();
    expect(h.simulate).not.toHaveBeenCalled();
  });

  it("stany forbidden i unavailable z odczytu symulacji", async () => {
    h.simulate.mockResolvedValue({ state: "forbidden" });
    mount();
    fireEvent.click(await leadRadio(/Anna Nowak/));
    expect(await screen.findByText(t(journeyLabelKey("mutationError", "forbidden")))).toBeVisible();
    cleanup();
    h.simulate.mockResolvedValue({ state: "unavailable" });
    mount();
    fireEvent.click(await leadRadio(/Anna Nowak/));
    expect(
      await screen.findByText(t(journeyLabelKey("mutationError", "unavailable"))),
    ).toBeVisible();
  });

  it("brak aal2 przy odczycie kontaktów -> MfaRequiredNotice", async () => {
    h.leads.mockRejectedValue(new Error("Forbidden: mfa_required (aal2)"));
    mount();
    expect(await screen.findByTestId("revenue-mfa-required")).toBeVisible();
  });
});
