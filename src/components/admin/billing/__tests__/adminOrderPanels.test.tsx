// Dwa panele zamówień w administracji: `AdminPaymentOrdersPanel` (0 z 8
// funkcji) i `AdminTicketOrdersPanel` (0 z 15) - oba na zerze do 18.08.2026.
//
// Razem odpowiadają na pytanie „za co i czy klient zapłacił". Trzy rzeczy,
// od których zależy ich użyteczność:
//
//   1. ZAMÓWIENIA WISZĄCE MUSZĄ BYĆ WIDOCZNE OD RAZU. Ostrzeżenie o brakującej
//      sesji operatora jest jedynym sygnałem przerwanej ścieżki checkoutu;
//      ukryte w tabeli 200 wierszy nie istnieje.
//   2. FILTR STATUSU JEST ZAPYTANIEM, NIE UKRYWANIEM WIERSZY. Panel ma pytać
//      serwer o wybrany status - inaczej limit 200 wierszy odcina starsze
//      zamówienia zanim filtr je zobaczy.
//   3. KONTO USUNIĘTE (RODO) POKAZUJE SIĘ JAKO USUNIĘTE. Zamówienie zostaje
//      jako dowód księgowy, ale danych kupującego już nie ma - pokazanie
//      surowego identyfikatora zamiast komunikatu wyglądałoby jak awaria.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { moneyPattern } from "@/test/billing/fixtures";

interface PaymentOrderView {
  id: string;
  createdAt: string;
  status: string;
  kind: string;
  provider: string;
  environment: string | null;
  sessionId: string | null;
  amountCents: number;
  currency: string;
  planNamePl: string | null;
  planNameEn: string | null;
  buyerEmail: string | null;
}

interface TicketOrderView {
  id: string;
  eventId: string;
  eventTitlePl: string | null;
  eventTitleEn: string | null;
  eventStartsAt: string | null;
  buyerId: string;
  buyerName: string | null;
  buyerEmail: string | null;
  buyerAnonymized: boolean;
  tickets: number;
  amountCents: number;
  currency: string;
  couponCode: string | null;
  status: string;
  transactionId: string | null;
  paidAt: string | null;
  createdAt: string;
}

const h = vi.hoisted(() => ({
  lang: { current: "pl" },
  paymentOrders: {
    current: {
      rows: [] as PaymentOrderView[],
      summary: { total: 0, stuck: 0, paid: 0, failed: 0 },
    },
  },
  paymentThrows: { current: false },
  listPaymentOrders: vi.fn(),
  ticketOrders: { current: [] as TicketOrderView[] },
  ticketThrows: { current: false },
  history: { current: [] as Array<Record<string, unknown>> },
  historyThrows: { current: false },
}));

vi.mock("react-i18next", async () => {
  const stubs = await import("@/test/reactStubs");
  return stubs.reactI18nextStub(() => h.lang.current);
});

vi.mock("@/lib/i18n-admin-billing", () => ({}));

vi.mock("@tanstack/react-start", () => ({ useServerFn: <T,>(fn: T) => fn }));

vi.mock("@/lib/billing/paymentOrders.functions", () => ({
  listPaymentOrders: (arg: unknown) => {
    h.listPaymentOrders(arg);
    return h.paymentThrows.current
      ? Promise.reject(new Error("forbidden"))
      : Promise.resolve(h.paymentOrders.current);
  },
}));

vi.mock("@/lib/billing/ticketOrders.functions", () => ({
  listTicketOrders: () =>
    h.ticketThrows.current
      ? Promise.reject(new Error("forbidden"))
      : Promise.resolve(h.ticketOrders.current),
  getTicketOrderHistory: () =>
    h.historyThrows.current
      ? Promise.reject(new Error("forbidden"))
      : Promise.resolve(h.history.current),
}));

import { AdminPaymentOrdersPanel } from "@/components/admin/billing/AdminPaymentOrdersPanel";
import { AdminTicketOrdersPanel } from "@/components/admin/billing/AdminTicketOrdersPanel";

function paymentOrder(overrides: Partial<PaymentOrderView> = {}): PaymentOrderView {
  return {
    id: "order-1",
    createdAt: "2026-08-18T10:00:00.000Z",
    status: "paid",
    kind: "subscription",
    provider: "stripe",
    environment: "sandbox",
    sessionId: "cs_test_1",
    amountCents: 4900,
    currency: "PLN",
    planNamePl: null,
    planNameEn: null,
    buyerEmail: "syntetyczny@example.test",
    ...overrides,
  };
}

function ticketOrder(overrides: Partial<TicketOrderView> = {}): TicketOrderView {
  return {
    id: "ticket-1",
    eventId: "event-1",
    eventTitlePl: "Decision Lab: energia",
    eventTitleEn: "Decision Lab: energy",
    eventStartsAt: "2026-09-01T08:00:00.000Z",
    buyerId: "user-me",
    buyerName: "Jan Syntetyczny",
    buyerEmail: "syntetyczny@example.test",
    buyerAnonymized: false,
    tickets: 2,
    amountCents: 19900,
    currency: "PLN",
    couponCode: null,
    status: "paid",
    transactionId: "pi_test_1",
    paidAt: "2026-08-18T10:01:00.000Z",
    createdAt: "2026-08-18T10:00:00.000Z",
    ...overrides,
  };
}

const setPaymentRows = (rows: PaymentOrderView[], stuck = 0) => {
  h.paymentOrders.current = {
    rows,
    summary: {
      total: rows.length,
      stuck,
      paid: rows.filter((row) => row.status === "paid").length,
      failed: rows.filter((row) => row.status === "failed").length,
    },
  };
};

const dataRows = () => Array.from(document.querySelectorAll("tbody tr"));

beforeEach(() => {
  h.lang.current = "pl";
  setPaymentRows([paymentOrder()]);
  h.paymentThrows.current = false;
  h.listPaymentOrders.mockReset();
  h.ticketOrders.current = [ticketOrder()];
  h.ticketThrows.current = false;
  h.history.current = [];
  h.historyThrows.current = false;
});

describe("AdminPaymentOrdersPanel - zamówienia wiszące", () => {
  it("OSTRZEŻENIE o brakującej sesji jest widoczne z liczbą", async () => {
    setPaymentRows([paymentOrder({ status: "pending", sessionId: null })], 1);
    renderWithQueryClient(<AdminPaymentOrdersPanel />);

    await waitFor(() =>
      expect(screen.getByText(/adminBilling\.ordersWithoutSession/)).toBeTruthy(),
    );
    expect(screen.getByText(/adminBilling\.ordersWithoutSession/).textContent).toContain(
      '"count":1',
    );
  });

  it("bez zamówień wiszących ostrzeżenia nie ma", async () => {
    renderWithQueryClient(<AdminPaymentOrdersPanel />);

    await waitFor(() => expect(dataRows().length).toBeGreaterThan(0));
    expect(screen.queryByText(/adminBilling\.ordersWithoutSession/)).toBeNull();
  });

  it("brak sesji jest oznaczony w WIERSZU, nie tylko w podsumowaniu", async () => {
    setPaymentRows([paymentOrder({ sessionId: null })]);
    renderWithQueryClient(<AdminPaymentOrdersPanel />);

    await waitFor(() => expect(screen.getByText("adminBilling.missing")).toBeTruthy());
    expect(dataRows()).toHaveLength(1);
  });
});

describe("AdminPaymentOrdersPanel - filtr statusu", () => {
  it("FILTR JEST ZAPYTANIEM: wybór statusu leci do serwera", async () => {
    renderWithQueryClient(<AdminPaymentOrdersPanel />);
    await waitFor(() => expect(h.listPaymentOrders).toHaveBeenCalled());

    fireEvent.click(screen.getByText("adminBilling.failed"));

    await waitFor(() =>
      expect(h.listPaymentOrders).toHaveBeenCalledWith({ data: { status: "failed", limit: 200 } }),
    );
  });

  it("domyślnie pyta o wszystkie statusy", async () => {
    renderWithQueryClient(<AdminPaymentOrdersPanel />);

    await waitFor(() =>
      expect(h.listPaymentOrders).toHaveBeenCalledWith({ data: { status: "all", limit: 200 } }),
    );
  });

  it("wybrany filtr ma kontrakt a11y (`aria-pressed`)", async () => {
    renderWithQueryClient(<AdminPaymentOrdersPanel />);
    await waitFor(() => expect(h.listPaymentOrders).toHaveBeenCalled());

    fireEvent.click(screen.getByText("adminBilling.paid"));

    await waitFor(() =>
      expect(screen.getByText("adminBilling.paid").getAttribute("aria-pressed")).toBe("true"),
    );
    expect(screen.getByText("adminBilling.all").getAttribute("aria-pressed")).toBe("false");
  });

  it("lista filtrów ma etykietę dostępną", async () => {
    renderWithQueryClient(<AdminPaymentOrdersPanel />);

    await waitFor(() => expect(screen.getByLabelText("adminBilling.statusFilter")).toBeTruthy());
    // Siedem filtrów: wszystkie + sześć statusów.
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
  });
});

describe("AdminPaymentOrdersPanel - treść wiersza", () => {
  it("pokazuje kwotę, status i dostawcę ze środowiskiem", async () => {
    renderWithQueryClient(<AdminPaymentOrdersPanel />);

    await waitFor(() => expect(screen.getByText(moneyPattern(4900))).toBeTruthy());
    expect(screen.getByText("paid")).toBeTruthy();
    expect(screen.getByText(/stripe · sandbox/)).toBeTruthy();
  });

  it("zamówienie bez środowiska nie pokazuje wiszącej kropki", async () => {
    setPaymentRows([paymentOrder({ environment: null })]);
    renderWithQueryClient(<AdminPaymentOrdersPanel />);

    await waitFor(() => expect(screen.getByText("stripe")).toBeTruthy());
    expect(screen.queryByText(/stripe ·/)).toBeNull();
  });

  it("bez nazwy planu pokazuje RODZAJ zamówienia, nie pustkę", async () => {
    setPaymentRows([paymentOrder({ planNamePl: null, planNameEn: null, kind: "subscription" })]);
    renderWithQueryClient(<AdminPaymentOrdersPanel />);

    await waitFor(() => expect(screen.getByText("adminBilling.subscription")).toBeTruthy());
  });

  it("zamówienie jednorazowe ma własną etykietę rodzaju", async () => {
    setPaymentRows([paymentOrder({ planNamePl: null, planNameEn: null, kind: "one_time" })]);
    renderWithQueryClient(<AdminPaymentOrdersPanel />);

    await waitFor(() => expect(screen.getByText("adminBilling.oneTimePayment")).toBeTruthy());
    expect(screen.queryByText("adminBilling.subscription")).toBeNull();
  });

  it("nazwa planu, gdy jest, wypiera etykietę rodzaju", async () => {
    setPaymentRows([
      paymentOrder({ planNamePl: "Członek miesięcznie", planNameEn: "Member monthly" }),
    ]);
    renderWithQueryClient(<AdminPaymentOrdersPanel />);

    await waitFor(() => expect(screen.getByText("Członek miesięcznie")).toBeTruthy());
    expect(screen.queryByText("adminBilling.subscription")).toBeNull();
  });

  it("nazwa planu w panelu idzie za JĘZYKIEM INTERFEJSU administratora", async () => {
    h.lang.current = "en";
    setPaymentRows([
      paymentOrder({ planNamePl: "Członek miesięcznie", planNameEn: "Member monthly" }),
    ]);
    renderWithQueryClient(<AdminPaymentOrdersPanel />);

    await waitFor(() => expect(screen.getByText("Member monthly")).toBeTruthy());
    expect(screen.queryByText("Członek miesięcznie")).toBeNull();
  });

  it("nazwa tylko w jednym języku jest używana w obu (lepsza niż etykieta ogólna)", async () => {
    h.lang.current = "en";
    setPaymentRows([paymentOrder({ planNamePl: "Członek miesięcznie", planNameEn: null })]);
    renderWithQueryClient(<AdminPaymentOrdersPanel />);

    await waitFor(() => expect(screen.getByText("Członek miesięcznie")).toBeTruthy());
    expect(screen.queryByText("adminBilling.subscription")).toBeNull();
  });

  it("waluta inna niż domyślna nie jest podmieniana", async () => {
    setPaymentRows([paymentOrder({ amountCents: 2500, currency: "EUR" })]);
    renderWithQueryClient(<AdminPaymentOrdersPanel />);

    await waitFor(() => expect(screen.getByText(moneyPattern(2500))).toBeTruthy());
    expect(document.querySelector("tbody")!.textContent).not.toContain("zł");
  });

  it("BŁĄD WCZYTANIA mówi to wprost, zamiast pokazywać pustą tabelę", async () => {
    h.paymentThrows.current = true;
    renderWithQueryClient(<AdminPaymentOrdersPanel />);

    await waitFor(() => expect(screen.getByText("adminBilling.couldLoadOrders")).toBeTruthy());
    expect(document.querySelector("tbody")).toBeNull();
  });

  it("pusty wynik filtra ma własny komunikat", async () => {
    setPaymentRows([]);
    renderWithQueryClient(<AdminPaymentOrdersPanel />);

    await waitFor(() => expect(screen.getByText("adminBilling.ordersFilter")).toBeTruthy());
    expect(screen.queryByText("adminBilling.couldLoadOrders")).toBeNull();
  });
});

describe("AdminTicketOrdersPanel - statystyki i wiersze", () => {
  it("statystyki liczą TYLKO opłacone bilety", async () => {
    h.ticketOrders.current = [
      ticketOrder({ id: "a", status: "paid", tickets: 2 }),
      ticketOrder({ id: "b", status: "paid", tickets: 3 }),
      ticketOrder({ id: "c", status: "pending", tickets: 10 }),
    ];
    renderWithQueryClient(<AdminTicketOrdersPanel />);

    // Czekamy na WCZYTANE dane: pasek statystyk renderuje się od razu (zerami),
    // więc samo jego istnienie nic nie dowodzi.
    await waitFor(() =>
      expect(screen.getByText(/adminBilling\.ticketStats/).textContent).toContain('"tickets":5'),
    );
    // Pięć biletów z dwóch opłaconych zamówień; dziesięć oczekujących nie wchodzi.
    expect(screen.getByText(/adminBilling\.ticketStats/).textContent).toContain('"pending":1');
  });

  it("tytuł wydarzenia idzie za językiem interfejsu", async () => {
    renderWithQueryClient(<AdminTicketOrdersPanel />);
    await waitFor(() => expect(screen.getByText("Decision Lab: energia")).toBeTruthy());

    h.lang.current = "en";
    const { unmount } = renderWithQueryClient(<AdminTicketOrdersPanel />);
    await waitFor(() => expect(screen.getByText("Decision Lab: energy")).toBeTruthy());
    unmount();
  });

  it("brak tytułu w obu językach schodzi na identyfikator wydarzenia", async () => {
    h.ticketOrders.current = [ticketOrder({ eventTitlePl: null, eventTitleEn: null })];
    renderWithQueryClient(<AdminTicketOrdersPanel />);

    await waitFor(() => expect(screen.getByText("event-1")).toBeTruthy());
  });

  it("brak polskiego tytułu schodzi na angielski, nie na identyfikator", async () => {
    h.ticketOrders.current = [ticketOrder({ eventTitlePl: null })];
    renderWithQueryClient(<AdminTicketOrdersPanel />);

    await waitFor(() => expect(screen.getByText("Decision Lab: energy")).toBeTruthy());
    expect(screen.queryByText("event-1")).toBeNull();
  });

  it("KONTO USUNIĘTE (RODO) pokazuje komunikat, nie surowy identyfikator", async () => {
    h.ticketOrders.current = [
      ticketOrder({ buyerAnonymized: true, buyerName: null, buyerEmail: null }),
    ];
    renderWithQueryClient(<AdminTicketOrdersPanel />);

    await waitFor(() => expect(screen.getByText("adminBilling.accountDeleted")).toBeTruthy());
    expect(screen.queryByText("user-me")).toBeNull();
  });

  it("kupujący bez nazwy schodzi na e-mail, a bez e-maila na identyfikator", async () => {
    h.ticketOrders.current = [
      ticketOrder({ id: "a", buyerName: null }),
      ticketOrder({ id: "b", buyerName: null, buyerEmail: null }),
    ];
    renderWithQueryClient(<AdminTicketOrdersPanel />);

    await waitFor(() => expect(screen.getByText("syntetyczny@example.test")).toBeTruthy());
    expect(screen.getByText("user-me")).toBeTruthy();
  });

  it("kod kuponu jest widoczny przy cenie", async () => {
    h.ticketOrders.current = [ticketOrder({ couponCode: "NES20" })];
    renderWithQueryClient(<AdminTicketOrdersPanel />);

    await waitFor(() => expect(screen.getByText("NES20")).toBeTruthy());
    expect(screen.getByText(moneyPattern(19900))).toBeTruthy();
  });

  it("identyfikator transakcji jest widoczny przy statusie", async () => {
    renderWithQueryClient(<AdminTicketOrdersPanel />);

    await waitFor(() => expect(screen.getByText("pi_test_1")).toBeTruthy());
    expect(screen.getByText("paid")).toBeTruthy();
  });

  it("brak zamówień biletowych ma własny komunikat", async () => {
    h.ticketOrders.current = [];
    renderWithQueryClient(<AdminTicketOrdersPanel />);

    await waitFor(() => expect(screen.getByText("adminBilling.ticketOrdersYet")).toBeTruthy());
    expect(document.querySelector("tbody")).toBeNull();
  });

  // Uwaga: przy błędzie panel pokazuje JEDNOCZEŚNIE komunikat awarii i „brak
  // zamówień biletowych" (warunek pustej listy nie wyklucza stanu błędu). Dwa
  // sprzeczne zdania obok siebie to drobna niezgrabność, nie usterka pieniężna -
  // test przypina stan faktyczny i zgłasza to w dokumencie wdrożenia, zamiast
  // zmieniać zachowanie przy okazji pisania testów.
  it("błąd wczytania listy mówi to wprost (obok komunikatu pustej listy)", async () => {
    h.ticketThrows.current = true;
    renderWithQueryClient(<AdminTicketOrdersPanel />);

    await waitFor(() => expect(screen.getByText("adminBilling.couldLoadOrders")).toBeTruthy());
    expect(document.querySelector("tbody")).toBeNull();
  });
});

describe("AdminTicketOrdersPanel - OŚ CZASU zmian zamówienia", () => {
  const openHistory = async () => {
    await waitFor(() =>
      expect(screen.getByLabelText("adminBilling.showChangeHistory")).toBeTruthy(),
    );
    fireEvent.click(screen.getByLabelText("adminBilling.showChangeHistory"));
  };

  it("historia jest ukryta, dopóki operator jej nie rozwinie", async () => {
    renderWithQueryClient(<AdminTicketOrdersPanel />);

    await waitFor(() =>
      expect(screen.getByLabelText("adminBilling.showChangeHistory")).toBeTruthy(),
    );
    expect(
      screen.getByLabelText("adminBilling.showChangeHistory").getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("utworzenie zamówienia i rozliczenie płatności mają CZYTELNE etykiety", async () => {
    h.history.current = [
      { id: "h1", at: "2026-08-18T10:00:00.000Z", kind: "order_created", label: "surowe" },
      { id: "h2", at: "2026-08-18T10:01:00.000Z", kind: "order_paid", label: "surowe" },
    ];
    renderWithQueryClient(<AdminTicketOrdersPanel />);
    await openHistory();

    await waitFor(() => expect(screen.getByText("adminBilling.orderCreated")).toBeTruthy());
    expect(screen.getByText("adminBilling.paymentSettled")).toBeTruthy();
  });

  it("zdarzenie NIEZNANEGO rodzaju pokazuje swoją surową etykietę", async () => {
    h.history.current = [
      { id: "h1", at: "2026-08-18T10:00:00.000Z", kind: "webhook_event", label: "invoice.paid" },
    ];
    renderWithQueryClient(<AdminTicketOrdersPanel />);
    await openHistory();

    await waitFor(() => expect(screen.getByText("invoice.paid")).toBeTruthy());
  });

  it("wpis ze ŚRODOWISKA TESTOWEGO jest oznaczony", async () => {
    h.history.current = [
      {
        id: "h1",
        at: "2026-08-18T10:00:00.000Z",
        kind: "webhook_event",
        label: "invoice.paid",
        environment: "sandbox",
      },
    ];
    renderWithQueryClient(<AdminTicketOrdersPanel />);
    await openHistory();

    await waitFor(() => expect(screen.getByText("test")).toBeTruthy());
    expect(screen.getByText("invoice.paid")).toBeTruthy();
  });

  it("wpis produkcyjny NIE jest oznaczany jako testowy", async () => {
    h.history.current = [
      {
        id: "h1",
        at: "2026-08-18T10:00:00.000Z",
        kind: "webhook_event",
        label: "invoice.paid",
        environment: "live",
      },
    ];
    renderWithQueryClient(<AdminTicketOrdersPanel />);
    await openHistory();

    await waitFor(() => expect(screen.getByText("invoice.paid")).toBeTruthy());
    expect(screen.queryByText("test")).toBeNull();
  });

  it("BŁĄD zapisany w osi czasu jest pokazany, nie ukryty", async () => {
    h.history.current = [
      {
        id: "h1",
        at: "2026-08-18T10:00:00.000Z",
        kind: "webhook_event",
        label: "invoice.paid",
        status: "failed",
        error: "nieznany plan w metadanych",
      },
    ];
    renderWithQueryClient(<AdminTicketOrdersPanel />);
    await openHistory();

    await waitFor(() => expect(screen.getByText("nieznany plan w metadanych")).toBeTruthy());
    expect(screen.getByText("failed")).toBeTruthy();
  });

  it("pusta oś czasu mówi, że zmian nie zapisano", async () => {
    h.history.current = [];
    renderWithQueryClient(<AdminTicketOrdersPanel />);
    await openHistory();

    await waitFor(() => expect(screen.getByText("adminBilling.recordedChanges")).toBeTruthy());
  });

  it("błąd wczytania osi czasu ma osobny komunikat od błędu listy", async () => {
    h.historyThrows.current = true;
    renderWithQueryClient(<AdminTicketOrdersPanel />);
    await openHistory();

    await waitFor(() => expect(screen.getByText("adminBilling.couldLoadHistory")).toBeTruthy());
    expect(screen.queryByText("adminBilling.couldLoadOrders")).toBeNull();
  });

  it("rozwinięcie DRUGIEGO zamówienia zamyka pierwsze", async () => {
    h.ticketOrders.current = [
      ticketOrder({ id: "a", eventTitlePl: "Pierwsze" }),
      ticketOrder({ id: "b", eventTitlePl: "Drugie" }),
    ];
    h.history.current = [
      { id: "h1", at: "2026-08-18T10:00:00.000Z", kind: "order_created", label: "x" },
    ];
    renderWithQueryClient(<AdminTicketOrdersPanel />);
    await waitFor(() =>
      expect(screen.getAllByLabelText("adminBilling.showChangeHistory")).toHaveLength(2),
    );

    fireEvent.click(screen.getAllByLabelText("adminBilling.showChangeHistory")[0]);
    await waitFor(() => expect(screen.getAllByRole("list").length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByLabelText("adminBilling.showChangeHistory")[1]);

    await waitFor(() =>
      expect(
        screen
          .getAllByLabelText("adminBilling.showChangeHistory")
          .filter((button) => button.getAttribute("aria-expanded") === "true"),
      ).toHaveLength(1),
    );
  });
});
