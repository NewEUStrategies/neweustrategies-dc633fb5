// Panel rozliczeń jako ORGANIZM spinający pozostałe panele adminowe -
// 0 z 24 funkcji pokrytych do 18.08.2026, przy 434 liniach. Razem z nim
// `ResendPortalLinkButton` (0 z 5).
//
// Panele potomne (dziennik zdarzeń, diagnostyka, zamówienia płatnicze
// i biletowe) mają własne pliki testowe i są tu ATRAPAMI. Ten plik pilnuje
// tego, czego żaden z nich nie widzi:
//
//   1. TRZY LICZNIKI NA GÓRZE. „Aktywne", „nieudane płatności" i „zaplanowane
//      anulowania" to pierwsze, na co patrzy operator - i jedyne miejsce, gdzie
//      widać skalę problemu. Liczone z CAŁEJ listy, po jawnych regułach
//      (`active`/`trialing` to aktywne; licznik nieudanych płatności > 0 to
//      windykacja; `cancel_at_period_end` to odejście w kolejce).
//   2. STAN AUTOMATU I KATALOGU CEN. Wyłączony scheduler oznacza, że
//      przypomnienia o odnowieniu NIE WYCHODZĄ - panel musi to powiedzieć wprost
//      i wskazać, gdzie to włączyć. Rozjazd odcisku integracji oznacza restart
//      po stronie operatora (nowe konto, rotacja klucza).
//   3. LINK DO PORTALU IDZIE DO WŁAŚCICIELA SUBSKRYPCJI, nigdy do administratora.
//      Administrator nie widzi samego linku - jest jednorazowy i wrażliwy.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub } from "@/test/billing/fixtures";

interface AdminSubscriptionRow {
  id: string;
  user_id: string;
  provider_subscription_id: string;
  price_id: string;
  status: string;
  quantity: number;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  payment_failure_count: number;
  last_payment_failed_at: string | null;
  environment: string;
  created_at: string;
}

const h = vi.hoisted(() => ({
  lang: { current: "pl" },
  subs: { current: [] as AdminSubscriptionRow[] },
  subsError: { current: false },
  runner: { current: null as { enabled: boolean; base_url: string | null } | null },
  catalogState: { current: null as Record<string, unknown> | null },
  reminders: vi.fn(),
  syncCatalog: vi.fn(),
  resend: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  resendProps: [] as Array<{ userId: string; environment: string }>,
  chain: null as ReturnType<typeof import("@/test/supabaseChain").supabaseFromStub> | null,
}));

vi.mock("react-i18next", async () => {
  const stubs = await import("@/test/reactStubs");
  return stubs.reactI18nextStub(() => h.lang.current);
});

vi.mock("@/lib/i18n-admin-billing", () => ({}));

vi.mock("@/components/ui/tabs", async () => {
  const react = await import("react");
  const stubs = await import("@/test/reactStubs");
  return stubs.radixTabsStub(react);
});

vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@tanstack/react-start", () => ({ useServerFn: <T,>(fn: T) => fn }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => h.chain!.from(table) },
}));

vi.mock("@/lib/billing/reminders.functions", () => ({
  runBillingRemindersNow: (arg: unknown) => h.reminders(arg),
}));

vi.mock("@/lib/billing/catalogSync.functions", () => ({
  getCatalogSyncState: () => Promise.resolve(h.catalogState.current),
  syncPaymentCatalogNow: (arg: unknown) => h.syncCatalog(arg),
}));

vi.mock("@/lib/newsletter-admin.functions", () => ({
  getJobRunnerSettings: () => Promise.resolve(h.runner.current),
}));

vi.mock("@/lib/billing/portalLink.functions", () => ({
  resendPortalLinkForUser: (arg: unknown) => h.resend(arg),
}));

// Panele potomne: atrapy wystawiające sam fakt osadzenia. Ich zachowanie ma
// własne pliki testowe - organizm odpowiada tylko za to, KTÓRY z nich pokazuje.
vi.mock("@/components/admin/billing/AdminWebhookLogPanel", () => ({
  AdminWebhookLogPanel: () => <div data-testid="panel-dziennik" />,
}));
vi.mock("@/components/admin/billing/AdminPaymentsDiagnosticsPanel", () => ({
  AdminPaymentsDiagnosticsPanel: () => <div data-testid="panel-diagnostyka" />,
}));
vi.mock("@/components/admin/billing/AdminPaymentOrdersPanel", () => ({
  AdminPaymentOrdersPanel: () => <div data-testid="panel-zamowienia" />,
}));
vi.mock("@/components/admin/billing/AdminTicketOrdersPanel", () => ({
  AdminTicketOrdersPanel: () => <div data-testid="panel-bilety" />,
}));

vi.mock("sonner", () => ({
  toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) },
}));

import { AdminBillingPanel } from "@/components/admin/billing/AdminBillingPanel";
import { ResendPortalLinkButton } from "@/components/admin/billing/ResendPortalLinkButton";

function subscription(overrides: Partial<AdminSubscriptionRow> = {}): AdminSubscriptionRow {
  return {
    id: "sub-row-1",
    user_id: "user-me",
    provider_subscription_id: "sub_stripe_1",
    price_id: "plus_monthly",
    status: "active",
    quantity: 1,
    current_period_end: "2026-09-18T10:00:00.000Z",
    cancel_at_period_end: false,
    payment_failure_count: 0,
    last_payment_failed_at: null,
    environment: "sandbox",
    created_at: "2026-08-18T10:00:00.000Z",
    ...overrides,
  };
}

const render = () => renderWithQueryClient(<AdminBillingPanel />);
const awaitRows = () =>
  waitFor(() => expect(document.querySelectorAll("tbody tr").length).toBeGreaterThan(0));

/** Trzy liczniki na górze - w kolejności: aktywne, windykacja, anulowania. */
const counters = (): string[] =>
  Array.from(document.querySelectorAll(".text-2xl")).map((node) => node.textContent ?? "");

beforeEach(() => {
  h.lang.current = "pl";
  h.subs.current = [subscription()];
  h.subsError.current = false;
  h.runner.current = { enabled: true, base_url: "https://runner.example.test" };
  h.catalogState.current = {
    fingerprintCurrent: true,
    catalogCurrent: true,
    lastSyncedAt: "2026-08-18T09:00:00.000Z",
    lastStatus: "ok",
    lastError: null,
  };
  h.reminders.mockReset().mockResolvedValue({ renewal: 3, expiring: 1 });
  h.syncCatalog.mockReset().mockResolvedValue({ created: 2, updated: 1, archived: [], failed: 0 });
  h.resend.mockReset().mockResolvedValue({ ok: true, email: "syntetyczny@example.test" });
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.resendProps.length = 0;
  h.chain = supabaseFromStub();
  h.chain.setResponse("subscriptions", () =>
    h.subsError.current
      ? {
          data: null,
          error: Object.assign(new Error("permission denied"), { name: "PostgrestError" }),
        }
      : ok(h.subs.current),
  );
  h.chain.setResponse("payment_webhook_events", ok([]));
});

describe("AdminBillingPanel - trzy liczniki na górze", () => {
  it("AKTYWNE liczy `active` i `trialing`, nic więcej", async () => {
    h.subs.current = [
      subscription({ id: "a", status: "active" }),
      subscription({ id: "b", status: "trialing" }),
      subscription({ id: "c", status: "canceled" }),
      subscription({ id: "d", status: "past_due" }),
    ];
    render();

    await waitFor(() => expect(counters()[0]).toBe("2"));
    expect(counters()).toHaveLength(3);
  });

  it("WINDYKACJA liczy subskrypcje z niezerowym licznikiem nieudanych płatności", async () => {
    h.subs.current = [
      subscription({ id: "a", payment_failure_count: 0 }),
      subscription({ id: "b", payment_failure_count: 1 }),
      subscription({ id: "c", payment_failure_count: 3 }),
    ];
    render();

    await waitFor(() => expect(counters()[1]).toBe("2"));
  });

  it("ODEJŚCIA W KOLEJCE liczą zaplanowane anulowania", async () => {
    h.subs.current = [
      subscription({ id: "a", cancel_at_period_end: true }),
      subscription({ id: "b", cancel_at_period_end: false }),
    ];
    render();

    await waitFor(() => expect(counters()[2]).toBe("1"));
  });

  it("brak subskrypcji daje trzy zera i komunikat, nie pustą tabelę", async () => {
    h.subs.current = [];
    render();

    await waitFor(() => expect(screen.getByText("adminBilling.subscriptionsYet")).toBeTruthy());
    expect(counters()).toEqual(["0", "0", "0"]);
  });

  it("BŁĄD ODCZYTU nie udaje zerowych liczników na realnych danych", async () => {
    h.subsError.current = true;
    render();

    await waitFor(() => expect(screen.getByText("adminBilling.subscriptionsYet")).toBeTruthy());
    // Żaden wiersz nie jest renderowany - panel nie wymyśla stanu.
    expect(document.querySelectorAll("tbody tr")).toHaveLength(0);
  });
});

describe("AdminBillingPanel - wiersz subskrypcji", () => {
  it("plan jest opisany warstwą i cyklem z katalogu, nie surowym identyfikatorem ceny", async () => {
    render();

    await awaitRows();
    expect(screen.getByText(/member · adminBilling\.monthly/)).toBeTruthy();
  });

  it("cykl roczny ma własną etykietę", async () => {
    h.subs.current = [subscription({ price_id: "pro_annual" })];
    render();

    await awaitRows();
    expect(screen.getByText(/pro · adminBilling\.yearly/)).toBeTruthy();
  });

  it("cykl kwartalny i dwutygodniowy też mają własne etykiety", async () => {
    h.subs.current = [
      subscription({ id: "a", price_id: "business_quarterly" }),
      subscription({ id: "b", price_id: "business_2w" }),
    ];
    render();

    await awaitRows();
    expect(screen.getByText(/business · adminBilling\.quarterly/)).toBeTruthy();
    expect(screen.getByText(/business · adminBilling\.every2Weeks/)).toBeTruthy();
  });

  it("cena SPOZA katalogu pokazuje surowy identyfikator, zamiast zniknąć", async () => {
    h.subs.current = [subscription({ price_id: "cena_nieznana" })];
    render();

    await awaitRows();
    expect(screen.getByText("cena_nieznana")).toBeTruthy();
  });

  it("liczba miejsc pokazuje się tylko przy planie wielostanowiskowym", async () => {
    h.subs.current = [
      subscription({ id: "a", price_id: "team_monthly_seat", quantity: 5 }),
      subscription({ id: "b", quantity: 1 }),
    ];
    render();

    await awaitRows();
    expect(screen.getByText(/× 5/)).toBeTruthy();
    expect(screen.queryByText(/× 1/)).toBeNull();
  });

  it("zaplanowane anulowanie jest oznaczone przy statusie", async () => {
    h.subs.current = [subscription({ cancel_at_period_end: true })];
    render();

    await awaitRows();
    expect(screen.getByText("adminBilling.canceling")).toBeTruthy();
    expect(screen.getByText("active")).toBeTruthy();
  });

  it("NIEUDANE PŁATNOŚCI pokazują licznik i datę ostatniej próby", async () => {
    h.subs.current = [
      subscription({
        payment_failure_count: 2,
        last_payment_failed_at: "2026-08-17T10:00:00.000Z",
      }),
    ];
    render();

    await awaitRows();
    expect(screen.getByText(/^2 ·/)).toBeTruthy();
  });

  it("brak nieudanych płatności to kreska, nie zero", async () => {
    render();

    await awaitRows();
    expect(screen.getByText("-")).toBeTruthy();
    expect(screen.queryByText(/^0 ·/)).toBeNull();
  });

  it("identyfikator subskrypcji u operatora jest widoczny (do zgłoszeń)", async () => {
    render();

    await awaitRows();
    expect(screen.getByText("sub_stripe_1")).toBeTruthy();
    expect(screen.getByText("sandbox")).toBeTruthy();
  });
});

describe("AdminBillingPanel - stan automatu przypomnień", () => {
  it("AKTYWNY scheduler pokazuje adres, pod którym działa", async () => {
    render();

    await waitFor(() => expect(screen.getByText(/adminBilling\.schedulerActive/)).toBeTruthy());
    expect(screen.getByText(/runner\.example\.test/)).toBeTruthy();
  });

  it("WYŁĄCZONY scheduler mówi wprost i linkuje, gdzie go włączyć", async () => {
    h.runner.current = { enabled: false, base_url: null };
    render();

    await waitFor(() =>
      expect(screen.getByText(/adminBilling\.schedulerInactiveEnableJobRunner/)).toBeTruthy(),
    );
    expect(screen.getByText("/admin/newsletter/campaigns").getAttribute("href")).toBe(
      "/admin/newsletter/campaigns",
    );
  });

  it("scheduler włączony BEZ adresu jest traktowany jak nieaktywny", async () => {
    h.runner.current = { enabled: true, base_url: null };
    render();

    await waitFor(() =>
      expect(screen.getByText(/adminBilling\.schedulerInactiveEnableJobRunner/)).toBeTruthy(),
    );
    expect(screen.queryByText(/adminBilling\.schedulerActive/)).toBeNull();
  });

  it("ręczne uruchomienie przypomnień raportuje liczby z serwera", async () => {
    render();

    fireEvent.click(screen.getByText("adminBilling.sendReminders"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(
        'adminBilling.remindersQueued {"renewal":3,"expiring":1}',
      ),
    );
    expect(h.reminders).toHaveBeenCalledWith({ data: {} });
  });

  it("awaria przypomnień pokazuje powód, nie ogólny błąd", async () => {
    h.reminders.mockRejectedValue(new Error("scheduler nie odpowiada"));
    render();

    fireEvent.click(screen.getByText("adminBilling.sendReminders"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("scheduler nie odpowiada"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("AdminBillingPanel - stan katalogu cen", () => {
  it("zgodny odcisk i aktualny katalog dają dwie odznaki „w porządku”", async () => {
    render();

    await waitFor(() => expect(screen.getByText("adminBilling.integrationSync")).toBeTruthy());
    expect(screen.getByText("adminBilling.pricingUpDate")).toBeTruthy();
  });

  it("ROZJAZD ODCISKU (restart integracji u operatora) jest wołany po imieniu", async () => {
    h.catalogState.current = {
      fingerprintCurrent: false,
      catalogCurrent: true,
      lastSyncedAt: null,
      lastStatus: null,
      lastError: null,
    };
    render();

    await waitFor(() =>
      expect(screen.getByText("adminBilling.integrationRestartDetected")).toBeTruthy(),
    );
    expect(screen.getByText("adminBilling.syncedYet")).toBeTruthy();
  });

  it("zmieniony cennik pokazuje, że synchronizacja jest w kolejce", async () => {
    h.catalogState.current = {
      fingerprintCurrent: true,
      catalogCurrent: false,
      lastSyncedAt: "2026-08-18T09:00:00.000Z",
      lastStatus: "queued",
      lastError: null,
    };
    render();

    await waitFor(() =>
      expect(screen.getByText("adminBilling.pricingChangedSyncQueued")).toBeTruthy(),
    );
    // Nagłówek kolumny tabeli też jest `adminBilling.status`, więc szukamy
    // wpisu ze stanem ostatniej synchronizacji, nie samego klucza.
    expect(screen.getByText(/adminBilling\.status: queued/)).toBeTruthy();
  });

  it("BŁĄD ostatniej synchronizacji jest pokazany, nie ukryty", async () => {
    h.catalogState.current = {
      fingerprintCurrent: true,
      catalogCurrent: false,
      lastSyncedAt: "2026-08-18T09:00:00.000Z",
      lastStatus: "failed",
      lastError: "brak uprawnień do cennika",
    };
    render();

    await waitFor(() => expect(screen.getByText("brak uprawnień do cennika")).toBeTruthy());
  });

  it("ręczna synchronizacja raportuje cztery liczby", async () => {
    h.syncCatalog.mockResolvedValue({ created: 2, updated: 1, archived: ["x"], failed: 0 });
    render();

    fireEvent.click(screen.getByText("adminBilling.syncCatalog"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(
        'adminBilling.catalogSynced {"created":2,"updated":1,"archived":1,"failed":0}',
      ),
    );
  });

  it("brak listy zarchiwizowanych liczy się jako zero, nie wywala komunikatu", async () => {
    h.syncCatalog.mockResolvedValue({ created: 0, updated: 0, failed: 1 });
    render();

    fireEvent.click(screen.getByText("adminBilling.syncCatalog"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(
        'adminBilling.catalogSynced {"created":0,"updated":0,"archived":0,"failed":1}',
      ),
    );
  });

  it("awaria synchronizacji katalogu pokazuje powód", async () => {
    h.syncCatalog.mockRejectedValue(new Error("bramka odmówiła"));
    render();

    fireEvent.click(screen.getByText("adminBilling.syncCatalog"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("bramka odmówiła"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("AdminBillingPanel - kompozycja paneli potomnych", () => {
  it("domyślnie pokazuje subskrypcje, a nie panele potomne", async () => {
    render();

    await awaitRows();
    expect(screen.queryByTestId("panel-dziennik")).toBeNull();
    expect(screen.queryByTestId("panel-diagnostyka")).toBeNull();
  });

  it("zakładka dziennika osadza panel zdarzeń", async () => {
    render();
    await awaitRows();

    fireEvent.click(screen.getByText("adminBilling.eventLog"));

    await waitFor(() => expect(screen.getByTestId("panel-dziennik")).toBeTruthy());
  });

  it("zakładka diagnostyki osadza panel diagnostyczny", async () => {
    render();
    await awaitRows();

    fireEvent.click(screen.getByText("adminBilling.diagnostics"));

    await waitFor(() => expect(screen.getByTestId("panel-diagnostyka")).toBeTruthy());
  });

  it("zakładki zamówień osadzają panele płatności i biletów", async () => {
    render();
    await awaitRows();

    fireEvent.click(screen.getByText("adminBilling.payments"));
    await waitFor(() => expect(screen.getByTestId("panel-zamowienia")).toBeTruthy());

    fireEvent.click(screen.getByText("adminBilling.tickets"));
    await waitFor(() => expect(screen.getByTestId("panel-bilety")).toBeTruthy());
  });

  it("odświeżenie pyta bazę PONOWNIE o subskrypcje i zdarzenia", async () => {
    render();
    await awaitRows();
    const before = h.chain!.chains.length;

    fireEvent.click(screen.getByText("adminBilling.refresh"));

    await waitFor(() => expect(h.chain!.chains.length).toBeGreaterThan(before));
  });
});

describe("ResendPortalLinkButton - link idzie do WŁAŚCICIELA subskrypcji", () => {
  const renderButton = (environment: "sandbox" | "live" = "sandbox") =>
    renderWithQueryClient(
      <ResendPortalLinkButton userId="user-obcy" environment={environment} label="Wyślij link" />,
    );

  it("wysyła żądanie z identyfikatorem WŁAŚCICIELA i środowiskiem", async () => {
    renderButton();

    fireEvent.click(screen.getByText("Wyślij link"));

    await waitFor(() =>
      expect(h.resend).toHaveBeenCalledWith({
        data: { userId: "user-obcy", environment: "sandbox" },
      }),
    );
  });

  it("środowisko produkcyjne jedzie jako `live`, nie domyślne", async () => {
    renderButton("live");

    fireEvent.click(screen.getByText("Wyślij link"));

    await waitFor(() =>
      expect(h.resend).toHaveBeenCalledWith({ data: { userId: "user-obcy", environment: "live" } }),
    );
  });

  it("potwierdzenie podaje ADRES, na który poszedł mail (nie sam link)", async () => {
    renderButton();

    fireEvent.click(screen.getByText("Wyślij link"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(
        expect.stringContaining("syntetyczny@example.test"),
      ),
    );
    // Administrator NIE widzi samego linku - jest jednorazowy i wrażliwy.
    expect(h.toastSuccess.mock.calls[0]?.[0]).not.toContain("http");
  });

  it("BRAK KONTA PŁATNIKA ma własny komunikat", async () => {
    h.resend.mockResolvedValue({ ok: false, error: "no_customer" });
    renderButton();

    fireEvent.click(screen.getByText("Wyślij link"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    // Komunikaty przeniesione do słownika (`adminBilling.resendPortal`) -
    // asercja idzie po KLUCZU, więc zmiana copy jej nie psuje, a rozjazd
    // klucza owszem.
    expect(h.toastError.mock.calls[0]?.[0]).toContain("resendPortal.noCustomer");
  });

  it("brak adresu e-mail użytkownika ma osobny komunikat", async () => {
    h.resend.mockResolvedValue({ ok: false, error: "no_recipient" });
    renderButton();

    fireEvent.click(screen.getByText("Wyślij link"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastError.mock.calls[0]?.[0]).toContain("resendPortal.noRecipient");
  });

  it("NIEZNANY powód odmowy schodzi na komunikat wysyłki, nie na pustkę", async () => {
    h.resend.mockResolvedValue({ ok: false, error: "powod_z_przyszlosci" });
    renderButton();

    fireEvent.click(screen.getByText("Wyślij link"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastError.mock.calls[0]?.[0]).toContain("resendPortal.sendFailed");
  });

  it("komunikaty idą przez SŁOWNIK, nie przez parę napisów w kodzie", async () => {
    // Do 19.08.2026 przycisk trzymał pięć par `pl ? "..." : "..."` wprost
    // w kodzie - poza bramką parytetu PL/EN i poza zasięgiem tłumacza. Teraz
    // wołany jest klucz, a wybór języka należy do i18next.
    h.lang.current = "en";
    h.resend.mockResolvedValue({ ok: false, error: "no_customer" });
    renderButton();

    fireEvent.click(screen.getByText("Wyślij link"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastError.mock.calls[0]?.[0]).toBe("adminBilling.resendPortal.noCustomer");
  });

  it("awaria transportu też kończy się komunikatem", async () => {
    h.resend.mockRejectedValue(new Error("sieć padła"));
    renderButton();

    fireEvent.click(screen.getByText("Wyślij link"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("w trakcie wysyłki przycisk jest zablokowany (bez dubla maila)", async () => {
    h.resend.mockImplementation(() => new Promise(() => {}));
    renderButton();

    fireEvent.click(screen.getByText("Wyślij link"));

    await waitFor(() =>
      expect(screen.getByText("Wyślij link").closest("button")?.hasAttribute("disabled")).toBe(
        true,
      ),
    );
    expect(h.resend).toHaveBeenCalledTimes(1);
  });
});
