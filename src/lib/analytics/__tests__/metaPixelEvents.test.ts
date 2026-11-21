import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const consent = vi.hoisted(() => ({ marketing: true }));

vi.mock("@/lib/ads/consent", () => ({
  hasCategoryConsent: (cat: string) => (cat === "marketing" ? consent.marketing : true),
}));

import { sanitizeMetaParams, trackMetaEvent } from "../metaPixelEvents";

type FbqWindow = Window & { fbq?: unknown };

describe("trackMetaEvent", () => {
  let fbq: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    consent.marketing = true;
    fbq = vi.fn();
    (window as FbqWindow).fbq = fbq;
  });

  afterEach(() => {
    delete (window as FbqWindow).fbq;
  });

  it("sends Lead with an eventID after marketing consent", () => {
    expect(trackMetaEvent("Lead", { content_category: "form" }, "lead_abc")).toBe(true);
    expect(fbq).toHaveBeenCalledWith("track", "Lead", { content_category: "form" }, { eventID: "lead_abc" });
  });

  it("sends nothing without marketing consent", () => {
    consent.marketing = false;
    expect(trackMetaEvent("CompleteRegistration")).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
  });

  it("sends nothing when the Meta pixel was not started", () => {
    delete (window as FbqWindow).fbq;
    expect(trackMetaEvent("Lead")).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
  });

  it("generates a distinct eventID per call", () => {
    trackMetaEvent("Lead");
    trackMetaEvent("Lead");
    const first = fbq.mock.calls[0]?.[3] as { eventID: string };
    const second = fbq.mock.calls[1]?.[3] as { eventID: string };
    expect(first.eventID).not.toBe(second.eventID);
  });
});

describe("sanitizeMetaParams", () => {
  it("keeps a checkout value with its currency rounded to cents", () => {
    expect(sanitizeMetaParams({ value: 49.999, currency: "pln", num_items: 1 })).toEqual({
      value: 50,
      currency: "PLN",
      num_items: 1,
    });
  });

  it("drops a value without a valid currency", () => {
    expect(sanitizeMetaParams({ value: 10, currency: "zloty" })).toEqual({});
  });

  it("drops negative values and empty content ids", () => {
    expect(sanitizeMetaParams({ value: -5, currency: "EUR", content_ids: ["", " plan_1 "] })).toEqual({
      currency: "EUR",
      content_ids: ["plan_1"],
    });
  });
});
