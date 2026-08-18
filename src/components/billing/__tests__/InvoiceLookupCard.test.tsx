// Odzyskiwanie faktury po numerze transakcji + mail z linkiem do portalu -
// 0 z 11 funkcji pokrytych do 18.08.2026.
//
// Faktur NIE trzymamy u siebie: operator (Merchant of Record) wystawia je
// i udostępnia pod krótkotrwałym adresem. Klient wkleja numer z maila, serwer
// sprawdza WŁASNOŚĆ transakcji i zwraca jednorazowy link.
//
// Dlatego ten plik pilnuje przede wszystkim tego, żeby każdy powód odmowy miał
// SWÓJ komunikat. „Nie udało się" jest tu bezużyteczne: klient nie wie, czy
// wkleił zły numer, czy transakcja nie jest jego, czy operator nie wystawił
// jeszcze dokumentu - a od tego zależy, co ma zrobić dalej.
//
// Reguła numeru transakcji (`isTransactionId`) jest współdzielona z serwerem
// i ma własny test; tutaj sprawdzamy jej UŻYCIE w formularzu.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({
  invoice: { current: {} as Record<string, unknown> },
  portalEmail: { current: {} as Record<string, unknown> },
  findInvoice: vi.fn(),
  sendPortal: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => {
  const stubs = await import("@/test/reactStubs");
  return stubs.reactI18nextStub();
});

vi.mock("@tanstack/react-start", () => ({
  useServerFn: <T,>(fn: T) => fn,
}));

vi.mock("@/lib/stripe", () => ({ getStripeEnvironment: () => "sandbox" }));

vi.mock("@/lib/billing/portalLink.functions", () => ({
  fetchMyInvoiceByTransaction: (arg: unknown) => h.findInvoice(arg),
  sendMyPortalLink: (arg: unknown) => h.sendPortal(arg),
}));

vi.mock("sonner", () => ({
  toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) },
}));

import { InvoiceLookupCard } from "@/components/billing/InvoiceLookupCard";

/** Numer transakcji o kształcie, jaki naprawdę wystawia Stripe (syntetyczny). */
const VALID_ID = "in_1SyntetycznyTestowy00";

function renderCard() {
  return renderWithQueryClient(<InvoiceLookupCard />);
}

const field = () => screen.getByLabelText("profile.orders.invoiceLookup.label");
const submit = () => screen.getByText("profile.orders.invoiceLookup.cta").closest("button")!;

function typeId(value: string): void {
  fireEvent.change(field(), { target: { value } });
}

beforeEach(() => {
  h.invoice.current = {
    ok: true,
    url: "https://invoice.example.test/hosted",
    transactionId: VALID_ID,
  };
  h.portalEmail.current = { ok: true, email: "syntetyczny@example.test" };
  h.findInvoice.mockReset().mockImplementation(() => Promise.resolve(h.invoice.current));
  h.sendPortal.mockReset().mockImplementation(() => Promise.resolve(h.portalEmail.current));
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("InvoiceLookupCard - walidacja numeru przed wysyłką", () => {
  it("pusty formularz ma wyłączony przycisk i nie wysyła żądania", () => {
    renderCard();

    expect(submit().hasAttribute("disabled")).toBe(true);
    expect(h.findInvoice).not.toHaveBeenCalled();
  });

  it("NIEPOPRAWNY numer nie wychodzi do serwera", () => {
    renderCard();

    typeId("faktura-123");
    fireEvent.blur(field());

    expect(submit().hasAttribute("disabled")).toBe(true);
    expect(h.findInvoice).not.toHaveBeenCalled();
  });

  it("niepoprawny numer pokazuje błąd DOPIERO po dotknięciu pola", () => {
    renderCard();

    typeId("faktura-123");
    expect(
      screen.queryByText("profile.orders.invoiceLookup.errors.invalid_transaction"),
    ).toBeNull();

    fireEvent.blur(field());
    expect(
      screen.getByText("profile.orders.invoiceLookup.errors.invalid_transaction"),
    ).toBeTruthy();
  });

  it("poprawny numer odblokowuje przycisk i nie pokazuje błędu", () => {
    renderCard();

    typeId(VALID_ID);
    fireEvent.blur(field());

    expect(submit().hasAttribute("disabled")).toBe(false);
    expect(
      screen.queryByText("profile.orders.invoiceLookup.errors.invalid_transaction"),
    ).toBeNull();
  });

  it("numer wklejony z otoczką białych znaków jest oczyszczany, a nie odrzucany", async () => {
    renderCard();

    typeId(`  ${VALID_ID}  `);
    fireEvent.click(submit());

    await waitFor(() => expect(h.findInvoice).toHaveBeenCalledTimes(1));
    expect(h.findInvoice).toHaveBeenCalledWith({
      data: { transactionId: VALID_ID, environment: "sandbox" },
    });
  });
});

describe("InvoiceLookupCard - każdy powód odmowy ma swój komunikat", () => {
  it("znaleziona faktura pokazuje link do pobrania w nowej karcie", async () => {
    renderCard();
    typeId(VALID_ID);

    fireEvent.click(submit());

    await waitFor(() =>
      expect(screen.getByText("profile.orders.invoiceLookup.download")).toBeTruthy(),
    );
    const link = screen.getByText("profile.orders.invoiceLookup.download").closest("a");
    expect(link?.getAttribute("href")).toBe("https://invoice.example.test/hosted");
  });

  it("FAKTURA NIEISTNIEJĄCA (`not_found`) ma własny komunikat", async () => {
    h.invoice.current = { ok: false, error: "not_found" };
    renderCard();
    typeId(VALID_ID);

    fireEvent.click(submit());

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.orders.invoiceLookup.errors.not_found"),
    );
    expect(screen.queryByText("profile.orders.invoiceLookup.download")).toBeNull();
  });

  it("TRANSAKCJA INNEGO KLIENTA (`forbidden`) nie pokazuje adresu dokumentu", async () => {
    h.invoice.current = { ok: false, error: "forbidden" };
    renderCard();
    typeId(VALID_ID);

    fireEvent.click(submit());

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.orders.invoiceLookup.errors.forbidden"),
    );
    // Kluczowe: ŻADNEGO linku, nawet gdyby serwer coś dorzucił w ładunku.
    expect(screen.queryByText("profile.orders.invoiceLookup.download")).toBeNull();
  });

  it("dokument jeszcze niewystawiony (`invoice_unavailable`) ma osobny komunikat", async () => {
    h.invoice.current = { ok: false, error: "invoice_unavailable" };
    renderCard();
    typeId(VALID_ID);

    fireEvent.click(submit());

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        "profile.orders.invoiceLookup.errors.invoice_unavailable",
      ),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("awaria transportu też kończy się komunikatem", async () => {
    h.findInvoice.mockRejectedValue(new Error("sieć padła"));
    renderCard();
    typeId(VALID_ID);

    fireEvent.click(submit());

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        "profile.orders.invoiceLookup.errors.invoice_unavailable",
      ),
    );
    expect(screen.queryByText("profile.orders.invoiceLookup.download")).toBeNull();
  });

  it("PO NIEUDANYM SZUKANIU poprzedni link ZNIKA", async () => {
    renderCard();
    typeId(VALID_ID);
    fireEvent.click(submit());
    await waitFor(() =>
      expect(screen.getByText("profile.orders.invoiceLookup.download")).toBeTruthy(),
    );

    // Druga próba, inny numer, tym razem odmowa - stary adres nie może zostać
    // na ekranie, bo klient pobrałby dokument sprzed poprawki.
    h.invoice.current = { ok: false, error: "not_found" };
    typeId("cs_1InnySyntetyczny000");
    fireEvent.click(submit());

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(screen.queryByText("profile.orders.invoiceLookup.download")).toBeNull();
  });
});

describe("InvoiceLookupCard - mail z linkiem do portalu", () => {
  const portalCta = () => screen.getByText("profile.orders.portalEmail.cta");

  it("wysyła prośbę o link i potwierdza adresem, na który poszedł", async () => {
    renderCard();

    fireEvent.click(portalCta());

    await waitFor(() => expect(h.sendPortal).toHaveBeenCalledTimes(1));
    expect(h.toastSuccess).toHaveBeenCalledWith(
      'profile.orders.portalEmail.sent {"email":"syntetyczny@example.test"}',
    );
  });

  it("BRAK KONTA U OPERATORA ma własny komunikat", async () => {
    h.portalEmail.current = { ok: false, error: "no_customer" };
    renderCard();

    fireEvent.click(portalCta());

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.orders.portalEmail.errors.no_customer"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("brak adresu odbiorcy (`no_recipient`) też jest rozróżniony", async () => {
    h.portalEmail.current = { ok: false, error: "no_recipient" };
    renderCard();

    fireEvent.click(portalCta());

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.orders.portalEmail.errors.no_recipient"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("awaria wysyłki maila kończy się komunikatem o wysyłce, nie o fakturze", async () => {
    h.sendPortal.mockRejectedValue(new Error("poczta padła"));
    renderCard();

    fireEvent.click(portalCta());

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.orders.portalEmail.errors.send_failed"),
    );
    expect(h.toastError).not.toHaveBeenCalledWith(
      "profile.orders.invoiceLookup.errors.invoice_unavailable",
    );
  });

  it("żądanie linku nosi środowisko operatora", async () => {
    renderCard();

    fireEvent.click(portalCta());

    await waitFor(() => expect(h.sendPortal).toHaveBeenCalledTimes(1));
    expect(h.sendPortal).toHaveBeenCalledWith({ data: { environment: "sandbox" } });
  });
});
