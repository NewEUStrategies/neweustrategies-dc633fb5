// Dwie tabele rozliczeniowe klienta - `BillingDocumentsCard` (rejestr faktur
// i paragonów) i `OrdersTableCard` (zamówienia). Obie stały na 0 z 4 funkcji
// do 18.08.2026.
//
// Struktura mają identyczną (zapytanie -> tabela), więc siedzą w jednym pliku:
// osobne pliki znaczyłyby dwie kopie tej samej atrapy warstwy danych, a to
// dokładnie ten rodzaj duplikacji, którego ta praca ma się pozbyć.
//
// Co jest tu warte testu, mimo prostoty komponentów:
//
//   1. PUSTY REJESTR MÓWI, ŻE JEST PUSTY. Tabela z samymi nagłówkami wygląda
//      jak awaria wczytywania, a klient szukający faktury nie wie, czy ma
//      czekać, czy pisać do obsługi.
//   2. DOKUMENT BEZ ADRESU nie renderuje martwego linku.
//   3. WALUTA NIE JEST PODMIENIANA - rejestr potrafi mieszać PLN i EUR.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { billingDocument, moneyPattern, paymentOrder } from "@/test/billing/fixtures";
import type { BillingDocument, PaymentOrder } from "@/lib/billing/types";

const h = vi.hoisted(() => ({
  lang: { current: "pl" },
  docs: { current: [] as BillingDocument[] },
  orders: { current: [] as PaymentOrder[] },
}));

vi.mock("react-i18next", async () => {
  const stubs = await import("@/test/reactStubs");
  return stubs.reactI18nextStub(() => h.lang.current);
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "user-me" } } }),
}));

vi.mock("@/lib/billing/queries", () => ({
  fetchMyBillingDocuments: () => Promise.resolve(h.docs.current),
  fetchMyOrders: () => Promise.resolve(h.orders.current),
}));

import { BillingDocumentsCard } from "@/components/billing/BillingDocumentsCard";
import { OrdersTableCard } from "@/components/billing/OrdersTableCard";

const awaitRows = () => waitFor(() => expect(screen.getAllByRole("row").length).toBeGreaterThan(1));

beforeEach(() => {
  h.lang.current = "pl";
  h.docs.current = [];
  h.orders.current = [];
});

describe("BillingDocumentsCard", () => {
  it("PUSTY REJESTR mówi to wprost, bez nagłówków tabeli", async () => {
    renderWithQueryClient(<BillingDocumentsCard />);

    await waitFor(() => expect(screen.getByText("profile.orders.documents.empty")).toBeTruthy());
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("faktura pokazuje numer, kwotę i status", async () => {
    h.docs.current = [
      billingDocument({ number: "FV/2026/08/0001", amount_cents: 4900, status: "paid" }),
    ];
    renderWithQueryClient(<BillingDocumentsCard />);

    await awaitRows();
    expect(screen.getByText("FV/2026/08/0001")).toBeTruthy();
    expect(screen.getByText("profile.orders.documents.status.paid")).toBeTruthy();
  });

  it("rodzaj dokumentu ma osobny klucz dla paragonu i faktury", async () => {
    h.docs.current = [
      billingDocument({ id: "d1", provider_document_id: "in_1", kind: "invoice" }),
      billingDocument({ id: "d2", provider_document_id: "re_1", kind: "receipt" }),
    ];
    renderWithQueryClient(<BillingDocumentsCard />);

    await awaitRows();
    expect(screen.getByText("profile.orders.documents.kind.invoice")).toBeTruthy();
    expect(screen.getByText("profile.orders.documents.kind.receipt")).toBeTruthy();
  });

  it("dokument BEZ numeru pokazuje kreskę, nie puste pole", async () => {
    h.docs.current = [billingDocument({ number: null })];
    renderWithQueryClient(<BillingDocumentsCard />);

    await awaitRows();
    expect(screen.getByText("-")).toBeTruthy();
  });

  it("adres hostowany i PDF to DWA osobne wejścia", async () => {
    h.docs.current = [
      billingDocument({
        hosted_url: "https://invoice.example.test/hosted",
        pdf_url: "https://invoice.example.test/plik.pdf",
      }),
    ];
    renderWithQueryClient(<BillingDocumentsCard />);

    await awaitRows();
    expect(
      screen.getByText("profile.orders.documents.view").closest("a")?.getAttribute("href"),
    ).toBe("https://invoice.example.test/hosted");
    expect(
      screen.getByText("profile.orders.documents.pdf").closest("a")?.getAttribute("href"),
    ).toBe("https://invoice.example.test/plik.pdf");
  });

  it("DOKUMENT BEZ ADRESÓW nie renderuje martwych linków", async () => {
    h.docs.current = [billingDocument({ hosted_url: null, pdf_url: null })];
    renderWithQueryClient(<BillingDocumentsCard />);

    await awaitRows();
    expect(screen.queryByText("profile.orders.documents.view")).toBeNull();
    expect(screen.queryByText("profile.orders.documents.pdf")).toBeNull();
  });

  it("linki dokumentów otwierają się bez dostępu do okna źródłowego", async () => {
    h.docs.current = [billingDocument({ hosted_url: "https://invoice.example.test/hosted" })];
    renderWithQueryClient(<BillingDocumentsCard />);

    await awaitRows();
    const link = screen.getByText("profile.orders.documents.view").closest("a");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
  });

  it("WALUTA nie jest podmieniana na domyślną", async () => {
    h.docs.current = [billingDocument({ amount_cents: 2500, currency: "EUR" })];
    renderWithQueryClient(<BillingDocumentsCard />);

    await awaitRows();
    const table = screen.getByRole("table");
    expect(table.textContent).toMatch(moneyPattern(2500));
    expect(table.textContent).not.toContain("zł");
  });

  it("kolumna akcji ma etykietę dostępną (pusty nagłówek bez niej jest bezimienny)", async () => {
    h.docs.current = [billingDocument()];
    renderWithQueryClient(<BillingDocumentsCard />);

    await awaitRows();
    expect(screen.getByLabelText("profile.orders.documents.view")).toBeTruthy();
  });
});

describe("OrdersTableCard", () => {
  it("BRAK ZAMÓWIEŃ mówi to wprost", async () => {
    renderWithQueryClient(<OrdersTableCard />);

    await waitFor(() => expect(screen.getByText("profile.orders.empty")).toBeTruthy());
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("zamówienie pokazuje kwotę i status", async () => {
    h.orders.current = [paymentOrder({ amount_cents: 4900, status: "paid" })];
    renderWithQueryClient(<OrdersTableCard />);

    await awaitRows();
    expect(screen.getByText(moneyPattern(4900))).toBeTruthy();
    expect(screen.getByText("profile.status.paid")).toBeTruthy();
  });

  it("ETYKIETA Z METADANYCH wypiera ogólny rodzaj zamówienia", async () => {
    h.orders.current = [paymentOrder({ metadata: { label: "Bilet: Decision Lab" } })];
    renderWithQueryClient(<OrdersTableCard />);

    await awaitRows();
    expect(screen.getByText("Bilet: Decision Lab")).toBeTruthy();
    expect(screen.queryByText("profile.orders.kindSubscription")).toBeNull();
  });

  it("bez etykiety w metadanych pokazuje rodzaj zamówienia", async () => {
    h.orders.current = [paymentOrder({ kind: "one_time", metadata: {} })];
    renderWithQueryClient(<OrdersTableCard />);

    await awaitRows();
    expect(screen.getByText("profile.orders.kindOneTime")).toBeTruthy();
    expect(screen.queryByText("profile.orders.kindSubscription")).toBeNull();
  });

  it("etykieta o nietekstowym typie nie przecieka do widoku", async () => {
    h.orders.current = [paymentOrder({ kind: "subscription", metadata: { label: 42 } })];
    renderWithQueryClient(<OrdersTableCard />);

    await awaitRows();
    expect(screen.getByText("profile.orders.kindSubscription")).toBeTruthy();
    expect(screen.queryByText("42")).toBeNull();
  });

  it("zamówienie nieudane ma inny status niż opłacone", async () => {
    h.orders.current = [
      paymentOrder({ id: "o1", status: "paid" }),
      paymentOrder({ id: "o2", status: "failed" }),
    ];
    renderWithQueryClient(<OrdersTableCard />);

    await awaitRows();
    expect(screen.getByText("profile.status.paid")).toBeTruthy();
    expect(screen.getByText("profile.status.failed")).toBeTruthy();
  });

  it("zamówienie z fakturą linkuje do niej, bez faktury pokazuje kreskę", async () => {
    h.orders.current = [
      paymentOrder({ id: "o1", invoice_url: "https://invoice.example.test/o1" }),
      paymentOrder({ id: "o2", invoice_url: null }),
    ];
    renderWithQueryClient(<OrdersTableCard />);

    await awaitRows();
    expect(screen.getByText("profile.orders.invoice").closest("a")?.getAttribute("href")).toBe(
      "https://invoice.example.test/o1",
    );
    expect(screen.getByText("-")).toBeTruthy();
  });
});
