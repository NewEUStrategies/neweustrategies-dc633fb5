// Test na sobie (S8.3c2) - RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Tylko własny kontakt: zapis idzie `enrollJourneyTest({ journeyId })` -
//      bez żadnego identyfikatora kontaktu w żądaniu; panel nie ma wyboru.
//   2. Test działa na OPUBLIKOWANEJ wersji (numer w panelu, kroki opisane
//      według grafu wersji); bez publikacji - przycisk wyłączony z powodem.
//   3. Uczciwie o silniku: prefiks „[TEST] ”, zależność od harmonogramu (I9)
//      i bieżący komunikat zdrowia (`scheduler_pending`, „nie wykonał żadnego
//      kroku”).
//   4. Postęp z `journeyEnrollmentsQueryOptions` (wiersz testowy po id),
//      „Pomiń oczekiwanie” tylko admin i tylko na czekaniu (redaktor: wyłączony
//      z widocznym wyjaśnieniem), „Zakończ test”; zapis pamiętany w karcie.
//   5. Błędy `own_lead_missing`/`duplicate` jako zdania, redaktor bez roli ->
//      `RoleGateNotice`, brak `aal2` -> `MfaRequiredNotice`. axe bez naruszeń.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
  health: vi.fn(),
  enrollments: vi.fn(),
  enroll: vi.fn(),
  skip: vi.fn(),
  exit: vi.fn(),
  version: vi.fn(),
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
  getJourneyEngineHealth: () => h.health(),
  getJourneyEnrollments: (input: unknown) => h.enrollments(input),
  enrollJourneyTest: (input: unknown) => h.enroll(input),
  skipJourneyWait: (input: unknown) => h.skip(input),
  exitJourneyEnrollment: (input: unknown) => h.exit(input),
}));
vi.mock("@/lib/admin/journeys/journeyEditor.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/journeys/journeyEditor.functions")>()),
  getJourneyVersion: (input: unknown) => h.version(input),
}));

import { JourneyTestPanel, type JourneyTestPanelProps } from "../JourneyTestPanel";
import type { JourneyVersionSummary } from "@/lib/admin/journeys/journeyEditor.functions";
import { buildJourneyView } from "@/lib/admin/journeys/viewModel";
import { RPC_SHAPES } from "@/lib/journeys/__tests__/rpcShapes.fixture";
import { journeyLabelKey } from "@/lib/journeys/labels";
import { parseEngineHealth, parseJourneyEnrollments } from "@/lib/journeys/parse";
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
const E = "c37321d8-4fb5-4c59-8b70-277e4ba45ba5";
const LEAD = "434b9215-1ddc-4b35-aaf2-84ed79898881";
const AT = "2026-10-20T09:57:10.333703+00:00";
const NEXT_RUN = "2026-10-21T09:00:00+00:00";

/** Fikstury `as const` przez JSON - kopia bez wspólnych referencji. */
const clone = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const ready = <D,>(data: D) => ({ state: "ready" as const, data });

const VERSION: JourneyVersionSummary = {
  id: V1,
  version: 1,
  publishedAt: AT,
  publishedBy: null,
  triggerEventType: "checkout.abandoned.v1",
  graphChecksum: RPC_SHAPES.publish.graph_checksum,
};
const GRAPH = {
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
} as const;
const W_NUMBER = buildJourneyView(
  clone(GRAPH) as Parameters<typeof buildJourneyView>[0],
).numbering.get("w");

function enrollmentsPage(row: Record<string, unknown>) {
  const shape = clone(RPC_SHAPES.enrollments) as { rows: Record<string, unknown>[] };
  return ready(
    parseJourneyEnrollments({
      ...shape,
      rows: [
        {
          ...shape.rows[0],
          id: E,
          lead_id: LEAD,
          status: "waiting",
          is_test: true,
          current_node_id: "w",
          next_run_at: NEXT_RUN,
          exit_reason: null,
          finished_at: null,
          ...row,
        },
      ],
    }),
  );
}

function mount(overrides: Partial<JourneyTestPanelProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props: JourneyTestPanelProps = {
    tenantId: T,
    journeyId: J,
    definition: { status: "active", publishedVersionId: V1 },
    versions: [VERSION],
    capabilities: { canTest: true, canSkipWait: true },
    ...overrides,
  };
  render(
    <QueryClientProvider client={queryClient}>
      <JourneyTestPanel {...props} />
    </QueryClientProvider>,
  );
  return props;
}

const panel = () => screen.getByTestId("journey-test-panel");
const button = (key: string) => screen.getByRole("button", { name: t(key) });
const formatTime = (iso: string) =>
  new Intl.DateTimeFormat("pl-PL", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso),
  );

beforeEach(() => {
  for (const fn of [h.health, h.enrollments, h.enroll, h.skip, h.exit, h.version]) fn.mockReset();
  window.sessionStorage.clear();
  h.health.mockResolvedValue(ready(parseEngineHealth(RPC_SHAPES.health, false)));
  h.enrollments.mockResolvedValue(enrollmentsPage({}));
  h.version.mockResolvedValue(
    ready({
      version: VERSION,
      graphRaw: clone(GRAPH),
      settingsRaw: { triggerEventType: "checkout.abandoned.v1" },
      contents: [],
    }),
  );
  h.enroll.mockResolvedValue({ ok: true, data: { enrollmentId: E, leadId: LEAD } });
  h.skip.mockResolvedValue({ ok: true, data: { enrollmentId: E } });
  h.exit.mockResolvedValue({ ok: true, data: { exited: true } });
});
afterEach(cleanup);

describe("JourneyTestPanel - admin", () => {
  it("własny kontakt: zapis bez wyboru kontaktu, postęp według wersji, pominięcie i koniec", async () => {
    mount();
    expect(
      within(panel()).getByRole("heading", { name: t("adminJourneys.testPanel.title") }),
    ).toBeVisible();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText(t("adminJourneys.testPanel.version", { version: 1 }))).toBeVisible();
    expect(screen.getByText(t("adminJourneys.testPanel.prefix"))).toHaveTextContent("[TEST] ");
    expect(screen.getByText(t("adminJourneys.testPanel.scheduler"))).toBeVisible();
    expect(await screen.findByTestId("journey-test-engine")).toHaveTextContent(
      t("adminJourneys.engineStrip.notice.scheduler_pending"),
    );
    // Zanim kliknięto - nic nie czyta postępu (nie wiemy, który zapis jest nasz).
    expect(h.enrollments).not.toHaveBeenCalled();
    const violationsBefore = await axeViolations(panel());
    expect(violationsBefore, summarize(violationsBefore)).toEqual([]);

    fireEvent.click(button("adminJourneys.testPanel.start"));
    await waitFor(() => expect(h.enroll).toHaveBeenCalledWith({ data: { journeyId: J } }));
    expect(await screen.findByText(t("adminJourneys.testPanel.started"))).toBeVisible();
    const progress = await screen.findByTestId("journey-test-progress");
    await waitFor(() =>
      expect(
        within(progress).getByText(t(journeyLabelKey("enrollmentStatus", "waiting"))),
      ).toBeVisible(),
    );
    await waitFor(() =>
      expect(
        within(progress).getByText(
          t("adminJourneys.testPanel.stepValue", {
            number: W_NUMBER,
            description: t("adminJourneys.common.summary.waitDays", { count: 1 }),
          }),
        ),
      ).toBeVisible(),
    );
    expect(within(progress).getByText(formatTime(NEXT_RUN))).toBeVisible();
    expect(JSON.parse(window.sessionStorage.getItem(`nes.journeyTest.${J}`) ?? "null")).toEqual({
      enrollmentId: E,
      leadId: LEAD,
    });
    const violationsAfter = await axeViolations(panel());
    expect(violationsAfter, summarize(violationsAfter)).toEqual([]);

    fireEvent.click(button("adminJourneys.testPanel.skip"));
    await waitFor(() => expect(h.skip).toHaveBeenCalledWith({ data: { enrollmentId: E } }));
    expect(await screen.findByText(t("adminJourneys.testPanel.skipped"))).toBeVisible();

    fireEvent.click(button("adminJourneys.testPanel.exit"));
    await waitFor(() => expect(h.exit).toHaveBeenCalledWith({ data: { enrollmentId: E } }));
    expect(await screen.findByText(t("adminJourneys.testPanel.exited"))).toBeVisible();
  });

  it("zapis z karty wraca po ponownym otwarciu; zakończony test bez akcji, z powodem", async () => {
    window.sessionStorage.setItem(
      `nes.journeyTest.${J}`,
      JSON.stringify({ enrollmentId: E, leadId: LEAD }),
    );
    h.enrollments.mockResolvedValue(
      enrollmentsPage({ status: "exited", exit_reason: "manual", next_run_at: null }),
    );
    mount();
    const progress = await screen.findByTestId("journey-test-progress");
    await waitFor(() =>
      expect(within(progress).getByText(t(journeyLabelKey("exitReason", "manual")))).toBeVisible(),
    );
    expect(h.enroll).not.toHaveBeenCalled();
    expect(button("adminJourneys.testPanel.restart")).toBeEnabled();
    expect(screen.getByText(t("adminJourneys.testPanel.restartHint"))).toBeVisible();
    expect(screen.queryByRole("button", { name: t("adminJourneys.testPanel.skip") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("adminJourneys.testPanel.exit") })).toBeNull();
  });

  it("kontakt w toku, ale nie na czekaniu - pominięcie wyłączone z powodem", async () => {
    window.sessionStorage.setItem(
      `nes.journeyTest.${J}`,
      JSON.stringify({ enrollmentId: E, leadId: LEAD }),
    );
    h.enrollments.mockResolvedValue(enrollmentsPage({ status: "active" }));
    mount();
    await waitFor(() => expect(button("adminJourneys.testPanel.skip")).toBeDisabled());
    expect(button("adminJourneys.testPanel.skip")).toHaveAccessibleDescription(
      t("adminJourneys.testPanel.skipNotWaiting"),
    );
    expect(button("adminJourneys.testPanel.exit")).toBeEnabled();
  });

  it("brak opublikowanej wersji - zapis wyłączony z powodem", () => {
    mount({ definition: { status: "draft", publishedVersionId: null }, versions: [] });
    expect(screen.getByText(t("adminJourneys.testPanel.notPublished"))).toBeVisible();
    expect(button("adminJourneys.testPanel.start")).toBeDisabled();
    expect(h.version).not.toHaveBeenCalled();
  });

  it("own_lead_missing i duplicate jako zdania; silnik bez kroków przy pustej kolejce", async () => {
    h.health.mockResolvedValue(
      ready(parseEngineHealth({ ...(clone(RPC_SHAPES.health) as object), due_now: 0 }, false)),
    );
    h.enroll.mockResolvedValueOnce({
      ok: false,
      error: "not_found",
      reason: "own_lead_missing",
    });
    h.enroll.mockResolvedValueOnce({ ok: false, error: "duplicate", reason: "already_enrolled" });
    mount();
    expect(await screen.findByTestId("journey-test-engine")).toHaveTextContent(
      t("adminJourneys.testPanel.runnerIdle"),
    );
    fireEvent.click(button("adminJourneys.testPanel.start"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      `${t(journeyLabelKey("mutationError", "not_found"))} ${t("adminJourneys.common.reason.own_lead_missing")}`,
    );
    fireEvent.click(button("adminJourneys.testPanel.start"));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(t("adminJourneys.testPanel.duplicate")),
    );
    expect(screen.queryByTestId("journey-test-progress")).toBeNull();
  });

  it("brak aal2 przy zapisie -> MfaRequiredNotice", async () => {
    h.enroll.mockRejectedValue(new Error("Forbidden: mfa_required (aal2)"));
    mount();
    fireEvent.click(button("adminJourneys.testPanel.start"));
    expect(await screen.findByTestId("revenue-mfa-required")).toBeVisible();
  });
});

describe("JourneyTestPanel - redaktor i brak roli", () => {
  it("redaktor: pominięcie czekania wyłączone z widocznym wyjaśnieniem", async () => {
    window.sessionStorage.setItem(
      `nes.journeyTest.${J}`,
      JSON.stringify({ enrollmentId: E, leadId: LEAD }),
    );
    mount({ capabilities: { canTest: true, canSkipWait: false } });
    await waitFor(() => expect(button("adminJourneys.testPanel.skip")).toBeDisabled());
    expect(screen.getByText(t("adminJourneys.testPanel.skipAdminOnly"))).toBeVisible();
    expect(button("adminJourneys.testPanel.skip")).toHaveAccessibleDescription(
      t("adminJourneys.testPanel.skipAdminOnly"),
    );
    expect(button("adminJourneys.testPanel.exit")).toBeEnabled();
    const violations = await axeViolations(panel());
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("bez roli: RoleGateNotice zamiast panelu, żadnych odczytów", () => {
    mount({ capabilities: { canTest: false, canSkipWait: false } });
    expect(within(panel()).getByTestId("revenue-role-gate")).toHaveAttribute(
      "data-required-role",
      "admin_or_editor",
    );
    expect(h.health).not.toHaveBeenCalled();
  });
});
