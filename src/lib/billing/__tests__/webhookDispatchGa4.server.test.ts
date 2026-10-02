// Zakup z webhooka w GA4 - NAJEMCA decyduje o strumieniu (audyt wyd. 12, 16.8).
//
// CO BYŁO ZŁE. `reportPurchaseToGa4` wysyłał każdy opłacony zakup
// jednorazowy do strumienia wdrożenia: ignorował identyfikator pomiaru
// skonfigurowany w panelu najemcy i jego wyłącznik „Odłącz GA4". Panel
// mówił „GA4 wyłączone", a serwer i tak raportował przychód do Google.
//
// CO TEN PLIK PRZYBIJA. Najemca zakupu pochodzi z NASZEGO wiersza (zamówienie
// albo darowizna, w środowisku zdarzenia) i jedzie do `sendGa4Purchase`, który
// respektuje panel (testy `ga4MpServer.test.ts`). Zakup, którego nie da się
// przypisać do najemcy, nie idzie do GA4 wcale. Awaria analityki nie wywraca
// realizacji płatności.
//
// ATRAPY NA GRANICACH: klient roli serwisowej (`client.server`), realizacja
// zamówienia (`oneTimeFulfilment.server` - ma własne testy, tu liczy się
// wyłącznie to, co dzieje się PO niej) i wysyłka do GA4 (`ga4Mp.server`).
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabase/chain";
import { FIXED_NOW_ISO, freezeClock } from "@/test/time";
import type { TransactionData } from "@/lib/billing/webhookDispatch.server";

const h = vi.hoisted(() => ({
  sendGa4Purchase: vi.fn(),
  fulfil: vi.fn(),
}));

let db: SupabaseFromStub;

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => db.from(table) },
}));
vi.mock("@/lib/billing/oneTimeFulfilment.server", () => ({
  fulfilOneTimeTransaction: (...args: unknown[]) => h.fulfil(...args),
  markOneTimePaymentFailed: vi.fn(),
}));
vi.mock("@/lib/analytics/ga4Mp.server", () => ({
  sendGa4Purchase: (input: unknown) => h.sendGa4Purchase(input),
}));
vi.mock("@/lib/stripe.server", () => ({
  getStripeClient: () => {
    throw new Error("test: żaden przypadek nie ma prawa wołać operatora");
  },
}));

const { dispatchWebhookEvent } = await import("@/lib/billing/webhookDispatch.server");

function oneTime(customData: Record<string, unknown> | null): TransactionData {
  return {
    id: "txn_ga4_1",
    subscriptionId: null,
    customerId: "cus_1",
    paymentIntentId: "pi_1",
    currencyCode: "PLN",
    customData,
    customer: { email: "kupujacy@example.com" },
    details: { totals: { grandTotal: "4900" } },
  };
}

async function paid(data: TransactionData) {
  return dispatchWebhookEvent({
    eventType: "transaction.completed",
    data,
    environment: "live",
    occurredAt: FIXED_NOW_ISO,
  });
}

/** Filtry zapytania o NAJEMCĘ zakupu (`select("tenant_id")`) - inne odczyty pomijamy. */
function eqs(table: string): unknown[][] {
  return db
    .chainsFor(table)
    .filter((chain) => chain.argsOf("select")?.[0] === "tenant_id")
    .flatMap((chain) => chain.calls.filter((call) => call.method === "eq"))
    .map((call) => [...call.args]);
}

// Zamrożenie na poziomie pliku (`freezeClock` sam rejestruje before/afterEach).
freezeClock();

beforeEach(() => {
  db = supabaseFromStub();
  h.sendGa4Purchase.mockReset().mockResolvedValue(undefined);
  h.fulfil.mockReset().mockResolvedValue("order");
});

describe("zakup jednorazowy w GA4 - najemca z naszego wiersza", () => {
  it("zamówienie: najemca z `payment_orders` W ŚRODOWISKU zdarzenia", async () => {
    db.setResponse("payment_orders", ok({ tenant_id: "ten_a" }));

    expect(await paid(oneTime({ orderId: "order-1" }))).toBe("processed");

    expect(eqs("payment_orders")).toEqual([
      ["id", "order-1"],
      ["environment", "live"],
    ]);
    expect(h.sendGa4Purchase).toHaveBeenCalledWith({
      transactionId: "txn_ga4_1",
      amountCents: 4900,
      currency: "PLN",
      clientId: null,
      tenantId: "ten_a",
    });
  });

  it("historyczna pisownia `order_id` też wskazuje zamówienie", async () => {
    db.setResponse("payment_orders", ok({ tenant_id: "ten_a" }));

    await paid(oneTime({ order_id: "order-2" }));

    expect(eqs("payment_orders")[0]).toEqual(["id", "order-2"]);
    expect(h.sendGa4Purchase).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "ten_a" }));
  });

  it("darowizna: najemca z `donations`", async () => {
    db.setResponse("donations", ok({ tenant_id: "ten_d" }));

    await paid(oneTime({ purpose: "donation", donationId: "don-1" }));

    expect(eqs("donations")).toEqual([
      ["id", "don-1"],
      ["environment", "live"],
    ]);
    expect(h.sendGa4Purchase).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "ten_d" }));
  });

  it("zakup bez przypisanego najemcy NIE idzie do GA4", async () => {
    db.setResponse("payment_orders", ok(null));
    db.setResponse("donations", ok(null));

    await paid(oneTime({ orderId: "order-zniknal" }));
    await paid(oneTime({ purpose: "donation", donationId: "don-zniknela" }));
    await paid(oneTime({ purpose: "ticket" }));
    await paid(oneTime(null));

    expect(h.sendGa4Purchase).not.toHaveBeenCalled();
  });

  it("pusty identyfikator zamówienia nie trafia do zapytania", async () => {
    await paid(oneTime({ orderId: "", donationId: "" }));

    expect(eqs("payment_orders")).toEqual([]);
    expect(eqs("donations")).toEqual([]);
    expect(h.sendGa4Purchase).not.toHaveBeenCalled();
  });

  it("`_ga_client_id` jako tekst zszywa zakup z sesją; inny typ jest ignorowany", async () => {
    db.setResponse("payment_orders", ok({ tenant_id: "ten_a" }));

    await paid(oneTime({ orderId: "order-1", _ga_client_id: "111.222" }));
    await paid(oneTime({ orderId: "order-1", _ga_client_id: 111222 }));

    expect(h.sendGa4Purchase.mock.calls[0]?.[0]).toMatchObject({ clientId: "111.222" });
    expect(h.sendGa4Purchase.mock.calls[1]?.[0]).toMatchObject({ clientId: null });
  });

  it("awaria analityki nie wywraca realizacji płatności", async () => {
    db.setResponse("payment_orders", () => {
      throw new Error("connection reset");
    });
    const blad = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await paid(oneTime({ orderId: "order-1" }))).toBe("processed");

    expect(h.fulfil).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(blad.mock.calls)).toContain("GA4 purchase report failed");
    blad.mockRestore();
  });
});
