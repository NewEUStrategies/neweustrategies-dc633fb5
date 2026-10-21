// Zakładka „Kontakty” (S8-B) - zapisy kontaktów, filtr, strony, akcje wg ról; RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Tabela z `caption`/`scope`: kontakt (odnośnik do karty CRM, adres,
//      oznaczenie testu), status i powód z etykiet silnika, bieżący krok
//      z numeracji kanwy, wersja.
//   2. Filtr statusu i strony po 50 idą do `getJourneyEnrollments`
//      (`status`, `page`, krok panelu); filtr wraca na pierwszą stronę.
//   3. Admin: „Pomiń czekanie” i „Wyjmij” z `ConfirmDialog`, wynik
//      `ok:false` tłumaczony kodem i powodem RPC.
//   4. Redaktor: „Wyjmij” działa, „Pomiń czekanie” wyłączone (`aria-disabled`,
//      fokus zostaje) z wyjaśnieniem w `aria-describedby`; klik nic nie wysyła.
//   5. Stany: autor, `mfa_required`, niewdrożone, pusty krok. axe bez naruszeń.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
  hydrated: true,
  auth: { roles: ["admin"], tenantId: "11111111-1111-4111-8111-111111111111" } as {
    roles: string[];
    tenantId: string | null;
  },
  enrollments: vi.fn(),
  detail: vi.fn(),
  exit: vi.fn(),
  skip: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.("pl"), i18n: { language: "pl" }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
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
vi.mock("@/lib/journeys/journeys.functions", () => ({
  getJourneyEnrollments: (input: unknown) => h.enrollments(input),
  exitJourneyEnrollment: (input: unknown) => h.exit(input),
  skipJourneyWait: (input: unknown) => h.skip(input),
}));
vi.mock("@/lib/admin/journeys/journeyEditor.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/journeys/journeyEditor.functions")>()),
  getJourneyDetail: (input: unknown) => h.detail(input),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { toast } from "sonner";
import { JourneyEnrollmentsTable } from "../JourneyEnrollmentsTable";
import { mutationErrorText } from "@/lib/admin/journeys/journeyMutations";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import { RPC_SHAPES } from "@/lib/journeys/__tests__/rpcShapes.fixture";
import { parseJourneyEnrollments } from "@/lib/journeys/parse";
import "@/lib/i18n-admin-revenue";
import "@/lib/i18n-admin-revenue-shell";
import "@/lib/i18n-admin-journeys";
import "@/lib/i18n-admin-journeys-list";
import "@/lib/i18n-admin-journeys-results";

h.fixedT = realT;
const t = realT("pl");
const J = "4cab3de7-f976-404a-b54e-c37337942b7e";
const AT = "2026-10-20T09:57:10.333703+00:00";
const E_WAIT = "aaaaaaaa-0000-4000-8000-000000000001";
const E_ACTIVE = "aaaaaaaa-0000-4000-8000-000000000002";
const E_DONE = "aaaaaaaa-0000-4000-8000-000000000003";

function clone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

const GRAPH = {
  nodes: [
    { id: "t", type: "trigger", params: {} },
    { id: "w", type: "wait", params: { mode: "duration", minutes: 60 } },
    { id: "m", type: "send_email", params: {} },
    { id: "x", type: "exit", params: {} },
  ],
  edges: [
    { from: "t", to: "w", branch: "next" },
    { from: "w", to: "m", branch: "next" },
    { from: "m", to: "x", branch: "next" },
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
      templateKey: null,
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

function page(total = 3, pageIndex = 0) {
  const raw = clone(RPC_SHAPES.enrollments) as {
    total: number;
    page: number;
    rows: Record<string, unknown>[];
  };
  const base = raw.rows[0];
  raw.total = total;
  raw.page = pageIndex;
  raw.rows = [
    {
      ...base,
      id: E_WAIT,
      status: "waiting",
      is_test: false,
      lead_name: "Anna Nowak",
      lead_email: "anna@example.test",
      current_node_id: "w",
      exit_reason: null,
      finished_at: null,
      next_run_at: AT,
    },
    {
      ...base,
      id: E_ACTIVE,
      status: "active",
      is_test: false,
      lead_name: null,
      lead_email: "jan@example.test",
      current_node_id: "m",
      exit_reason: null,
      finished_at: null,
    },
    { ...base, id: E_DONE },
  ];
  return { state: "ready", data: parseJourneyEnrollments(raw) };
}

function mount(nodeId: string | null = null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <JourneyEnrollmentsTable journeyId={J} nodeId={nodeId} />
    </QueryClientProvider>,
  );
}

const row = (id: string) =>
  document.querySelector(`[data-enrollment-id="${id}"]`) as HTMLTableRowElement;

async function confirmIn(label: string) {
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: label }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
}

beforeEach(() => {
  h.hydrated = true;
  h.auth = { roles: ["admin"], tenantId: "11111111-1111-4111-8111-111111111111" };
  h.enrollments.mockReset().mockResolvedValue(page());
  h.detail.mockReset().mockResolvedValue(DETAIL);
  h.exit.mockReset().mockResolvedValue({ ok: true, data: { exited: true } });
  h.skip.mockReset().mockResolvedValue({ ok: true, data: { enrollmentId: E_WAIT } });
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});
afterEach(cleanup);

describe("tabela zapisów", () => {
  it("caption/scope, kontakt z odnośnikiem do CRM, etykiety silnika, krok z numeracji", async () => {
    mount();
    const table = await screen.findByRole("table", {
      name: t("adminJourneys.enrollments.caption"),
    });
    for (const header of within(table).getAllByRole("columnheader")) {
      expect(header).toHaveAttribute("scope", "col");
    }
    const waiting = row(E_WAIT);
    const contact = within(waiting).getByRole("link", {
      name: t("adminJourneys.enrollments.openLead", { name: "Anna Nowak" }),
    });
    expect(contact).toHaveAttribute("href", "/admin/crm/434b9215-1ddc-4b35-aaf2-84ed79898881");
    expect(waiting).toHaveTextContent("anna@example.test");
    expect(waiting).toHaveTextContent(t("adminJourneys.enrollmentStatus.waiting"));
    await waitFor(() =>
      expect(waiting).toHaveTextContent(
        t("adminJourneys.results.stepLabel", {
          number: "2",
          type: t("adminJourneys.nodeType.wait"),
        }),
      ),
    );
    // Bez nazwy kontaktu - adres jako nazwa.
    expect(within(row(E_ACTIVE)).getByRole("rowheader")).toHaveTextContent("jan@example.test");
    const done = row(E_DONE);
    expect(done).toHaveTextContent(t("adminJourneys.exitReason.manual"));
    expect(done).toHaveTextContent(t("adminJourneys.enrollments.test"));
    expect(done).toHaveTextContent("v1");
    expect(screen.getByTestId("journey-enrollments-total")).toHaveTextContent("3 zapisy");
  });

  it("filtr statusu i krok panelu w zapytaniu; zmiana filtra wraca na pierwszą stronę", async () => {
    h.enrollments.mockResolvedValue(page(120));
    mount("w");
    await screen.findByRole("table");
    expect(h.enrollments).toHaveBeenLastCalledWith({
      data: { journeyId: J, nodeId: "w", status: null, page: 0, pageSize: 50 },
    });
    fireEvent.click(screen.getByRole("button", { name: t("adminJourneys.enrollments.next") }));
    await waitFor(() =>
      expect(h.enrollments).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ page: 1 }),
      }),
    );
    expect(
      screen.getByText(t("adminJourneys.enrollments.pageOf", { page: 2, pages: 3 })),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText(t("adminJourneys.enrollments.statusFilter")), {
      target: { value: "waiting" },
    });
    await waitFor(() =>
      expect(h.enrollments).toHaveBeenLastCalledWith({
        data: { journeyId: J, nodeId: "w", status: "waiting", page: 0, pageSize: 50 },
      }),
    );
  });

  it("pusty krok - zdanie zamiast tabeli", async () => {
    h.enrollments.mockResolvedValue({
      state: "ready",
      data: { total: 0, page: 0, pageSize: 50, rows: [] },
    });
    mount("m");
    expect(await screen.findByText(t("adminJourneys.enrollments.emptyNode"))).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("akcje wg ról", () => {
  it("admin: pominięcie czekania i wyjście z potwierdzeniem", async () => {
    mount();
    await screen.findByRole("table");
    fireEvent.click(
      within(row(E_WAIT)).getByRole("button", {
        name: t("adminJourneys.enrollments.skipFor", { name: "Anna Nowak" }),
      }),
    );
    await confirmIn(t("adminJourneys.enrollments.skipConfirm"));
    expect(h.skip).toHaveBeenCalledWith({ data: { enrollmentId: E_WAIT } });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(t("adminJourneys.enrollments.skipDone")),
    );

    fireEvent.click(
      within(row(E_ACTIVE)).getByRole("button", {
        name: t("adminJourneys.enrollments.exitFor", { name: "jan@example.test" }),
      }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(t("adminJourneys.exitReason.manual"));
    await confirmIn(t("adminJourneys.enrollments.exitConfirm"));
    expect(h.exit).toHaveBeenCalledWith({ data: { enrollmentId: E_ACTIVE } });
    // Zapis zakończony nie ma akcji.
    expect(within(row(E_DONE)).queryAllByRole("button")).toEqual([]);
  });

  it("wynik `ok:false` - zdanie z kodu i powodu RPC", async () => {
    const failure = { ok: false, error: "invalid", reason: "not_waiting" } as const;
    h.skip.mockResolvedValue(failure);
    mount();
    await screen.findByRole("table");
    fireEvent.click(
      within(row(E_WAIT)).getByRole("button", {
        name: t("adminJourneys.enrollments.skipFor", { name: "Anna Nowak" }),
      }),
    );
    await confirmIn(t("adminJourneys.enrollments.skipConfirm"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(mutationErrorText(t, failure)));
  });

  it("redaktor: wyjście działa, pominięcie wyłączone z wyjaśnieniem (fokus zostaje)", async () => {
    h.auth = { roles: ["editor"], tenantId: "11111111-1111-4111-8111-111111111111" };
    mount();
    await screen.findByRole("table");
    const skip = within(row(E_WAIT)).getByRole("button", {
      name: t("adminJourneys.enrollments.skipFor", { name: "Anna Nowak" }),
    });
    expect(skip).toHaveAttribute("aria-disabled", "true");
    expect(skip).not.toBeDisabled();
    const hint = document.getElementById(skip.getAttribute("aria-describedby") ?? "");
    expect(hint).toHaveTextContent(t("adminJourneys.enrollments.skipAdminOnly"));
    fireEvent.click(skip);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(h.skip).not.toHaveBeenCalled();
    expect(
      within(row(E_ACTIVE)).getByRole("button", {
        name: t("adminJourneys.enrollments.exitFor", { name: "jan@example.test" }),
      }),
    ).not.toBeDisabled();
  });

  it("axe bez naruszeń (admin i redaktor)", async () => {
    const { container } = mount();
    await screen.findByRole("table");
    let violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
    cleanup();
    h.auth = { roles: ["editor"], tenantId: "11111111-1111-4111-8111-111111111111" };
    const editor = mount();
    await screen.findByRole("table");
    violations = await axeViolations(editor.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("stany", () => {
  it("autor - RoleGateNotice, bez zapytań", () => {
    h.auth = { roles: ["author"], tenantId: "11111111-1111-4111-8111-111111111111" };
    mount();
    expect(screen.getByTestId("revenue-role-gate")).toBeTruthy();
    expect(h.enrollments).not.toHaveBeenCalled();
  });

  it("brak aal2 - MfaRequiredNotice (dane osobowe kontaktów)", async () => {
    h.enrollments.mockRejectedValue(new Error("Forbidden: mfa_required (aal2)"));
    mount();
    expect(await screen.findByTestId("revenue-mfa-required")).toBeTruthy();
  });

  it("niewdrożone - komunikat", async () => {
    h.enrollments.mockResolvedValue({ state: "unavailable" });
    mount();
    expect(await screen.findByText(t("adminJourneys.enrollments.unavailable"))).toBeTruthy();
  });
});
