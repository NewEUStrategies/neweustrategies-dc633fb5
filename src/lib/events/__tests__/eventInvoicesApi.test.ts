// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW:
//
// Warstwa danych faktur w studiu: NAZWA funkcji i NAZWY kluczy ladunku to
// jedyny kontrakt po stronie klienta (obiekt argumentow `rpc` jest luzny, wiec
// literowka przechodzi przez `tsc` i konczy sie funkcja, ktorej PostgREST nie
// znajduje albo kluczem, ktory SQL czyta jako "bez zmian"). Kwot, numerow ani
// stanow warstwa nie liczy - to robi baza (harness 27).
import { beforeEach, describe, expect, it, vi } from "vitest";

import { emptyBuyerDraft } from "@/lib/events/eventInvoiceBuyerDraft";
import { parseInvoiceDocument } from "@/lib/events/eventInvoiceDocument";
import { fail } from "@/test/supabase/chain";
import { supabaseRpcStub } from "@/test/supabase/rpc";
import {
  INVOICE_IDS,
  invoiceCandidateRow,
  invoiceDocumentJson,
  invoiceListRow,
  invoiceSettingsJson,
} from "@/test/events/invoiceFixtures";

const h = vi.hoisted(() => ({
  stub: null as ReturnType<typeof supabaseRpcStub> | null,
  prepareFx: vi.fn(),
  verifyVies: vi.fn(),
}));

vi.mock("@/lib/events/eventInvoiceFx.functions", () => ({
  prepareEventInvoiceFx: (input: unknown) => h.prepareFx(input),
}));

vi.mock("@/lib/events/eventInvoiceVies.functions", () => ({
  verifyEventInvoiceVies: (input: unknown) => h.verifyVies(input),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.stub === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.stub.rpc(name, args);
    },
  },
}));

const api = await import("@/lib/events/eventInvoicesApi");

let stub: ReturnType<typeof supabaseRpcStub>;

beforeEach(() => {
  stub = supabaseRpcStub();
  h.stub = stub;
  h.prepareFx.mockReset();
  h.verifyVies.mockReset();
});

const SETTINGS_INPUT = {
  enabled: true,
  sellerName: "Organizator 27",
  sellerTaxId: "7011278375",
  sellerAddress: "ul. Dluga 1",
  sellerPostalCode: "00-001",
  sellerCity: "Warszawa",
  sellerCountry: "PL",
  sellerEmail: "faktury@org27.example.com",
  sellerPhone: "",
  sellerBankAccount: "",
  sellerBankSwift: "",
  seriesInvoice: "FV",
  seriesProforma: "PRO",
  seriesCorrection: "KOR",
  paymentDays: 14,
  defaultVatRate: "23" as const,
  vatExemptBasis: "",
  footerNote: "",
  defaultLocale: "pl" as const,
  confirmSeller: false,
};

describe("ustawienia wystawcy", () => {
  it("odczyt: mapowanie pol i domyslne wartosci dla brakow", async () => {
    stub.setData(
      "admin_event_invoice_settings_get",
      invoiceSettingsJson({ seller_phone: "+48 1" }),
    );
    const settings = await api.fetchInvoiceSettings();
    expect(settings).toMatchObject({
      enabled: true,
      confirmedAt: "2026-09-01T08:00:00.000Z",
      sellerName: "Organizator 27 Sp. z o.o.",
      sellerPhone: "+48 1",
      paymentDays: 14,
      defaultVatRate: "23",
      defaultLocale: "pl",
    });
    expect(stub.lastCall("admin_event_invoice_settings_get")?.keys()).toEqual([]);
  });

  it("pusta odpowiedz = domyslne serie, termin, stawka i kraj", () => {
    expect(api.parseInvoiceSettings(null)).toEqual({
      enabled: false,
      confirmedAt: null,
      sellerName: "",
      sellerTaxId: "",
      sellerAddress: "",
      sellerPostalCode: "",
      sellerCity: "",
      sellerCountry: "PL",
      sellerEmail: "",
      sellerPhone: "",
      sellerBankAccount: "",
      sellerBankSwift: "",
      seriesInvoice: "FV",
      seriesProforma: "PRO",
      seriesCorrection: "KOR",
      paymentDays: 14,
      defaultVatRate: "23",
      vatExemptBasis: "",
      vatNpBasis: "",
      footerNote: "",
      defaultLocale: "pl",
    });
    expect(api.parseInvoiceSettings({ payment_days: 0, enabled: "true" })).toMatchObject({
      paymentDays: 0,
      enabled: false,
    });
  });

  it("zapis: snake_case, potwierdzenie sprzedawcy WYLACZNIE gdy zaznaczone", async () => {
    stub.setData("admin_event_invoice_settings_save", invoiceSettingsJson());
    await api.saveInvoiceSettings(SETTINGS_INPUT);
    const first = stub.lastCall("admin_event_invoice_settings_save")?.arg("p_payload");
    expect(first).toEqual({
      enabled: true,
      seller_name: "Organizator 27",
      seller_tax_id: "7011278375",
      seller_address: "ul. Dluga 1",
      seller_postal_code: "00-001",
      seller_city: "Warszawa",
      seller_country: "PL",
      seller_email: "faktury@org27.example.com",
      seller_phone: "",
      seller_bank_account: "",
      seller_bank_swift: "",
      series_invoice: "FV",
      series_proforma: "PRO",
      series_correction: "KOR",
      payment_days: 14,
      default_vat_rate: "23",
      vat_exempt_basis: "",
      footer_note: "",
      default_locale: "pl",
    });
    await api.saveInvoiceSettings({ ...SETTINGS_INPUT, confirmSeller: true });
    expect(stub.lastCall("admin_event_invoice_settings_save")?.arg("p_payload")).toMatchObject({
      confirm_seller: true,
    });
  });

  it("odmowa bazy wraca jako Error z glowa komunikatu", async () => {
    stub.setError("admin_event_invoice_settings_save", "seller_incomplete: issuer name");
    await expect(api.saveInvoiceSettings(SETTINGS_INPUT)).rejects.toThrow(
      "seller_incomplete: issuer name",
    );
    stub.setError("admin_event_invoice_settings_get", "forbidden: admin role required");
    await expect(api.fetchInvoiceSettings()).rejects.toThrow("forbidden");
  });
});

describe("listy wydarzenia", () => {
  it("kandydaci i dokumenty po identyfikatorze wydarzenia", async () => {
    stub.setData("admin_event_invoice_candidates", [invoiceCandidateRow()]);
    stub.setData("admin_event_invoices_list", [invoiceListRow()]);
    await expect(api.fetchInvoiceCandidates(INVOICE_IDS.event)).resolves.toHaveLength(1);
    await expect(api.fetchEventInvoices(INVOICE_IDS.event)).resolves.toHaveLength(1);
    expect(stub.lastCall("admin_event_invoice_candidates")?.args).toEqual({
      p_event_id: INVOICE_IDS.event,
    });
    expect(stub.lastCall("admin_event_invoices_list")?.args).toEqual({
      p_event_id: INVOICE_IDS.event,
    });
  });

  it("null z PostgREST = pusta lista; blad = wyjatek", async () => {
    stub.setData("admin_event_invoice_candidates", null);
    stub.setData("admin_event_invoices_list", null);
    await expect(api.fetchInvoiceCandidates(INVOICE_IDS.event)).resolves.toEqual([]);
    await expect(api.fetchEventInvoices(INVOICE_IDS.event)).resolves.toEqual([]);
    stub.setError("admin_event_invoice_candidates", "not_found: event");
    stub.setError("admin_event_invoices_list", "forbidden: admin");
    await expect(api.fetchInvoiceCandidates(INVOICE_IDS.event)).rejects.toThrow("not_found");
    await expect(api.fetchEventInvoices(INVOICE_IDS.event)).rejects.toThrow("forbidden");
  });

  it("dokument: odczyt przez parser, nieczytelny = unknown", async () => {
    stub.setData("admin_event_invoice_get", invoiceDocumentJson());
    const doc = await api.fetchEventInvoice(INVOICE_IDS.invoice);
    expect(doc.number).toBe("FV/2026/09/0001");
    expect(stub.lastCall("admin_event_invoice_get")?.args).toEqual({ p_id: INVOICE_IDS.invoice });
    expect(api.sourcesGrossCents(doc)).toBe(24601);
    stub.setData("admin_event_invoice_get", { invoice: {} });
    await expect(api.fetchEventInvoice(INVOICE_IDS.invoice)).rejects.toThrow("unknown:");
    stub.setError("admin_event_invoice_get", "not_found: document");
    await expect(api.fetchEventInvoice(INVOICE_IDS.invoice)).rejects.toThrow("not_found");
  });
});

describe("szkic", () => {
  it("zbiorczy szkic: zrodla, agregacja, bez prosby gdy nie podano", async () => {
    stub.setData("admin_event_invoice_draft_create", INVOICE_IDS.draft);
    await expect(
      api.createInvoiceDraft({
        eventId: INVOICE_IDS.event,
        kind: "invoice",
        aggregate: "per_ticket_type",
        sources: [
          { kind: "registration", id: INVOICE_IDS.registration },
          { kind: "package_order", id: INVOICE_IDS.packageOrder },
        ],
      }),
    ).resolves.toBe(INVOICE_IDS.draft);
    expect(stub.lastCall("admin_event_invoice_draft_create")?.arg("p_payload")).toEqual({
      event_id: INVOICE_IDS.event,
      kind: "invoice",
      aggregate: "per_ticket_type",
      sources: [
        { kind: "registration", id: INVOICE_IDS.registration },
        { kind: "package_order", id: INVOICE_IDS.packageOrder },
      ],
    });
    await api.createInvoiceDraft({
      eventId: INVOICE_IDS.event,
      kind: "proforma",
      aggregate: "per_source",
      requestId: INVOICE_IDS.request,
      sources: [{ kind: "registration", id: INVOICE_IDS.registration }],
    });
    expect(stub.lastCall("admin_event_invoice_draft_create")?.arg("p_payload")).toMatchObject({
      kind: "proforma",
      request_id: INVOICE_IDS.request,
    });
    await api.createInvoiceDraft({
      eventId: INVOICE_IDS.event,
      kind: "invoice",
      aggregate: "per_source",
      requestId: null,
      sources: [],
    });
    expect(stub.lastCall("admin_event_invoice_draft_create")?.has("p_payload")).toBe(true);
    expect(stub.lastCall("admin_event_invoice_draft_create")?.arg("p_payload")).not.toHaveProperty(
      "request_id",
    );
  });

  it("edycja: klucz pominiety = bez zmian, jawny null = wyczysc, pozycje w snake_case", async () => {
    stub.setData("admin_event_invoice_draft_update", INVOICE_IDS.draft);
    await api.updateInvoiceDraft({ id: INVOICE_IDS.draft, note: "Uwaga" });
    expect(stub.lastCall("admin_event_invoice_draft_update")?.arg("p_payload")).toEqual({
      id: INVOICE_IDS.draft,
      note: "Uwaga",
    });
    await api.updateInvoiceDraft({
      id: INVOICE_IDS.draft,
      buyer: { ...emptyBuyerDraft(), name: "Acme", taxId: "PL5260250274" },
      saleDate: null,
      dueDate: "2026-10-01",
      paymentMethod: "card",
      paidAt: null,
      locale: "en",
      correctionReason: "r",
      lines: [
        {
          description: "Parking",
          unit: "szt.",
          quantity: 2,
          unitGrossCents: 1050,
          vatRate: "5",
          ticketTypeId: null,
          correctsLineId: INVOICE_IDS.line1,
        },
      ],
    });
    expect(stub.lastCall("admin_event_invoice_draft_update")?.arg("p_payload")).toEqual({
      id: INVOICE_IDS.draft,
      buyer: expect.objectContaining({ name: "Acme", tax_id: "5260250274", is_company: true }),
      sale_date: null,
      due_date: "2026-10-01",
      payment_method: "card",
      paid_at: null,
      locale: "en",
      correction_reason: "r",
      lines: [
        {
          description: "Parking",
          unit: "szt.",
          quantity: 2,
          unit_gross_cents: 1050,
          vat_rate: "5",
          ticket_type_id: null,
          corrects_line_id: INVOICE_IDS.line1,
        },
      ],
    });
    stub.setError("admin_event_invoice_draft_update", "not_draft: only a draft");
    await expect(api.updateInvoiceDraft({ id: INVOICE_IDS.draft })).rejects.toThrow("not_draft");
    stub.setError("admin_event_invoice_draft_create", "already_invoiced: x");
    await expect(
      api.createInvoiceDraft({
        eventId: "e",
        kind: "invoice",
        aggregate: "per_source",
        sources: [],
      }),
    ).rejects.toThrow("already_invoiced");
  });
});

describe("wystawienie, masowe wystawienie, anulowanie", () => {
  it("wystawienie oddaje numer; brak id w odpowiedzi = id wolajacego", async () => {
    stub.setData("admin_event_invoice_issue", {
      id: INVOICE_IDS.invoice,
      number: "FV/2026/09/0002",
    });
    await expect(api.issueInvoice(INVOICE_IDS.invoice)).resolves.toEqual({
      id: INVOICE_IDS.invoice,
      number: "FV/2026/09/0002",
    });
    expect(stub.lastCall("admin_event_invoice_issue")?.args).toEqual({ p_id: INVOICE_IDS.invoice });
    stub.setData("admin_event_invoice_issue", null);
    await expect(api.issueInvoice(INVOICE_IDS.draft)).resolves.toEqual({
      id: INVOICE_IDS.draft,
      number: "",
    });
    stub.setError("admin_event_invoice_issue", "mor_seller_conflict: card orders");
    await expect(api.issueInvoice(INVOICE_IDS.draft)).rejects.toThrow("mor_seller_conflict");
  });

  it("masowo: wystawione i odmowy per grupa prosb", async () => {
    stub.setData("admin_event_invoice_issue_pending", {
      issued: [
        { invoice_id: INVOICE_IDS.invoice, number: "FV/2026/09/0003", request_ids: ["r1", "r2"] },
      ],
      failed: [{ request_ids: ["r3", 7], code: "invalid_buyer_address" }],
    });
    await expect(api.issuePendingInvoices(INVOICE_IDS.event, true)).resolves.toEqual({
      issued: [{ id: INVOICE_IDS.invoice, number: "FV/2026/09/0003" }],
      failed: [{ requestIds: ["r3", ""], code: "invalid_buyer_address" }],
    });
    expect(stub.lastCall("admin_event_invoice_issue_pending")?.arg("p_payload")).toEqual({
      event_id: INVOICE_IDS.event,
      collective: true,
    });
    stub.setData("admin_event_invoice_issue_pending", null);
    await expect(api.issuePendingInvoices(INVOICE_IDS.event, false)).resolves.toEqual({
      issued: [],
      failed: [],
    });
    stub.setError("admin_event_invoice_issue_pending", "invoicing_disabled: x");
    await expect(api.issuePendingInvoices(INVOICE_IDS.event, false)).rejects.toThrow(
      "invoicing_disabled",
    );
  });

  it("anulowanie z powodem", async () => {
    stub.setData("admin_event_invoice_cancel", INVOICE_IDS.invoice);
    await expect(api.cancelInvoice(INVOICE_IDS.invoice, "Pomylka")).resolves.toBe(
      INVOICE_IDS.invoice,
    );
    expect(stub.lastCall("admin_event_invoice_cancel")?.arg("p_payload")).toEqual({
      id: INVOICE_IDS.invoice,
      reason: "Pomylka",
    });
    stub.setError("admin_event_invoice_cancel", "ksef_locked: sent");
    await expect(api.cancelInvoice(INVOICE_IDS.invoice, "x")).rejects.toThrow("ksef_locked");
  });
});

describe("kurs NBP przy wystawieniu (INV-06)", () => {
  it("rozpoznaje odmowe bazy fx_rate_required", () => {
    expect(api.isFxRateRequired("fx_rate_required: EUR 2026-10-09")).toBe(true);
    expect(api.isFxRateRequired(" fx_rate_required")).toBe(true);
    expect(api.isFxRateRequired("fx_rate_required_x: y")).toBe(false);
    expect(api.isFxRateRequired("amount_mismatch: x")).toBe(false);
  });

  it("brak kursu: serwer pobiera kurs NBP dla tego szkicu i wystawienie idzie RAZ jeszcze", async () => {
    let calls = 0;
    stub.setResponse("admin_event_invoice_issue", () => {
      calls += 1;
      return calls === 1
        ? fail("fx_rate_required: EUR 2026-10-09")
        : { data: { id: INVOICE_IDS.invoice, number: "FV/2026/10/0001" }, error: null };
    });
    h.prepareFx.mockResolvedValue({ needed: 1, loaded: 1, missing: [] });
    await expect(api.issueInvoice(INVOICE_IDS.invoice)).resolves.toEqual({
      id: INVOICE_IDS.invoice,
      number: "FV/2026/10/0001",
    });
    expect(h.prepareFx).toHaveBeenCalledWith({ data: { invoiceIds: [INVOICE_IDS.invoice] } });
    expect(calls).toBe(2);
  });

  it("kurs nadal niedostepny = ta sama odmowa; inne odmowy bez pobierania kursu", async () => {
    stub.setError("admin_event_invoice_issue", "fx_rate_required: EUR 2026-10-09");
    h.prepareFx.mockResolvedValue({ needed: 1, loaded: 0, missing: [] });
    await expect(api.issueInvoice(INVOICE_IDS.invoice)).rejects.toThrow("fx_rate_required");
    expect(h.prepareFx).toHaveBeenCalledTimes(1);
    h.prepareFx.mockClear();
    stub.setError("admin_event_invoice_issue", "amount_mismatch: 100 <> 200");
    await expect(api.issueInvoice(INVOICE_IDS.invoice)).rejects.toThrow("amount_mismatch");
    expect(h.prepareFx).not.toHaveBeenCalled();
  });

  it("masowo: grupy bez kursu -> kursy dla oczekujacych prosb wydarzenia i drugi przebieg", async () => {
    let calls = 0;
    stub.setResponse("admin_event_invoice_issue_pending", () => {
      calls += 1;
      return calls === 1
        ? {
            data: {
              issued: [{ invoice_id: "a", number: "FV/1", request_ids: ["r1"] }],
              failed: [{ request_ids: ["r2"], code: "fx_rate_required" }],
            },
            error: null,
          }
        : {
            data: {
              issued: [{ invoice_id: "b", number: "FV/2", request_ids: ["r2"] }],
              failed: [],
            },
            error: null,
          };
    });
    h.prepareFx.mockResolvedValue({ needed: 1, loaded: 1, missing: [] });
    await expect(api.issuePendingInvoices(INVOICE_IDS.event, false)).resolves.toEqual({
      issued: [
        { id: "a", number: "FV/1" },
        { id: "b", number: "FV/2" },
      ],
      failed: [],
    });
    expect(h.prepareFx).toHaveBeenCalledWith({
      data: { eventId: INVOICE_IDS.event, pending: true },
    });
  });
});

describe("VIES (INV-12)", () => {
  it("wynik serwera: wazny/niewazny to odpowiedz, blad techniczny to wyjatek", async () => {
    h.verifyVies.mockResolvedValueOnce({
      ok: true,
      valid: true,
      requestId: "WAPIAAAAX",
      name: "ACME GMBH",
      address: "BERLIN",
    });
    await expect(api.verifyInvoiceVies(INVOICE_IDS.draft)).resolves.toEqual({
      valid: true,
      requestId: "WAPIAAAAX",
      name: "ACME GMBH",
      address: "BERLIN",
    });
    expect(h.verifyVies).toHaveBeenCalledWith({ data: { invoiceId: INVOICE_IDS.draft } });
    h.verifyVies.mockResolvedValueOnce({ ok: false, error: "vies_unavailable" });
    await expect(api.verifyInvoiceVies(INVOICE_IDS.draft)).rejects.toThrow("vies_unavailable");
  });
});

describe("korekta, proforma, KSeF, zaplata", () => {
  it("korekta pelna bez pozycji, czesciowa z para zmian", async () => {
    stub.setData("admin_event_invoice_correction_create", INVOICE_IDS.correction);
    await api.createInvoiceCorrection({
      invoiceId: INVOICE_IDS.invoice,
      mode: "full",
      reason: "Rezygnacja",
    });
    expect(stub.lastCall("admin_event_invoice_correction_create")?.arg("p_payload")).toEqual({
      invoice_id: INVOICE_IDS.invoice,
      mode: "full",
      reason: "Rezygnacja",
    });
    await expect(
      api.createInvoiceCorrection({
        invoiceId: INVOICE_IDS.invoice,
        mode: "partial",
        reason: "Stawka",
        lines: [{ lineId: INVOICE_IDS.line1, quantity: 1, unitGrossCents: 12300, vatRate: "8" }],
      }),
    ).resolves.toBe(INVOICE_IDS.correction);
    expect(stub.lastCall("admin_event_invoice_correction_create")?.arg("p_payload")).toMatchObject({
      lines: [{ line_id: INVOICE_IDS.line1, quantity: 1, unit_gross_cents: 12300, vat_rate: "8" }],
    });
    stub.setError("admin_event_invoice_correction_create", "correction_exists: x");
    await expect(
      api.createInvoiceCorrection({ invoiceId: INVOICE_IDS.invoice, mode: "full", reason: "r" }),
    ).rejects.toThrow("correction_exists");
  });

  it("faktura z proformy", async () => {
    stub.setData("admin_event_invoice_from_proforma", INVOICE_IDS.draft);
    await expect(api.invoiceFromProforma(INVOICE_IDS.proforma)).resolves.toBe(INVOICE_IDS.draft);
    expect(stub.lastCall("admin_event_invoice_from_proforma")?.args).toEqual({
      p_id: INVOICE_IDS.proforma,
    });
    stub.setError("admin_event_invoice_from_proforma", "proforma_already_converted: x");
    await expect(api.invoiceFromProforma(INVOICE_IDS.proforma)).rejects.toThrow(
      "proforma_already_converted",
    );
  });

  it("KSeF i data zaplaty", async () => {
    stub.setData("admin_event_invoice_ksef_update", INVOICE_IDS.invoice);
    stub.setData("admin_event_invoice_set_paid", INVOICE_IDS.invoice);
    await api.updateInvoiceKsef({ id: INVOICE_IDS.invoice, status: "accepted", number: "KSEF-1" });
    expect(stub.lastCall("admin_event_invoice_ksef_update")?.arg("p_payload")).toEqual({
      id: INVOICE_IDS.invoice,
      status: "accepted",
      number: "KSEF-1",
    });
    await api.setInvoicePaid({ id: INVOICE_IDS.invoice, paidAt: null });
    expect(stub.lastCall("admin_event_invoice_set_paid")?.arg("p_payload")).toEqual({
      id: INVOICE_IDS.invoice,
      paid_at: null,
    });
    stub.setError("admin_event_invoice_ksef_update", "ksef_number_required: x");
    stub.setError("admin_event_invoice_set_paid", "not_found: x");
    await expect(
      api.updateInvoiceKsef({ id: "x", status: "accepted", number: "" }),
    ).rejects.toThrow("ksef_number_required");
    await expect(api.setInvoicePaid({ id: "x", paidAt: null })).rejects.toThrow("not_found");
  });

  it("KSeF: notatka zmiany trafia do dziennika (INV-02)", async () => {
    stub.setData("admin_event_invoice_ksef_update", INVOICE_IDS.invoice);
    await api.updateInvoiceKsef({
      id: INVOICE_IDS.invoice,
      status: "rejected",
      number: "",
      note: "Blad schematu",
    });
    expect(stub.lastCall("admin_event_invoice_ksef_update")?.arg("p_payload")).toEqual({
      id: INVOICE_IDS.invoice,
      status: "rejected",
      number: "",
      note: "Blad schematu",
    });
    stub.setError("admin_event_invoice_ksef_update", "invalid_transition: accepted -> pending");
    await expect(
      api.updateInvoiceKsef({ id: INVOICE_IDS.invoice, status: "pending", number: "" }),
    ).rejects.toThrow("invalid_transition");
  });

  it("zaksiegowana wplata za zapis (INV-14): kwota i waluta wracaja z bazy", async () => {
    stub.setData("admin_event_registration_record_payment", {
      amount_cents: 9900,
      currency: "EUR",
    });
    await expect(
      api.recordRegistrationPayment({ registrationId: "r1", amountCents: 9900, currency: "EUR" }),
    ).resolves.toEqual({ amountCents: 9900, currency: "EUR" });
    expect(stub.lastCall("admin_event_registration_record_payment")?.arg("p_payload")).toEqual({
      registration_id: "r1",
      amount_cents: 9900,
      currency: "EUR",
    });
    stub.setError("admin_event_registration_record_payment", "payment_is_card: x");
    await expect(
      api.recordRegistrationPayment({ registrationId: "r1", amountCents: 1 }),
    ).rejects.toThrow("payment_is_card");
  });

  it("sourcesGrossCents sumuje zrodla dokumentu", () => {
    const doc = parseInvoiceDocument(
      invoiceDocumentJson({
        sources: [
          { id: "a", source_kind: "registration", gross_cents: 100, covers: true },
          { id: "b", source_kind: "package_order", gross_cents: 250, covers: true },
        ],
      }),
    );
    expect(doc === null ? -1 : api.sourcesGrossCents(doc)).toBe(350);
  });
});
