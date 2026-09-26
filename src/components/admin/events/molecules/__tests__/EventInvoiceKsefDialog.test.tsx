// Reczny stan KSeF wystawionego dokumentu (bez klienta API w tej wersji):
// stan i numer z wiersza listy, zapis przez RPC, odmowa bazy jako toast.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { INVOICE_IDS, invoiceListRow } from "@/test/events/invoiceFixtures";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/select", async () => (await import("@/test/reactStubs")).radixSelectStub(await import("react")));
const api = vi.hoisted(() => ({ updateInvoiceKsef: vi.fn() }));
vi.mock("@/lib/events/eventInvoicesApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/eventInvoicesApi")>()),
  ...api,
}));

const { toast } = await import("sonner");
const { EventInvoiceKsefDialog } = await import("@/components/admin/events/molecules/EventInvoiceKsefDialog");

beforeEach(() => {
  api.updateInvoiceKsef.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe("EventInvoiceKsefDialog", () => {
  it("bez wiersza okno jest zamkniete", () => {
    render(<EventInvoiceKsefDialog eventId={INVOICE_IDS.event} row={null} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stan i numer z wiersza; zapis przyjetego z numerem", async () => {
    api.updateInvoiceKsef.mockResolvedValue(INVOICE_IDS.invoice);
    const onClose = vi.fn();
    renderWithQueryClient(
      <EventInvoiceKsefDialog eventId={INVOICE_IDS.event} row={invoiceListRow({ ksef_status: "sent" })} onClose={onClose} />,
    );
    expect(screen.getByText("adminEventInvoices.ksef.title(number=FV/2026/09/0001)")).toBeTruthy();
    const status = screen.getByLabelText("adminEventInvoices.ksef.status") as HTMLSelectElement;
    expect(status.value).toBe("sent");
    fireEvent.change(status, { target: { value: "accepted" } });
    fireEvent.change(screen.getByLabelText("adminEventInvoices.ksef.number"), { target: { value: " KSEF-1 " } });
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.ksef.save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith("adminEventInvoices.toasts.ksefSaved");
    expect(api.updateInvoiceKsef.mock.calls[0]?.[0]).toEqual({
      id: INVOICE_IDS.invoice,
      status: "accepted",
      number: "KSEF-1",
    });
  });

  it("zapisany numer w polu; odmowa bazy = toast, okno zostaje; anuluj", async () => {
    api.updateInvoiceKsef.mockRejectedValue(new Error("ksef_number_required: x"));
    const onClose = vi.fn();
    renderWithQueryClient(
      <EventInvoiceKsefDialog
        eventId={INVOICE_IDS.event}
        row={invoiceListRow({ ksef_status: "weird", ksef_number: "K-9" })}
        onClose={onClose}
      />,
    );
    expect((screen.getByLabelText("adminEventInvoices.ksef.number") as HTMLInputElement).value).toBe("K-9");
    expect((screen.getByLabelText("adminEventInvoices.ksef.status") as HTMLSelectElement).value).toBe("not_applicable");
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.ksef.save" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.ksef.cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
