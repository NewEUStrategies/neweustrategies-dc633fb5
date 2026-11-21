import { beforeEach, describe, expect, it } from "vitest";
import {
  META_CHECKOUT_MARKER_TTL_MS,
  consumeMetaCheckout,
  rememberMetaCheckout,
} from "../metaCheckoutMarker";

const marker = {
  event: "Subscribe" as const,
  value: 49,
  currency: "PLN",
  contentId: "plan-1",
  category: "membership_plan",
  eventId: "membership_plan-1_x",
};

describe("Meta checkout marker", () => {
  beforeEach(() => sessionStorage.clear());

  it("returns the remembered checkout exactly once", () => {
    rememberMetaCheckout("membership", marker, 1_000);
    expect(consumeMetaCheckout("membership", 2_000)).toMatchObject(marker);
    expect(consumeMetaCheckout("membership", 3_000)).toBeNull();
  });

  it("sends nothing on a success page visited without a checkout", () => {
    expect(consumeMetaCheckout("membership")).toBeNull();
  });

  it("ignores a checkout older than 6 hours", () => {
    rememberMetaCheckout("membership", marker, 0);
    expect(consumeMetaCheckout("membership", META_CHECKOUT_MARKER_TTL_MS + 1)).toBeNull();
  });

  it("keeps donations and memberships apart", () => {
    rememberMetaCheckout("donation", { ...marker, event: "Donate" }, 0);
    expect(consumeMetaCheckout("membership", 1)).toBeNull();
    expect(consumeMetaCheckout("donation", 1)?.event).toBe("Donate");
  });

  it("rejects a tampered marker", () => {
    sessionStorage.setItem("meta:checkout:membership", JSON.stringify({ ...marker, event: "Lead", createdAt: 0 }));
    expect(consumeMetaCheckout("membership", 1)).toBeNull();
  });
});
