// Samoobsługowa synchronizacja: idzie tą samą ścieżką co webhook i nigdy nie
// dotyka subskrypcji należącej do innego użytkownika.
import { describe, expect, it, vi, beforeEach } from "vitest";

const retrieve = vi.fn();
const search = vi.fn();
const dispatch = vi.fn();

vi.mock("@/lib/stripe.server", () => ({
  createStripeClient: () => ({ subscriptions: { retrieve, search } }),
}));
vi.mock("@/lib/billing/webhookDispatch.server", () => ({
  dispatchWebhookEvent: (input: unknown) => {
    dispatch(input);
    return Promise.resolve("processed");
  },
}));

const subscription = (id: string, userId: string, status = "active") => ({
  id,
  status,
  customer: "cus_1",
  metadata: { userId },
  items: {
    data: [
      {
        price: { id: "price_1", lookup_key: "pro_monthly", product: "prod_1" },
        current_period_start: 1_700_000_000,
        current_period_end: 1_702_000_000,
        quantity: 1,
      },
    ],
  },
});

describe("syncUserSubscriptionsFromProvider", () => {
  beforeEach(() => {
    retrieve.mockReset();
    search.mockReset();
    dispatch.mockReset();
    search.mockResolvedValue({ data: [] });
  });

  it("nie robi nic, gdy użytkownik nie ma subskrypcji", async () => {
    const { syncUserSubscriptionsFromProvider } = await import("../selfSync.server");
    const result = await syncUserSubscriptionsFromProvider("sandbox", "user-1", []);
    expect(result).toEqual({ scanned: 0, applied: 0, statuses: [] });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("przepuszcza subskrypcję wołającego przez dyspozytor webhooka", async () => {
    retrieve.mockResolvedValue(subscription("sub_1", "user-1"));
    const { syncUserSubscriptionsFromProvider } = await import("../selfSync.server");
    const result = await syncUserSubscriptionsFromProvider("sandbox", "user-1", ["sub_1"]);
    expect(result.applied).toBe(1);
    expect(result.statuses).toEqual(["active"]);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0]).toMatchObject({ environment: "sandbox" });
  });

  it("pomija subskrypcję należącą do kogoś innego", async () => {
    retrieve.mockResolvedValue(subscription("sub_2", "intruder"));
    const { syncUserSubscriptionsFromProvider } = await import("../selfSync.server");
    const result = await syncUserSubscriptionsFromProvider("sandbox", "user-1", ["sub_2"]);
    expect(result.applied).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("mapuje anulowaną subskrypcję na zdarzenie usunięcia", async () => {
    retrieve.mockResolvedValue(subscription("sub_3", "user-1", "canceled"));
    const { syncUserSubscriptionsFromProvider } = await import("../selfSync.server");
    await syncUserSubscriptionsFromProvider("sandbox", "user-1", ["sub_3"]);
    expect(dispatch.mock.calls[0][0]).toMatchObject({ eventType: "subscription.canceled" });
  });
});
