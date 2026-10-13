// Dokument rozliczeniowy z webhooka - KIEDY i DLA KTÓREJ transakcji (PAY-12).
//
// CO BYŁO ZŁE. `transaction.completed` zapisywał dokument PRZED realizacją
// zamówienia. Właściciela zakupu jednorazowego `billingDocuments.server`
// ustala po `payment_orders.provider_intent_id`, które stempluje dopiero
// realizacja - więc odczyt nie znajdował nikogo, błąd był połykany, a zakup
// jednorazowy NIGDY nie dostawał dokumentu w panelu klienta. Pierwsza sesja
// Checkout subskrypcji zakładała z kolei fantom `cs_...` (status `pending`,
// bo sesja nie ma pola statusu) obok właściwej faktury `in_...`.
//
// CO TEN PLIK PRZYBIJA. Dokument powstaje PO realizacji i jest opłacony;
// subskrypcja ma dokładnie jeden dokument - fakturę z `invoice.paid`;
// porażka dokumentu nie wywraca obsługi zdarzenia (to nie są pieniądze).
//
// ATRAPY NA GRANICACH: klient roli serwisowej (`client.server`, tabele
// w pamięci), realizacja zamówienia (`oneTimeFulfilment.server` - ma własne
// testy; tu odtwarzamy wyłącznie jej kontrakt: stempluje `provider_intent_id`
// identyfikatorem transakcji) i wysyłka do GA4. Normalizacja zdarzeń Stripe,
// dyspozytor, windykacja i zapis dokumentu biegną PRAWDZIWYM kodem.
//
// RODO: adresy syntetyczne (`example.com`), identyfikatory zmyślone.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fail, ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabase/chain";
import { rowStore, type RowStore } from "@/test/billing/rowStore";
import type { VerifiedWebhookEvent } from "@/lib/stripe.server";

const h = vi.hoisted(() => ({
  fulfilFails: false,
}));

let db: SupabaseFromStub;

/** Łańcuch zapisu w kształcie, jakiego używa realizacja (`update().eq().eq()`). */
interface FilteredWrite extends PromiseLike<{ error: unknown }> {
  eq(column: string, value: unknown): FilteredWrite;
}
const ordersTable = () => db.from("payment_orders") as { update(patch: unknown): FilteredWrite };

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => db.from(table) },
}));
// Kontrakt realizacji: zamówienie z `metadata.orderId` W ŚRODOWISKU zdarzenia
// dostaje `status = paid` i `provider_intent_id` = identyfikator transakcji.
vi.mock("@/lib/billing/oneTimeFulfilment.server", () => ({
  fulfilOneTimeTransaction: async (
    txn: { id: string; customData: Record<string, unknown> | null },
    env: string,
  ) => {
    if (h.fulfilFails) throw new Error("one-time: order paid flip failed: connection reset");
    const { error } = await ordersTable()
      .update({ status: "paid", provider_intent_id: txn.id })
      .eq("id", txn.customData?.["orderId"])
      .eq("environment", env);
    if (error) throw new Error("one-time: order paid flip failed");
    return "order";
  },
  settleSubscriptionCheckoutOrder: async () => "skipped",
  markOneTimePaymentFailed: async () => {},
  expireCheckoutOrder: async () => false,
}));
vi.mock("@/lib/analytics/ga4Mp.server", () => ({ sendGa4Purchase: async () => {} }));
vi.mock("@/lib/stripe.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe.server")>()),
  getStripeClient: () => {
    throw new Error("test: żaden przypadek nie ma prawa wołać operatora");
  },
}));

const { dispatchWebhookEvent } = await import("@/lib/billing/webhookDispatch.server");
const { normalizeStripeEvent } = await import("@/lib/billing/stripeEvents.server");

const OWNER = { user_id: "user-kupujacy", tenant_id: "tenant-alfa" };
const CREATED_S = Math.floor(Date.parse("2026-09-01T10:00:00.000Z") / 1000);

let orders: RowStore;
let documents: RowStore;
let subscriptions: RowStore;

/** Zdarzenie Stripe z bramki -> normalizacja -> dyspozytor (jak trasa webhooka). */
async function deliver(type: string, object: Record<string, unknown>, id: string) {
  const event: VerifiedWebhookEvent = { id, type, created: CREATED_S, data: { object } };
  const normalized = normalizeStripeEvent(event);
  if (!normalized) throw new Error(`test: zdarzenie ${type} poza zakresem integracji`);
  return dispatchWebhookEvent({
    eventId: id,
    eventType: normalized.eventType,
    data: normalized.data,
    environment: "live",
    occurredAt: new Date(CREATED_S * 1000).toISOString(),
  });
}

/** Opłacona sesja Checkout zakupu jednorazowego. */
const ONE_TIME_SESSION = {
  id: "cs_live_jednorazowy",
  object: "checkout.session",
  mode: "payment",
  payment_status: "paid",
  amount_total: 4900,
  currency: "pln",
  customer: "cus_kupujacy",
  payment_intent: "pi_jednorazowy",
  customer_details: { email: "kupujacy@example.com" },
  metadata: { orderId: "order-jednorazowe", purpose: "content" },
};

/** Pierwsza sesja Checkout subskrypcji (tryb `subscription`). */
const SUBSCRIPTION_SESSION = {
  id: "cs_live_subskrypcja",
  object: "checkout.session",
  mode: "subscription",
  payment_status: "paid",
  amount_total: 9900,
  currency: "pln",
  customer: "cus_kupujacy",
  subscription: "sub_kupujacy",
  customer_details: { email: "kupujacy@example.com" },
  metadata: { orderId: "order-subskrypcja", userId: OWNER.user_id },
};

/** Faktura pierwszego okresu tej subskrypcji (kształt API Basil). */
const FIRST_INVOICE = {
  id: "in_live_pierwsza",
  object: "invoice",
  customer: "cus_kupujacy",
  customer_email: "kupujacy@example.com",
  currency: "pln",
  amount_paid: 9900,
  total: 9900,
  number: "FV/2026/09/0001",
  hosted_invoice_url: "https://invoice.example.test/hosted",
  invoice_pdf: "https://invoice.example.test/pdf",
  status_transitions: { paid_at: CREATED_S },
  parent: {
    subscription_details: {
      subscription: "sub_kupujacy",
      metadata: { orderId: "order-subskrypcja", userId: OWNER.user_id },
    },
  },
  lines: { data: [{ period: { end: CREATED_S + 30 * 86_400 } }] },
};

beforeEach(() => {
  h.fulfilFails = false;
  db = supabaseFromStub();
  orders = rowStore({
    rows: [
      {
        id: "order-jednorazowe",
        ...OWNER,
        environment: "live",
        status: "pending",
        provider_intent_id: null,
      },
    ],
  });
  documents = rowStore({ unique: ["provider_document_id"] });
  subscriptions = rowStore({
    rows: [
      {
        provider_subscription_id: "sub_kupujacy",
        environment: "live",
        ...OWNER,
        price_id: "pro_monthly",
        current_period_end: null,
        payment_failure_count: 0,
        last_dunning_transaction_id: null,
      },
    ],
  });
  db.setResponse("payment_orders", (chain) => orders.respond(chain));
  db.setResponse("billing_documents", (chain) => documents.respond(chain));
  db.setResponse("subscriptions", (chain) => subscriptions.respond(chain));
});

describe("dokument rozliczeniowy z `transaction.completed` (PAY-12)", () => {
  it("zakup jednorazowy zakłada dokument - właściciel znaleziony przez zamówienie PO realizacji", async () => {
    expect(await deliver("checkout.session.completed", ONE_TIME_SESSION, "evt_jednorazowy")).toBe(
      "processed",
    );

    expect(documents.rows).toEqual([
      expect.objectContaining({
        provider_document_id: "cs_live_jednorazowy",
        // Sesja nie ma pola statusu - `transaction.completed` znaczy „opłacone".
        status: "paid",
        amount_cents: 4900,
        currency: "PLN",
        user_id: OWNER.user_id,
        tenant_id: OWNER.tenant_id,
      }),
    ]);
    // Kolejność dowodzi przyczyny: najpierw realizacja stempluje zamówienie,
    // dopiero potem odczyt właściciela po `provider_intent_id`.
    const chains = db.chainsFor("payment_orders");
    const stamped = chains.findIndex((c) => c.has("update"));
    const ownerLookup = chains.findIndex((c) =>
      c.calls.some((call) => call.method === "eq" && call.args[0] === "provider_intent_id"),
    );
    expect(stamped).toBeGreaterThanOrEqual(0);
    expect(ownerLookup).toBeGreaterThan(stamped);
  });

  it("kasa subskrypcji + `invoice.paid`: dokładnie jeden dokument - faktura `in_`", async () => {
    // Sesja subskrypcji NIE zakłada dokumentu (rozliczeniem jest faktura),
    // a dwa zdarzenia tej samej faktury (`invoice.paid` i
    // `invoice.payment_succeeded`) trafiają w jeden wiersz.
    expect(
      await deliver("checkout.session.completed", SUBSCRIPTION_SESSION, "evt_kasa_subskrypcji"),
    ).toBe("processed");
    expect(await deliver("invoice.paid", FIRST_INVOICE, "evt_faktura_oplacona")).toBe("processed");
    expect(await deliver("invoice.payment_succeeded", FIRST_INVOICE, "evt_faktura_platnosc")).toBe(
      "processed",
    );

    expect(documents.rows).toEqual([
      expect.objectContaining({
        provider_document_id: "in_live_pierwsza",
        number: "FV/2026/09/0001",
        status: "paid",
        amount_cents: 9900,
        user_id: OWNER.user_id,
        tenant_id: OWNER.tenant_id,
      }),
    ]);
    // Fantomu sesji nie ma nawet jako próby zapisu.
    const sessionDocs = db
      .chainsFor("billing_documents")
      .filter((c) => c.calls.some((call) => call.args.includes("cs_live_subskrypcja")));
    expect(sessionDocs).toHaveLength(0);
  });

  it("porażka realizacji nie zostawia dokumentu - zdarzenie pada w całości i wróci", async () => {
    h.fulfilFails = true;

    await expect(
      deliver("checkout.session.completed", ONE_TIME_SESSION, "evt_jednorazowy"),
    ).rejects.toThrow("one-time: order paid flip failed");

    expect(db.chainsFor("billing_documents")).toHaveLength(0);
  });

  it("porażka zapisu dokumentu: zamówienie JUŻ zrealizowane, zdarzenie pada i wróci (INV)", async () => {
    // Rejestr dokumentów to dowód sprzedaży (audyt INV): zdarzenie zamknięte
    // mimo braku dokumentu nigdy by nie wróciło, więc zapis, który padł, RZUCA
    // (500 -> ponowienie). Kolejność PAY-12 zostaje: realizacja idzie PIERWSZA,
    // więc klient ma dostęp, zanim rejestr dokumentów zawiedzie, a ponowienie
    // realizacji jest idempotentne.
    db.setResponse("billing_documents", (chain) =>
      chain.has("insert") ? fail("permission denied") : ok(null),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      deliver("checkout.session.completed", ONE_TIME_SESSION, "evt_jednorazowy"),
    ).rejects.toThrow("billing document not recorded: cs_live_jednorazowy");

    expect(orders.rows[0]).toMatchObject({ status: "paid" });
    error.mockRestore();
  });
});
