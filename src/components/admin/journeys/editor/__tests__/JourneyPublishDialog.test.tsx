// Publikacja ścieżki (S8.3c2) - RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Podsumowanie: wyzwalacz, szacunek wolumenu z RPC (30 dni), liczba
//      maili, polityka zgody/limitu/ciszy i nadawca z ustawień silnika,
//      „N kontaktów kontynuuje wersję k” (`JourneyListItem.active`).
//   2. Publikacja = flush szkicu -> `publishJourney` z tokenem Z TEGO ZAPISU,
//      trybem `drain`/`exit_all` i szkicem; wymaga potwierdzenia „obejmie
//      zdarzenia od teraz”; nieudany zapis szkicu wstrzymuje publikację.
//   3. Blokady panelu (nadawca domyślny, treść z szablonu) wyłączają przycisk
//      z liczbą problemów; „Przejdź do kroku” zamyka dialog i oddaje id.
//   4. Deduplikacja: dublujące przepisy zaznaczone domyślnie, wyłączane
//      `setWorkflowEnabled` dopiero po udanej publikacji; odznaczony zostaje.
//   5. Konflikt CAS -> komunikat + `onConflict`; `graph_invalid` i
//      `content_missing` z serwera -> lista problemów z numerami kroków.
//   6. Redaktor -> `RoleGateNotice` (admin); brak `aal2` -> `MfaRequiredNotice`;
//      pierwsza wersja bez wyboru trybu; zarchiwizowana - zablokowana. axe.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
  settings: vi.fn(),
  health: vi.fn(),
  list: vi.fn(),
  estimate: vi.fn(),
  publish: vi.fn(),
  workflows: vi.fn(),
  setEnabled: vi.fn(),
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
  estimateJourneyTrigger: (input: unknown) => h.estimate(input),
  publishJourney: (input: unknown) => h.publish(input),
}));
vi.mock("@/lib/admin/workflows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/workflows")>()),
  fetchWorkflowDefinitions: () => h.workflows(),
  setWorkflowEnabled: (id: string, enabled: boolean) => h.setEnabled(id, enabled),
}));
vi.mock("@/lib/admin/journeys/journeyEditor.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/journeys/journeyEditor.functions")>()),
  listJourneyTemplateCatalog: () => h.catalog(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { toast } from "sonner";
import { JourneyPublishDialog, type JourneyPublishDialogProps } from "../JourneyPublishDialog";
import { JOURNEY_ISSUE_LABEL_KEY } from "@/lib/admin/journeys/issues";
import {
  toCatalogEntry,
  type JourneyDetailDto,
} from "@/lib/admin/journeys/journeyEditor.functions";
import { translateSummary, triggerSentence } from "@/lib/admin/journeys/summaries";
import { buildJourneyView } from "@/lib/admin/journeys/viewModel";
import type { WorkflowDefinitionRow } from "@/lib/admin/workflows";
import { RPC_SHAPES } from "@/lib/journeys/__tests__/rpcShapes.fixture";
import { JourneyDraftSchema } from "@/lib/journeys/graph";
import { journeyLabelKey } from "@/lib/journeys/labels";
import {
  parseEngineHealth,
  parseJourneyList,
  parseJourneySettings,
  parsePublish,
  parseTriggerEstimate,
} from "@/lib/journeys/parse";
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
const V1 = "5547c447-8ae8-460b-ac5f-fe00b0e87fc5";
const AT = "2026-10-20T09:57:10.333703+00:00";
const FLUSHED = "2026-10-21T08:00:00.000000+00:00";
const TEMPLATE = JOURNEY_TEMPLATES.cancel_scheduled_save;
const REPLACED = "subscription-cancel-scheduled-crm-task";

/** Fikstury `as const` przez JSON - kopia bez wspólnych referencji. */
const clone = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const DRAFT = JourneyDraftSchema.parse(
  clone({ graph: TEMPLATE.graph, settings: TEMPLATE.settings }),
);
const NUMBERS = buildJourneyView(DRAFT.graph).numbering;
const ready = <D,>(data: D) => ({ state: "ready" as const, data });

function detailFixture(
  overrides: {
    templateMatches?: Record<string, boolean>;
    versions?: JourneyDetailDto["versions"];
    status?: JourneyDetailDto["definition"]["status"];
  } = {},
): JourneyDetailDto {
  const versions = overrides.versions ?? [
    {
      id: V1,
      version: 1,
      publishedAt: AT,
      publishedBy: null,
      triggerEventType: TEMPLATE.settings.triggerEventType,
      graphChecksum: RPC_SHAPES.publish.graph_checksum,
    },
  ];
  return {
    definition: {
      id: J,
      key: "anulowanie",
      name: "Zaplanowane anulowanie",
      description: null,
      status: overrides.status ?? "active",
      category: "marketing",
      legalBasis: null,
      templateKey: TEMPLATE.key,
      publishedVersionId: versions[0]?.id ?? null,
      createdAt: AT,
      updatedAt: AT,
    },
    draft: DRAFT,
    draftValid: true,
    draftRaw: clone(DRAFT),
    draftIssue: null,
    versions,
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
    templateMatches: overrides.templateMatches ?? {},
  };
}

function workflowRow(overrides: Partial<WorkflowDefinitionRow>): WorkflowDefinitionRow {
  return {
    condition: {},
    created_at: AT,
    created_by: null,
    enabled: true,
    id: "wf-overlap",
    name: "Zadanie przy anulowaniu",
    steps: [{ action: "create_crm_task", params: { title: "Zapytaj o powód" } }],
    template_key: null,
    tenant_id: T,
    trigger_event_type: TEMPLATE.settings.triggerEventType,
    updated_at: AT,
    ...overrides,
  };
}

function mount(overrides: Partial<JourneyPublishDialogProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props: JourneyPublishDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    tenantId: T,
    journeyId: J,
    detail: detailFixture(),
    draft: DRAFT,
    expectedUpdatedAt: AT,
    capabilities: { canPublish: true },
    flushDraft: vi.fn(async () => FLUSHED),
    onPublished: vi.fn(),
    onConflict: vi.fn(),
    onFocusNode: vi.fn(),
    ...overrides,
  };
  render(
    <QueryClientProvider client={queryClient}>
      <JourneyPublishDialog {...props} />
    </QueryClientProvider>,
  );
  return props;
}

const dialog = () => screen.getByRole("dialog", { name: t("adminJourneys.publishDialog.title") });
const submitButton = () =>
  screen.getByRole("button", { name: t("adminJourneys.publishDialog.submit") });
const ackBox = () => screen.getByRole("checkbox", { name: t("adminJourneys.publishDialog.ack") });
const waitReady = () =>
  waitFor(() => expect(screen.queryByText(t("adminJourneys.publishDialog.loading"))).toBeNull());

beforeEach(() => {
  for (const fn of Object.values(h))
    if (typeof fn === "function" && "mockReset" in fn) fn.mockReset();
  h.settings.mockResolvedValue(ready(parseJourneySettings(RPC_SHAPES.settingsSaved)));
  h.health.mockResolvedValue(ready(parseEngineHealth(RPC_SHAPES.health, false)));
  h.list.mockResolvedValue(
    ready(
      parseJourneyList(clone(RPC_SHAPES.list)).map((item) => ({
        ...item,
        id: J,
        status: "active" as const,
        active: 5,
      })),
    ),
  );
  h.estimate.mockResolvedValue(ready(parseTriggerEstimate(RPC_SHAPES.estimate)));
  h.publish.mockResolvedValue({
    ok: true,
    data: { ...parsePublish(RPC_SHAPES.publish), version: 2 },
  });
  h.workflows.mockResolvedValue([]);
  h.setEnabled.mockResolvedValue(undefined);
  h.catalog.mockResolvedValue([toCatalogEntry(TEMPLATE)]);
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.warning).mockReset();
});
afterEach(cleanup);

describe("JourneyPublishDialog - admin", () => {
  it("podsumowanie: wyzwalacz, szacunek, maile, polityka, nadawca, kontakty w toku", async () => {
    mount();
    await waitReady();
    const root = dialog();
    expect(
      within(root).getByText(translateSummary(t, triggerSentence(DRAFT.settings))),
    ).toBeVisible();
    await waitFor(() =>
      expect(screen.getByTestId("journey-publish-estimate")).toHaveTextContent(
        t("adminJourneys.publishDialog.estimateValue", { count: 2, days: 30, events: 2 }),
      ),
    );
    expect(h.estimate).toHaveBeenCalledWith({
      data: {
        eventType: TEMPLATE.settings.triggerEventType,
        condition: { cancel_at_period_end: true },
        days: 30,
      },
    });
    expect(
      within(root).getByText(t("adminJourneys.publishDialog.emailsValue", { count: 2 })),
    ).toBeVisible();
    expect(
      within(root).getByText(
        t("adminJourneys.publishDialog.policyMarketing", {
          cap: 3,
          start: "22:00",
          end: "08:00",
          timezone: "Europe/Warsaw",
        }),
      ),
    ).toBeVisible();
    expect(
      within(root).getByText(t("adminJourneys.publishDialog.sender", { name: "Redakcja NES" })),
    ).toBeVisible();
    expect(screen.getByTestId("journey-publish-continuing")).toHaveTextContent(
      t("adminJourneys.publishDialog.continuing", { count: 5, version: 1 }),
    );
    expect(within(root).getByText(t("adminJourneys.publishDialog.exitUnsubscribe"))).toBeVisible();
    // `RPC_SHAPES.health`: silnik włączony, 1 kontakt do wykonania, żadnego kroku (Z-S5-03).
    expect(
      within(root).getByText(t("adminJourneys.engineStrip.notice.scheduler_pending")),
    ).toBeVisible();
    // Zasięg axe = treść okna (strażnicy ogniska Radiksa poza nim to artefakt prymitywu).
    const violations = await axeViolations(root);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("publikacja: potwierdzenie, flush szkicu, token z zapisu, tryb drain", async () => {
    const props = mount();
    await waitReady();
    expect(submitButton()).toBeDisabled();
    expect(screen.getByText(t("adminJourneys.publishDialog.ackRequired"))).toBeVisible();
    fireEvent.click(ackBox());
    await waitFor(() => expect(submitButton()).toBeEnabled());
    fireEvent.click(submitButton());
    await waitFor(() => expect(h.publish).toHaveBeenCalledTimes(1));
    expect(props.flushDraft).toHaveBeenCalledTimes(1);
    expect(h.publish).toHaveBeenCalledWith({
      data: { journeyId: J, expectedUpdatedAt: FLUSHED, mode: "drain", draft: DRAFT },
    });
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
    expect(props.onPublished).toHaveBeenCalledWith(expect.objectContaining({ version: 2 }));
    expect(toast.success).toHaveBeenCalledWith(
      t("adminJourneys.publishDialog.published", { version: 2 }),
    );
    expect(h.setEnabled).not.toHaveBeenCalled();
  });

  it("tryb exit_all; bez flushDraft publikuje z tokenem sesji", async () => {
    mount({ flushDraft: undefined });
    await waitReady();
    fireEvent.click(screen.getByRole("radio", { name: /Zakończ ich przejścia od razu/ }));
    fireEvent.click(ackBox());
    await waitFor(() => expect(submitButton()).toBeEnabled());
    fireEvent.click(submitButton());
    await waitFor(() =>
      expect(h.publish).toHaveBeenCalledWith({
        data: { journeyId: J, expectedUpdatedAt: AT, mode: "exit_all", draft: DRAFT },
      }),
    );
  });

  it("nieudany zapis szkicu wstrzymuje publikację", async () => {
    mount({ flushDraft: vi.fn(async () => null) });
    await waitReady();
    fireEvent.click(ackBox());
    await waitFor(() => expect(submitButton()).toBeEnabled());
    fireEvent.click(submitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t("adminJourneys.publishDialog.saveFailed"),
    );
    expect(h.publish).not.toHaveBeenCalled();
  });

  it("blokady: nadawca domyślny i treść z szablonu; przejście do kroku zamyka dialog", async () => {
    h.settings.mockResolvedValue(ready(parseJourneySettings(RPC_SHAPES.settingsDefault)));
    const props = mount({ detail: detailFixture({ templateMatches: { reason: true } }) });
    await waitReady();
    fireEvent.click(ackBox());
    expect(screen.getByText(t(JOURNEY_ISSUE_LABEL_KEY.sender_default))).toBeVisible();
    expect(screen.getByText(t(JOURNEY_ISSUE_LABEL_KEY.content_from_template))).toBeVisible();
    expect(submitButton()).toBeDisabled();
    expect(submitButton()).toHaveAccessibleDescription(
      t("adminJourneys.publishDialog.blocked", { count: 2 }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: t("adminJourneys.issuesList.goToStep", { number: NUMBERS.get("reason") }),
      }),
    );
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onFocusNode).toHaveBeenCalledWith("reason");
  });

  it("przepisy dublujące: zaznaczone domyślnie, wyłączane po publikacji; odznaczony zostaje", async () => {
    h.workflows.mockResolvedValue([
      workflowRow({ id: "wf-replace", name: "Przepis szablonu", template_key: REPLACED }),
      workflowRow({ id: "wf-overlap", name: "Zadanie przy anulowaniu" }),
      workflowRow({ id: "wf-other", name: "Inny", trigger_event_type: "paywall.hit.v1" }),
    ]);
    mount();
    await waitReady();
    const replace = await screen.findByRole("checkbox", {
      name: t("adminJourneys.publishDialog.workflowDisable", { name: "Przepis szablonu" }),
    });
    const overlap = screen.getByRole("checkbox", {
      name: t("adminJourneys.publishDialog.workflowDisable", { name: "Zadanie przy anulowaniu" }),
    });
    expect(replace).toHaveAttribute("aria-checked", "true");
    expect(replace).toHaveAccessibleDescription(
      t("adminJourneys.publishDialog.workflowReason.replace"),
    );
    expect(overlap).toHaveAccessibleDescription(
      t("adminJourneys.publishDialog.workflowReason.overlap"),
    );
    expect(screen.queryByText(/„Inny”/)).toBeNull();
    fireEvent.click(overlap);
    expect(overlap).toHaveAttribute("aria-checked", "false");
    fireEvent.click(ackBox());
    await waitFor(() => expect(submitButton()).toBeEnabled());
    fireEvent.click(submitButton());
    await waitFor(() => expect(h.setEnabled).toHaveBeenCalledTimes(1));
    expect(h.setEnabled).toHaveBeenCalledWith("wf-replace", false);
    // Kolejność: przepis wyłączamy dopiero PO udanej publikacji.
    expect(h.publish.mock.invocationCallOrder[0]).toBeLessThan(
      h.setEnabled.mock.invocationCallOrder[0],
    );
  });

  it("nieudane wyłączenie przepisu - publikacja zostaje, ostrzeżenie z nazwą", async () => {
    h.workflows.mockResolvedValue([
      workflowRow({ id: "wf-replace", name: "Przepis szablonu", template_key: REPLACED }),
    ]);
    h.setEnabled.mockRejectedValue(new Error("network"));
    const props = mount();
    await waitReady();
    await screen.findByRole("checkbox", {
      name: t("adminJourneys.publishDialog.workflowDisable", { name: "Przepis szablonu" }),
    });
    fireEvent.click(ackBox());
    await waitFor(() => expect(submitButton()).toBeEnabled());
    fireEvent.click(submitButton());
    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        t("adminJourneys.publishDialog.workflowDisableFailed", { name: "Przepis szablonu" }),
      ),
    );
    expect(props.onPublished).toHaveBeenCalled();
  });

  it("wyłączony przepis szablonu nie trafia do listy dublujących", async () => {
    h.workflows.mockResolvedValue([
      workflowRow({ id: "wf-replace", template_key: REPLACED, enabled: false }),
    ]);
    mount();
    await waitReady();
    expect(screen.queryByText(t("adminJourneys.publishDialog.workflows"))).toBeNull();
  });

  it("konflikt CAS: komunikat, onConflict, dialog zostaje", async () => {
    h.publish.mockResolvedValue({ ok: false, error: "conflict", reason: "conflict" });
    const props = mount();
    await waitReady();
    fireEvent.click(ackBox());
    await waitFor(() => expect(submitButton()).toBeEnabled());
    fireEvent.click(submitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t("adminJourneys.publishDialog.conflict"),
    );
    expect(props.onConflict).toHaveBeenCalledTimes(1);
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("graph_invalid i content_missing z serwera -> problemy z numerami kroków", async () => {
    h.publish.mockResolvedValueOnce({
      ok: false,
      error: "invalid",
      reason: "graph_invalid",
      detail: JSON.stringify([{ code: "wait_minutes", nodeId: "wait_5d" }]),
    });
    h.publish.mockResolvedValueOnce({
      ok: false,
      error: "invalid",
      reason: "content_missing",
      detail: JSON.stringify(["keep"]),
    });
    mount();
    await waitReady();
    fireEvent.click(ackBox());
    await waitFor(() => expect(submitButton()).toBeEnabled());
    fireEvent.click(submitButton());
    const first = await screen.findByRole("alert");
    expect(
      within(first).getByRole("heading", { name: t("adminJourneys.publishDialog.serverTitle") }),
    ).toBeVisible();
    expect(within(first).getByText(t(journeyLabelKey("graphIssue", "wait_minutes")))).toBeVisible();
    expect(
      within(first).getByText(
        t("adminJourneys.issuesList.step", { number: NUMBERS.get("wait_5d") }),
      ),
    ).toBeVisible();
    fireEvent.click(submitButton());
    await waitFor(() =>
      expect(
        within(screen.getByRole("alert")).getByText(t(JOURNEY_ISSUE_LABEL_KEY.content_missing)),
      ).toBeVisible(),
    );
    expect(
      within(screen.getByRole("alert")).getByText(
        t("adminJourneys.issuesList.step", { number: NUMBERS.get("keep") }),
      ),
    ).toBeVisible();
  });

  it("inny błąd zapisu -> zdanie z kodu i powodu", async () => {
    h.publish.mockResolvedValue({ ok: false, error: "invalid", reason: "journey_archived" });
    mount();
    await waitReady();
    fireEvent.click(ackBox());
    await waitFor(() => expect(submitButton()).toBeEnabled());
    fireEvent.click(submitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      `${t(journeyLabelKey("mutationError", "invalid"))} ${t("adminJourneys.common.reason.journey_archived")}`,
    );
  });

  it("błędy silnika z ostatniej doby - zdanie bez odsyłacza do listy błędów", async () => {
    h.health.mockResolvedValue(
      ready(
        parseEngineHealth(
          { ...(clone(RPC_SHAPES.health) as object), due_now: 0, failed_24h: 2 },
          false,
        ),
      ),
    );
    mount();
    await waitReady();
    expect(screen.getByText(t("adminJourneys.publishDialog.engineErrors"))).toBeVisible();
    expect(screen.queryByText(t("adminJourneys.engineStrip.notice.errors"))).toBeNull();
  });

  it("pierwsza publikacja bez wyboru trybu; zarchiwizowana zablokowana", async () => {
    mount({ detail: detailFixture({ versions: [] }) });
    await waitReady();
    expect(screen.getByText(t("adminJourneys.publishDialog.firstVersion"))).toBeVisible();
    expect(screen.queryAllByRole("radio")).toEqual([]);
    cleanup();
    mount({ detail: detailFixture({ status: "archived" }) });
    await waitReady();
    fireEvent.click(ackBox());
    expect(submitButton()).toBeDisabled();
    expect(submitButton()).toHaveAccessibleDescription(t("adminJourneys.publishDialog.archived"));
  });
});

describe("JourneyPublishDialog - odmowy jako stany", () => {
  it("redaktor: RoleGateNotice (admin), żadnych odczytów ani przycisku publikacji", () => {
    mount({ capabilities: { canPublish: false } });
    const notice = within(dialog()).getByTestId("revenue-role-gate");
    expect(notice).toHaveAttribute("data-required-role", "admin");
    expect(
      screen.queryByRole("button", { name: t("adminJourneys.publishDialog.submit") }),
    ).toBeNull();
    expect(h.settings).not.toHaveBeenCalled();
  });

  it("brak aal2 przy odczycie kontekstu -> MfaRequiredNotice", async () => {
    h.settings.mockRejectedValue(new Error("Forbidden: mfa_required (aal2)"));
    mount();
    expect(await screen.findByTestId("revenue-mfa-required", {}, { timeout: 3000 })).toBeVisible();
  });

  it("brak aal2 przy publikacji -> MfaRequiredNotice", async () => {
    h.publish.mockRejectedValue(new Error("Forbidden: mfa_required (aal2)"));
    mount();
    await waitReady();
    fireEvent.click(ackBox());
    await waitFor(() => expect(submitButton()).toBeEnabled());
    fireEvent.click(submitButton());
    expect(await screen.findByTestId("revenue-mfa-required")).toBeVisible();
  });
});
