// Plaszczyzna KUPUJACEGO: prosba o fakture i wlasne dokumenty. Najemca i
// wlasciciel biora sie z bazy (`public_tenant_id()` + `auth.uid()`) - klient
// NIE podaje ani najemcy, ani uzytkownika; kontraktem jest nazwa funkcji
// i ksztalt ladunku.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { emptyBuyerDraft } from "@/lib/events/eventInvoiceBuyerDraft";
import { supabaseRpcStub } from "@/test/supabase/rpc";
import {
  INVOICE_IDS,
  invoiceDocumentJson,
  myInvoiceRow,
  myInvoiceSourceRow,
} from "@/test/events/invoiceFixtures";

const h = vi.hoisted(() => ({ stub: null as ReturnType<typeof supabaseRpcStub> | null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.stub === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.stub.rpc(name, args);
    },
  },
}));

const api = await import("@/lib/events/myEventInvoicesApi");

let stub: ReturnType<typeof supabaseRpcStub>;

beforeEach(() => {
  stub = supabaseRpcStub();
  h.stub = stub;
});

const BUYER = {
  ...emptyBuyerDraft(),
  name: "Acme",
  taxId: "526-025-02-74",
  address: "ul. Morska 5",
  postalCode: "80-001",
  city: "Gdansk",
};

describe("odczyty kupujacego", () => {
  it("zamowienia i dokumenty bez argumentow (tozsamosc z sesji)", async () => {
    stub.setData("event_my_invoice_sources", [myInvoiceSourceRow()]);
    stub.setData("event_my_invoices", [myInvoiceRow()]);
    await expect(api.fetchMyInvoiceSources()).resolves.toHaveLength(1);
    await expect(api.fetchMyInvoices()).resolves.toHaveLength(1);
    expect(stub.lastCall("event_my_invoice_sources")?.keys()).toEqual([]);
    expect(stub.lastCall("event_my_invoices")?.keys()).toEqual([]);
  });

  it("null = pusta lista, blad = wyjatek", async () => {
    stub.setData("event_my_invoice_sources", null);
    stub.setData("event_my_invoices", null);
    await expect(api.fetchMyInvoiceSources()).resolves.toEqual([]);
    await expect(api.fetchMyInvoices()).resolves.toEqual([]);
    stub.setError("event_my_invoice_sources", "boom");
    stub.setError("event_my_invoices", "boom2");
    await expect(api.fetchMyInvoiceSources()).rejects.toThrow("boom");
    await expect(api.fetchMyInvoices()).rejects.toThrow("boom2");
  });

  it("wlasny dokument do PDF", async () => {
    stub.setData("event_my_invoice", invoiceDocumentJson());
    await expect(api.fetchMyInvoice(INVOICE_IDS.invoice)).resolves.toMatchObject({ number: "FV/2026/09/0001" });
    expect(stub.lastCall("event_my_invoice")?.args).toEqual({ p_id: INVOICE_IDS.invoice });
    stub.setData("event_my_invoice", null);
    await expect(api.fetchMyInvoice(INVOICE_IDS.invoice)).rejects.toThrow("unknown:");
    stub.setError("event_my_invoice", "not_found: document");
    await expect(api.fetchMyInvoice(INVOICE_IDS.invoice)).rejects.toThrow("not_found");
  });
});

describe("prosba o fakture", () => {
  it("do zapisu: registration_id + znormalizowany nabywca", async () => {
    stub.setData("event_invoice_request_save", INVOICE_IDS.request);
    await expect(api.saveInvoiceRequest({ registrationId: INVOICE_IDS.registration }, BUYER)).resolves.toBe(
      INVOICE_IDS.request,
    );
    const call = stub.lastCall("event_invoice_request_save");
    expect(call?.keys()).toEqual(["p_payload"]);
    expect(call?.arg("p_payload")).toEqual({
      registration_id: INVOICE_IDS.registration,
      buyer: expect.objectContaining({ tax_id: "5260250274", name: "Acme", country: "PL" }),
    });
  });

  it("do pakietu: package_order_id, bez klucza zapisu", async () => {
    stub.setData("event_invoice_request_save", INVOICE_IDS.request);
    await api.saveInvoiceRequest({ packageOrderId: INVOICE_IDS.packageOrder }, BUYER);
    const payload = stub.lastCall("event_invoice_request_save")?.arg("p_payload");
    expect(payload).toMatchObject({ package_order_id: INVOICE_IDS.packageOrder });
    expect(payload).not.toHaveProperty("registration_id");
    stub.setError("event_invoice_request_save", "request_window_closed: x");
    await expect(api.saveInvoiceRequest({ packageOrderId: "p" }, BUYER)).rejects.toThrow("request_window_closed");
  });

  it("wycofanie prosby", async () => {
    stub.setData("event_invoice_request_cancel", INVOICE_IDS.request);
    await expect(api.cancelInvoiceRequest(INVOICE_IDS.request)).resolves.toBe(INVOICE_IDS.request);
    expect(stub.lastCall("event_invoice_request_cancel")?.args).toEqual({ p_request_id: INVOICE_IDS.request });
    stub.setError("event_invoice_request_cancel", "not_found: x");
    await expect(api.cancelInvoiceRequest("x")).rejects.toThrow("not_found");
  });
});
