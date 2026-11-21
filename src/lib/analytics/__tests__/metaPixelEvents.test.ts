import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const consent = vi.hoisted(() => ({ marketing: true }));

vi.mock("@/lib/ads/consent", () => ({
  hasCategoryConsent: (cat: string) => (cat === "marketing" ? consent.marketing : true),
}));

const mirror = vi.hoisted(() => ({ calls: [] as Array<{ name: string; eventId: string }> }));

vi.mock("../metaCapiMirror", () => ({
  mirrorMetaEventToCapi: (input: { name: string; eventId: string }) => {
    mirror.calls.push(input);
  },
}));

import {
  META_SEARCH_IDLE_MS,
  contactChannel,
  flushPendingMetaEvents,
  installMetaContactListener,
  resetMetaPixelStateForTests,
  sanitizeMetaParams,
  trackMetaEvent,
  trackMetaPageView,
  trackMetaSearch,
} from "../metaPixelEvents";

type FbqWindow = Window & { fbq?: unknown };

describe("trackMetaEvent", () => {
  let fbq: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetMetaPixelStateForTests();
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

describe("startup queue", () => {
  beforeEach(() => {
    resetMetaPixelStateForTests();
    consent.marketing = true;
    delete (window as FbqWindow).fbq;
  });
  afterEach(() => {
    delete (window as FbqWindow).fbq;
  });

  it("sends an event raised before the pixel started once the pixel is up", () => {
    expect(trackMetaEvent("ViewContent", { content_ids: ["post-1"] }, "vc_1")).toBe(false);
    const fbq = vi.fn();
    (window as FbqWindow).fbq = fbq;
    expect(flushPendingMetaEvents()).toBe(1);
    expect(fbq).toHaveBeenCalledWith("track", "ViewContent", { content_ids: ["post-1"] }, { eventID: "vc_1" });
    expect(flushPendingMetaEvents()).toBe(0);
  });

  it("never queues an event raised without marketing consent", () => {
    consent.marketing = false;
    trackMetaEvent("ViewContent");
    consent.marketing = true;
    (window as FbqWindow).fbq = vi.fn();
    expect(flushPendingMetaEvents()).toBe(0);
  });

  it("drops the queue when consent is withdrawn before the pixel starts", () => {
    trackMetaEvent("Purchase", { value: 10, currency: "PLN" });
    consent.marketing = false;
    (window as FbqWindow).fbq = vi.fn();
    expect(flushPendingMetaEvents()).toBe(0);
    consent.marketing = true;
    expect(flushPendingMetaEvents()).toBe(0);
  });

  it("discards queued events older than 60 seconds", () => {
    trackMetaEvent("ViewContent");
    (window as FbqWindow).fbq = vi.fn();
    expect(flushPendingMetaEvents(Date.now() + 61_000)).toBe(0);
  });
});

describe("trackMetaSearch", () => {
  let fbq: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    resetMetaPixelStateForTests();
    consent.marketing = true;
    fbq = vi.fn();
    (window as FbqWindow).fbq = fbq;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (window as FbqWindow).fbq;
  });

  it("sends one Search after typing settles, without the phrase", () => {
    trackMetaSearch("eu");
    trackMetaSearch("euro");
    trackMetaSearch("europa");
    vi.advanceTimersByTime(META_SEARCH_IDLE_MS);
    expect(fbq).toHaveBeenCalledTimes(1);
    expect(fbq.mock.calls[0]?.[1]).toBe("Search");
    expect(JSON.stringify(fbq.mock.calls[0])).not.toContain("europa");
  });

  it("does not count the same phrase twice in a row", () => {
    trackMetaSearch("Energia");
    vi.advanceTimersByTime(META_SEARCH_IDLE_MS);
    trackMetaSearch("energia ");
    vi.advanceTimersByTime(META_SEARCH_IDLE_MS);
    expect(fbq).toHaveBeenCalledTimes(1);
  });

  it("ignores one-letter queries", () => {
    trackMetaSearch("e");
    vi.advanceTimersByTime(META_SEARCH_IDLE_MS);
    expect(fbq).not.toHaveBeenCalled();
  });
});

describe("Contact", () => {
  it("maps mailto and tel links to channels", () => {
    expect(contactChannel("mailto:biuro@example.com")).toBe("email");
    expect(contactChannel("TEL:+48123")).toBe("phone");
    expect(contactChannel("https://example.com")).toBeNull();
  });

  it("sends Contact with the channel only when an e-mail link is clicked", () => {
    resetMetaPixelStateForTests();
    consent.marketing = true;
    const fbq = vi.fn();
    (window as FbqWindow).fbq = fbq;
    const stop = installMetaContactListener();
    const link = document.createElement("a");
    link.href = "mailto:biuro@example.com";
    link.addEventListener("click", (e) => e.preventDefault());
    document.body.appendChild(link);
    link.click();
    stop();
    link.click();
    link.remove();
    delete (window as FbqWindow).fbq;
    expect(fbq).toHaveBeenCalledTimes(1);
    expect(fbq.mock.calls[0]?.[1]).toBe("Contact");
    expect(fbq.mock.calls[0]?.[2]).toEqual({ content_category: "email" });
  });
});

describe("sanitizeMetaParams - catalog fields", () => {
  it("keeps contents, content_type and predicted_ltv with a currency", () => {
    expect(
      sanitizeMetaParams({
        value: 0,
        currency: "PLN",
        predicted_ltv: 49.9,
        content_type: "product",
        contents: [{ id: "plan-1", quantity: 1 }, { id: " ", quantity: 1 }, { id: "x", quantity: 0 }],
      }),
    ).toEqual({
      value: 0,
      currency: "PLN",
      predicted_ltv: 49.9,
      content_type: "product",
      contents: [{ id: "plan-1", quantity: 1 }],
    });
  });

  it("drops predicted_ltv without a currency", () => {
    expect(sanitizeMetaParams({ predicted_ltv: 10 })).toEqual({});
  });
});

describe("Conversions API mirror and PageView", () => {
  let fbq: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetMetaPixelStateForTests();
    mirror.calls.length = 0;
    consent.marketing = true;
    fbq = vi.fn();
    (window as FbqWindow).fbq = fbq;
  });

  afterEach(() => {
    delete (window as FbqWindow).fbq;
  });

  it("mirrors every pixel event to the server with the same name and eventID", () => {
    trackMetaEvent("Lead", { content_category: "form" }, "Lead_dedupe01");
    expect(mirror.calls).toHaveLength(1);
    expect(mirror.calls[0]).toMatchObject({ name: "Lead", eventId: "Lead_dedupe01" });
  });

  it("sends a PageView with an eventID once per page", () => {
    expect(trackMetaPageView()).toBe(true);
    expect(trackMetaPageView()).toBe(false);
    expect(fbq).toHaveBeenCalledTimes(1);
    const call = fbq.mock.calls[0] as [string, string, object, { eventID: string }];
    expect(call[1]).toBe("PageView");
    expect(call[3].eventID).toMatch(/^PageView_/);
    expect(mirror.calls[0]).toMatchObject({ name: "PageView", eventId: call[3].eventID });
  });

  it("sends no PageView without marketing consent", () => {
    consent.marketing = false;
    expect(trackMetaPageView()).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
    expect(mirror.calls).toHaveLength(0);
  });
});
