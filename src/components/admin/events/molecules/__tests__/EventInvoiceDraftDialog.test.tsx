// Edytor szkicu dokumentu w oknie. Pilnujemy: stany odczytu (ladowanie,
// odmowa, dokument juz wystawiony), podglad sum na zywo (lustro bazy),
// ostrzezenie o rozjezdzie z zamowieniami, jawny zapis calego formularza,
// wystawienie z potwierdzeniem (i zapis przed nim, gdy sa zmiany), PDF podgladu.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseInvoiceDocument, type EventInvoiceDocument } from "@/lib/events/eventInvoiceDocument";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { INVOICE_IDS, invoiceDocumentJson } from "@/test/events/invoiceFixtures";

const h = vi.hoisted(() => ({ confirm: true, confirmCalls: 0 }));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@/lib/appDialogs", () => ({
  confirmDialog: async () => {
    h.confirmCalls += 1;
    return h.confirm;
  },
}));
const pdf = vi.hoisted(() => ({ downloadEventInvoicePdf: vi.fn() }));
vi.mock("@/lib/events/eventInvoicePdfLabels", () => pdf);
const api = vi.hoisted(() => ({
  fetchEventInvoice: vi.fn(),
  updateInvoiceDraft: vi.fn(),
  issueInvoice: vi.fn(),
}));
vi.mock("@/lib/events/eventInvoicesApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/eventInvoicesApi")>()),
  ...api,
}));

const { toast } = await import("sonner");
const { EventInvoiceDraftDialog } =
  await import("@/components/admin/events/molecules/EventInvoiceDraftDialog");

function draftDoc(json: Parameters<typeof invoiceDocumentJson>[0] = {}): EventInvoiceDocument {
  const parsed = parseInvoiceDocument(
    invoiceDocumentJson({
      ...json,
      invoice: { status: "draft", number: null, ...(json.invoice ?? {}) },
    }),
  );
  if (parsed === null) throw new Error("fixture");
  return parsed;
}

function open(props: Partial<{ onClose: () => void; onIssued: (value: unknown) => void }> = {}) {
  const onClose = props.onClose ?? vi.fn();
  const onIssued = props.onIssued ?? vi.fn();
  renderWithQueryClient(
    <EventInvoiceDraftDialog
      eventId={INVOICE_IDS.event}
      invoiceId={INVOICE_IDS.draft}
      onClose={onClose}
      onIssued={onIssued}
    />,
  );
  return { onClose, onIssued };
}

beforeEach(() => {
  h.confirm = true;
  h.confirmCalls = 0;
  for (const fn of [...Object.values(api), ...Object.values(pdf)]) fn.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe("EventInvoiceDraftDialog", () => {
  it("zamkniete okno nie pyta o dokument", () => {
    renderWithQueryClient(
      <EventInvoiceDraftDialog
        eventId={INVOICE_IDS.event}
        invoiceId={null}
        onClose={vi.fn()}
        onIssued={vi.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.fetchEventInvoice).not.toHaveBeenCalled();
  });

  it("ladowanie, odmowa odczytu, dokument juz wystawiony", async () => {
    api.fetchEventInvoice.mockReturnValue(new Promise(() => {}));
    open();
    expect(screen.getByRole("status").textContent).toBe("adminEventInvoices.loading");
  });

  it("odmowa odczytu", async () => {
    api.fetchEventInvoice.mockRejectedValue(new Error("not_found: x"));
    open();
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("wystawiony dokument jest tylko do odczytu; korekta ma wlasny tytul", async () => {
    api.fetchEventInvoice.mockResolvedValue(
      draftDoc({ invoice: { status: "issued", kind: "correction", number: "KOR/1" } }),
    );
    open();
    expect(await screen.findByText("adminEventInvoices.draft.readOnly")).toBeTruthy();
    expect(screen.getByText("adminEventInvoices.draft.titleCorrection")).toBeTruthy();
  });

  it("podglad sum na zywo, podsumowanie stawek i ostrzezenie o rozjezdzie z zamowieniami", async () => {
    api.fetchEventInvoice.mockResolvedValue(draftDoc());
    open();
    const price = await screen.findByLabelText("adminEventInvoices.draft.line.unitGross", {
      selector: `#invoice-line-${INVOICE_IDS.line1}-price`,
    });
    expect(screen.queryByText(/adminEventInvoices\.draft\.sourcesMismatch/)).toBeNull();
    fireEvent.change(price, { target: { value: "100" } });
    expect(await screen.findByText(/adminEventInvoices\.draft\.sourcesMismatch/)).toBeTruthy();
    fireEvent.change(
      screen.getByLabelText("adminEventInvoices.draft.line.vatRate", {
        selector: `#invoice-line-${INVOICE_IDS.line1}-rate`,
      }),
      { target: { value: "8" } },
    );
    const summary = screen.getByText("adminEventInvoices.draft.vatSummary").parentElement;
    expect(summary?.textContent).toContain("adminEventInvoices.vatRates.8");
    expect(summary?.textContent).toContain("adminEventInvoices.vatRates.23");
  });

  it("dodanie i usuniecie pozycji; nieczytelna kwota pozycji = kreska", async () => {
    api.fetchEventInvoice.mockResolvedValue(draftDoc());
    open();
    const section = (await screen.findByText("adminEventInvoices.draft.linesSection"))
      .parentElement;
    if (section === null) throw new Error("brak sekcji pozycji");
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.draft.addLine" }));
    const lines = within(section).getAllByRole("listitem");
    expect(lines).toHaveLength(3);
    expect(lines[2].textContent).toContain("adminEventInvoices.draft.line.gross: -");
    fireEvent.click(
      screen.getByRole("button", { name: "adminEventInvoices.draft.removeLine(position=1)" }),
    );
    expect(within(section).getAllByRole("listitem")).toHaveLength(2);
  });

  it("zapis z bledami: bledy pozycji i dokumentu, bez zapytania", async () => {
    api.fetchEventInvoice.mockResolvedValue(draftDoc());
    open();
    await screen.findByText("adminEventInvoices.draft.linesSection");
    fireEvent.click(
      screen.getByRole("button", { name: "adminEventInvoices.draft.removeLine(position=1)" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "adminEventInvoices.draft.removeLine(position=1)" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.draft.save" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("adminEventInvoices.draft.errors.fix"),
    );
    expect(screen.getByText("adminEventInvoices.draft.errors.noLines")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.draft.addLine" }));
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.draft.save" }));
    expect(await screen.findByText("adminEventInvoices.draft.errors.lineDescription")).toBeTruthy();
    expect(api.updateInvoiceDraft).not.toHaveBeenCalled();
  });

  it("zapis: caly formularz, toast; odmowa bazy = toast z mapy", async () => {
    api.fetchEventInvoice.mockResolvedValue(draftDoc());
    api.updateInvoiceDraft.mockResolvedValueOnce(INVOICE_IDS.draft);
    open();
    fireEvent.change(await screen.findByLabelText("adminEventInvoices.draft.note"), {
      target: { value: " Uwaga " },
    });
    fireEvent.change(screen.getByLabelText("adminEventInvoices.draft.paymentMethod"), {
      target: { value: "card" },
    });
    fireEvent.change(screen.getByLabelText("adminEventInvoices.draft.locale"), {
      target: { value: "en" },
    });
    fireEvent.change(screen.getByLabelText("adminEventInvoices.draft.saleDate"), {
      target: { value: "2026-09-21" },
    });
    fireEvent.change(screen.getByLabelText("adminEventInvoices.draft.dueDate"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("eventInvoices.buyer.city"), {
      target: { value: "Sopot" },
    });
    fireEvent.change(
      screen.getByLabelText("adminEventInvoices.draft.line.description", {
        selector: `#invoice-line-${INVOICE_IDS.line1}-description`,
      }),
      { target: { value: "Bilet VIP" } },
    );
    fireEvent.change(
      screen.getByLabelText("adminEventInvoices.draft.line.unit", {
        selector: `#invoice-line-${INVOICE_IDS.line1}-unit`,
      }),
      { target: { value: "os." } },
    );
    fireEvent.change(
      screen.getByLabelText("adminEventInvoices.draft.line.quantity", {
        selector: `#invoice-line-${INVOICE_IDS.line1}-quantity`,
      }),
      { target: { value: "2" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.draft.save" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("adminEventInvoices.toasts.saved"),
    );
    const input = api.updateInvoiceDraft.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      id: INVOICE_IDS.invoice,
      note: "Uwaga",
      paymentMethod: "card",
      locale: "en",
      saleDate: "2026-09-21",
      dueDate: null,
      buyer: expect.objectContaining({ city: "Sopot" }),
    });
    expect(input.lines[0]).toMatchObject({
      description: "Bilet VIP",
      unit: "os.",
      quantity: 2,
      unitGrossCents: 12300,
    });
    api.updateInvoiceDraft.mockRejectedValueOnce(new Error("not_draft: x"));
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.draft.save" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it("korekta: pole przyczyny wymagane", async () => {
    api.fetchEventInvoice.mockResolvedValue(
      draftDoc({
        invoice: { kind: "correction", correction_mode: "full", correction_reason: "" },
        sources: [],
      }),
    );
    open();
    const reason = await screen.findByLabelText("adminEventInvoices.draft.correctionReason");
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.draft.save" }));
    expect(await screen.findByText("adminEventInvoices.draft.errors.reasonRequired")).toBeTruthy();
    fireEvent.change(reason, { target: { value: "Zwrot" } });
    api.updateInvoiceDraft.mockResolvedValue(INVOICE_IDS.draft);
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.draft.save" }));
    await waitFor(() => expect(api.updateInvoiceDraft).toHaveBeenCalled());
    expect(api.updateInvoiceDraft.mock.calls[0]?.[0]).toMatchObject({ correctionReason: "Zwrot" });
  });

  it("wystawienie bez zmian: potwierdzenie, numer, zamkniecie", async () => {
    api.fetchEventInvoice.mockResolvedValue(draftDoc());
    api.issueInvoice.mockResolvedValue({ id: INVOICE_IDS.invoice, number: "FV/2026/09/0001" });
    const { onClose, onIssued } = open();
    fireEvent.click(await screen.findByRole("button", { name: "adminEventInvoices.draft.issue" }));
    await waitFor(() =>
      expect(onIssued).toHaveBeenCalledWith({ id: INVOICE_IDS.invoice, number: "FV/2026/09/0001" }),
    );
    expect(onClose).toHaveBeenCalled();
    expect(h.confirmCalls).toBe(1);
    expect(api.updateInvoiceDraft).not.toHaveBeenCalled();
    expect(api.issueInvoice.mock.calls[0]?.[0]).toBe(INVOICE_IDS.invoice);
  });

  it("wystawienie ze zmianami: najpierw zapis; rezygnacja w potwierdzeniu nic nie wystawia", async () => {
    api.fetchEventInvoice.mockResolvedValue(draftDoc());
    api.updateInvoiceDraft.mockResolvedValue(INVOICE_IDS.draft);
    h.confirm = false;
    open();
    fireEvent.change(await screen.findByLabelText("adminEventInvoices.draft.note"), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.draft.issue" }));
    await waitFor(() => expect(h.confirmCalls).toBe(1));
    expect(api.updateInvoiceDraft).toHaveBeenCalledTimes(1);
    expect(api.issueInvoice).not.toHaveBeenCalled();
  });

  it("wystawienie: zapis sie nie udal = bez pytania; odmowa wystawienia = toast", async () => {
    api.fetchEventInvoice.mockResolvedValue(draftDoc());
    api.updateInvoiceDraft.mockRejectedValue(new Error("invalid_tax_id: x"));
    open();
    fireEvent.change(await screen.findByLabelText("adminEventInvoices.draft.note"), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.draft.issue" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(h.confirmCalls).toBe(0);
  });

  it("wystawianie w toku: przycisk z opisem stanu i blokada", async () => {
    api.fetchEventInvoice.mockResolvedValue(draftDoc());
    api.issueInvoice.mockReturnValue(new Promise(() => {}));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "adminEventInvoices.draft.issue" }));
    const issuing = await screen.findByRole("button", { name: "adminEventInvoices.draft.issuing" });
    expect(issuing).toHaveProperty("disabled", true);
  });

  it("odmowa wystawienia (MoR) = toast, okno zostaje", async () => {
    api.fetchEventInvoice.mockResolvedValue(draftDoc());
    api.issueInvoice.mockRejectedValue(new Error("mor_seller_conflict: x"));
    const { onClose } = open();
    fireEvent.click(await screen.findByRole("button", { name: "adminEventInvoices.draft.issue" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("podglad PDF i zamkniecie", async () => {
    api.fetchEventInvoice.mockResolvedValue(draftDoc());
    const { onClose } = open();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      await within(dialog).findByRole("button", { name: "adminEventInvoices.draft.preview" }),
    );
    expect(pdf.downloadEventInvoicePdf).toHaveBeenCalledWith(
      expect.objectContaining({ id: INVOICE_IDS.invoice }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "adminEventInvoices.draft.close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
