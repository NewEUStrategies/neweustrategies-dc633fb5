// Kontrakt: subskrypcja MUSI powstać z ceny katalogowej dostawcy.
// Transakcja z ceną ad-hoc dawałaby jednorazowe obciążenie - bez cyklu
// rozliczeniowego, bez okresu próbnego i bez zdarzeń `subscription.*`,
// więc cały downstream (odnowienia, dunning, portal) byłby martwy.
import { describe, it, expect, vi, beforeEach } from "vitest";

const gatewayFetch = vi.fn();

vi.mock("@/lib/stripe.server", () => ({ gatewayFetch }));

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("createSubscriptionTransaction", () => {
  beforeEach(() => {
    gatewayFetch.mockReset();
    vi.resetModules();
  });

  it("rozwiązuje czytelny identyfikator ceny i wysyła pozycję cennikową", async () => {
    gatewayFetch
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "pri_123" }] }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "txn_123" } }));

    const { createSubscriptionTransaction } =
      await import("@/lib/billing/paddleTransaction.server");
    const result = await createSubscriptionTransaction({
      environment: "sandbox",
      priceExternalId: "pro_monthly",
      quantity: 3,
      customerEmail: "kto@example.com",
      discountId: "dsc_1",
      customData: { userId: "u1" },
    });

    expect(result).toEqual({ ok: true, transactionId: "txn_123" });

    const lookupPath = gatewayFetch.mock.calls[0][1] as string;
    expect(lookupPath).toContain("/prices?external_id=pro_monthly");

    const body = JSON.parse((gatewayFetch.mock.calls[1][2] as RequestInit).body as string);
    expect(body.items).toEqual([{ price_id: "pri_123", quantity: 3 }]);
    expect(body.discount_id).toBe("dsc_1");
    expect(body.custom_data).toEqual({ userId: "u1" });
    // Cena ad-hoc jest zakazana na tej ścieżce.
    expect(JSON.stringify(body)).not.toContain("unit_price");
  });

  it("zwraca błąd zamiast rzucać, gdy cena katalogowa nie istnieje", async () => {
    gatewayFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));
    const { createSubscriptionTransaction } =
      await import("@/lib/billing/paddleTransaction.server");
    const result = await createSubscriptionTransaction({
      environment: "sandbox",
      priceExternalId: "nieistniejaca",
      customData: {},
    });
    expect(result).toEqual({ ok: false, error: "price_missing" });
  });
});
