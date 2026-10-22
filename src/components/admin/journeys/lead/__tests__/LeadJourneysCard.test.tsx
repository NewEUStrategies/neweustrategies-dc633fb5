// Karta „Ścieżki” kontaktu w CRM (S8-B) - zapisy kontaktu, akcje wg ról, stany; RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Każdy zapis: nazwa ścieżki jako odnośnik do edytora na bieżącym kroku
//      (`?node=<id>&tab=contacts`), status i powód z etykiet silnika,
//      oznaczenie testu, wersja, daty.
//   2. Admin: „Pomiń czekanie” i „Wyjmij” przez `ConfirmDialog`; po pominięciu
//      karta odświeża ścieżki kontaktu. Redaktor: „Wyjmij” działa, pominięcie
//      wyłączone (`aria-disabled`) z wyjaśnieniem. Zapis zakończony - bez akcji.
//   3. Stany karty (nie toasty): przed hydratacją, autor, `mfa_required`,
//      niewdrożone, błąd z ponowieniem, pusto z następnym krokiem (galeria).
//   4. `lang` karty kontaktu przypina język słownika. axe bez naruszeń.
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
  lead: vi.fn(),
  exit: vi.fn(),
  skip: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: (_ns?: unknown, options?: { lng?: "pl" | "en" }) => ({
    t: h.fixedT?.(options?.lng ?? "pl"),
    i18n: { language: "pl" },
    ready: true,
  }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    ...(await importOriginal<typeof import("@tanstack/react-router")>()),
    // Stub gubi `search` - zapisujemy go w atrybucie (bez cudzysłowów, które
    // psułyby selektory axe), żeby test widział adres.
    Link: ({ search, ...props }: Parameters<typeof RouterLinkStub>[0]) => (
      <RouterLinkStub
        {...props}
        data-search={new URLSearchParams((search ?? {}) as Record<string, string>).toString()}
      />
    ),
    useHydrated: () => h.hydrated,
  };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireCrmStaff: { __mw: "requireCrmStaff" },
  requireAdmin: { __mw: "requireAdmin" },
}));
vi.mock("@/lib/journeys/journeys.functions", () => ({
  getLeadJourneys: (input: unknown) => h.lead(input),
  exitJourneyEnrollment: (input: unknown) => h.exit(input),
  skipJourneyWait: (input: unknown) => h.skip(input),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { toast } from "sonner";
import { LeadJourneysCard } from "../LeadJourneysCard";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import { RPC_SHAPES } from "@/lib/journeys/__tests__/rpcShapes.fixture";
import { parseLeadEnrollments } from "@/lib/journeys/parse";
import "@/lib/i18n-admin-revenue";
import "@/lib/i18n-admin-revenue-shell";
import "@/lib/i18n-admin-journeys";
import "@/lib/i18n-admin-journeys-list";
import "@/lib/i18n-admin-journeys-results";

h.fixedT = realT;
const t = realT("pl");
const LEAD = "434b9215-1ddc-4b35-aaf2-84ed79898881";
const J1 = "4cab3de7-f976-404a-b54e-c37337942b7e";
const J2 = "aaaaaaaa-0000-4000-8000-0000000000aa";
const E_WAIT = "bbbbbbbb-0000-4000-8000-000000000001";
const E_ACTIVE = "bbbbbbbb-0000-4000-8000-000000000002";
const E_DONE = "c37321d8-4fb5-4c59-8b70-277e4ba45ba5";

function clone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function rows() {
  const base = (clone(RPC_SHAPES.leadEnrollments) as Record<string, unknown>[])[0];
  return parseLeadEnrollments([
    {
      ...base,
      enrollment_id: E_WAIT,
      journey_id: J1,
      journey_name: "Powitanie",
      status: "waiting",
      is_test: false,
      exit_reason: null,
      finished_at: null,
      current_node_id: "w",
    },
    {
      ...base,
      enrollment_id: E_ACTIVE,
      journey_id: J2,
      journey_name: "Porzucona kasa",
      status: "active",
      is_test: false,
      exit_reason: null,
      finished_at: null,
      current_node_id: "m2",
      version: 3,
    },
    base,
  ]);
}

function mount(lang?: "pl" | "en") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LeadJourneysCard leadId={LEAD} lang={lang} />
    </QueryClientProvider>,
  );
}

const item = (id: string) =>
  document.querySelector(`[data-enrollment-id="${id}"]`) as HTMLLIElement;

async function confirmIn(label: string) {
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: label }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
}

beforeEach(() => {
  h.hydrated = true;
  h.auth = { roles: ["admin"], tenantId: "11111111-1111-4111-8111-111111111111" };
  h.lead.mockReset().mockResolvedValue({ state: "ready", data: rows() });
  h.exit.mockReset().mockResolvedValue({ ok: true, data: { exited: true } });
  h.skip.mockReset().mockResolvedValue({ ok: true, data: { enrollmentId: E_WAIT } });
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});
afterEach(cleanup);

describe("zapisy kontaktu", () => {
  it("odnośnik do edytora na bieżącym kroku, status, test, wersja, powód", async () => {
    mount();
    const list = await screen.findByRole("list", { name: t("adminJourneys.lead.list") });
    expect(h.lead).toHaveBeenCalledWith({ data: { leadId: LEAD } });
    const waiting = item(E_WAIT);
    const link = within(waiting).getByRole("link", {
      name: t("adminJourneys.lead.open", { name: "Powitanie" }),
    });
    expect(link).toHaveAttribute("href", `/admin/revenue/journeys/${J1}`);
    expect(link).toHaveAttribute("data-search", "node=w&tab=contacts");
    expect(waiting).toHaveTextContent(t("adminJourneys.enrollmentStatus.waiting"));
    expect(waiting).toHaveTextContent(t("adminJourneys.lead.step", { node: "w" }));
    expect(item(E_ACTIVE)).toHaveTextContent(t("adminJourneys.lead.version", { version: 3 }));
    const done = item(E_DONE);
    expect(done).toHaveTextContent(t("adminJourneys.lead.test"));
    expect(done).toHaveTextContent(
      t("adminJourneys.lead.reason", { reason: t("adminJourneys.exitReason.manual") }),
    );
    expect(within(done).queryAllByRole("button")).toEqual([]);
    expect(list.children).toHaveLength(3);
  });

  it("język karty kontaktu (`lang`) przypina słownik", async () => {
    mount("en");
    expect(
      screen.getByRole("heading", { name: realT("en")("adminJourneys.lead.title") }),
    ).toBeTruthy();
    expect(
      await screen.findByRole("list", { name: realT("en")("adminJourneys.lead.list") }),
    ).toBeTruthy();
  });
});

describe("akcje wg ról", () => {
  it("admin: pominięcie czekania (potem odświeżenie ścieżek kontaktu) i wyjście", async () => {
    mount();
    await screen.findByRole("list", { name: t("adminJourneys.lead.list") });
    fireEvent.click(
      within(item(E_WAIT)).getByRole("button", {
        name: t("adminJourneys.lead.skipFor", { name: "Powitanie" }),
      }),
    );
    await confirmIn(t("adminJourneys.enrollments.skipConfirm"));
    expect(h.skip).toHaveBeenCalledWith({ data: { enrollmentId: E_WAIT } });
    await waitFor(() => expect(h.lead).toHaveBeenCalledTimes(2));
    expect(toast.success).toHaveBeenCalledWith(t("adminJourneys.enrollments.skipDone"));

    fireEvent.click(
      within(item(E_ACTIVE)).getByRole("button", {
        name: t("adminJourneys.lead.exitFor", { name: "Porzucona kasa" }),
      }),
    );
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      t("adminJourneys.lead.exitConfirmBody", {
        name: "Porzucona kasa",
        reason: t("adminJourneys.exitReason.manual"),
      }),
    );
    await confirmIn(t("adminJourneys.enrollments.exitConfirm"));
    expect(h.exit).toHaveBeenCalledWith({ data: { enrollmentId: E_ACTIVE } });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(t("adminJourneys.enrollments.exitDone")),
    );
  });

  it("redaktor: pominięcie wyłączone z wyjaśnieniem, wyjście dostępne", async () => {
    h.auth = { roles: ["editor"], tenantId: "11111111-1111-4111-8111-111111111111" };
    mount();
    await screen.findByRole("list", { name: t("adminJourneys.lead.list") });
    const skip = within(item(E_WAIT)).getByRole("button", {
      name: t("adminJourneys.lead.skipFor", { name: "Powitanie" }),
    });
    expect(skip).toHaveAttribute("aria-disabled", "true");
    const hint = document.getElementById(skip.getAttribute("aria-describedby") ?? "");
    expect(hint).toHaveTextContent(t("adminJourneys.enrollments.skipAdminOnly"));
    fireEvent.click(skip);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(h.skip).not.toHaveBeenCalled();
    expect(
      within(item(E_WAIT)).getByRole("button", {
        name: t("adminJourneys.lead.exitFor", { name: "Powitanie" }),
      }),
    ).not.toBeDisabled();
  });

  it("brak aal2 przy zapisie - MfaRequiredNotice w karcie", async () => {
    h.exit.mockRejectedValue(new Error("Forbidden: mfa_required (aal2)"));
    mount();
    await screen.findByRole("list", { name: t("adminJourneys.lead.list") });
    fireEvent.click(
      within(item(E_ACTIVE)).getByRole("button", {
        name: t("adminJourneys.lead.exitFor", { name: "Porzucona kasa" }),
      }),
    );
    await confirmIn(t("adminJourneys.enrollments.exitConfirm"));
    expect(await screen.findByTestId("revenue-mfa-required")).toBeTruthy();
  });

  it("axe bez naruszeń (admin i redaktor)", async () => {
    const { container } = mount();
    await screen.findByRole("list", { name: t("adminJourneys.lead.list") });
    let violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
    cleanup();
    h.auth = { roles: ["editor"], tenantId: "11111111-1111-4111-8111-111111111111" };
    const editor = mount();
    await screen.findByRole("list", { name: t("adminJourneys.lead.list") });
    violations = await axeViolations(editor.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("stany karty", () => {
  it("przed hydratacją - wczytywanie, bez zapytań", () => {
    h.hydrated = false;
    mount();
    expect(screen.getByTestId("lead-journeys")).toHaveTextContent(t("adminRevenue.common.loading"));
    expect(h.lead).not.toHaveBeenCalled();
  });

  it("autor - RoleGateNotice", () => {
    h.auth = { roles: ["author"], tenantId: "11111111-1111-4111-8111-111111111111" };
    mount();
    expect(screen.getByTestId("revenue-role-gate")).toBeTruthy();
    expect(h.lead).not.toHaveBeenCalled();
  });

  it("brak aal2 przy odczycie - MfaRequiredNotice", async () => {
    h.lead.mockRejectedValue(new Error("Forbidden: mfa_required (aal2)"));
    mount();
    expect(await screen.findByTestId("revenue-mfa-required")).toBeTruthy();
  });

  it("niewdrożone - komunikat; błąd odczytu - ponowienie", async () => {
    h.lead.mockResolvedValue({ state: "unavailable" });
    mount();
    expect(await screen.findByText(t("adminJourneys.lead.unavailable"))).toBeTruthy();
    cleanup();
    h.lead.mockReset().mockRejectedValue(new Error("network"));
    mount();
    const retry = await screen.findByRole(
      "button",
      { name: t("adminJourneys.common.retry") },
      { timeout: 3000 },
    );
    h.lead.mockResolvedValue({ state: "ready", data: rows() });
    fireEvent.click(retry);
    expect(await screen.findByRole("list", { name: t("adminJourneys.lead.list") })).toBeTruthy();
  });

  it("pusto - zdanie z następnym krokiem i odnośnik do galerii szablonów", async () => {
    h.lead.mockResolvedValue({ state: "ready", data: [] });
    mount();
    expect(await screen.findByText(t("adminJourneys.lead.empty"))).toBeTruthy();
    expect(screen.getByText(t("adminJourneys.lead.emptyNext"))).toBeTruthy();
    const gallery = screen.getByRole("link", { name: t("adminJourneys.lead.gallery") });
    expect(gallery).toHaveAttribute("href", "/admin/revenue/journeys");
    expect(gallery).toHaveAttribute("data-search", "new=1");
  });
});
