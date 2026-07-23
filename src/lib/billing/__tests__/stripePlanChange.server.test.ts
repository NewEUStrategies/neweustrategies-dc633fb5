// Zmiana planu po stronie Stripe: kodowanie parametrów (prorata od razu,
// nieudana dopłata nie zmienia planu, kwartał = month x 3) i mapowanie błędów.
// Wstrzykiwany fetch - bez sieci i bez realnego klucza (konwencja stripe.server).
import { describe, it, expect, vi } from "vitest";
import {
  changeStripeSubscriptionPrice,
  fetchStripeInvoice,
  fetchStripeSubscriptionItem,
} from "@/lib/billing/stripe.server";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("fetchStripeSubscriptionItem", () => {
  it("zwraca pozycję subskrypcji (item, produkt, waluta, koniec okresu)", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        current_period_end: 1893456000,
        items: { data: [{ id: "si_1", price: { product: "prod_1", currency: "pln" } }] },
      }),
    );
    const res = await fetchStripeSubscriptionItem("sub_1", "sk_test", fetchImpl);
    expect(res).toEqual({
      ok: true,
      item: {
        itemId: "si_1",
        productId: "prod_1",
        currency: "PLN",
        currentPeriodEnd: new Date(1893456000 * 1000).toISOString(),
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.stripe.com/v1/subscriptions/sub_1",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("subskrypcja bez pozycji = czytelny błąd (nie undefined)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { items: { data: [] } }));
    const res = await fetchStripeSubscriptionItem("sub_2", "sk_test", fetchImpl);
    expect(res.ok).toBe(false);
  });
});

describe("changeStripeSubscriptionPrice", () => {
  it("koduje proratę od razu, error_if_incomplete i kwartał jako month x 3", async () => {
    let sentBody = "";
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      sentBody = String(init?.body ?? "");
      return jsonResponse(200, { status: "active", current_period_end: 1893456000 });
    });
    const res = await changeStripeSubscriptionPrice(
      "sub_1",
      {
        itemId: "si_1",
        productId: "prod_1",
        currency: "PLN",
        unitAmountCents: 14900,
        interval: "month",
        intervalCount: 3,
      },
      "sk_test",
      fetchImpl,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.currentPeriodEnd).toBe(new Date(1893456000 * 1000).toISOString());
    }
    const params = new URLSearchParams(sentBody);
    expect(params.get("items[0][id]")).toBe("si_1");
    expect(params.get("items[0][price_data][product]")).toBe("prod_1");
    expect(params.get("items[0][price_data][currency]")).toBe("pln");
    expect(params.get("items[0][price_data][unit_amount]")).toBe("14900");
    expect(params.get("items[0][price_data][recurring][interval]")).toBe("month");
    expect(params.get("items[0][price_data][recurring][interval_count]")).toBe("3");
    expect(params.get("proration_behavior")).toBe("always_invoice");
    expect(params.get("payment_behavior")).toBe("error_if_incomplete");
    expect(params.get("cancel_at_period_end")).toBe("false");
  });

  it("zwykła kadencja nie wysyła interval_count", async () => {
    let sentBody = "";
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      sentBody = String(init?.body ?? "");
      return jsonResponse(200, { status: "active" });
    });
    await changeStripeSubscriptionPrice(
      "sub_1",
      {
        itemId: "si_1",
        productId: "prod_1",
        currency: "EUR",
        unitAmountCents: 990,
        interval: "year",
        intervalCount: 1,
      },
      "sk_test",
      fetchImpl,
    );
    const params = new URLSearchParams(sentBody);
    expect(params.get("items[0][price_data][recurring][interval]")).toBe("year");
    expect(params.get("items[0][price_data][recurring][interval_count]")).toBeNull();
  });

  it("odmowa Stripe (np. nieudana dopłata) mapuje się na ok:false z kodem", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(402, { error: { code: "card_declined", message: "Your card was declined." } }),
    );
    const res = await changeStripeSubscriptionPrice(
      "sub_1",
      {
        itemId: "si_1",
        productId: "prod_1",
        currency: "PLN",
        unitAmountCents: 5900,
        interval: "month",
        intervalCount: 1,
      },
      "sk_test",
      fetchImpl,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("card_declined");
  });
});

describe("fetchStripeInvoice", () => {
  it("zwraca metadane dokumentu (numer, linki, kwota, data)", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        hosted_invoice_url: "https://stripe.example/in_1",
        invoice_pdf: "https://stripe.example/in_1.pdf",
        number: "F/2026/07/007",
        status: "paid",
        amount_paid: 5900,
        currency: "pln",
        created: 1785456000,
      }),
    );
    const res = await fetchStripeInvoice("in_1", "sk_test", fetchImpl);
    expect(res).toEqual({
      ok: true,
      invoice: {
        hostedUrl: "https://stripe.example/in_1",
        pdfUrl: "https://stripe.example/in_1.pdf",
        number: "F/2026/07/007",
        status: "paid",
        amountPaidCents: 5900,
        currency: "PLN",
        createdAt: new Date(1785456000 * 1000).toISOString(),
      },
    });
  });
});
