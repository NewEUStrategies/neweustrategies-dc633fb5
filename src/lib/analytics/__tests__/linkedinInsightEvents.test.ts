import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const consent = vi.hoisted(() => ({ marketing: true }));
vi.mock("@/lib/ads/consent", () => ({
  hasCategoryConsent: (cat: string) => (cat === "marketing" ? consent.marketing : true),
}));

import {
  __resetLinkedInInsightForTests,
  configureLinkedInConversions,
  extractLinkedInConversionId,
  resetLinkedInConversions,
  trackLinkedInGoal,
  trackLinkedInPageView,
} from "../linkedinInsightEvents";
import { MarketingConfigSchema } from "../config";

type Call = [string, Record<string, unknown> | undefined];
let calls: Call[] = [];

function installLintrk(): void {
  (window as Window & { lintrk?: unknown }).lintrk = (
    action: string,
    payload?: Record<string, unknown>,
  ) => {
    calls.push([action, payload]);
  };
}

describe("LinkedIn Insight conversions", () => {
  beforeEach(() => {
    consent.marketing = true;
    calls = [];
    __resetLinkedInInsightForTests();
    installLintrk();
  });
  afterEach(() => {
    delete (window as Window & { lintrk?: unknown }).lintrk;
  });

  it("accepts a bare number or the Campaign Manager snippet", () => {
    expect(extractLinkedInConversionId(" 23456789 ")).toBe("23456789");
    expect(
      extractLinkedInConversionId("window.lintrk('track', { conversion_id: 19876543 });"),
    ).toBe("19876543");
    expect(extractLinkedInConversionId("abc")).toBe("");
  });

  it("sends the configured conversion_id as a number for a confirmed outcome", () => {
    configureLinkedInConversions({ newsletter: "123456" });
    expect(trackLinkedInGoal("newsletter")).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("track");
    expect(calls[0]?.[1]?.["conversion_id"]).toBe(123456);
  });

  it("sends nothing for a goal without a conversion ID", () => {
    configureLinkedInConversions({ newsletter: "123456" });
    expect(trackLinkedInGoal("contact_form")).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("sends nothing and queues nothing without marketing consent", () => {
    consent.marketing = false;
    expect(trackLinkedInGoal("account_signup")).toBe(false);
    consent.marketing = true;
    configureLinkedInConversions({ account_signup: "42" });
    expect(calls).toHaveLength(0);
  });

  it("flushes an outcome confirmed before the settings were read", () => {
    expect(trackLinkedInGoal("club_application")).toBe(true);
    expect(calls).toHaveLength(0);
    configureLinkedInConversions({ club_application: "777" });
    expect(calls.map((c) => c[1]?.["conversion_id"])).toEqual([777]);
  });

  it("drops the startup queue when consent is withdrawn", () => {
    trackLinkedInGoal("event_registration");
    resetLinkedInConversions();
    configureLinkedInConversions({ event_registration: "55" });
    expect(calls).toHaveLength(0);
  });

  it("counts a purchase once per transaction with event_id equal to the transaction", () => {
    configureLinkedInConversions({ purchase: "999" });
    expect(trackLinkedInGoal("purchase", { eventId: "order_1" })).toBe(true);
    expect(trackLinkedInGoal("purchase", { eventId: "order_1" })).toBe(false);
    expect(trackLinkedInGoal("purchase")).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]?.["event_id"]).toBe("order_1");
  });
});

describe("LinkedIn Insight SPA page views", () => {
  beforeEach(() => {
    consent.marketing = true;
    calls = [];
    __resetLinkedInInsightForTests();
    installLintrk();
    window.history.replaceState(null, "", "/en");
  });
  afterEach(() => {
    delete (window as Window & { lintrk?: unknown }).lintrk;
  });

  it("skips the landing page the tag already counted and sends each new route once", () => {
    configureLinkedInConversions({});
    expect(trackLinkedInPageView("/en")).toBe(false);
    expect(trackLinkedInPageView("/en/blog/a?utm_source=x")).toBe(true);
    expect(trackLinkedInPageView("/en/blog/a")).toBe(false);
    expect(calls).toEqual([["track", undefined]]);
  });

  it("sends nothing before the tag starts or without marketing consent", () => {
    expect(trackLinkedInPageView("/en/blog/a")).toBe(false);
    configureLinkedInConversions({});
    consent.marketing = false;
    expect(trackLinkedInPageView("/en/blog/b")).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("page_view conversion", () => {
  it("counts the landing page and each new route once when an id is set", () => {
    configureLinkedInConversions({ page_view: "777" });
    trackLinkedInPageView("/en/blog/a");
    trackLinkedInPageView("/en/blog/a");
    const conv = calls.filter(([, p]) => p?.["conversion_id"] === 777);
    expect(conv).toHaveLength(2);
  });
});

describe("MarketingConfigSchema.linkedin_conversions", () => {
  it("defaults every goal to empty and keeps other marketing IDs on bad input", () => {
    const parsed = MarketingConfigSchema.parse({
      meta_pixel_id: "2369595433545317",
      linkedin_conversions: { purchase: "not-a-number", newsletter: 12 },
    });
    expect(parsed.meta_pixel_id).toBe("2369595433545317");
    expect(parsed.linkedin_conversions.purchase).toBe("");
    expect(parsed.linkedin_conversions.newsletter).toBe("");
    expect(MarketingConfigSchema.parse({}).linkedin_conversions.contact_form).toBe("");
  });
});
