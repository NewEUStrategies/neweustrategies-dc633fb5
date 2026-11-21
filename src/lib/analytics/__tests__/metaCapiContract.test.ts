import { describe, expect, it } from "vitest";
import {
  buildMetaCapiPayload,
  clampMetaEventTime,
  hasMarketingConsentCookie,
  metaEventSourceUrl,
  readMetaBrowserIds,
} from "../metaCapiContract";
import { MetaCapiBatchSchema } from "../metaCapiSchema";

const consentCookie = (record: object) =>
  `other=1; nes_cookie_consent=${encodeURIComponent(JSON.stringify(record))}`;

describe("hasMarketingConsentCookie", () => {
  it("accepts a recorded marketing consent", () => {
    expect(
      hasMarketingConsentCookie(consentCookie({ version: 2, categories: { marketing: true } }), false),
    ).toBe(true);
  });

  it("rejects a decision without marketing consent", () => {
    expect(
      hasMarketingConsentCookie(consentCookie({ version: 2, categories: { marketing: false } }), false),
    ).toBe(false);
    expect(hasMarketingConsentCookie(null, false)).toBe(false);
    expect(hasMarketingConsentCookie("nes_cookie_consent=%E0%A4%A", false)).toBe(false);
  });

  it("lets Global Privacy Control win unless consent was given at the GPC notice", () => {
    const plain = consentCookie({ version: 2, categories: { marketing: true } });
    const overridden = consentCookie({ version: 2, categories: { marketing: true }, gpcOverrideAt: 1 });
    expect(hasMarketingConsentCookie(plain, true)).toBe(false);
    expect(hasMarketingConsentCookie(overridden, true)).toBe(true);
  });
});

describe("readMetaBrowserIds", () => {
  it("reads the pixel's _fbp and _fbc cookies unhashed", () => {
    const ids = readMetaBrowserIds("_fbp=fb.1.1700000000000.123456789; _fbc=fb.1.1700000000000.AbC_1", null, 0);
    expect(ids).toEqual({ fbp: "fb.1.1700000000000.123456789", fbc: "fb.1.1700000000000.AbC_1" });
  });

  it("builds _fbc from fbclid when the cookie does not exist yet", () => {
    expect(readMetaBrowserIds("", "IwAR123", 1700000000000)).toEqual({ fbc: "fb.1.1700000000000.IwAR123" });
  });
});

describe("metaEventSourceUrl", () => {
  it("drops the query string and fragment", () => {
    expect(metaEventSourceUrl("https://neweuropeanstrategies.com/pl/a?email=x@y.pl#top")).toBe(
      "https://neweuropeanstrategies.com/pl/a",
    );
    expect(metaEventSourceUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("clampMetaEventTime", () => {
  const now = 1_800_000_000;
  it("keeps a recent browser time and replaces times Meta would reject", () => {
    expect(clampMetaEventTime(now - 30, now)).toBe(now - 30);
    expect(clampMetaEventTime(now + 3600, now)).toBe(now);
    expect(clampMetaEventTime(now - 8 * 24 * 3600, now)).toBe(now);
  });
});

describe("buildMetaCapiPayload", () => {
  it("keeps the browser event name and eventID for deduplication", () => {
    const payload = buildMetaCapiPayload(
      {
        events: [
          {
            event_name: "PageView",
            event_id: "PageView_abc12345",
            event_time: 1_800_000_000,
            event_source_url: "https://neweuropeanstrategies.com/",
          },
        ],
        fbp: "fb.1.1700000000000.123",
      },
      { clientIp: "203.0.113.5", userAgent: "UA", nowS: 1_800_000_010 },
    );
    expect(payload.partner_agent).toBe("lovable");
    expect(payload.test_event_code).toBeUndefined();
    expect(payload.data[0]).toEqual({
      event_name: "PageView",
      event_id: "PageView_abc12345",
      event_time: 1_800_000_000,
      action_source: "website",
      event_source_url: "https://neweuropeanstrategies.com/",
      user_data: { client_user_agent: "UA", client_ip_address: "203.0.113.5", fbp: "fb.1.1700000000000.123" },
    });
  });
});

describe("MetaCapiBatchSchema", () => {
  const event = {
    event_name: "Lead",
    event_id: "Lead_abcdefgh",
    event_time: 1_800_000_000,
    event_source_url: "https://neweuropeanstrategies.com/",
  };

  it("rejects unknown events, extra fields and oversized batches", () => {
    expect(MetaCapiBatchSchema.safeParse({ events: [event] }).success).toBe(true);
    expect(MetaCapiBatchSchema.safeParse({ events: [{ ...event, event_name: "Custom" }] }).success).toBe(false);
    expect(MetaCapiBatchSchema.safeParse({ events: [{ ...event, em: "a@b.pl" }] }).success).toBe(false);
    expect(MetaCapiBatchSchema.safeParse({ events: Array.from({ length: 11 }, () => event) }).success).toBe(false);
  });
});
