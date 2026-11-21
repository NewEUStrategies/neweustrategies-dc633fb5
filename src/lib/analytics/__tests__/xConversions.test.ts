import { beforeEach, describe, expect, it, vi } from "vitest";

const consent = vi.hoisted(() => ({ marketing: true }));
vi.mock("@/lib/ads/consent", () => ({
  hasCategoryConsent: (cat: string) => (cat === "marketing" ? consent.marketing : true),
}));

import {
  __resetXPixelForTests,
  configureXPixel,
  installXAutoGoals,
  trackXGoal,
  trackXPageView,
} from "../xPixelEvents";
import { extractXEventId, xEventPixelId } from "../xPixelId";
import { X_FUNNEL, X_GOALS } from "../xGoals";
import { MarketingConfigSchema } from "../config";
import { PIXELS_TABS } from "@/lib/admin/pixelsTabs";

let calls: unknown[][] = [];

function events(): unknown[][] {
  return calls.filter((c) => c[0] === "event");
}

beforeEach(() => {
  consent.marketing = true;
  calls = [];
  __resetXPixelForTests();
  window.history.replaceState({}, "", "/");
  (window as Window & { twq?: unknown }).twq = (...args: unknown[]) => {
    calls.push(args);
  };
});

describe("X event IDs", () => {
  it("accepts the bare event ID and the full X event code", () => {
    expect(extractXEventId("tw-rjppz-q1w2e")).toBe("tw-rjppz-q1w2e");
    expect(extractXEventId("twq('event', 'tw-rjppz-q1w2e', { value: null });")).toBe(
      "tw-rjppz-q1w2e",
    );
    expect(xEventPixelId("tw-rjppz-q1w2e")).toBe("rjppz");
  });
  it("rejects garbage", () => {
    expect(extractXEventId("rjppz")).toBe("");
    expect(extractXEventId("<script>alert(1)</script>")).toBe("");
  });
  it("settings have a field for every goal and drop garbage", () => {
    const parsed = MarketingConfigSchema.parse({
      x_conversions: { contact_form: "twq('event','tw-rjppz-abc12',{})", purchase: "zle" },
    }).x_conversions;
    expect(Object.keys(parsed).sort()).toEqual([...X_GOALS].sort());
    expect(parsed.contact_form).toBe("tw-rjppz-abc12");
    expect(parsed.purchase).toBe("");
  });
  it("every goal stands in exactly one funnel stage", () => {
    const placed = X_FUNNEL.flatMap((g) => g.goals);
    expect([...placed].sort()).toEqual([...X_GOALS].sort());
  });
  it("Pixels has its own X Ads tab", () => {
    expect(PIXELS_TABS).toContain("x");
  });
});

describe("X conversions", () => {
  it("sends a configured goal as twq('event') only after marketing consent", () => {
    configureXPixel("rjppz", { contact_form: "tw-rjppz-abc12" });
    expect(trackXGoal("contact_form")).toBe(true);
    const sent = events();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.[1]).toBe("tw-rjppz-abc12");

    consent.marketing = false;
    expect(trackXGoal("contact_form")).toBe(false);
    expect(events()).toHaveLength(1);
  });

  it("a goal without an event ID sends nothing", () => {
    configureXPixel("rjppz", {});
    expect(trackXGoal("newsletter")).toBe(false);
    expect(events()).toHaveLength(0);
  });

  it("purchase carries value, currency and the transaction as conversion_id, once", () => {
    configureXPixel("rjppz", { purchase: "tw-rjppz-buy01" });
    expect(trackXGoal("purchase", { eventId: "ord_1", value: 49.004, currency: "pln" })).toBe(true);
    expect(trackXGoal("purchase", { eventId: "ord_1", value: 49, currency: "PLN" })).toBe(false);
    expect(trackXGoal("purchase", { value: 49, currency: "PLN" })).toBe(false);
    const sent = events();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.[2]).toEqual({ conversion_id: "ord_1", value: 49, currency: "PLN" });
  });

  it("queues a result confirmed before the pixel starts and flushes it on configure", () => {
    expect(trackXGoal("account_signup")).toBe(true);
    expect(events()).toHaveLength(0);
    configureXPixel("rjppz", { account_signup: "tw-rjppz-sign1" });
    expect(events().map((c) => c[1])).toEqual(["tw-rjppz-sign1"]);
  });

  it("page view conversion fires on landing and on each new SPA page", () => {
    configureXPixel("rjppz", { page_view: "tw-rjppz-view1" });
    expect(events()).toHaveLength(1);
    window.history.pushState({}, "", "/analizy");
    expect(trackXPageView()).toBe(true);
    expect(trackXPageView()).toBe(false);
    expect(events()).toHaveLength(2);
  });

  it("file downloads count once per file", () => {
    configureXPixel("rjppz", { download: "tw-rjppz-dl001" });
    const stop = installXAutoGoals();
    const link = document.createElement("a");
    link.href = "/raport.pdf";
    document.body.appendChild(link);
    link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    stop();
    link.remove();
    expect(events().map((c) => c[1])).toEqual(["tw-rjppz-dl001"]);
  });
});

describe("X server copy", () => {
  it("mirrors every sent event to the Conversion API with the same conversion_id", async () => {
    const { setXCapiSenderForTests, flushXCapiQueue, resetXCapiMirrorForTests } =
      await import("../xCapiMirror");
    resetXCapiMirrorForTests();
    const batches: Array<{ events: Array<{ event_id: string; conversion_id: string }> }> = [];
    setXCapiSenderForTests(async (b) => {
      batches.push(b);
    });
    configureXPixel("rjppz", { purchase: "tw-rjppz-buy01" });
    trackXGoal("purchase", { eventId: "ord_9", value: 10, currency: "EUR" });
    await flushXCapiQueue();
    setXCapiSenderForTests(null);
    const browser = events()[0];
    expect(browser?.[2]).toMatchObject({ conversion_id: "ord_9" });
    expect(batches[0]?.events[0]).toMatchObject({
      event_id: "tw-rjppz-buy01",
      conversion_id: "ord_9",
    });
  });
});
