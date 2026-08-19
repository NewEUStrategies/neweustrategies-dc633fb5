// Dziennik zdarzeń operatora płatności w panelu administratora - 0 z 18
// funkcji pokrytych do 18.08.2026, przy 355 liniach.
//
// To narzędzie, którym gasi się pożary: „klient zapłacił, a nie ma dostępu"
// diagnozuje się TUTAJ, zamiast wchodzić do bazy. Jeśli panel skłamie
// o statusie zdarzenia albo ponowienie po cichu nic nie zrobi, operator
// szuka błędu w złym miejscu, a klient czeka.
//
// Cztery rzeczy, których ten plik pilnuje:
//
//   1. FILTRY ZAWĘŻAJĄ TO, CO WIDAĆ, ale statystyki liczą się z CAŁOŚCI -
//      inaczej „3 błędy" zmieniałoby się przy każdym kliknięciu filtra
//      i nikt by nie wiedział, ile ich naprawdę jest.
//   2. ZDARZENIE NIEPRZETWORZONE (`received`) jest osobnym stanem, nie
//      „prawie przetworzonym": to ono oznacza zawieszony webhook.
//   3. PONOWIENIE ODCZYTUJE WYNIK Z ŁADUNKU. Server fn zwraca
//      `status: "failed"` BEZ rzucania - bez jawnego sprawdzenia panel
//      meldowałby udane ponowienie po nieudanym (ten sam kształt defektu,
//      co w karcie subskrypcji klienta).
//   4. ŁADUNEK POKAZUJE SIĘ W CAŁOŚCI I NIE WYWALA WIDOKU, gdy jest pusty
//      albo nie jest obiektem.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub, webhookEvent } from "@/test/billing/fixtures";
import type { WebhookEventRow } from "@/test/billing/fixtures";

const h = vi.hoisted(() => ({
  lang: { current: "pl" },
  rows: { current: [] as WebhookEventRow[] },
  readError: { current: false },
  retry: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  chain: null as ReturnType<typeof import("@/test/supabaseChain").supabaseFromStub> | null,
}));

vi.mock("react-i18next", async () => {
  const stubs = await import("@/test/reactStubs");
  return stubs.reactI18nextStub(() => h.lang.current);
});

// Import słownika jest tu efektem ubocznym (`import "@/lib/i18n-admin-billing"`).
vi.mock("@/lib/i18n-admin-billing", () => ({}));

vi.mock("@/components/ui/select", async () => {
  const react = await import("react");
  const stubs = await import("@/test/reactStubs");
  return stubs.radixSelectStub(react);
});

vi.mock("@tanstack/react-start", () => ({ useServerFn: <T,>(fn: T) => fn }));

vi.mock("@/lib/billing/webhookRetry.functions", () => ({
  retryWebhookEvent: (arg: unknown) => h.retry(arg),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => h.chain!.from(table) },
}));

vi.mock("sonner", () => ({
  toast: {
    success: (m: string, opts?: unknown) => h.toastSuccess(m, opts),
    error: (m: string, opts?: unknown) => h.toastError(m, opts),
  },
}));

import { AdminWebhookLogPanel } from "@/components/admin/billing/AdminWebhookLogPanel";

const render = () => renderWithQueryClient(<AdminWebhookLogPanel />);

/** Wiersze danych (bez nagłówka i bez rozwiniętego podglądu ładunku). */
const eventRows = () =>
  Array.from(document.querySelectorAll("tbody tr")).filter(
    (row) => !row.querySelector("pre") && row.querySelectorAll("td").length > 1,
  );

const awaitRows = () => waitFor(() => expect(eventRows().length).toBeGreaterThan(0));

/** Filtr statusu to pierwszy `<select>`, filtr środowiska - drugi. */
const statusFilter = () => screen.getAllByRole("combobox")[0];
const envFilter = () => screen.getAllByRole("combobox")[1];
const searchBox = () => screen.getByPlaceholderText("adminBilling.searchTypeIdUser");

beforeEach(() => {
  h.lang.current = "pl";
  h.readError.current = false;
  h.retry.mockReset().mockResolvedValue({
    status: "processed",
    eventType: "checkout.session.completed",
    durationMs: 42,
  });
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.chain = supabaseFromStub();
  h.rows.current = [webhookEvent()];
  h.chain.setResponse("payment_webhook_events", () =>
    h.readError.current
      ? {
          data: null,
          error: Object.assign(new Error("permission denied"), { name: "PostgrestError" }),
        }
      : ok(h.rows.current),
  );
});

describe("AdminWebhookLogPanel - odczyt dziennika", () => {
  it("czyta najnowsze zdarzenia z limitem, malejąco po dacie", async () => {
    render();

    await awaitRows();
    const chain = h.chain!.lastChain("payment_webhook_events")!;
    expect(chain.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain.argsOf("limit")).toEqual([300]);
  });

  it("pusty dziennik mówi to wprost, zamiast pokazywać nagłówki tabeli", async () => {
    h.rows.current = [];
    render();

    await waitFor(() => expect(screen.getByText("adminBilling.eventsTheseFilters")).toBeTruthy());
    expect(document.querySelector("tbody")).toBeNull();
  });

  it("wiersz pokazuje typ zdarzenia i czas obsługi", async () => {
    h.rows.current = [webhookEvent({ duration_ms: 250 })];
    render();

    await awaitRows();
    expect(screen.getByText("checkout.session.completed")).toBeTruthy();
    expect(screen.getByText("250 ms")).toBeTruthy();
  });

  it("brak czasu obsługi to kreska, nie „null ms”", async () => {
    h.rows.current = [webhookEvent({ duration_ms: null })];
    render();

    await awaitRows();
    expect(screen.getByText("-")).toBeTruthy();
    expect(screen.queryByText("null ms")).toBeNull();
  });

  it("wiersz identyfikuje zdarzenie subskrypcją, a bez niej klientem", async () => {
    h.rows.current = [
      webhookEvent({ id: "a", subscription_id: "sub_stripe_9", customer_id: "cus_1" }),
      webhookEvent({ id: "b", subscription_id: null, customer_id: "cus_2" }),
    ];
    render();

    await awaitRows();
    expect(screen.getByText("sub_stripe_9")).toBeTruthy();
    expect(screen.getByText("cus_2")).toBeTruthy();
  });

  it("bez subskrypcji i klienta zostaje identyfikator zdarzenia", async () => {
    h.rows.current = [
      webhookEvent({ subscription_id: null, customer_id: null, event_id: "evt_samotne" }),
    ];
    render();

    await awaitRows();
    expect(screen.getByText("evt_samotne")).toBeTruthy();
  });

  it("BŁĄD ODCZYTU nie udaje pustego dziennika", async () => {
    h.readError.current = true;
    render();

    await waitFor(() => expect(screen.getByText("adminBilling.eventsTheseFilters")).toBeTruthy());
    // Kluczowe: brak wiersza z danymi - panel nie pokazuje wymyślonego stanu.
    expect(eventRows()).toHaveLength(0);
  });
});

describe("AdminWebhookLogPanel - filtry i statystyki", () => {
  beforeEach(() => {
    h.rows.current = [
      webhookEvent({ id: "p1", status: "processed", environment: "live" }),
      webhookEvent({ id: "f1", status: "failed", environment: "sandbox", error: "brak planu" }),
      webhookEvent({ id: "r1", status: "received", environment: "sandbox" }),
      webhookEvent({ id: "s1", status: "skipped", environment: "live" }),
    ];
  });

  it("STATYSTYKI liczą się z CAŁOŚCI: przetworzone, błędy i zawieszone", async () => {
    render();

    await awaitRows();
    expect(
      screen.getByText('adminBilling.webhookStats {"processed":1,"failed":1,"stuck":1}'),
    ).toBeTruthy();
    expect(eventRows()).toHaveLength(4);
  });

  it("filtr statusu zawęża listę do wybranego stanu", async () => {
    render();
    await awaitRows();

    fireEvent.change(statusFilter(), { target: { value: "failed" } });

    await waitFor(() => expect(eventRows()).toHaveLength(1));
    expect(screen.getByText("brak planu")).toBeTruthy();
  });

  it("ZDARZENIE NIEPRZETWORZONE („received”) da się wyfiltrować osobno", async () => {
    render();
    await awaitRows();

    fireEvent.change(statusFilter(), { target: { value: "received" } });

    await waitFor(() => expect(eventRows()).toHaveLength(1));
    expect(screen.getByText("received")).toBeTruthy();
  });

  it("FILTR NIE ZMIENIA STATYSTYK - liczby nadal mówią o całości", async () => {
    render();
    await awaitRows();

    fireEvent.change(statusFilter(), { target: { value: "failed" } });

    await waitFor(() => expect(eventRows()).toHaveLength(1));
    expect(
      screen.getByText('adminBilling.webhookStats {"processed":1,"failed":1,"stuck":1}'),
    ).toBeTruthy();
  });

  it("filtr środowiska oddziela produkcję od trybu testowego", async () => {
    render();
    await awaitRows();

    fireEvent.change(envFilter(), { target: { value: "live" } });

    await waitFor(() => expect(eventRows()).toHaveLength(2));
    expect(screen.queryByText("brak planu")).toBeNull();
  });

  it("filtry SKŁADAJĄ SIĘ (status i środowisko naraz)", async () => {
    render();
    await awaitRows();

    fireEvent.change(statusFilter(), { target: { value: "failed" } });
    fireEvent.change(envFilter(), { target: { value: "live" } });

    await waitFor(() => expect(eventRows()).toHaveLength(0));
    expect(screen.getByText("adminBilling.eventsTheseFilters")).toBeTruthy();
  });

  it("wyszukiwanie działa po TYPIE zdarzenia", async () => {
    h.rows.current = [
      webhookEvent({ id: "a", event_type: "checkout.session.completed" }),
      webhookEvent({ id: "b", event_type: "invoice.payment_failed" }),
    ];
    render();
    await awaitRows();

    fireEvent.change(searchBox(), { target: { value: "payment_failed" } });

    await waitFor(() => expect(eventRows()).toHaveLength(1));
    expect(screen.getByText("invoice.payment_failed")).toBeTruthy();
  });

  it("wyszukiwanie działa też po użytkowniku i treści błędu", async () => {
    h.rows.current = [
      webhookEvent({ id: "a", user_id: "user-szukany" }),
      webhookEvent({ id: "b", user_id: "user-inny", error: "nieznany plan" }),
    ];
    render();
    await awaitRows();

    fireEvent.change(searchBox(), { target: { value: "nieznany" } });
    await waitFor(() => expect(eventRows()).toHaveLength(1));

    fireEvent.change(searchBox(), { target: { value: "user-szukany" } });
    await waitFor(() => expect(eventRows()).toHaveLength(1));
  });

  it("wyszukiwanie nie zależy od wielkości liter ani spacji na brzegach", async () => {
    h.rows.current = [webhookEvent({ event_type: "invoice.payment_failed" })];
    render();
    await awaitRows();

    fireEvent.change(searchBox(), { target: { value: "  INVOICE.Payment_Failed  " } });

    await waitFor(() => expect(eventRows()).toHaveLength(1));
    expect(screen.getByText("invoice.payment_failed")).toBeTruthy();
  });

  it("wyszukiwanie bez trafień pokazuje komunikat, nie pustą tabelę", async () => {
    render();
    await awaitRows();

    fireEvent.change(searchBox(), { target: { value: "czegos-takiego-nie-ma" } });

    await waitFor(() => expect(screen.getByText("adminBilling.eventsTheseFilters")).toBeTruthy());
    expect(eventRows()).toHaveLength(0);
  });
});

describe("AdminWebhookLogPanel - podgląd ładunku", () => {
  it("ładunek jest ukryty, dopóki operator go nie rozwinie", async () => {
    render();
    await awaitRows();

    expect(document.querySelector("pre")).toBeNull();
    expect(screen.getByLabelText("adminBilling.showPayload")).toBeTruthy();
  });

  it("rozwinięcie pokazuje ładunek i szczegóły idempotencji", async () => {
    render();
    await awaitRows();

    fireEvent.click(screen.getByLabelText("adminBilling.showPayload"));

    await waitFor(() => expect(document.querySelector("pre")).toBeTruthy());
    expect(document.querySelector("pre")!.textContent).toContain("checkout.session.completed");
  });

  it("stan rozwinięcia jest odzwracalny i ma kontrakt a11y", async () => {
    render();
    await awaitRows();
    const toggle = screen.getByLabelText("adminBilling.showPayload");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(screen.getByLabelText("adminBilling.showPayload").getAttribute("aria-expanded")).toBe(
        "true",
      ),
    );

    fireEvent.click(screen.getByLabelText("adminBilling.showPayload"));
    await waitFor(() => expect(document.querySelector("pre")).toBeNull());
  });

  it("rozwinięcie DRUGIEGO wiersza zamyka pierwszy (jeden podgląd naraz)", async () => {
    h.rows.current = [
      webhookEvent({ id: "a", payload: { marker: "pierwszy" } }),
      webhookEvent({ id: "b", payload: { marker: "drugi" } }),
    ];
    render();
    await awaitRows();

    fireEvent.click(screen.getAllByLabelText("adminBilling.showPayload")[0]);
    await waitFor(() => expect(document.querySelector("pre")!.textContent).toContain("pierwszy"));

    fireEvent.click(screen.getAllByLabelText("adminBilling.showPayload")[1]);
    await waitFor(() => expect(document.querySelector("pre")!.textContent).toContain("drugi"));
    expect(document.querySelectorAll("pre")).toHaveLength(1);
  });

  it("ŁADUNEK PUSTY (null) nie wywala podglądu", async () => {
    h.rows.current = [webhookEvent({ payload: null })];
    render();
    await awaitRows();

    fireEvent.click(screen.getByLabelText("adminBilling.showPayload"));

    await waitFor(() => expect(document.querySelector("pre")).toBeTruthy());
    expect(document.querySelector("pre")!.textContent).toBe("null");
  });

  it("ŁADUNEK NIEBĘDĄCY OBIEKTEM (sam napis) też się pokazuje", async () => {
    h.rows.current = [webhookEvent({ payload: "to nie jest obiekt" })];
    render();
    await awaitRows();

    fireEvent.click(screen.getByLabelText("adminBilling.showPayload"));

    await waitFor(() => expect(document.querySelector("pre")).toBeTruthy());
    expect(document.querySelector("pre")!.textContent).toContain("to nie jest obiekt");
  });

  it("liczba ponowień jest widoczna w podglądzie", async () => {
    h.rows.current = [
      webhookEvent({ retry_count: 3, last_retried_at: "2026-08-18T09:00:00.000Z" }),
    ];
    render();
    await awaitRows();

    fireEvent.click(screen.getByLabelText("adminBilling.showPayload"));

    await waitFor(() => expect(screen.getByText(/adminBilling\.retriesCount/)).toBeTruthy());
    expect(screen.getByText(/adminBilling\.retriesCount/).textContent).toContain('"count":3');
  });

  it("zdarzenie bez ponowień mówi to osobnym kluczem", async () => {
    h.rows.current = [webhookEvent({ retry_count: 0 })];
    render();
    await awaitRows();

    fireEvent.click(screen.getByLabelText("adminBilling.showPayload"));

    await waitFor(() => expect(screen.getByText(/adminBilling\.retries$/)).toBeTruthy());
    expect(screen.queryByText(/adminBilling\.retriesCount/)).toBeNull();
  });
});

describe("AdminWebhookLogPanel - PONOWIENIE zdarzenia", () => {
  it("wysyła identyfikator wiersza dziennika", async () => {
    h.rows.current = [webhookEvent({ id: "evt-row-77" })];
    render();
    await awaitRows();

    fireEvent.click(screen.getByText("adminBilling.retry2"));

    await waitFor(() => expect(h.retry).toHaveBeenCalledWith({ data: { id: "evt-row-77" } }));
  });

  it("udane ponowienie potwierdza i odświeża dziennik", async () => {
    const { queryClient } = render();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await awaitRows();

    fireEvent.click(screen.getByText("adminBilling.retry2"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(
        "adminBilling.eventReprocessed",
        expect.objectContaining({ description: expect.stringContaining("42 ms") }),
      ),
    );
    expect(invalidate).toHaveBeenCalled();
  });

  it("NIEUDANE PONOWIENIE (status w ładunku) NIE jest raportowane jako sukces", async () => {
    h.retry.mockResolvedValue({
      status: "failed",
      error: "nieznany plan w metadanych",
      eventType: "checkout.session.completed",
      durationMs: 12,
    });
    render();
    await awaitRows();

    fireEvent.click(screen.getByText("adminBilling.retry2"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        "adminBilling.retryFailed",
        expect.objectContaining({ description: "nieznany plan w metadanych" }),
      ),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("zdarzenie typu nieobsługiwanego ma własny komunikat, nie „przetworzono”", async () => {
    h.retry.mockResolvedValue({
      status: "skipped",
      eventType: "customer.created",
      durationMs: 3,
    });
    render();
    await awaitRows();

    fireEvent.click(screen.getByText("adminBilling.retry2"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(
        "adminBilling.eventSkippedTypeHandled",
        expect.anything(),
      ),
    );
    expect(h.toastSuccess).not.toHaveBeenCalledWith(
      "adminBilling.eventReprocessed",
      expect.anything(),
    );
  });

  it("awaria transportu ma osobny komunikat i niesie powód", async () => {
    h.retry.mockRejectedValue(new Error("timeout"));
    render();
    await awaitRows();

    fireEvent.click(screen.getByText("adminBilling.retry2"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        "adminBilling.couldRetryEvent",
        expect.objectContaining({ description: "timeout" }),
      ),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("w trakcie ponawiania przyciski są zablokowane (bez podwójnej wysyłki)", async () => {
    h.retry.mockImplementation(() => new Promise(() => {}));
    render();
    await awaitRows();

    fireEvent.click(screen.getByText("adminBilling.retry2"));

    await waitFor(() =>
      expect(
        screen.getByText("adminBilling.retry2").closest("button")?.hasAttribute("disabled"),
      ).toBe(true),
    );
    expect(h.retry).toHaveBeenCalledTimes(1);
  });

  it("odświeżenie ręczne ponownie pyta bazę", async () => {
    render();
    await awaitRows();
    const before = h.chain!.chainsFor("payment_webhook_events").length;

    fireEvent.click(screen.getByText("adminBilling.refresh"));

    await waitFor(() =>
      expect(h.chain!.chainsFor("payment_webhook_events").length).toBeGreaterThan(before),
    );
  });
});
