// Okno "Dane do faktury" z profilu: walidacja przed wyslaniem, zapis prosby
// dla wskazanego zamowienia, odmowa bazy zdaniem kupujacego.
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { emptyBuyerDraft } from "@/lib/events/eventInvoiceBuyerDraft";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { INVOICE_IDS } from "@/test/events/invoiceFixtures";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

const api = vi.hoisted(() => ({
  fetchMyInvoiceSources: vi.fn(),
  fetchMyInvoices: vi.fn(),
  saveInvoiceRequest: vi.fn(),
  cancelInvoiceRequest: vi.fn(),
}));
vi.mock("@/lib/events/myEventInvoicesApi", () => api);

const { InvoiceRequestDialog } =
  await import("@/components/events/invoices/molecules/InvoiceRequestDialog");

const VALID = {
  ...emptyBuyerDraft(),
  name: "Acme",
  taxId: "5260250274",
  address: "ul. Morska 5",
  postalCode: "80-001",
  city: "Gdansk",
};
const TARGET = { registrationId: INVOICE_IDS.registration };

beforeEach(() => {
  api.saveInvoiceRequest.mockReset();
});

describe("InvoiceRequestDialog", () => {
  it("niepoprawne dane: bledy przy polach, bez zapisu", () => {
    renderWithQueryClient(
      <InvoiceRequestDialog
        target={TARGET}
        initial={emptyBuyerDraft()}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("eventInvoices.profile.dialogTitle")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "eventInvoices.profile.submit" }));
    expect(screen.getByText("eventInvoices.buyer.errors.nameRequired")).toBeTruthy();
    expect(api.saveInvoiceRequest).not.toHaveBeenCalled();
  });

  it("poprawne dane: zapis prosby i zamkniecie", async () => {
    let release: (value: string) => void = () => {};
    api.saveInvoiceRequest.mockReturnValue(new Promise<string>((resolve) => (release = resolve)));
    const onSaved = vi.fn();
    renderWithQueryClient(
      <InvoiceRequestDialog target={TARGET} initial={VALID} onClose={vi.fn()} onSaved={onSaved} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "eventInvoices.profile.submit" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "eventInvoices.profile.submitting" }),
      ).toHaveProperty("disabled", true),
    );
    release(INVOICE_IDS.request);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.saveInvoiceRequest).toHaveBeenCalledWith(TARGET, VALID);
  });

  it("odmowa bazy: zdanie kupujacego, okno zostaje", async () => {
    api.saveInvoiceRequest.mockRejectedValue(new Error("request_window_closed: too late"));
    const onSaved = vi.fn();
    renderWithQueryClient(
      <InvoiceRequestDialog target={TARGET} initial={VALID} onClose={vi.fn()} onSaved={onSaved} />,
    );
    fireEvent.change(screen.getByLabelText("eventInvoices.buyer.city"), {
      target: { value: "Sopot" },
    });
    fireEvent.click(screen.getByRole("button", { name: "eventInvoices.profile.submit" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "eventInvoices.errors.requestWindowClosed",
    );
    expect(onSaved).not.toHaveBeenCalled();
    expect(api.saveInvoiceRequest).toHaveBeenCalledWith(TARGET, { ...VALID, city: "Sopot" });
  });

  it("anuluj zamyka okno", () => {
    const onClose = vi.fn();
    renderWithQueryClient(
      <InvoiceRequestDialog target={TARGET} initial={VALID} onClose={onClose} onSaved={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "eventInvoices.profile.close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
