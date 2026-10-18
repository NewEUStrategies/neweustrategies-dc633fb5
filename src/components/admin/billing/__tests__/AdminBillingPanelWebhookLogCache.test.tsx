// Panel rozliczeń + PRAWDZIWY dziennik zdarzeń we wspólnym cache zapytań.
//
// DEFEKT (2026-10-18). Panel rozliczeń czytał na starcie 200 zdarzeń webhooka
// (9 kolumn) pod kluczem `billingKeys.admin.paymentWebhookEvents()` - tym
// samym, pod którym dziennik zdarzeń trzyma SWOJE 300 wierszy z 16 kolumnami
// (ładunek, czas obsługi, ponowienia, użytkownik). Panel rozliczeń tych danych
// nigdzie nie pokazywał, a wpis cache zostawał świeży: dziennik otwarty
// w ciągu `staleTime` renderował okrojone wiersze - „undefined ms" zamiast
// czasu obsługi, pusty podgląd ładunku, brak licznika ponowień - a przycisk
// „Odśwież" panelu nadpisywał pełne wiersze dziennika okrojonymi.
//
// Ten plik osadza dziennik naprawdę (pozostałe panele potomne są atrapami)
// i odpowiada z atrapy PostgREST WYŁĄCZNIE kolumnami z `select(...)` - tak
// jak baza. Atrapa zwracająca pełny wiersz na każde pytanie ukrywała defekt.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub, webhookEvent } from "@/test/billing/fixtures";
import type { RecordedChain } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  chain: null as ReturnType<typeof import("@/test/supabaseChain").supabaseFromStub> | null,
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("react-i18next", async () => {
  const stubs = await import("@/test/reactStubs");
  return stubs.reactI18nextStub(() => "pl");
});
vi.mock("@/lib/i18n-admin-billing", () => ({}));
vi.mock("@/components/ui/tabs", async () => {
  const react = await import("react");
  const stubs = await import("@/test/reactStubs");
  return stubs.radixTabsStub(react);
});
vi.mock("@/components/ui/select", async () => {
  const react = await import("react");
  const stubs = await import("@/test/reactStubs");
  return stubs.radixSelectStub(react);
});
vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: <T,>(fn: T) => fn }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => h.chain!.from(table) },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isSuperAdmin: false }) }));
vi.mock("@/lib/billing/webhookRetry.functions", () => ({ retryWebhookEvent: vi.fn() }));
vi.mock("@/lib/billing/reminders.functions", () => ({ runBillingRemindersNow: vi.fn() }));
vi.mock("@/lib/billing/catalogSync.functions", () => ({
  getCatalogSyncState: () => Promise.resolve(null),
  syncPaymentCatalogNow: vi.fn(),
}));
vi.mock("@/lib/newsletter-admin.functions", () => ({
  getJobRunnerSettings: () => Promise.resolve(null),
}));
vi.mock("@/lib/billing/portalLink.functions", () => ({ resendPortalLinkForUser: vi.fn() }));
vi.mock("@/components/admin/billing/AdminPaymentsDiagnosticsPanel", () => ({
  AdminPaymentsDiagnosticsPanel: () => null,
}));
vi.mock("@/components/admin/billing/AdminPaymentOrdersPanel", () => ({
  AdminPaymentOrdersPanel: () => null,
}));
vi.mock("@/components/admin/billing/AdminTicketOrdersPanel", () => ({
  AdminTicketOrdersPanel: () => null,
}));
vi.mock("@/components/admin/billing/LegacyNonPaymentReconcileCard", () => ({
  LegacyNonPaymentReconcileCard: () => null,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AdminBillingPanel } from "@/components/admin/billing/AdminBillingPanel";

/** Odpowiedź PostgREST: każdy wiersz ograniczony do kolumn z `select(...)`. */
function projected(chain: RecordedChain) {
  const columns = String(chain.argsOf("select")?.[0] ?? "")
    .split(",")
    .map((column) => column.trim());
  return ok(
    h.rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column]]))),
  );
}

const webhookChains = () => h.chain!.chainsFor("payment_webhook_events");

async function openEventLog() {
  renderWithQueryClient(<AdminBillingPanel />);
  await screen.findByText("adminBilling.subscriptionsYet");
  fireEvent.click(screen.getByText("adminBilling.eventLog"));
  return screen.findByText("checkout.session.completed");
}

/** Wiersz zdarzenia w tabeli dziennika (pierwsza kolumna to przycisk podglądu). */
const eventRow = () => screen.getByText("checkout.session.completed").closest("tr")!;

beforeEach(() => {
  h.rows = [
    webhookEvent({
      duration_ms: 345,
      retry_count: 2,
      last_retried_at: "2026-10-17T08:00:00.000Z",
      payload: { id: "evt_1SyntetyczneZdarzenie", livemode: false },
    }),
  ] as unknown as Array<Record<string, unknown>>;
  h.chain = supabaseFromStub();
  h.chain.setResponse("subscriptions", ok([]));
  h.chain.setResponse("payment_webhook_events", projected);
});

describe("AdminBillingPanel - dziennik zdarzeń nie dostaje cudzych, okrojonych wierszy", () => {
  it("panel NIE czyta dziennika, dopóki zakładka dziennika jest zamknięta", async () => {
    renderWithQueryClient(<AdminBillingPanel />);
    await screen.findByText("adminBilling.subscriptionsYet");

    expect(webhookChains()).toHaveLength(0);
  });

  it("dziennik otwarty po starcie panelu pokazuje czas obsługi, ponowienia i ładunek", async () => {
    await openEventLog();

    expect(within(eventRow()).getByText("345 ms")).toBeTruthy();
    expect(screen.queryByText(/undefined/)).toBeNull();
    expect(within(eventRow()).getByText(/adminBilling\.attempts/).textContent).toContain("2");

    fireEvent.click(within(eventRow()).getByLabelText("adminBilling.showPayload"));
    const payload = document.querySelector("pre")!;
    expect(JSON.parse(payload.textContent ?? "")).toEqual({
      id: "evt_1SyntetyczneZdarzenie",
      livemode: false,
    });
    // Jedyny odczyt dziennika to odczyt samego dziennika - 300 wierszy.
    expect(webhookChains().map((chain) => chain.argsOf("limit"))).toEqual([[300]]);
  });

  it("„Odśwież” panelu przy otwartym dzienniku odświeża go JEGO zapytaniem, bez okrajania", async () => {
    await openEventLog();
    const before = webhookChains().length;
    h.rows = [{ ...h.rows[0], duration_ms: 999 }];

    const refreshButtons = screen.getAllByText("adminBilling.refresh");
    // Pierwszy przycisk „Odśwież" to przycisk panelu rozliczeń (nad zakładkami).
    fireEvent.click(refreshButtons[0]);

    await waitFor(() => expect(within(eventRow()).getByText("999 ms")).toBeTruthy());
    expect(webhookChains().length).toBeGreaterThan(before);
    for (const chain of webhookChains()) {
      expect(String(chain.argsOf("select")?.[0])).toContain("duration_ms");
      expect(chain.argsOf("limit")).toEqual([300]);
    }
  });
});
