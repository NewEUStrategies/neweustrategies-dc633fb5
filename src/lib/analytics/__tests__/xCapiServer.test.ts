// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => null }));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveTrustedRequestHost: async () => "neweuropeanstrategies.com",
  resolveTenantIdForHost: async () => "tenant-1",
}));
const settings = vi.hoisted(() => ({
  value: {
    x_pixel_id: "rjppz",
    x_conversions: { contact_form: "tw-rjppz-abc12", purchase: "tw-other1-buy01" },
  } as object | null,
}));
vi.mock("@/integrations/supabase/client.server", () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({
      data: settings.value ? { value: settings.value } : null,
      error: null,
    }),
  };
  return { supabaseAdmin: { from: () => chain } };
});

import { relayXCapiBatch, resetXCapiCacheForTests } from "../xCapi.server";
import { buildXCapiPayload, readXClickId, type XCapiBatch } from "../xCapiContract";
import { XCapiBatchSchema } from "../xCapiSchema";

const NOW = 1_800_000_005_000;
const CONSENT = `nes_cookie_consent=${encodeURIComponent(
  JSON.stringify({ version: 2, categories: { marketing: true } }),
)}`;

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://neweuropeanstrategies.com/_serverFn/x", {
    method: "POST",
    headers: {
      origin: "https://neweuropeanstrategies.com",
      "user-agent": "Mozilla/5.0",
      "cf-connecting-ip": "203.0.113.7",
      cookie: CONSENT,
      ...headers,
    },
  });
}

const batch: XCapiBatch = {
  events: [
    {
      event_id: "tw-rjppz-abc12",
      conversion_id: "x_contact_form_123",
      occurred_at: NOW - 2_000,
      event_source_url: "https://neweuropeanstrategies.com/kontakt",
    },
  ],
  twclid: "abcdefgh12345",
};

describe("relayXCapiBatch", () => {
  let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    resetXCapiCacheForTests();
    settings.value = {
      x_pixel_id: "rjppz",
      x_conversions: { contact_form: "tw-rjppz-abc12", purchase: "tw-other1-buy01" },
    };
    vi.stubEnv("X_PIXEL_TOKEN", "test-token");
    fetcher = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
  });
  afterEach(() => vi.unstubAllEnvs());

  it("posts to the site's pixel with the token header and the browser conversion_id", async () => {
    const result = await relayXCapiBatch(batch, request(), fetcher, NOW);
    expect(result).toEqual({ status: "sent", sent: 1 });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://ads-api.x.com/12/measurement/conversions/rjppz");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-pixel-token")).toBe("test-token");
    const body = JSON.parse(String(init?.body)) as {
      conversions: Array<{
        event_id: string;
        conversion_id: string;
        identifiers: Array<Record<string, string>>;
      }>;
    };
    expect(body.conversions[0]?.event_id).toBe("tw-rjppz-abc12");
    expect(body.conversions[0]?.conversion_id).toBe("x_contact_form_123");
    expect(body.conversions[0]?.identifiers[0]).toEqual({
      user_agent: "Mozilla/5.0",
      ip_address: "203.0.113.7",
      twclid: "abcdefgh12345",
    });
  });

  it("sends nothing without marketing consent", async () => {
    const result = await relayXCapiBatch(batch, request({ cookie: "" }), fetcher, NOW);
    expect(result).toEqual({ status: "skipped", reason: "no_consent" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses events from another site", async () => {
    const result = await relayXCapiBatch(
      batch,
      request({ origin: "https://evil.example" }),
      fetcher,
      NOW,
    );
    expect(result).toEqual({ status: "skipped", reason: "origin_mismatch" });
  });

  it("sends nothing without the token", async () => {
    vi.stubEnv("X_PIXEL_TOKEN", "");
    const result = await relayXCapiBatch(batch, request(), fetcher, NOW);
    expect(result).toEqual({ status: "skipped", reason: "not_configured" });
  });

  it("drops events not configured in Pixels or belonging to another pixel", async () => {
    const foreign: XCapiBatch = {
      events: [
        { ...batch.events[0]!, event_id: "tw-rjppz-zzz99" },
        { ...batch.events[0]!, event_id: "tw-other1-buy01" },
      ],
    };
    const result = await relayXCapiBatch(foreign, request(), fetcher, NOW);
    expect(result).toEqual({ status: "skipped", reason: "no_events" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("X CAPI contract", () => {
  it("purchase carries value and currency", () => {
    const payload = buildXCapiPayload(
      {
        events: [
          {
            event_id: "tw-rjppz-buy01",
            conversion_id: "ord_1",
            occurred_at: NOW,
            event_source_url: "https://neweuropeanstrategies.com/checkout",
            value: 49,
            currency: "PLN",
          },
        ],
      },
      { clientIp: null, userAgent: "UA", nowMs: NOW, allowedEventIds: new Set(["tw-rjppz-buy01"]) },
    );
    expect(payload.conversions[0]).toMatchObject({
      conversion_id: "ord_1",
      value: "49.00",
      price_currency: "PLN",
    });
  });

  it("skips events older than 7 days", () => {
    const payload = buildXCapiPayload(
      { events: [{ ...batch.events[0]!, occurred_at: NOW - 8 * 24 * 3600 * 1000 }] },
      { clientIp: null, userAgent: "UA", nowMs: NOW, allowedEventIds: new Set(["tw-rjppz-abc12"]) },
    );
    expect(payload.conversions).toHaveLength(0);
  });

  it("reads twclid from the landing address or the pixel cookie", () => {
    expect(readXClickId("", "https://x.test/?twclid=abcdefgh123")).toBe("abcdefgh123");
    const cookie = `_twclid=${encodeURIComponent(JSON.stringify({ twclid: "zyxwvuts987" }))}`;
    expect(readXClickId(cookie, null)).toBe("zyxwvuts987");
    expect(readXClickId("", null)).toBeUndefined();
  });

  it("schema rejects unknown fields and malformed event IDs", () => {
    expect(() =>
      XCapiBatchSchema.parse({ events: [{ ...batch.events[0], email: "a@b.c" }] }),
    ).toThrow();
    expect(() =>
      XCapiBatchSchema.parse({ events: [{ ...batch.events[0], event_id: "rjppz" }] }),
    ).toThrow();
  });
});
