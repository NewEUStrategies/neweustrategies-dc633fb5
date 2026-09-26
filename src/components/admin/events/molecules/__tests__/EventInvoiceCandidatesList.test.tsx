// Zamowienia do zafakturowania pogrupowane po NIP-ie. Pilnujemy: grupa =
// faktura zbiorcza (pozycje wg rodzaju biletu), pojedyncze zamowienie =
// pozycja na zamowienie, proforma dla dowolnego zaznaczenia, filtr "tylko bez
// faktury", blokada przy wylaczonym fakturowaniu i masowe wystawienie z prosb
// z potwierdzeniem i raportem.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";
import { INVOICE_IDS, invoiceCandidateRow } from "@/test/events/invoiceFixtures";

const h = vi.hoisted(() => ({
  confirm: true,
  confirmCalls: [] as Array<{ description?: string }>,
  lang: "pl",
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/appDialogs", () => ({
  confirmDialog: async (request: { description?: string }) => {
    h.confirmCalls.push(request);
    return h.confirm;
  },
}));
const api = vi.hoisted(() => ({
  fetchInvoiceCandidates: vi.fn(),
  createInvoiceDraft: vi.fn(),
  issuePendingInvoices: vi.fn(),
}));
vi.mock("@/lib/events/eventInvoicesApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/eventInvoicesApi")>()),
  ...api,
}));

const { toast } = await import("sonner");
const { EventInvoiceCandidatesList } =
  await import("@/components/admin/events/molecules/EventInvoiceCandidatesList");
const { groupCandidates } = await import("@/lib/events/eventInvoiceViews");

const ROWS = [
  invoiceCandidateRow(),
  invoiceCandidateRow({
    source_id: INVOICE_IDS.packageOrder,
    source_kind: "package_order",
    label_pl: "Firmowy 5",
    label_en: "Company 5",
    seats: 5,
    gross_cents: 50000,
    paid_via: "transfer",
    person_name: "Anna Pakiet",
  }),
  invoiceCandidateRow({
    source_id: INVOICE_IDS.registration2,
    tax_key: null,
    request_id: null,
    request_status: null,
    buyer_name: null,
    person_name: "Ewa Druga",
    company_text: "Druga Firma",
    payment_state: "unpaid",
    amount_source: "price_list",
    gross_cents: 12300,
    seats: 1,
    proforma_id: INVOICE_IDS.proforma,
    proforma_number: "PRO/2026/09/0001",
  }),
  invoiceCandidateRow({
    source_id: "wystawiony",
    tax_key: null,
    person_name: "Zafakturowany",
    invoice_id: INVOICE_IDS.invoice,
    invoice_number: "FV/2026/09/0001",
    invoice_status: "issued",
  }),
  invoiceCandidateRow({
    source_id: "szkic",
    tax_key: null,
    person_name: "Ze szkicem",
    invoice_id: INVOICE_IDS.draft,
    invoice_status: "draft",
    payment_state: "partially_refunded",
  }),
];

function renderList(props: Partial<{ enabled: boolean }> = {}) {
  const onDraftCreated = vi.fn();
  const onBulkIssued = vi.fn();
  const view = renderWithQueryClient(
    <EventInvoiceCandidatesList
      eventId={INVOICE_IDS.event}
      enabled={props.enabled ?? true}
      onDraftCreated={onDraftCreated}
      onBulkIssued={onBulkIssued}
    />,
  );
  return { ...view, onDraftCreated, onBulkIssued };
}

beforeEach(() => {
  h.lang = "pl";
  h.confirm = true;
  h.confirmCalls = [];
  for (const fn of Object.values(api)) fn.mockReset();
  for (const fn of [toast.success, toast.error, toast.info]) vi.mocked(fn).mockReset();
  api.fetchInvoiceCandidates.mockResolvedValue(ROWS);
});

describe("groupCandidates", () => {
  it("grupy po NIP-ie w kolejnosci bazy, bez NIP-u osobno", () => {
    const groups = groupCandidates(ROWS);
    expect(groups.map((group) => [group.key, group.rows.length, group.buyerName])).toEqual([
      ["tax:5260250274", 2, "Acme Sp. z o.o."],
      ["none", 3, ""],
    ]);
  });
});

describe("EventInvoiceCandidatesList", () => {
  it("ladowanie, odmowa odczytu, pusta lista", async () => {
    api.fetchInvoiceCandidates.mockReturnValueOnce(new Promise(() => {}));
    const first = renderList();
    expect(screen.getByText("adminEventInvoices.loading")).toBeTruthy();
    first.unmount();
    api.fetchInvoiceCandidates.mockRejectedValueOnce(new Error("forbidden: x"));
    const second = renderList();
    expect(await screen.findByText(/.+/, { selector: "p.text-destructive" })).toBeTruthy();
    second.unmount();
    api.fetchInvoiceCandidates.mockResolvedValueOnce([]);
    renderList();
    expect(await screen.findByText("adminEventInvoices.candidates.empty")).toBeTruthy();
  });

  it("grupy, etykiety platnosci i dokumentow; filtr 'tylko bez faktury'", async () => {
    renderList();
    const group = await screen.findByText(
      /adminEventInvoices\.candidates\.groupTaxId\(taxId=5260250274\)/,
    );
    expect(group.textContent).toContain("Acme Sp. z o.o. · ");
    expect(screen.getByText("adminEventInvoices.candidates.groupNoTaxId")).toBeTruthy();
    expect(screen.queryByText("Zafakturowany")).toBeNull();
    const pack = screen.getByText("Anna Pakiet").closest("li");
    expect(pack?.textContent).toContain("adminEventInvoices.candidates.package(name=Firmowy 5)");
    expect(pack?.textContent).toContain("adminEventInvoices.candidates.paidVia.transfer");
    const unpaid = screen.getByText("Ewa Druga").closest("li");
    expect(unpaid?.textContent).toContain("adminEventInvoices.candidates.payment.unpaid");
    expect(unpaid?.textContent).not.toContain("paidVia");
    expect(unpaid?.textContent).toContain("adminEventInvoices.candidates.priceList");
    expect(unpaid?.textContent).toContain("Druga Firma");
    expect(unpaid?.textContent).toContain(
      "adminEventInvoices.candidates.hasProforma(number=PRO/2026/09/0001)",
    );
    const lead = screen.getByText("Anna Kupujaca").closest("li");
    expect(lead?.textContent).toContain("adminEventInvoices.candidates.requested");
    expect(lead?.textContent).toContain("adminEventInvoices.candidates.paidVia.card");
    expect(lead?.textContent).toContain("adminEventInvoices.candidates.noDocument");
    fireEvent.click(screen.getByLabelText("adminEventInvoices.candidates.onlyOpen"));
    const invoiced = screen.getByText("Zafakturowany").closest("li");
    expect(invoiced?.textContent).toContain(
      "adminEventInvoices.candidates.hasInvoice(number=FV/2026/09/0001)",
    );
    expect(within(invoiced as HTMLElement).getByRole("checkbox")).toHaveProperty("disabled", true);
    const draft = screen.getByText("Ze szkicem").closest("li");
    expect(draft?.textContent).toContain("adminEventInvoices.candidates.hasDraft");
    expect(draft?.textContent).toContain(
      "adminEventInvoices.candidates.payment.partially_refunded",
    );
  });

  it("jedno zamowienie = faktura z pozycja na zamowienie", async () => {
    api.createInvoiceDraft.mockResolvedValue(INVOICE_IDS.draft);
    const { onDraftCreated } = renderList();
    fireEvent.click(
      await screen.findByLabelText("adminEventInvoices.candidates.selectRow(name=Ewa Druga)"),
    );
    expect(screen.getByText("adminEventInvoices.candidates.selected(count=1)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.candidates.invoice" }));
    await waitFor(() => expect(onDraftCreated).toHaveBeenCalledWith(INVOICE_IDS.draft));
    expect(toast.success).toHaveBeenCalledWith("adminEventInvoices.toasts.draftCreated");
    expect(api.createInvoiceDraft.mock.calls[0]?.[0]).toEqual({
      eventId: INVOICE_IDS.event,
      kind: "invoice",
      aggregate: "per_source",
      sources: [{ kind: "registration", id: INVOICE_IDS.registration2 }],
    });
    await waitFor(() => expect(screen.queryByText(/candidates\.selected/)).toBeNull());
  });

  it("cala grupa = faktura ZBIORCZA wg rodzaju biletu; odznaczenie grupy", async () => {
    api.createInvoiceDraft.mockResolvedValue(INVOICE_IDS.draft);
    renderList();
    const [groupBox] = await screen.findAllByLabelText("adminEventInvoices.candidates.selectGroup");
    fireEvent.click(groupBox);
    expect(screen.getByText("adminEventInvoices.candidates.selected(count=2)")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "adminEventInvoices.candidates.collective" }),
    );
    await waitFor(() => expect(api.createInvoiceDraft).toHaveBeenCalled());
    expect(api.createInvoiceDraft.mock.calls[0]?.[0]).toMatchObject({
      aggregate: "per_ticket_type",
      sources: [
        { kind: "registration", id: INVOICE_IDS.registration },
        { kind: "package_order", id: INVOICE_IDS.packageOrder },
      ],
    });
  });

  it("proforma; odmowa bazy = toast; odznaczenie grupy czysci wybor", async () => {
    api.createInvoiceDraft.mockRejectedValue(new Error("currency_mismatch: x"));
    renderList();
    const [groupBox] = await screen.findAllByLabelText("adminEventInvoices.candidates.selectGroup");
    fireEvent.click(groupBox);
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.candidates.proforma" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(api.createInvoiceDraft.mock.calls[0]?.[0]).toMatchObject({ kind: "proforma" });
    fireEvent.click(groupBox);
    expect(screen.queryByText(/candidates\.selected/)).toBeNull();
  });

  it("angielski interfejs: angielska nazwa pozycji, a bez niej polska; proforma w szkicu = szkic", async () => {
    h.lang = "en";
    api.fetchInvoiceCandidates.mockResolvedValue([
      ROWS[1],
      invoiceCandidateRow({
        source_id: "bez-en",
        person_name: "Bez EN",
        label_en: "",
        label_pl: "Tylko PL",
      }),
      invoiceCandidateRow({
        source_id: "pro",
        person_name: "Proforma",
        proforma_id: INVOICE_IDS.proforma,
      }),
    ]);
    renderList();
    expect((await screen.findByText("Anna Pakiet")).closest("li")?.textContent).toContain(
      "adminEventInvoices.candidates.package(name=Company 5)",
    );
    expect(screen.getByText("Bez EN").closest("li")?.textContent).toContain(
      "adminEventInvoices.candidates.ticket(name=Tylko PL)",
    );
    expect(screen.getByText("Proforma").closest("li")?.textContent).toContain(
      "adminEventInvoices.candidates.hasProforma(number=adminEventInvoices.documents.draftNumber)",
    );
  });

  it("grupa bez zamowien do wyboru ma martwy przelacznik", async () => {
    api.fetchInvoiceCandidates.mockResolvedValue([ROWS[3]]);
    renderList();
    fireEvent.click(await screen.findByLabelText("adminEventInvoices.candidates.onlyOpen"));
    expect(screen.getByLabelText("adminEventInvoices.candidates.selectGroup")).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("fakturowanie wylaczone: przyciski martwe", async () => {
    renderList({ enabled: false });
    fireEvent.click(
      await screen.findByLabelText("adminEventInvoices.candidates.selectRow(name=Ewa Druga)"),
    );
    expect(
      screen.getByRole("button", { name: "adminEventInvoices.candidates.invoice" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", { name: "adminEventInvoices.candidates.issuePending" }),
    ).toHaveProperty("disabled", true);
  });

  it("masowo: rezygnacja w potwierdzeniu nic nie robi", async () => {
    h.confirm = false;
    renderList();
    fireEvent.click(
      await screen.findByRole("button", { name: "adminEventInvoices.candidates.issuePending" }),
    );
    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    expect(h.confirmCalls[0]?.description).toBe("adminEventInvoices.candidates.issuePendingBody");
    expect(api.issuePendingInvoices).not.toHaveBeenCalled();
  });

  it("masowo zbiorczo: raport, odmowy per grupa, powiadomienie wolajacego", async () => {
    const result = {
      issued: [{ id: INVOICE_IDS.invoice, number: "FV/2026/09/0003" }],
      failed: [{ requestIds: ["r"], code: "invalid_buyer_address" }],
    };
    api.issuePendingInvoices.mockResolvedValue(result);
    const { onBulkIssued } = renderList();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "adminEventInvoices.candidates.issuePendingCollective",
      }),
    );
    await waitFor(() => expect(onBulkIssued).toHaveBeenCalledWith(result));
    expect(h.confirmCalls[0]?.description).toBe(
      "adminEventInvoices.candidates.issuePendingCollectiveBody",
    );
    expect(api.issuePendingInvoices).toHaveBeenCalledWith(INVOICE_IDS.event, true);
    expect(toast.success).toHaveBeenCalledWith(
      "adminEventInvoices.candidates.bulkResult(failed=1,issued=1)",
    );
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("masowo: nic do wystawienia = informacja; odmowa = toast", async () => {
    api.issuePendingInvoices.mockResolvedValueOnce({ issued: [], failed: [] });
    renderList();
    fireEvent.click(
      await screen.findByRole("button", { name: "adminEventInvoices.candidates.issuePending" }),
    );
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith("adminEventInvoices.candidates.bulkNothing"),
    );
    api.issuePendingInvoices.mockRejectedValueOnce(new Error("invoicing_disabled: x"));
    fireEvent.click(
      screen.getByRole("button", { name: "adminEventInvoices.candidates.issuePending" }),
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it("dostepnosc: brak naruszen axe", async () => {
    const { container } = renderList();
    await screen.findByText("Anna Kupujaca");
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
