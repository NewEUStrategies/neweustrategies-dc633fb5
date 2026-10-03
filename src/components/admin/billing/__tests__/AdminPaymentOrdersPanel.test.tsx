// Panel zamówień płatniczych - przypadki, których nie domyka
// `adminOrderPanels.test.tsx` (tamten plik trzyma kontrakt filtrów, środowiska
// i zamówień wiszących na atrapie słownika).
//
// JAKIE RYZYKO TU PILNUJEMY. Ten panel jest pierwszym miejscem, do którego
// dyżurny zagląda, gdy klient pisze „zapłaciłem i nic". Trzy rzeczy kłamią
// najbardziej przekonująco:
//   1. „ODŚWIEŻ", KTÓRE NIE PYTA SERWERA. Przycisk zostawiający stare wiersze
//      z cache to tabela, która pokazuje zamówienie jako `pending`, choć webhook
//      już je opłacił - i operator „naprawia" coś, co jest w porządku.
//   2. PUSTA KOMÓRKA KUPUJĄCEGO. Zamówienie bez adresu (konto usunięte, płatność
//      gościa bez maila) ma to POWIEDZIEĆ słowami ze słownika, a nie zostawić
//      pustkę wyglądającą jak błąd wczytania.
//   3. STATUS SPOZA ZNANEJ LISTY. Nowa wartość enumu (migracja wdrożona przed
//      panelem) nie może ani wywrócić wiersza, ani dostać koloru „opłacone".
//
// Atrapy stoją WYŁĄCZNIE na granicach: funkcja serwerowa (`listPaymentOrders`)
// i konfiguracja środowiska operatora (prefiks tokena publikowalnego).
// Słownik jest PRAWDZIWY (`@/test/i18nReal`), więc asercje mierzą napisy,
// które zobaczy administrator.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import type { PaymentOrderRow, PaymentOrdersSummary } from "@/lib/billing/paymentOrders.server";

const h = vi.hoisted(() => ({ list: vi.fn() }));

// Częściowa podmiana: prawdziwy słownik (`@/lib/i18n`) potrzebuje
// `createIsomorphicFn` z tego samego pakietu.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});
vi.mock("@/lib/billing/paymentOrders.functions", () => ({
  listPaymentOrders: (args: unknown) => h.list(args),
}));
// Środowisko startowe zależy od prefiksu tokena - w teście deterministyczne.
vi.mock("@/lib/stripe", () => ({ getStripeEnvironmentSafe: () => "sandbox" as const }));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { AdminPaymentOrdersPanel } from "@/components/admin/billing/AdminPaymentOrdersPanel";

function order(overrides: Partial<PaymentOrderRow> = {}): PaymentOrderRow {
  return {
    id: "ord-1",
    createdAt: "2026-08-18T10:00:00.000Z",
    paidAt: null,
    status: "pending",
    kind: "one_time",
    provider: "stripe",
    environment: "sandbox",
    sessionId: "cs_test_syntetyczna",
    amountCents: 4900,
    currency: "PLN",
    planId: null,
    planNamePl: "Członek miesięcznie",
    planNameEn: "Member monthly",
    buyerId: "user-1",
    buyerEmail: "kupujacy@example.com",
    ...overrides,
  };
}

function page(rows: PaymentOrderRow[]): { rows: PaymentOrderRow[]; summary: PaymentOrdersSummary } {
  return {
    rows,
    summary: {
      total: rows.length,
      stuck: 0,
      paid: rows.filter((r) => r.status === "paid").length,
      failed: rows.filter((r) => r.status === "failed").length,
    },
  };
}

/** Wiersz tabeli po identyfikatorze sesji operatora (unikalny w fixture). */
function rowOf(sessionId: string): HTMLElement {
  return screen.getByText(sessionId).closest("tr") as HTMLElement;
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.list.mockReset().mockResolvedValue(page([order()]));
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

describe("AdminPaymentOrdersPanel - odświeżenie", () => {
  it("„Odśwież” pyta serwer PONOWNIE o ten sam zakres i pokazuje świeży stan", async () => {
    renderWithQueryClient(<AdminPaymentOrdersPanel />);
    await waitFor(() =>
      expect(within(rowOf("cs_test_syntetyczna")).getByText("pending")).toBeTruthy(),
    );
    expect(h.list).toHaveBeenCalledTimes(1);

    // W międzyczasie webhook opłacił zamówienie - serwer zna już nowy status.
    h.list.mockResolvedValue(page([order({ status: "paid" })]));
    fireEvent.click(screen.getByRole("button", { name: "Odśwież" }));

    await waitFor(() =>
      expect(within(rowOf("cs_test_syntetyczna")).getByText("paid")).toBeTruthy(),
    );
    expect(h.list).toHaveBeenCalledTimes(2);
    // Ten sam zakres zapytania - odświeżenie nie gubi filtra ani środowiska.
    expect(h.list).toHaveBeenLastCalledWith({
      data: { status: "all", limit: 200, environment: "sandbox" },
    });
  });

  it("w trakcie odczytu przycisk jest zablokowany - bez serii równoległych zapytań", async () => {
    renderWithQueryClient(<AdminPaymentOrdersPanel />);
    await screen.findByText("cs_test_syntetyczna");

    let release: (value: ReturnType<typeof page>) => void = () => {};
    h.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const button = screen.getByRole("button", { name: "Odśwież" });
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    expect(h.list).toHaveBeenCalledTimes(2);

    release(page([order()]));
    await waitFor(() => expect(button).toBeEnabled());
  });
});

describe("AdminPaymentOrdersPanel - komórka kupującego", () => {
  it("zamówienie BEZ adresu kupującego mówi to słowami słownika (PL)", async () => {
    h.list.mockResolvedValue(page([order({ buyerEmail: null })]));
    renderWithQueryClient(<AdminPaymentOrdersPanel />);

    await waitFor(() =>
      expect(within(rowOf("cs_test_syntetyczna")).getByText("(brak adresu)")).toBeTruthy(),
    );
  });

  it("ten sam brak adresu w panelu angielskim ma angielski napis", async () => {
    await i18n.changeLanguage("en");
    h.list.mockResolvedValue(page([order({ buyerEmail: null })]));
    renderWithQueryClient(<AdminPaymentOrdersPanel />);

    await waitFor(() =>
      expect(within(rowOf("cs_test_syntetyczna")).getByText("(no email)")).toBeTruthy(),
    );
    expect(screen.queryByText("(brak adresu)")).toBeNull();
  });

  it("adres kupującego, gdy jest, wypiera napis zastępczy", async () => {
    renderWithQueryClient(<AdminPaymentOrdersPanel />);

    await waitFor(() =>
      expect(within(rowOf("cs_test_syntetyczna")).getByText("kupujacy@example.com")).toBeTruthy(),
    );
    expect(screen.queryByText("(brak adresu)")).toBeNull();
  });
});

describe("AdminPaymentOrdersPanel - status spoza znanej listy", () => {
  it("nowa wartość statusu wyświetla się dosłownie i NEUTRALNIE, nie jako „opłacone”", async () => {
    h.list.mockResolvedValue(
      page([
        order({ id: "ord-paid", sessionId: "cs_oplacona", status: "paid" }),
        order({ id: "ord-nowy", sessionId: "cs_nowy_status", status: "disputed" }),
      ]),
    );
    renderWithQueryClient(<AdminPaymentOrdersPanel />);

    const badge = await waitFor(() => within(rowOf("cs_nowy_status")).getByText("disputed"));
    const paidBadge = within(rowOf("cs_oplacona")).getByText("paid");

    // Kolor jest tu treścią: zielony znaczy „pieniądze są", więc nieznany
    // status nie może go odziedziczyć.
    expect(paidBadge.className).toContain("emerald");
    expect(badge.className).not.toContain("emerald");
    expect(badge.className).toContain("bg-muted");
  });
});
