// Ekran faktur studia: piec zakladek, dwa ostrzezenia nad nimi (fakturowanie
// wylaczone, kasa operatora = MoR) i powiadomienie kupujacych po wystawieniu
// (ile maili poszlo). Molekuly maja wlasne testy - tu sa zastapione atrapami,
// ktore oddaja wolaniami zwrotnymi to, co zrobilby uzytkownik.
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IssuePendingResult, IssuedInvoice } from "@/lib/events/eventInvoicesApi";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { INVOICE_IDS, invoiceListRow } from "@/test/events/invoiceFixtures";

const h = vi.hoisted(() => ({
  checkout: undefined as { automatic_tax: boolean } | undefined,
  notify: vi.fn(),
  props: {} as Record<string, Record<string, unknown>>,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/tabs", async () => (await import("@/test/reactStubs")).radixTabsStub(await import("react")));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => h.notify,
}));
vi.mock("@/lib/events/eventInvoiceNotify.functions", () => ({ notifyEventInvoicesIssued: {} }));
vi.mock("@/hooks/useCheckoutSettings", () => ({
  useCheckoutSettings: () => ({ data: h.checkout }),
}));
const api = vi.hoisted(() => ({ fetchInvoiceSettings: vi.fn() }));
vi.mock("@/lib/events/eventInvoicesApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/eventInvoicesApi")>()),
  ...api,
}));

function stub(name: string) {
  return (props: Record<string, unknown>) => {
    h.props[name] = props;
    return <div data-testid={name} />;
  };
}
vi.mock("@/components/admin/events/molecules/EventInvoiceCandidatesList", () => ({
  EventInvoiceCandidatesList: stub("candidates"),
}));
vi.mock("@/components/admin/events/molecules/EventInvoiceDocumentsList", () => ({
  EventInvoiceDocumentsList: (props: Record<string, unknown>) => {
    h.props[`documents-${String(props.tab)}`] = props;
    return <div data-testid={`documents-${String(props.tab)}`} />;
  },
}));
vi.mock("@/components/admin/events/molecules/EventInvoiceSettingsForm", () => ({
  EventInvoiceSettingsForm: stub("settings"),
}));
vi.mock("@/components/admin/events/molecules/EventInvoiceDraftDialog", () => ({
  EventInvoiceDraftDialog: stub("draft"),
}));
vi.mock("@/components/admin/events/molecules/EventInvoiceCorrectionDialog", () => ({
  EventInvoiceCorrectionDialog: stub("correction"),
}));
vi.mock("@/components/admin/events/molecules/EventInvoiceKsefDialog", () => ({
  EventInvoiceKsefDialog: stub("ksef"),
}));

const { toast } = await import("sonner");
const { EventInvoicesPanel } = await import("@/components/admin/events/organisms/EventInvoicesPanel");

function call<T>(name: string, prop: string, value: T): void {
  const handler = h.props[name]?.[prop];
  if (typeof handler !== "function") throw new Error(`brak ${name}.${prop}`);
  act(() => {
    handler(value);
  });
}

beforeEach(() => {
  h.checkout = { automatic_tax: true };
  h.notify.mockReset();
  h.props = {};
  api.fetchInvoiceSettings.mockReset();
  api.fetchInvoiceSettings.mockResolvedValue({ enabled: true });
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe("EventInvoicesPanel", () => {
  it("zakladka startowa, wlaczone fakturowanie przekazane liscie, przelaczanie zakladek", async () => {
    renderWithQueryClient(<EventInvoicesPanel eventId={INVOICE_IDS.event} />);
    expect(screen.getByTestId("candidates")).toBeTruthy();
    await waitFor(() => expect(h.props.candidates?.enabled).toBe(true));
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "adminEventInvoices.tabs.candidates",
      "adminEventInvoices.tabs.issued",
      "adminEventInvoices.tabs.drafts",
      "adminEventInvoices.tabs.corrections",
      "adminEventInvoices.tabs.settings",
    ]);
    fireEvent.click(screen.getByRole("tab", { name: "adminEventInvoices.tabs.corrections" }));
    expect(screen.getByTestId("documents-corrections")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "adminEventInvoices.tabs.settings" }));
    expect(screen.getByTestId("settings")).toBeTruthy();
  });

  it("fakturowanie wylaczone: ostrzezenie z przejsciem do ustawien", async () => {
    api.fetchInvoiceSettings.mockResolvedValue({ enabled: false });
    renderWithQueryClient(<EventInvoicesPanel eventId={INVOICE_IDS.event} />);
    expect(await screen.findByText("adminEventInvoices.disabled.title")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.disabled.action" }));
    expect(screen.getByTestId("settings")).toBeTruthy();
  });

  it("kasa operatora (MoR): ostrzezenie; kasa wlasna i brak danych kasy: bez ostrzezenia", async () => {
    h.checkout = { automatic_tax: false };
    const first = renderWithQueryClient(<EventInvoicesPanel eventId={INVOICE_IDS.event} />);
    expect(screen.getByRole("note").textContent).toContain("adminEventInvoices.mor.title");
    first.unmount();
    h.checkout = undefined;
    const second = renderWithQueryClient(<EventInvoicesPanel eventId={INVOICE_IDS.event} />);
    expect(screen.queryByRole("note")).toBeNull();
    second.unmount();
    h.checkout = { automatic_tax: true };
    renderWithQueryClient(<EventInvoicesPanel eventId={INVOICE_IDS.event} />);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("wystawienie z listy: toast z numerem i powiadomienie kupujacego", async () => {
    h.notify.mockResolvedValue({ sent: 1, skipped: 0, failed: 0 });
    renderWithQueryClient(<EventInvoicesPanel eventId={INVOICE_IDS.event} />);
    fireEvent.click(screen.getByRole("tab", { name: "adminEventInvoices.tabs.drafts" }));
    const issued: IssuedInvoice = { id: INVOICE_IDS.invoice, number: "FV/2026/09/0001" };
    call("documents-drafts", "onIssued", issued);
    expect(toast.success).toHaveBeenCalledWith("adminEventInvoices.toasts.issued(number=FV/2026/09/0001)");
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith({ data: { invoiceIds: [INVOICE_IDS.invoice] } }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("adminEventInvoices.toasts.notified(count=1)"));
  });

  it("masowe wystawienie: jedno powiadomienie na wszystkie; nieudane maile i awaria = toast", async () => {
    h.notify.mockResolvedValueOnce({ sent: 0, skipped: 1, failed: 1 });
    renderWithQueryClient(<EventInvoicesPanel eventId={INVOICE_IDS.event} />);
    const result: IssuePendingResult = {
      issued: [
        { id: "a", number: "FV/1" },
        { id: "b", number: "FV/2" },
      ],
      failed: [],
    };
    call("candidates", "onBulkIssued", result);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("adminEventInvoices.toasts.notifyFailed"));
    expect(h.notify).toHaveBeenCalledWith({ data: { invoiceIds: ["a", "b"] } });
    expect(toast.success).not.toHaveBeenCalled();
    h.notify.mockRejectedValueOnce(new Error("network"));
    call("candidates", "onBulkIssued", { issued: [{ id: "c", number: "FV/3" }], failed: [] });
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));
    call("candidates", "onBulkIssued", { issued: [], failed: [] });
    expect(h.notify).toHaveBeenCalledTimes(2);
  });

  it("okna: szkic z kandydatow, korekta -> szkic korekty, KSeF; zamkniecia", async () => {
    renderWithQueryClient(<EventInvoicesPanel eventId={INVOICE_IDS.event} />);
    expect(h.props.draft?.invoiceId).toBeNull();
    call("candidates", "onDraftCreated", INVOICE_IDS.draft);
    expect(h.props.draft?.invoiceId).toBe(INVOICE_IDS.draft);
    call("draft", "onClose", undefined);
    expect(h.props.draft?.invoiceId).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "adminEventInvoices.tabs.issued" }));
    call("documents-issued", "onCorrect", INVOICE_IDS.invoice);
    expect(h.props.correction?.invoiceId).toBe(INVOICE_IDS.invoice);
    call("correction", "onCreated", INVOICE_IDS.correction);
    expect(h.props.correction?.invoiceId).toBeNull();
    expect(h.props.draft?.invoiceId).toBe(INVOICE_IDS.correction);
    call("documents-issued", "onCorrect", INVOICE_IDS.invoice);
    call("correction", "onClose", undefined);
    expect(h.props.correction?.invoiceId).toBeNull();
    call("documents-issued", "onEdit", INVOICE_IDS.proforma);
    expect(h.props.draft?.invoiceId).toBe(INVOICE_IDS.proforma);
    const row = invoiceListRow();
    call("documents-issued", "onKsef", row);
    expect(h.props.ksef?.row).toBe(row);
    call("ksef", "onClose", undefined);
    expect(h.props.ksef?.row).toBeNull();
    h.notify.mockResolvedValue({ sent: 0, skipped: 0, failed: 0 });
    call("draft", "onIssued", { id: "x", number: "FV/9" });
    await waitFor(() => expect(h.notify).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledTimes(1);
  });
});
