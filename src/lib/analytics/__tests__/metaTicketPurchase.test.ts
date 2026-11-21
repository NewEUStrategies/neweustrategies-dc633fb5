import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const consent = vi.hoisted(() => ({ marketing: true }));
vi.mock("@/lib/ads/consent", () => ({
  hasCategoryConsent: (cat: string) => (cat === "marketing" ? consent.marketing : true),
}));

import { peekMetaCheckout, rememberMetaCheckout } from "../metaCheckoutMarker";
import { resetMetaPixelStateForTests } from "../metaPixelEvents";
import {
  META_TICKET_POLL_INTERVAL_MS,
  watchMetaTicketPurchase,
  type MetaTicketOrderRow,
} from "../metaTicketPurchase";

type FbqWindow = Window & { fbq?: unknown };

function rememberTicket(createdAt = Date.now()): void {
  rememberMetaCheckout(
    "ticket",
    {
      event: "Purchase",
      value: 100,
      currency: "PLN",
      contentId: "event-1",
      category: "event_ticket",
      eventId: "purchase_order-1",
      orderId: "order-1",
    },
    createdAt,
  );
}

describe("watchMetaTicketPurchase", () => {
  let fbq: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    localStorage.clear();
    resetMetaPixelStateForTests();
    consent.marketing = true;
    fbq = vi.fn();
    (window as FbqWindow).fbq = fbq;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as FbqWindow).fbq;
  });

  it("sends Purchase with the paid order amount after the database confirms payment", async () => {
    rememberTicket();
    const statuses: MetaTicketOrderRow[] = [
      { status: "pending", amount_cents: 8000, currency: "PLN" },
      { status: "paid", amount_cents: 8000, currency: "PLN", quantity: 2 },
    ];
    const fetchOrder = vi.fn(async () => statuses.shift() ?? null);
    watchMetaTicketPurchase(fetchOrder);
    await vi.advanceTimersByTimeAsync(0);
    expect(fbq).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(META_TICKET_POLL_INTERVAL_MS);
    expect(fbq).toHaveBeenCalledTimes(1);
    expect(fbq.mock.calls[0]?.[1]).toBe("Purchase");
    expect(fbq.mock.calls[0]?.[2]).toMatchObject({
      value: 80,
      currency: "PLN",
      content_ids: ["event-1"],
      num_items: 2,
    });
    expect(fbq.mock.calls[0]?.[3]).toEqual({ eventID: "purchase_order-1" });
    expect(peekMetaCheckout("ticket")).toBeNull();
  });

  it("never reports the same order twice", async () => {
    const fetchOrder = vi.fn(async () => ({ status: "paid", amount_cents: 5000, currency: "PLN" }));
    rememberTicket();
    watchMetaTicketPurchase(fetchOrder);
    await vi.advanceTimersByTimeAsync(0);
    rememberTicket();
    watchMetaTicketPurchase(fetchOrder);
    await vi.advanceTimersByTimeAsync(0);
    expect(fbq).toHaveBeenCalledTimes(1);
  });

  it("sends nothing and drops the marker when the payment failed", async () => {
    rememberTicket();
    watchMetaTicketPurchase(async () => ({ status: "failed", amount_cents: 5000, currency: "PLN" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(fbq).not.toHaveBeenCalled();
    expect(peekMetaCheckout("ticket")).toBeNull();
  });

  it("checks an old unpaid checkout only once per page", async () => {
    rememberTicket(Date.now() - 10 * 60_000);
    const fetchOrder = vi.fn(async () => ({ status: "pending", amount_cents: 5000, currency: "PLN" }));
    watchMetaTicketPurchase(fetchOrder);
    await vi.advanceTimersByTimeAsync(META_TICKET_POLL_INTERVAL_MS * 5);
    expect(fetchOrder).toHaveBeenCalledTimes(1);
    expect(peekMetaCheckout("ticket")).not.toBeNull();
  });

  it("does nothing on an ordinary visit without a ticket checkout", async () => {
    const fetchOrder = vi.fn(async () => null);
    watchMetaTicketPurchase(fetchOrder);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchOrder).not.toHaveBeenCalled();
  });
});
