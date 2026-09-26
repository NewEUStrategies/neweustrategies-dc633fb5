// Mail do kupujacego o wystawionym dokumencie. Granica autoryzacji jest
// w bazie (`admin_event_invoice_notify_payload` wolane KLIENTEM uzytkownika),
// wiec test pilnuje, ze serwer: czyta ladunek wylacznie ta funkcja, milczy
// o szkicu/anulowanym/bez konta/bez adresu, bierze najemce z ladunku (nie
// z wejscia) i wysyla z kluczem idempotencji per dokument.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

const { sendTxEmail } = vi.hoisted(() => ({ sendTxEmail: vi.fn() }));

vi.mock("@/lib/email/transactional.server", () => ({ sendTxEmail }));

const { buildEventInvoiceNotice, notifyIssuedInvoices } = await import(
  "@/lib/events/eventInvoiceNotify.server"
);

const PAYLOAD: { [key: string]: Json } = {
  tenant_id: "tenant-1",
  invoice_id: "inv-1",
  status: "issued",
  kind: "invoice",
  number: "FV/2026/09/0001",
  issue_date: "2026-09-20",
  gross_cents: 24601,
  currency: "PLN",
  locale: "pl",
  event_title_pl: "Kongres 27",
  event_title_en: "Congress 27",
  buyer_name: "Acme",
  has_account: true,
  recipient: " ksiegowosc@acme.example.com ",
};

type Rpc = (name: string, args: { p_id: string }) => Promise<{ data: Json | null; error: { message: string } | null }>;

interface RpcSurface {
  rpc: Rpc;
}

/** Straznik, nie rzutowanie: atrapa bez ogniwa `rpc` nie udaje klienta. */
function isDbClient(candidate: RpcSurface): candidate is RpcSurface & SupabaseClient<Database> {
  return typeof candidate.rpc === "function";
}

function client(rpc: Rpc): SupabaseClient<Database> {
  const candidate: RpcSurface = { rpc };
  if (!isDbClient(candidate)) throw new Error("test: atrapa nie niesie ogniwa rpc()");
  return candidate;
}

beforeEach(() => {
  sendTxEmail.mockReset();
});

describe("buildEventInvoiceNotice", () => {
  it("polski dokument: adres przyciety, najemca z ladunku, szczegoly maila", () => {
    const notice = buildEventInvoiceNotice(PAYLOAD);
    expect(notice).toMatchObject({
      invoiceId: "inv-1",
      tenantId: "tenant-1",
      to: "ksiegowosc@acme.example.com",
      lang: "pl",
      subjectName: "Kongres 27",
    });
    expect(notice?.details.map((detail) => detail.label)).toEqual(["Wydarzenie", "Numer dokumentu", "Kwota"]);
    expect(notice?.details[1].value).toBe("FV/2026/09/0001");
    expect(notice?.details[2].value).toMatch(/246,01/);
  });

  it("angielski dokument: angielski tytul i etykiety; bez tytulu - bez wiersza wydarzenia", () => {
    const en = buildEventInvoiceNotice({ ...PAYLOAD, locale: "en", currency: "EUR", gross_cents: 5000 });
    expect(en?.lang).toBe("en");
    expect(en?.subjectName).toBe("Congress 27");
    expect(en?.details.map((detail) => detail.label)).toEqual(["Event", "Document number", "Amount"]);
    const untitled = buildEventInvoiceNotice({ ...PAYLOAD, event_title_pl: "", gross_cents: "x", currency: "" });
    expect(untitled?.details.map((detail) => detail.label)).toEqual(["Numer dokumentu", "Kwota"]);
    expect(untitled?.details[1].value).toMatch(/0,00/);
  });

  it("milczy: szkic/anulowany, bez konta, bez adresu, bez najemcy, zly ksztalt", () => {
    for (const payload of [
      { ...PAYLOAD, status: "draft" },
      { ...PAYLOAD, status: "cancelled" },
      { ...PAYLOAD, has_account: false },
      { ...PAYLOAD, recipient: "  " },
      { ...PAYLOAD, recipient: null },
      { ...PAYLOAD, tenant_id: "" },
    ]) {
      expect(buildEventInvoiceNotice(payload)).toBeNull();
    }
    expect(buildEventInvoiceNotice(null)).toBeNull();
    expect(buildEventInvoiceNotice([PAYLOAD])).toBeNull();
    expect(buildEventInvoiceNotice("x")).toBeNull();
  });
});

describe("notifyIssuedInvoices", () => {
  it("wysyla, liczy pominiete i nieudane; klucz idempotencji per dokument", async () => {
    const responses: Record<string, { data: Json | null; error: { message: string } | null }> = {
      a: { data: { ...PAYLOAD, invoice_id: "a" }, error: null },
      b: { data: { ...PAYLOAD, invoice_id: "b", has_account: false }, error: null },
      c: { data: null, error: { message: "forbidden: admin role required" } },
      d: { data: { ...PAYLOAD, invoice_id: "d" }, error: null },
      e: { data: { ...PAYLOAD, invoice_id: "e" }, error: null },
    };
    const rpc = vi.fn<Rpc>(async (_name, args) => responses[args.p_id]);
    sendTxEmail
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, skipped: "duplicate" })
      .mockResolvedValueOnce({ ok: false, error: "smtp" });
    const result = await notifyIssuedInvoices(client(rpc), ["a", "b", "c", "d", "e"]);
    expect(result).toEqual({ sent: 1, skipped: 2, failed: 2 });
    expect(rpc).toHaveBeenCalledTimes(5);
    expect(rpc.mock.calls.every(([name]) => name === "admin_event_invoice_notify_payload")).toBe(true);
    expect(sendTxEmail).toHaveBeenCalledTimes(3);
    expect(sendTxEmail.mock.calls[0]?.[0]).toMatchObject({
      type: "event_invoice_issued",
      to: "ksiegowosc@acme.example.com",
      lang: "pl",
      subjectName: "Kongres 27",
      ctaPath: "/profile/invoices",
      tenantId: "tenant-1",
      idempotencyKey: "event-invoice:a:issued",
    });
    expect(sendTxEmail.mock.calls[1]?.[0]).toMatchObject({ idempotencyKey: "event-invoice:d:issued" });
  });

  it("pusta lista = nic", async () => {
    const rpc = vi.fn<Rpc>();
    await expect(notifyIssuedInvoices(client(rpc), [])).resolves.toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(rpc).not.toHaveBeenCalled();
  });
});
