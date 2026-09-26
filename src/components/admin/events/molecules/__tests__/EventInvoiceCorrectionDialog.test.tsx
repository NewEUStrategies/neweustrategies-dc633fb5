// Tworzenie szkicu KOREKTY: pelna (odwrocenie wszystkich pozycji) albo
// czesciowa (tylko zmienione pozycje jako para przed/po liczona w bazie).
// Okno wysyla wylacznie ZMIENIONE pozycje, nieczytelne pole zatrzymuje
// wysylke, a odmowa bazy (np. brak przyczyny) wraca jako toast.
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseInvoiceDocument, type EventInvoiceDocument } from "@/lib/events/eventInvoiceDocument";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { INVOICE_IDS, invoiceDocumentJson } from "@/test/events/invoiceFixtures";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/select", async () => (await import("@/test/reactStubs")).radixSelectStub(await import("react")));
const api = vi.hoisted(() => ({ fetchEventInvoice: vi.fn(), createInvoiceCorrection: vi.fn() }));
vi.mock("@/lib/events/eventInvoicesApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/eventInvoicesApi")>()),
  ...api,
}));

const { toast } = await import("sonner");
const { EventInvoiceCorrectionDialog } = await import(
  "@/components/admin/events/molecules/EventInvoiceCorrectionDialog"
);

function issued(): EventInvoiceDocument {
  const parsed = parseInvoiceDocument(invoiceDocumentJson());
  if (parsed === null) throw new Error("fixture");
  return parsed;
}

function open() {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  renderWithQueryClient(
    <EventInvoiceCorrectionDialog
      eventId={INVOICE_IDS.event}
      invoiceId={INVOICE_IDS.invoice}
      onClose={onClose}
      onCreated={onCreated}
    />,
  );
  return { onClose, onCreated };
}

const QTY = "adminEventInvoices.correction.lineQuantity(description=Bilet: Standard - Kongres 27)";
const PRICE = "adminEventInvoices.correction.lineUnitGross(description=Bilet: Standard - Kongres 27)";
const RATE = "adminEventInvoices.correction.lineVatRate(description=Bilet: Standard - Kongres 27)";

beforeEach(() => {
  api.fetchEventInvoice.mockReset();
  api.createInvoiceCorrection.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe("EventInvoiceCorrectionDialog", () => {
  it("zamkniete okno nic nie pobiera; ladowanie", () => {
    const view = renderWithQueryClient(
      <EventInvoiceCorrectionDialog eventId={INVOICE_IDS.event} invoiceId={null} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    expect(api.fetchEventInvoice).not.toHaveBeenCalled();
    view.unmount();
    api.fetchEventInvoice.mockReturnValue(new Promise(() => {}));
    open();
    expect(screen.getByRole("status").textContent).toBe("adminEventInvoices.loading");
  });

  it("korekta pelna: bez pozycji w ladunku, przyczyna przycieta", async () => {
    api.fetchEventInvoice.mockResolvedValue(issued());
    api.createInvoiceCorrection.mockResolvedValue(INVOICE_IDS.correction);
    const { onCreated } = open();
    expect(await screen.findByText("adminEventInvoices.correction.title(number=FV/2026/09/0001)")).toBeTruthy();
    expect(screen.queryByLabelText(QTY, { exact: false })).toBeNull();
    fireEvent.change(screen.getByLabelText("adminEventInvoices.correction.reason"), {
      target: { value: " Rezygnacja " },
    });
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.correction.create" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(INVOICE_IDS.correction));
    expect(toast.success).toHaveBeenCalledWith("adminEventInvoices.toasts.correctionCreated");
    expect(api.createInvoiceCorrection.mock.calls[0]?.[0]).toEqual({
      invoiceId: INVOICE_IDS.invoice,
      mode: "full",
      reason: "Rezygnacja",
    });
  });

  it("korekta czesciowa: tylko zmienione pozycje (ilosc, cena, stawka)", async () => {
    api.fetchEventInvoice.mockResolvedValue(issued());
    api.createInvoiceCorrection.mockResolvedValue(INVOICE_IDS.correction);
    open();
    fireEvent.click(await screen.findByLabelText("adminEventInvoices.correction.modePartial"));
    const quantities = screen.getAllByLabelText(QTY);
    const prices = screen.getAllByLabelText(PRICE);
    const rates = screen.getAllByLabelText(RATE);
    expect(quantities).toHaveLength(2);
    fireEvent.change(quantities[0], { target: { value: "0" } });
    fireEvent.change(prices[0], { target: { value: "100,00" } });
    fireEvent.change(rates[0], { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("adminEventInvoices.correction.reason"), { target: { value: "Zwrot" } });
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.correction.create" }));
    await waitFor(() => expect(api.createInvoiceCorrection).toHaveBeenCalled());
    expect(api.createInvoiceCorrection.mock.calls[0]?.[0]).toEqual({
      invoiceId: INVOICE_IDS.invoice,
      mode: "partial",
      reason: "Zwrot",
      lines: [{ lineId: INVOICE_IDS.line1, quantity: 0, unitGrossCents: 10000, vatRate: "8" }],
    });
  });

  it("nieczytelna ilosc albo cena zatrzymuje wysylke", async () => {
    api.fetchEventInvoice.mockResolvedValue(issued());
    open();
    fireEvent.click(await screen.findByLabelText("adminEventInvoices.correction.modePartial"));
    fireEvent.change(screen.getAllByLabelText(QTY)[1], { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.correction.create" }));
    expect(toast.error).toHaveBeenCalledWith("adminEventInvoices.draft.errors.fix");
    fireEvent.change(screen.getAllByLabelText(QTY)[1], { target: { value: "1" } });
    fireEvent.change(screen.getAllByLabelText(PRICE)[1], { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.correction.create" }));
    expect(toast.error).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getAllByLabelText(PRICE)[1], { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.correction.create" }));
    expect(toast.error).toHaveBeenCalledTimes(3);
    expect(api.createInvoiceCorrection).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("adminEventInvoices.correction.modeFull"));
    expect(screen.queryAllByLabelText(QTY)).toHaveLength(0);
  });

  it("tworzenie w toku blokuje przycisk", async () => {
    api.fetchEventInvoice.mockResolvedValue(issued());
    api.createInvoiceCorrection.mockReturnValue(new Promise(() => {}));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "adminEventInvoices.correction.create" }));
    expect(await screen.findByRole("button", { name: "adminEventInvoices.correction.creating" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("odmowa bazy = toast; anuluj zamyka", async () => {
    api.fetchEventInvoice.mockResolvedValue(issued());
    api.createInvoiceCorrection.mockRejectedValue(new Error("reason_required: x"));
    const { onClose, onCreated } = open();
    fireEvent.click(await screen.findByRole("button", { name: "adminEventInvoices.correction.create" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onCreated).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.correction.cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
