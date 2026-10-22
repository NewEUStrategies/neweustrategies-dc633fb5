// Lista problemów ścieżki i hook kontekstu (S8.3c2) - RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Lista: poziom to ikona + SŁOWO, numer kroku albo „Cała ścieżka” /
//      „Krok poza przepływem”, nazwa przepisu przy nakładaniu, liczniki;
//      „Przejdź do kroku” woła `onFocusNode` z id kroku; bez callbacku - bez
//      przycisków; pusta lista mówi, że można publikować. axe bez naruszeń.
//   2. `useJourneyIssues`: blokady panelu z kontekstu serwera - nadawca
//      domyślny (`sender_name` NULL), treść identyczna z szablonem, przepis
//      zastępowany przez szablon i przepis o tym samym wyzwalaczu z zadaniem
//      CRM; lokalny szkic edytora wygrywa ze szkicem z bazy; dopóki kontekst
//      się wczytuje - `ready: false`; brak `aal2` - `mfaRequired`.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
  settings: vi.fn(),
  health: vi.fn(),
  list: vi.fn(),
  workflows: vi.fn(),
  catalog: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.("pl"), i18n: { language: "pl" }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireCrmStaff: { __mw: "requireCrmStaff" },
  requireAdmin: { __mw: "requireAdmin" },
}));
vi.mock("@/lib/journeys/journeys.functions", () => ({
  getJourneySettings: () => h.settings(),
  getJourneyEngineHealth: () => h.health(),
  listJourneys: (input: unknown) => h.list(input),
}));
vi.mock("@/lib/admin/workflows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/workflows")>()),
  fetchWorkflowDefinitions: () => h.workflows(),
}));
vi.mock("@/lib/admin/journeys/journeyEditor.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/journeys/journeyEditor.functions")>()),
  listJourneyTemplateCatalog: () => h.catalog(),
}));

import {
  JourneyIssuesList,
  useJourneyIssues,
  type UseJourneyIssuesInput,
} from "../JourneyIssuesList";
import { JOURNEY_ISSUE_LABEL_KEY, type JourneyIssue } from "@/lib/admin/journeys/issues";
import {
  toCatalogEntry,
  type JourneyDetailDto,
} from "@/lib/admin/journeys/journeyEditor.functions";
import { buildJourneyView } from "@/lib/admin/journeys/viewModel";
import type { WorkflowDefinitionRow } from "@/lib/admin/workflows";
import { RPC_SHAPES } from "@/lib/journeys/__tests__/rpcShapes.fixture";
import { JourneyDraftSchema } from "@/lib/journeys/graph";
import { journeyLabelKey } from "@/lib/journeys/labels";
import { parseEngineHealth, parseJourneyList, parseJourneySettings } from "@/lib/journeys/parse";
import { JOURNEY_TEMPLATES } from "@/lib/journeys/templates";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-journeys";
import "@/lib/i18n-admin-journeys-list";
import "@/lib/i18n-admin-journeys-publish";

h.fixedT = realT;
const t = realT("pl");
const T = "11111111-1111-4111-8111-111111111111";
const J = "4cab3de7-f976-404a-b54e-c37337942b7e";
const AT = "2026-10-20T09:57:10.333703+00:00";
const TEMPLATE = JOURNEY_TEMPLATES.cancel_scheduled_save;
const REPLACED = "subscription-cancel-scheduled-crm-task";

/** Fikstury `as const` przez JSON - kopia bez wspólnych referencji. */
const clone = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const DRAFT = JourneyDraftSchema.parse(
  clone({ graph: TEMPLATE.graph, settings: TEMPLATE.settings }),
);
const NUMBERS = buildJourneyView(DRAFT.graph).numbering;

function detailFixture(templateMatches: Record<string, boolean> = {}): JourneyDetailDto {
  return {
    definition: {
      id: J,
      key: "anulowanie",
      name: "Zaplanowane anulowanie",
      description: null,
      status: "draft",
      category: "marketing",
      legalBasis: null,
      templateKey: TEMPLATE.key,
      publishedVersionId: null,
      createdAt: AT,
      updatedAt: AT,
    },
    draft: DRAFT,
    draftValid: true,
    draftRaw: clone(DRAFT),
    draftIssue: null,
    versions: [],
    contents: TEMPLATE.emails.map((email) => ({
      nodeId: email.nodeId,
      variant: "A",
      subjectPl: email.subject.pl,
      subjectEn: email.subject.en,
      preheaderPl: null,
      preheaderEn: null,
      doc: { blocks: [] },
      updatedAt: AT,
      matchesTemplate: false,
    })),
    templateMatches,
  };
}

function workflowRow(overrides: Partial<WorkflowDefinitionRow>): WorkflowDefinitionRow {
  return {
    condition: {},
    created_at: AT,
    created_by: null,
    enabled: true,
    id: "wf-1",
    name: "Zadanie przy anulowaniu",
    steps: [{ action: "create_crm_task", params: { title: "Zapytaj o powód" } }],
    template_key: null,
    tenant_id: T,
    trigger_event_type: "billing_subscription.status_changed.v1",
    updated_at: AT,
    ...overrides,
  };
}

const ready = <D,>(data: D) => ({ state: "ready" as const, data });

function Harness(input: UseJourneyIssuesInput & { onFocusNode?: (nodeId: string) => void }) {
  const state = useJourneyIssues(input);
  return (
    <div
      data-testid="harness"
      data-ready={String(state.ready)}
      data-mfa={String(state.mfaRequired)}
    >
      <JourneyIssuesList
        issues={state.issues}
        loading={!state.ready}
        onFocusNode={input.onFocusNode}
      />
    </div>
  );
}

function mountHook(
  input: Partial<UseJourneyIssuesInput> & { onFocusNode?: (nodeId: string) => void } = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness tenantId={T} journeyId={J} detail={detailFixture()} {...input} />
    </QueryClientProvider>,
  );
}

const issue = (overrides: Partial<JourneyIssue> & Pick<JourneyIssue, "code">): JourneyIssue => ({
  severity: "blocker",
  labelKey: JOURNEY_ISSUE_LABEL_KEY.sender_default,
  params: {},
  ...overrides,
});

beforeEach(() => {
  for (const fn of [h.settings, h.health, h.list, h.workflows, h.catalog]) fn.mockReset();
  h.settings.mockResolvedValue(ready(parseJourneySettings(RPC_SHAPES.settingsSaved)));
  h.health.mockResolvedValue(ready(parseEngineHealth(RPC_SHAPES.health, false)));
  h.list.mockResolvedValue(
    ready(parseJourneyList(clone(RPC_SHAPES.list)).map((item) => ({ ...item, id: J }))),
  );
  h.workflows.mockResolvedValue([]);
  h.catalog.mockResolvedValue([toCatalogEntry(TEMPLATE)]);
});
afterEach(cleanup);

describe("JourneyIssuesList - prezentacja", () => {
  const ISSUES: JourneyIssue[] = [
    issue({ code: "sender_default" }),
    issue({
      code: "content_from_template",
      nodeId: "reason",
      number: "3",
      labelKey: JOURNEY_ISSUE_LABEL_KEY.content_from_template,
    }),
    issue({
      code: "workflow_overlap",
      severity: "warning",
      labelKey: journeyLabelKey("graphIssue", "workflow_overlap"),
      params: { detail: "Zadanie przy anulowaniu" },
    }),
    issue({
      code: "english_missing",
      severity: "info",
      nodeId: "orphan",
      number: "",
      labelKey: JOURNEY_ISSUE_LABEL_KEY.english_missing,
    }),
  ];

  it("poziom słowem, miejsce problemu, liczniki i przejście do kroku", async () => {
    const onFocusNode = vi.fn();
    const { container } = render(<JourneyIssuesList issues={ISSUES} onFocusNode={onFocusNode} />);
    expect(
      screen.getByRole("heading", { name: t("adminJourneys.issuesList.title") }),
    ).toBeVisible();
    expect(
      screen.getByText(
        [
          t("adminJourneys.issuesList.countBlocker", { value: 2 }),
          t("adminJourneys.issuesList.countWarning", { value: 1 }),
          t("adminJourneys.issuesList.countInfo", { value: 1 }),
        ].join(" · "),
      ),
    ).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("data-severity"))).toEqual([
      "blocker",
      "blocker",
      "warning",
      "info",
    ]);
    // Problem całej ścieżki - bez przycisku przejścia.
    expect(within(rows[0]).getByText(t("adminJourneys.issuesList.wholeJourney"))).toBeVisible();
    expect(within(rows[0]).getByText(t("adminJourneys.issuesList.severity.blocker"))).toBeVisible();
    expect(within(rows[0]).queryByRole("button")).toBeNull();
    expect(
      within(rows[1]).getByText(t("adminJourneys.issuesList.step", { number: "3" })),
    ).toBeVisible();
    expect(
      within(rows[1]).getByText(t(JOURNEY_ISSUE_LABEL_KEY.content_from_template)),
    ).toBeVisible();
    fireEvent.click(
      within(rows[1]).getByRole("button", {
        name: t("adminJourneys.issuesList.goToStep", { number: "3" }),
      }),
    );
    expect(onFocusNode).toHaveBeenCalledWith("reason");
    expect(
      within(rows[2]).getByText(
        t("adminJourneys.issuesList.concerns", { name: "Zadanie przy anulowaniu" }),
      ),
    ).toBeVisible();
    expect(within(rows[3]).getByText(t("adminJourneys.issuesList.stepDetached"))).toBeVisible();
    fireEvent.click(
      within(rows[3]).getByRole("button", { name: t("adminJourneys.issuesList.goToDetached") }),
    );
    expect(onFocusNode).toHaveBeenLastCalledWith("orphan");
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("bez callbacku nie ma przycisków; pusta lista mówi, że można publikować", () => {
    const { rerender } = render(<JourneyIssuesList issues={ISSUES} />);
    expect(screen.queryAllByRole("button")).toEqual([]);
    rerender(<JourneyIssuesList issues={[]} headingLevel={3} title="Własny tytuł" />);
    expect(screen.getByRole("heading", { level: 3, name: "Własny tytuł" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(t("adminJourneys.issuesList.empty"));
  });
});

describe("useJourneyIssues - kontekst serwera", () => {
  it("nadawca domyślny i treść z szablonu blokują; przepisy dublujące to ostrzeżenia", async () => {
    h.settings.mockResolvedValue(ready(parseJourneySettings(RPC_SHAPES.settingsDefault)));
    h.workflows.mockResolvedValue([
      workflowRow({ id: "wf-replace", name: "Przepis szablonu", template_key: REPLACED }),
      workflowRow({ id: "wf-overlap", name: "Zadanie przy anulowaniu" }),
      workflowRow({ id: "wf-off", name: "Wyłączony", enabled: false }),
    ]);
    const onFocusNode = vi.fn();
    mountHook({ detail: detailFixture({ reason: true }), onFocusNode });
    await waitFor(() =>
      expect(screen.getByTestId("harness")).toHaveAttribute("data-ready", "true"),
    );
    const codes = screen.getAllByRole("listitem").map((row) => row.getAttribute("data-code"));
    expect(codes).toEqual(
      expect.arrayContaining([
        "sender_default",
        "content_from_template",
        "workflow_replace",
        "workflow_overlap",
        "engine_disabled",
      ]),
    );
    expect(screen.getByText(t(JOURNEY_ISSUE_LABEL_KEY.sender_default))).toBeVisible();
    expect(
      screen.getByText(t(JOURNEY_ISSUE_LABEL_KEY.workflow_replace, { name: "Przepis szablonu" })),
    ).toBeVisible();
    expect(
      screen.getByText(t("adminJourneys.issuesList.concerns", { name: "Zadanie przy anulowaniu" })),
    ).toBeVisible();
    expect(screen.queryByText(/Wyłączony/)).toBeNull();
    const reasonNumber = NUMBERS.get("reason") ?? "";
    fireEvent.click(
      screen.getByRole("button", {
        name: t("adminJourneys.issuesList.goToStep", { number: reasonNumber }),
      }),
    );
    expect(onFocusNode).toHaveBeenCalledWith("reason");
  });

  it("nazwa nadawcy ustawiona i treść zmieniona - bez blokad", async () => {
    mountHook();
    await waitFor(() =>
      expect(screen.getByTestId("harness")).toHaveAttribute("data-ready", "true"),
    );
    expect(
      screen
        .queryAllByRole("listitem")
        .filter((row) => row.getAttribute("data-severity") === "blocker"),
    ).toEqual([]);
  });

  it("lokalny szkic edytora wygrywa ze szkicem z bazy (null = szkic niepoprawny)", async () => {
    mountHook({ draft: null });
    await waitFor(() =>
      expect(screen.getByTestId("harness")).toHaveAttribute("data-ready", "true"),
    );
    expect(screen.getByText(t(JOURNEY_ISSUE_LABEL_KEY.draft_invalid))).toBeVisible();
  });

  it("dopóki ustawienia silnika się wczytują - lista nie jest gotowa", async () => {
    h.settings.mockReturnValue(new Promise(() => {}));
    mountHook();
    await waitFor(() => expect(h.health).toHaveBeenCalled());
    expect(screen.getByTestId("harness")).toHaveAttribute("data-ready", "false");
    expect(screen.getByText(t("adminJourneys.issuesList.loading"))).toBeVisible();
  });

  it("brak aal2 w odczycie kontekstu -> mfaRequired; wyłączony hook nic nie czyta", async () => {
    h.settings.mockRejectedValue(new Error("Forbidden: mfa_required (aal2)"));
    mountHook();
    await waitFor(() => expect(screen.getByTestId("harness")).toHaveAttribute("data-mfa", "true"));
    cleanup();
    h.settings.mockClear();
    mountHook({ enabled: false });
    expect(h.settings).not.toHaveBeenCalled();
    expect(screen.getByTestId("harness")).toHaveAttribute("data-ready", "false");
  });
});
