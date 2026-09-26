// Dokumenty wydarzenia w zakladkach. Akcje wynikaja ze STANU dokumentu:
// szkic - edycja, wystawienie, porzucenie; wystawiona faktura - PDF, korekta,
// KSeF, zaplata, anulowanie z powodem; proforma - faktura koncowa; korekta -
// bez zaplaty. Filtr "do wyslania w KSeF" = wystawione w stanie `pending`.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";
import { freezeClock } from "@/test/time";
import { INVOICE_IDS, invoiceListRow } from "@/test/events/invoiceFixtures";

freezeClock("2026-09-26T10:00:00.000Z");

const h = vi.hoisted(() => ({
  confirm: true,
  prompt: "Pomylka" as string | null,
  confirmCalls: [] as Array<{ description?: string }>,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/appDialogs", () => ({
  confirmDialog: async (request: { description?: string }) => {
    h.confirmCalls.push(request);
    return h.confirm;
  },
  promptDialog: async () => h.prompt,
}));
const pdf = vi.hoisted(() => ({ downloadEventInvoicePdf: vi.fn() }));
vi.mock("@/lib/events/eventInvoicePdfLabels", () => pdf);
const api = vi.hoisted(() => ({
  fetchEventInvoices: vi.fn(),
  fetchEventInvoice: vi.fn(),
  issueInvoice: vi.fn(),
  cancelInvoice: vi.fn(),
  invoiceFromProforma: vi.fn(),
  setInvoicePaid: vi.fn(),
}));
vi.mock("@/lib/events/eventInvoicesApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/eventInvoicesApi")>()),
  ...api,
}));

const { toast } = await import("sonner");
const { EventInvoiceDocumentsList } =
  await import("@/components/admin/events/molecules/EventInvoiceDocumentsList");
const { documentsForTab } = await import("@/lib/events/eventInvoiceViews");

const ISSUED = invoiceListRow({ paid_at: null });
const PAID = invoiceListRow({
  id: "paid",
  number: "FV/2026/09/0002",
  ksef_status: "accepted",
  buyer_tax_id: "",
});
const DRAFT = invoiceListRow({
  id: INVOICE_IDS.draft,
  status: "draft",
  number: null,
  issue_date: null,
  issued_at: null,
  ksef_status: "not_applicable",
});
const PROFORMA = invoiceListRow({
  id: INVOICE_IDS.proforma,
  kind: "proforma",
  number: "PRO/2026/09/0001",
  ksef_status: "not_applicable",
});
const CONVERTED = invoiceListRow({
  id: "pro2",
  kind: "proforma",
  number: "PRO/2026/09/0002",
  converted_invoice_id: INVOICE_IDS.invoice,
});
const CORRECTION = invoiceListRow({
  id: INVOICE_IDS.correction,
  kind: "correction",
  number: "KOR/2026/09/0001",
  corrects_number: "FV/2026/09/0001",
  correction_mode: "full",
});
const CANCELLED = invoiceListRow({
  id: "cancelled",
  status: "cancelled",
  number: null,
  cancelled_at: "2026-09-21T10:00:00Z",
});
const ROWS = [ISSUED, PAID, DRAFT, PROFORMA, CONVERTED, CORRECTION, CANCELLED];

function renderTab(tab: "issued" | "drafts" | "corrections") {
  const handlers = { onEdit: vi.fn(), onCorrect: vi.fn(), onKsef: vi.fn(), onIssued: vi.fn() };
  const view = renderWithQueryClient(
    <EventInvoiceDocumentsList eventId={INVOICE_IDS.event} tab={tab} {...handlers} />,
  );
  return { ...view, ...handlers };
}

function rowFor(text: string): HTMLElement {
  const node = screen.getByText(text, { exact: false }).closest("li");
  if (node === null) throw new Error(`brak wiersza ${text}`);
  return node;
}

beforeEach(() => {
  h.confirm = true;
  h.prompt = "Pomylka";
  h.confirmCalls = [];
  for (const fn of [...Object.values(api), ...Object.values(pdf)]) fn.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  api.fetchEventInvoices.mockResolvedValue(ROWS);
});

describe("documentsForTab", () => {
  it("wystawione faktury, szkice z proformami, korekty", () => {
    expect(documentsForTab(ROWS, "issued").map((row) => row.id)).toEqual([
      ISSUED.id,
      "paid",
      "cancelled",
    ]);
    expect(documentsForTab(ROWS, "drafts").map((row) => row.id)).toEqual([
      DRAFT.id,
      PROFORMA.id,
      "pro2",
    ]);
    expect(documentsForTab(ROWS, "corrections").map((row) => row.id)).toEqual([CORRECTION.id]);
  });
});

describe("EventInvoiceDocumentsList", () => {
  it("ladowanie, odmowa, pusta zakladka", async () => {
    api.fetchEventInvoices.mockReturnValueOnce(new Promise(() => {}));
    const first = renderTab("issued");
    expect(screen.getByText("adminEventInvoices.loading")).toBeTruthy();
    first.unmount();
    api.fetchEventInvoices.mockRejectedValueOnce(new Error("forbidden: x"));
    const second = renderTab("issued");
    expect(await screen.findByText(/.+/, { selector: "p.text-destructive" })).toBeTruthy();
    second.unmount();
    api.fetchEventInvoices.mockResolvedValueOnce([]);
    renderTab("corrections");
    expect(await screen.findByText("adminEventInvoices.documents.empty")).toBeTruthy();
  });

  it("wystawione: stany, KSeF, zaplata, akcje; filtr KSeF", async () => {
    const { onCorrect, onKsef } = renderTab("issued");
    const issued = await waitFor(() => rowFor("FV/2026/09/0001"));
    expect(issued.textContent).toContain("adminEventInvoices.kinds.invoice FV/2026/09/0001");
    expect(issued.textContent).toContain("Acme Sp. z o.o. · 5260250274 · 2026-09-20");
    expect(issued.textContent).toContain("adminEventInvoices.statuses.issued");
    expect(issued.textContent).toContain("adminEventInvoices.ksefStatuses.pending");
    expect(issued.textContent).toContain("adminEventInvoices.documents.unpaid");
    const paid = rowFor("FV/2026/09/0002");
    expect(paid.textContent).toContain("adminEventInvoices.documents.paidOn(date=2026-09-20)");
    expect(paid.textContent).not.toContain("· 5260250274");
    const cancelled = rowFor("adminEventInvoices.documents.draftNumber");
    expect(
      within(cancelled).queryByRole("button", { name: "adminEventInvoices.documents.cancel" }),
    ).toBeNull();
    fireEvent.click(
      within(issued).getByRole("button", { name: "adminEventInvoices.documents.correct" }),
    );
    expect(onCorrect).toHaveBeenCalledWith(ISSUED.id);
    fireEvent.click(
      within(issued).getByRole("button", { name: "adminEventInvoices.documents.ksef" }),
    );
    expect(onKsef).toHaveBeenCalledWith(ISSUED);
    fireEvent.click(screen.getByLabelText("adminEventInvoices.documents.ksefOnly"));
    expect(screen.queryByText("FV/2026/09/0002", { exact: false })).toBeNull();
    expect(screen.getByText("FV/2026/09/0001", { exact: false })).toBeTruthy();
  });

  it("zaplata: oznaczenie z zegarem i zdjecie oznaczenia; odmowa = toast", async () => {
    api.setInvoicePaid.mockResolvedValue("x");
    renderTab("issued");
    const issued = await waitFor(() => rowFor("FV/2026/09/0001"));
    fireEvent.click(
      within(issued).getByRole("button", { name: "adminEventInvoices.documents.markPaid" }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("adminEventInvoices.toasts.paidSaved"),
    );
    expect(api.setInvoicePaid.mock.calls[0]?.[0]).toEqual({
      id: ISSUED.id,
      paidAt: "2026-09-26T10:00:00.000Z",
    });
    fireEvent.click(
      within(rowFor("FV/2026/09/0002")).getByRole("button", {
        name: "adminEventInvoices.documents.markUnpaid",
      }),
    );
    await waitFor(() => expect(api.setInvoicePaid).toHaveBeenCalledTimes(2));
    expect(api.setInvoicePaid.mock.calls[1]?.[0]).toEqual({ id: "paid", paidAt: null });
    api.setInvoicePaid.mockRejectedValueOnce(new Error("not_found: x"));
    fireEvent.click(
      within(rowFor("FV/2026/09/0001")).getByRole("button", {
        name: "adminEventInvoices.documents.markPaid",
      }),
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it("anulowanie wystawionego: powod z okna; rezygnacja nic nie robi; odmowa = toast", async () => {
    api.cancelInvoice.mockResolvedValueOnce(ISSUED.id);
    renderTab("issued");
    const issued = await waitFor(() => rowFor("FV/2026/09/0001"));
    fireEvent.click(
      within(issued).getByRole("button", { name: "adminEventInvoices.documents.cancel" }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("adminEventInvoices.toasts.cancelled"),
    );
    expect(api.cancelInvoice).toHaveBeenCalledWith(ISSUED.id, "Pomylka");
    h.prompt = null;
    fireEvent.click(
      within(rowFor("FV/2026/09/0001")).getByRole("button", {
        name: "adminEventInvoices.documents.cancel",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.cancelInvoice).toHaveBeenCalledTimes(1);
    h.prompt = "Pomylka";
    api.cancelInvoice.mockRejectedValueOnce(new Error("ksef_locked: x"));
    fireEvent.click(
      within(rowFor("FV/2026/09/0002")).getByRole("button", {
        name: "adminEventInvoices.documents.cancel",
      }),
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it("PDF: pobranie dokumentu; awaria = toast", async () => {
    const doc = { id: ISSUED.id };
    api.fetchEventInvoice.mockResolvedValueOnce(doc);
    renderTab("issued");
    const issued = await waitFor(() => rowFor("FV/2026/09/0001"));
    fireEvent.click(
      within(issued).getByRole("button", { name: "adminEventInvoices.documents.pdf" }),
    );
    await waitFor(() => expect(pdf.downloadEventInvoicePdf).toHaveBeenCalledWith(doc));
    api.fetchEventInvoice.mockRejectedValueOnce(new Error("boom"));
    fireEvent.click(
      within(issued).getByRole("button", { name: "adminEventInvoices.documents.pdf" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("adminEventInvoices.toasts.pdfFailed"),
    );
  });

  it("szkice: edycja, wystawienie z potwierdzeniem, porzucenie szkicu bez powodu", async () => {
    api.issueInvoice.mockResolvedValue({ id: DRAFT.id, number: "FV/2026/09/0003" });
    api.cancelInvoice.mockResolvedValue(DRAFT.id);
    const { onEdit, onIssued } = renderTab("drafts");
    const draft = await waitFor(() => rowFor("adminEventInvoices.documents.draftNumber"));
    expect(screen.queryByLabelText("adminEventInvoices.documents.ksefOnly")).toBeNull();
    fireEvent.click(
      within(draft).getByRole("button", { name: "adminEventInvoices.documents.edit" }),
    );
    expect(onEdit).toHaveBeenCalledWith(DRAFT.id);
    fireEvent.click(
      within(draft).getByRole("button", { name: "adminEventInvoices.documents.issue" }),
    );
    await waitFor(() =>
      expect(onIssued).toHaveBeenCalledWith({ id: DRAFT.id, number: "FV/2026/09/0003" }),
    );
    fireEvent.click(
      within(draft).getByRole("button", { name: "adminEventInvoices.documents.cancel" }),
    );
    await waitFor(() => expect(api.cancelInvoice).toHaveBeenCalledWith(DRAFT.id, ""));
    expect(h.confirmCalls.map((call) => call.description)).toEqual([
      "adminEventInvoices.documents.issueBody",
      "adminEventInvoices.documents.cancelDraftBody",
    ]);
  });

  it("szkice: rezygnacje w potwierdzeniach; odmowa wystawienia = toast", async () => {
    h.confirm = false;
    renderTab("drafts");
    const draft = await waitFor(() => rowFor("adminEventInvoices.documents.draftNumber"));
    fireEvent.click(
      within(draft).getByRole("button", { name: "adminEventInvoices.documents.issue" }),
    );
    fireEvent.click(
      within(draft).getByRole("button", { name: "adminEventInvoices.documents.cancel" }),
    );
    await waitFor(() => expect(h.confirmCalls).toHaveLength(2));
    expect(api.issueInvoice).not.toHaveBeenCalled();
    expect(api.cancelInvoice).not.toHaveBeenCalled();
    h.confirm = true;
    api.issueInvoice.mockRejectedValue(new Error("invalid_buyer_address: x"));
    fireEvent.click(
      within(draft).getByRole("button", { name: "adminEventInvoices.documents.issue" }),
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it("proforma: faktura koncowa otwiera edytor; przerobiona - bez przycisku; bez KSeF", async () => {
    api.invoiceFromProforma.mockResolvedValueOnce(INVOICE_IDS.draft);
    const { onEdit } = renderTab("drafts");
    const proforma = await waitFor(() => rowFor("PRO/2026/09/0001"));
    expect(
      within(proforma).queryByRole("button", { name: "adminEventInvoices.documents.ksef" }),
    ).toBeNull();
    expect(
      within(rowFor("PRO/2026/09/0002")).queryByRole("button", {
        name: "adminEventInvoices.documents.fromProforma",
      }),
    ).toBeNull();
    fireEvent.click(
      within(proforma).getByRole("button", { name: "adminEventInvoices.documents.fromProforma" }),
    );
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith(INVOICE_IDS.draft));
    expect(toast.success).toHaveBeenCalledWith("adminEventInvoices.toasts.draftCreated");
    api.invoiceFromProforma.mockRejectedValueOnce(new Error("proforma_already_converted: x"));
    fireEvent.click(
      within(proforma).getByRole("button", { name: "adminEventInvoices.documents.fromProforma" }),
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it("korekty: numer korygowanej faktury, KSeF, bez zaplaty i bez korekty korekty", async () => {
    renderTab("corrections");
    const correction = await waitFor(() => rowFor("KOR/2026/09/0001"));
    expect(correction.textContent).toContain(
      "adminEventInvoices.documents.corrects(number=FV/2026/09/0001)",
    );
    expect(
      within(correction).getByRole("button", { name: "adminEventInvoices.documents.ksef" }),
    ).toBeTruthy();
    expect(
      within(correction).queryByRole("button", { name: "adminEventInvoices.documents.markPaid" }),
    ).toBeNull();
    expect(
      within(correction).queryByRole("button", { name: "adminEventInvoices.documents.correct" }),
    ).toBeNull();
    expect(within(correction).getByRole("group").getAttribute("aria-label")).toBe(
      "adminEventInvoices.documents.actionsFor(number=KOR/2026/09/0001)",
    );
  });

  it("dostepnosc: brak naruszen axe", async () => {
    const { container } = renderTab("issued");
    await waitFor(() => rowFor("FV/2026/09/0001"));
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
