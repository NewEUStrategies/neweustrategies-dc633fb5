// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW:
//
// Reczny stan KSeF wystawionego dokumentu (bez klienta API w tej wersji).
// Pilnujemy reguly INV-02/INV-17: pole stanu oferuje WYLACZNIE obecny stan
// i przejscia, ktore baza przyjmie (przyjeta i "nie dotyczy" sa koncowe),
// numer nadany raz jest tylko do odczytu, nowy numer ma format KSeF
// (normalizacja wielkich liter i spacji), notatka trafia do dziennika,
// a dziennik zmian jest widoczny pod formularzem. Odmowa bazy = toast.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseInvoiceDocument } from "@/lib/events/eventInvoiceDocument";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { INVOICE_IDS, invoiceDocumentJson, invoiceListRow } from "@/test/events/invoiceFixtures";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
const api = vi.hoisted(() => ({ updateInvoiceKsef: vi.fn(), fetchEventInvoice: vi.fn() }));
vi.mock("@/lib/events/eventInvoicesApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/eventInvoicesApi")>()),
  ...api,
}));

const { toast } = await import("sonner");
const { EventInvoiceKsefDialog } =
  await import("@/components/admin/events/molecules/EventInvoiceKsefDialog");

const KSEF = "7011278375-20260920-0123456789AB-CD";

function open(row: ReturnType<typeof invoiceListRow>, onClose = vi.fn()) {
  renderWithQueryClient(
    <EventInvoiceKsefDialog eventId={INVOICE_IDS.event} row={row} onClose={onClose} />,
  );
  return onClose;
}

function statusSelect(): HTMLSelectElement {
  const element = screen.getByLabelText("adminEventInvoices.ksef.status");
  if (!(element instanceof HTMLSelectElement)) throw new Error("brak pola stanu");
  return element;
}

function numberInput(): HTMLInputElement {
  const element = screen.getByLabelText("adminEventInvoices.ksef.number");
  if (!(element instanceof HTMLInputElement)) throw new Error("brak pola numeru");
  return element;
}

function saveButton(): HTMLButtonElement {
  const element = screen.getByRole("button", { name: "adminEventInvoices.ksef.save" });
  if (!(element instanceof HTMLButtonElement)) throw new Error("brak przycisku zapisu");
  return element;
}

beforeEach(() => {
  api.updateInvoiceKsef.mockReset();
  api.fetchEventInvoice.mockReset();
  api.fetchEventInvoice.mockResolvedValue(parseInvoiceDocument(invoiceDocumentJson()));
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe("EventInvoiceKsefDialog", () => {
  it("bez wiersza okno jest zamkniete", () => {
    render(<EventInvoiceKsefDialog eventId={INVOICE_IDS.event} row={null} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("wyslany: tylko przejscia do przodu; przyjecie z numerem po normalizacji", async () => {
    api.updateInvoiceKsef.mockResolvedValue(INVOICE_IDS.invoice);
    const onClose = open(invoiceListRow({ ksef_status: "sent" }));
    expect(screen.getByText("adminEventInvoices.ksef.title(number=FV/2026/09/0001)")).toBeTruthy();
    expect(statusSelect().value).toBe("sent");
    expect([...statusSelect().options].map((option) => option.value)).toEqual([
      "sent",
      "accepted",
      "rejected",
    ]);
    // Bez zmiany nie ma czego zapisac.
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(statusSelect(), { target: { value: "accepted" } });
    fireEvent.change(numberInput(), { target: { value: ` ${KSEF.toLowerCase()} ` } });
    fireEvent.change(screen.getByLabelText("adminEventInvoices.ksef.note"), {
      target: { value: " UPO 123 " },
    });
    fireEvent.click(saveButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith("adminEventInvoices.toasts.ksefSaved");
    expect(api.updateInvoiceKsef.mock.calls[0]?.[0]).toEqual({
      id: INVOICE_IDS.invoice,
      status: "accepted",
      number: KSEF,
      note: "UPO 123",
    });
  });

  it("numer spoza formatu KSeF: podpowiedz formatu i zablokowany zapis", () => {
    open(invoiceListRow({ ksef_status: "pending" }));
    fireEvent.change(statusSelect(), { target: { value: "accepted" } });
    fireEvent.change(numberInput(), { target: { value: "KSEF-1" } });
    expect(screen.getByText("adminEventInvoices.ksef.numberFormat")).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it("przyjety: stan koncowy, numer tylko do odczytu; sama notatka trafia do dziennika", async () => {
    api.updateInvoiceKsef.mockResolvedValue(INVOICE_IDS.invoice);
    open(invoiceListRow({ ksef_status: "accepted", ksef_number: KSEF }));
    expect(statusSelect().disabled).toBe(true);
    expect([...statusSelect().options].map((option) => option.value)).toEqual(["accepted"]);
    expect(screen.getByText("adminEventInvoices.ksef.terminal")).toBeTruthy();
    expect(numberInput().disabled).toBe(true);
    expect(numberInput().value).toBe(KSEF);
    expect(screen.getByText("adminEventInvoices.ksef.numberLocked")).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("adminEventInvoices.ksef.note"), {
      target: { value: "Korekta zapisu UPO" },
    });
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.updateInvoiceKsef).toHaveBeenCalled());
    expect(api.updateInvoiceKsef.mock.calls[0]?.[0]).toEqual({
      id: INVOICE_IDS.invoice,
      status: "accepted",
      number: KSEF,
      note: "Korekta zapisu UPO",
    });
  });

  it("nieznany stan = 'nie dotyczy' (koncowy)", () => {
    open(invoiceListRow({ ksef_status: "weird" }));
    expect(statusSelect().value).toBe("not_applicable");
    expect(statusSelect().disabled).toBe(true);
  });

  it("odmowa bazy = toast, okno zostaje; anuluj zamyka", async () => {
    api.updateInvoiceKsef.mockRejectedValue(new Error("invalid_transition: accepted -> pending"));
    const onClose = open(invoiceListRow({ ksef_status: "pending" }));
    fireEvent.change(statusSelect(), { target: { value: "rejected" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(api.updateInvoiceKsef.mock.calls[0]?.[0]).toEqual({
      id: INVOICE_IDS.invoice,
      status: "rejected",
      number: "",
      note: "",
    });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.ksef.cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("dziennik zmian KSeF pod formularzem", async () => {
    api.fetchEventInvoice.mockResolvedValue(
      parseInvoiceDocument(
        invoiceDocumentJson({
          ksef_events: [
            {
              from_status: null,
              to_status: "pending",
              from_number: null,
              to_number: null,
              note: "issued",
              created_at: "2026-09-20T10:00:00.000Z",
            },
            {
              from_status: "pending",
              to_status: "rejected",
              from_number: null,
              to_number: null,
              note: "Blad schematu",
              created_at: "2026-09-21T10:00:00.000Z",
            },
          ],
        }),
      ),
    );
    open(invoiceListRow({ ksef_status: "rejected" }));
    expect(await screen.findByText("adminEventInvoices.ksef.history")).toBeTruthy();
    const items = screen.getAllByRole("listitem").map((item) => item.textContent ?? "");
    expect(items).toHaveLength(2);
    expect(items[0]).toContain("adminEventInvoices.ksefStatuses.pending");
    expect(items[0]).not.toContain("issued");
    expect(items[1]).toContain("Blad schematu");
  });
});
