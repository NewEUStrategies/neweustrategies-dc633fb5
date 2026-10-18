// Zamówienia biletowe w panelu admina - wiersz, oś czasu i stan bez sieci.
//
// Uzupełnia `adminOrderPanels.test.tsx` o przypadki, których tamten nie
// dotyka: data zamówienia NIEOPŁACONEGO, tytuł wydarzenia w interfejsie
// angielskim, zwinięcie osi czasu, status spoza słownika tonów, oś czasu
// wstrzymana bez sieci (dawniej „nie zapisano zmian", choć nic nie wczytano)
// oraz lista bez danych: błąd odczytu i wstrzymanie bez sieci (dawniej
// „brak zamówień biletowych" i statystyka z samych zer).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { uiLocale } from "@/lib/i18n/format";

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
  orders: { current: [] as TicketOrderView[] },
  /** Odrzucenie odczytu listy (`null` = odczyt udany). */
  ordersError: { current: null as Error | null },
  history: { current: [] as Array<Record<string, unknown>> },
  historyCalls: 0,
}));

vi.mock("react-i18next", async () => {
  const stubs = await import("@/test/reactStubs");
  return stubs.reactI18nextStub(() => h.lang.current);
});
vi.mock("@/lib/i18n-admin-billing", () => ({}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: <T,>(fn: T) => fn }));
vi.mock("@/lib/billing/ticketOrders.functions", () => ({
  listTicketOrders: () =>
    h.ordersError.current
      ? Promise.reject(h.ordersError.current)
      : Promise.resolve(h.orders.current),
  getTicketOrderHistory: () => {
    h.historyCalls += 1;
    return Promise.resolve(h.history.current);
  },
}));

import { AdminTicketOrdersPanel } from "@/components/admin/billing/AdminTicketOrdersPanel";

function ticketOrder(overrides: Partial<TicketOrderView> = {}): TicketOrderView {
  return {
    id: "ticket-1",
    eventId: "event-1",
    eventTitlePl: "Decision Lab: energia",
    eventTitleEn: "Decision Lab: energy",
    eventStartsAt: null,
    buyerId: "user-me",
    buyerName: "Jan Syntetyczny",
    buyerEmail: "syntetyczny@example.test",
    buyerAnonymized: false,
    tickets: 1,
    amountCents: 19900,
    currency: "PLN",
    couponCode: null,
    status: "paid",
    transactionId: null,
    paidAt: "2026-08-20T10:00:00.000Z",
    createdAt: "2026-08-10T10:00:00.000Z",
    ...overrides,
  };
}

/** Ten sam zapis daty co w panelu - test sprawdza, KTÓRA chwila trafia do kolumny. */
const shown = (iso: string, lang: "pl" | "en" = "pl") =>
  new Date(iso).toLocaleString(uiLocale(lang));

const row = () => screen.getByText(/Decision Lab/).closest("tr")!;

beforeEach(() => {
  h.lang.current = "pl";
  h.orders.current = [ticketOrder()];
  h.ordersError.current = null;
  h.history.current = [];
  h.historyCalls = 0;
});

afterEach(() => {
  onlineManager.setOnline(true);
});

describe("AdminTicketOrdersPanel - wiersz zamówienia", () => {
  it("zamówienie NIEOPŁACONE pokazuje chwilę założenia, opłacone - chwilę zapłaty", async () => {
    h.orders.current = [
      ticketOrder({ id: "a", eventTitlePl: "Decision Lab: A", status: "pending", paidAt: null }),
      ticketOrder({ id: "b", eventTitlePl: "Decision Lab: B" }),
    ];
    renderWithQueryClient(<AdminTicketOrdersPanel />);

    const unpaid = (await screen.findByText("Decision Lab: A")).closest("tr")!;
    const paid = screen.getByText("Decision Lab: B").closest("tr")!;
    expect(within(unpaid).getByText(shown("2026-08-10T10:00:00.000Z"))).toBeTruthy();
    expect(within(paid).getByText(shown("2026-08-20T10:00:00.000Z"))).toBeTruthy();
    expect(within(paid).queryByText(shown("2026-08-10T10:00:00.000Z"))).toBeNull();
  });

  it("interfejs ANGIELSKI bez angielskiego tytułu pokazuje polski, nie identyfikator", async () => {
    h.lang.current = "en";
    h.orders.current = [ticketOrder({ eventTitleEn: "" })];
    renderWithQueryClient(<AdminTicketOrdersPanel />);

    expect(await screen.findByText("Decision Lab: energia")).toBeTruthy();
    expect(screen.queryByText("event-1")).toBeNull();
    // Data w zapisie interfejsu angielskiego.
    expect(within(row()).getByText(shown("2026-08-20T10:00:00.000Z", "en"))).toBeTruthy();
  });

  it("status spoza słownika tonów jest pokazany neutralnie, a nie bez stylu", async () => {
    h.orders.current = [ticketOrder({ status: "disputed" })];
    renderWithQueryClient(<AdminTicketOrdersPanel />);

    const badge = await screen.findByText("disputed");
    expect(badge.className).toContain("bg-muted");
    expect(badge.className).toContain("text-muted-foreground");
  });
});

describe("AdminTicketOrdersPanel - oś czasu", () => {
  it("ponowne kliknięcie ZWIJA oś czasu rozwiniętego zamówienia", async () => {
    h.history.current = [
      { id: "h1", at: "2026-08-10T10:00:00.000Z", kind: "order_created", label: "x" },
    ];
    renderWithQueryClient(<AdminTicketOrdersPanel />);
    const toggle = await screen.findByLabelText("adminBilling.showChangeHistory");

    fireEvent.click(toggle);
    expect(await screen.findByText("adminBilling.orderCreated")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("adminBilling.showChangeHistory"));

    await waitFor(() => expect(screen.queryByText("adminBilling.orderCreated")).toBeNull());
    expect(
      screen.getByLabelText("adminBilling.showChangeHistory").getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("oś czasu wstrzymana BEZ SIECI mówi „wczytuję”, a nie „nie zapisano zmian”", async () => {
    renderWithQueryClient(<AdminTicketOrdersPanel />);
    const toggle = await screen.findByLabelText("adminBilling.showChangeHistory");
    onlineManager.setOnline(false);

    fireEvent.click(toggle);

    expect(await screen.findByText("adminBilling.loadingHistory")).toBeTruthy();
    expect(screen.queryByText("adminBilling.recordedChanges")).toBeNull();
    expect(h.historyCalls).toBe(0);
  });
});

describe("AdminTicketOrdersPanel - lista bez danych", () => {
  // DEFEKT (2026-10-18): błąd odczytu listy dawał OBOK komunikatu awarii
  // „brak zamówień biletowych" i statystykę „opłacone 0, bilety 0", a lista
  // wstrzymana bez sieci (`isLoading` = fałsz) - samo „brak zamówień". Admin
  // sprawdzający, czy ktoś kupił bilet, czytał „nikt", choć nic nie wczytano.
  it("BŁĄD ODCZYTU listy nie udaje braku zamówień ani zerowych statystyk", async () => {
    h.ordersError.current = new Error("permission denied");
    renderWithQueryClient(<AdminTicketOrdersPanel />);

    expect(await screen.findByText("adminBilling.couldLoadOrders")).toBeTruthy();
    expect(screen.queryByText("adminBilling.ticketOrdersYet")).toBeNull();
    expect(screen.queryByText(/adminBilling\.ticketStats/)).toBeNull();
    expect(document.querySelector("tbody")).toBeNull();
    // Awaria jest ogłaszana czytnikom ekranu jak w dzienniku zdarzeń.
    expect(screen.getByRole("alert").textContent).toBe("adminBilling.couldLoadOrders");
  });

  it("lista wstrzymana BEZ SIECI mówi „wczytuję”, bez „brak zamówień” i statystyki z zer", async () => {
    onlineManager.setOnline(false);
    renderWithQueryClient(<AdminTicketOrdersPanel />);

    expect(await screen.findByText("adminBilling.loadingOrders")).toBeTruthy();
    expect(screen.queryByText("adminBilling.ticketOrdersYet")).toBeNull();
    expect(screen.queryByText(/adminBilling\.ticketStats/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    // Po powrocie sieci lista wczytuje się sama i „wczytuję” znika.
    onlineManager.setOnline(true);
    expect(await screen.findByText("Decision Lab: energia")).toBeTruthy();
    expect(screen.queryByText("adminBilling.loadingOrders")).toBeNull();
    expect(screen.getByText(/adminBilling\.ticketStats/).textContent).toContain('"paid":1');
  });
});
