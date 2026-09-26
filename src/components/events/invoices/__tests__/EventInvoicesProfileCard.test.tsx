// "Faktury za wydarzenia" w profilu kupujacego: dokumenty z PDF w jezyku
// faktury, zamowienia bez faktury z prosba do konca terminu, wycofanie
// prosby. Dane prywatne - bez sesji zadnego zapytania.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";
import { INVOICE_IDS, myInvoiceRow, myInvoiceSourceRow } from "@/test/events/invoiceFixtures";

const h = vi.hoisted(() => ({ session: null as { user: { id: string } } | null, lang: "pl" }));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: h.session }) }));

const api = vi.hoisted(() => ({
  fetchMyInvoiceSources: vi.fn(),
  fetchMyInvoices: vi.fn(),
  fetchMyInvoice: vi.fn(),
  saveInvoiceRequest: vi.fn(),
  cancelInvoiceRequest: vi.fn(),
}));
vi.mock("@/lib/events/myEventInvoicesApi", () => api);
const pdf = vi.hoisted(() => ({ downloadEventInvoicePdf: vi.fn() }));
vi.mock("@/lib/events/eventInvoicePdfLabels", () => pdf);

const { toast } = await import("sonner");
const { EventInvoicesProfileCard } =
  await import("@/components/events/invoices/organisms/EventInvoicesProfileCard");

beforeEach(() => {
  h.session = { user: { id: "u" } };
  h.lang = "pl";
  for (const fn of [...Object.values(api), ...Object.values(pdf)]) fn.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  api.fetchMyInvoices.mockResolvedValue([]);
  api.fetchMyInvoiceSources.mockResolvedValue([]);
});

describe("EventInvoicesProfileCard", () => {
  it("bez sesji: nic nie pyta, puste listy", async () => {
    h.session = null;
    renderWithQueryClient(<EventInvoicesProfileCard />);
    expect(screen.getByText("eventInvoices.profile.documentsEmpty")).toBeTruthy();
    expect(screen.getByText("eventInvoices.profile.ordersEmpty")).toBeTruthy();
    expect(api.fetchMyInvoices).not.toHaveBeenCalled();
    expect(api.fetchMyInvoiceSources).not.toHaveBeenCalled();
  });

  it("wczytywanie i blad odczytu", async () => {
    api.fetchMyInvoices.mockReturnValue(new Promise(() => {}));
    const { unmount } = renderWithQueryClient(<EventInvoicesProfileCard />);
    expect(screen.getByRole("status").textContent).toContain("eventInvoices.profile.loading");
    unmount();
    api.fetchMyInvoices.mockRejectedValue(new Error("boom"));
    renderWithQueryClient(<EventInvoicesProfileCard />);
    expect((await screen.findByRole("alert")).textContent).toBe("eventInvoices.profile.loadFailed");
  });

  it("dokumenty: rodzaj, numer, anulowanie, korekta, termin, pobranie PDF", async () => {
    api.fetchMyInvoices.mockResolvedValue([
      myInvoiceRow({ paid_at: null, due_date: "2026-10-04" }),
      myInvoiceRow({
        id: INVOICE_IDS.proforma,
        kind: "proforma",
        number: "PRO/2026/09/0001",
        status: "cancelled",
      }),
      myInvoiceRow({
        id: INVOICE_IDS.correction,
        kind: "correction",
        number: "KOR/2026/09/0001",
        corrects_number: "FV/2026/09/0001",
        gross_cents: -24601,
      }),
    ]);
    const doc = { id: INVOICE_IDS.invoice };
    api.fetchMyInvoice.mockResolvedValue(doc);
    renderWithQueryClient(<EventInvoicesProfileCard />);
    const list = await screen.findByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain("eventInvoices.kinds.invoice FV/2026/09/0001");
    expect(items[0].textContent).toContain("eventInvoices.profile.dueDate(date=2026-10-04)");
    expect(items[0].textContent).toContain("Kongres 27 · 2026-09-20");
    expect(items[1].textContent).toContain("eventInvoices.kinds.proforma PRO/2026/09/0001");
    expect(items[1].textContent).toContain("eventInvoices.statuses.cancelled");
    expect(items[2].textContent).toContain(
      "eventInvoices.profile.correctionOf(number=FV/2026/09/0001)",
    );
    expect(items[2].querySelector("data")?.getAttribute("value")).toBe("-24601:PLN");
    fireEvent.click(
      within(items[0]).getByRole("button", { name: "eventInvoices.profile.download" }),
    );
    await waitFor(() => expect(pdf.downloadEventInvoicePdf).toHaveBeenCalledWith(doc));
    expect(api.fetchMyInvoice).toHaveBeenCalledWith(INVOICE_IDS.invoice);
  });

  it("angielski interfejs: angielski tytul wydarzenia; nieudany PDF = toast", async () => {
    h.lang = "en";
    api.fetchMyInvoices.mockResolvedValue([myInvoiceRow({ kind: "receipt" })]);
    api.fetchMyInvoice.mockRejectedValue(new Error("not_found"));
    renderWithQueryClient(<EventInvoicesProfileCard />);
    const list = await screen.findByRole("list");
    expect(list.textContent).toContain("Congress 27");
    expect(list.textContent).toContain("eventInvoices.kinds.invoice");
    fireEvent.click(screen.getByRole("button", { name: "eventInvoices.profile.download" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("eventInvoices.profile.downloadFailed"),
    );
    expect(pdf.downloadEventInvoicePdf).not.toHaveBeenCalled();
  });

  it("angielski interfejs: nazwa pozycji po angielsku, a bez niej po polsku", async () => {
    h.lang = "en";
    api.fetchMyInvoiceSources.mockResolvedValue([
      myInvoiceSourceRow({ label_en: "Standard EN" }),
      myInvoiceSourceRow({
        source_id: "bez-en",
        label_en: "",
        label_pl: "Tylko PL",
        event_title_en: "",
      }),
    ]);
    renderWithQueryClient(<EventInvoicesProfileCard />);
    const items = await screen.findAllByRole("listitem");
    expect(items[0].textContent).toContain("Standard EN");
    expect(items[1].textContent).toContain("Tylko PL");
    expect(items[1].textContent).toContain("Kongres 27");
  });

  it("pobieranie w toku blokuje przycisk", async () => {
    api.fetchMyInvoices.mockResolvedValue([myInvoiceRow()]);
    api.fetchMyInvoice.mockReturnValue(new Promise(() => {}));
    renderWithQueryClient(<EventInvoicesProfileCard />);
    fireEvent.click(await screen.findByRole("button", { name: "eventInvoices.profile.download" }));
    const busy = await screen.findByRole("button", { name: "eventInvoices.profile.downloading" });
    expect(busy).toHaveProperty("disabled", true);
  });

  it("zamowienia bez faktury: termin, zamkniete okno, nieoplacone, pakiet; wystawione pominiete", async () => {
    api.fetchMyInvoiceSources.mockResolvedValue([
      myInvoiceSourceRow(),
      myInvoiceSourceRow({
        source_id: INVOICE_IDS.packageOrder,
        source_kind: "package_order",
        label_pl: "Firmowy 5",
        seats: 5,
        payment_state: "unpaid",
        paid_at: null,
        request_deadline: null,
      }),
      myInvoiceSourceRow({
        source_id: "stary",
        can_request: false,
        request_deadline: "2026-05-31",
      }),
      myInvoiceSourceRow({
        source_id: "wystawiony",
        invoice_id: INVOICE_IDS.invoice,
        invoice_number: "FV/1",
      }),
    ]);
    renderWithQueryClient(<EventInvoicesProfileCard />);
    const lists = await screen.findAllByRole("list");
    const orders = within(lists[0]).getAllByRole("listitem");
    expect(orders).toHaveLength(3);
    expect(orders[0].textContent).toContain("eventInvoices.profile.deadline(date=2026-12-31)");
    expect(orders[0].textContent).toContain("eventInvoices.profile.seats(count=2)");
    expect(orders[1].textContent).toContain("eventInvoices.profile.packageLabel(name=Firmowy 5)");
    expect(orders[1].textContent).toContain("eventInvoices.profile.unpaid");
    expect(orders[2].textContent).toContain("eventInvoices.profile.windowClosed(date=2026-05-31)");
    expect(within(orders[2]).queryByRole("button")).toBeNull();
  });

  it("prosba: okno z danymi pustymi albo z zapisanej prosby; zapis zamyka okno", async () => {
    api.fetchMyInvoiceSources.mockResolvedValue([
      myInvoiceSourceRow(),
      myInvoiceSourceRow({
        source_id: INVOICE_IDS.packageOrder,
        source_kind: "package_order",
        request_id: INVOICE_IDS.request,
        request_status: "pending",
        buyer_name: "Acme",
        buyer_tax_id: "5260250274",
        buyer_country: "PL",
        buyer_address: "ul. Morska 5",
        buyer_postal_code: "80-001",
        buyer_city: "Gdansk",
      }),
    ]);
    api.saveInvoiceRequest.mockResolvedValue(INVOICE_IDS.request);
    renderWithQueryClient(<EventInvoicesProfileCard />);
    fireEvent.click(await screen.findByRole("button", { name: "eventInvoices.profile.request" }));
    expect((screen.getByLabelText("eventInvoices.buyer.name") as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "eventInvoices.profile.close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("eventInvoices.profile.requestPending")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "eventInvoices.profile.editRequest" }));
    expect((screen.getByLabelText("eventInvoices.buyer.name") as HTMLInputElement).value).toBe(
      "Acme",
    );
    fireEvent.click(screen.getByRole("button", { name: "eventInvoices.profile.submit" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("eventInvoices.request.saved"));
    expect(api.saveInvoiceRequest).toHaveBeenCalledWith(
      { packageOrderId: INVOICE_IDS.packageOrder },
      expect.objectContaining({ name: "Acme" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("prosba do zapisu: cel registrationId", async () => {
    api.fetchMyInvoiceSources.mockResolvedValue([
      myInvoiceSourceRow({
        request_id: INVOICE_IDS.request,
        request_status: "pending",
        buyer_name: "Acme",
        buyer_tax_id: "5260250274",
        buyer_country: "PL",
        buyer_address: "ul. Morska 5",
        buyer_postal_code: "80-001",
        buyer_city: "Gdansk",
      }),
    ]);
    api.saveInvoiceRequest.mockResolvedValue(INVOICE_IDS.request);
    renderWithQueryClient(<EventInvoicesProfileCard />);
    fireEvent.click(
      await screen.findByRole("button", { name: "eventInvoices.profile.editRequest" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "eventInvoices.profile.submit" }));
    await waitFor(() =>
      expect(api.saveInvoiceRequest).toHaveBeenCalledWith(
        { registrationId: INVOICE_IDS.registration },
        expect.objectContaining({ name: "Acme" }),
      ),
    );
  });

  it("wycofanie prosby: sukces i odmowa jako toast", async () => {
    api.fetchMyInvoiceSources.mockResolvedValue([
      myInvoiceSourceRow({ request_id: INVOICE_IDS.request, request_status: "pending" }),
    ]);
    api.cancelInvoiceRequest.mockResolvedValueOnce(INVOICE_IDS.request);
    renderWithQueryClient(<EventInvoicesProfileCard />);
    fireEvent.click(
      await screen.findByRole("button", { name: "eventInvoices.profile.cancelRequest" }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("eventInvoices.profile.requestCancelled"),
    );
    expect(api.cancelInvoiceRequest.mock.calls[0]?.[0]).toBe(INVOICE_IDS.request);
    api.cancelInvoiceRequest.mockRejectedValueOnce(new Error("not_found: x"));
    fireEvent.click(
      await screen.findByRole("button", { name: "eventInvoices.profile.cancelRequest" }),
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it("dostepnosc: brak naruszen axe", async () => {
    api.fetchMyInvoices.mockResolvedValue([myInvoiceRow()]);
    api.fetchMyInvoiceSources.mockResolvedValue([myInvoiceSourceRow()]);
    const { container } = renderWithQueryClient(<EventInvoicesProfileCard />);
    await screen.findAllByRole("listitem");
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
