// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => null }));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveTrustedRequestHost: async () => "neweuropeanstrategies.com",
  resolveTenantIdForHost: async () => "tenant-1",
}));
const settings = vi.hoisted(() => ({ value: { meta_pixel_id: "2369595433545317" } as object | null }));
vi.mock("@/integrations/supabase/client.server", () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: settings.value ? { value: settings.value } : null, error: null }),
  };
  return { supabaseAdmin: { from: () => chain } };
});

import { relayMetaCapiBatch, resetMetaCapiCacheForTests } from "../metaCapi.server";
import type { MetaCapiBatch } from "../metaCapiContract";

const CONSENT = `nes_cookie_consent=${encodeURIComponent(
  JSON.stringify({ version: 2, categories: { marketing: true } }),
)}`;

function request(headers: Record<string, string>): Request {
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

const batch: MetaCapiBatch = {
  events: [
    {
      event_name: "PageView",
      event_id: "PageView_0123456789",
      event_time: 1_800_000_000,
      event_source_url: "https://neweuropeanstrategies.com/pl",
    },
  ],
};

describe("relayMetaCapiBatch", () => {
  let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    resetMetaCapiCacheForTests();
    settings.value = { meta_pixel_id: "2369595433545317" };
    vi.stubEnv("LOVABLE_API_KEY", "lov");
    vi.stubEnv("META_ADS_API_KEY", "conn");
    fetcher = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ events_received: 1 }), { status: 200 }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends the event to the site's own pixel with the same eventID", async () => {
    const result = await relayMetaCapiBatch(batch, request({}), fetcher, 1_800_000_005_000);
    expect(result).toEqual({ status: "sent", received: 1 });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://connector-gateway.lovable.dev/meta_ads/v26.0/2369595433545317/events");
    const body = JSON.parse(String(init?.body)) as {
      data: Array<{ event_id: string; event_name: string; user_data: Record<string, string> }>;
    };
    expect(body.data[0]?.event_id).toBe("PageView_0123456789");
    expect(body.data[0]?.event_name).toBe("PageView");
    expect(body.data[0]?.user_data["client_ip_address"]).toBe("203.0.113.7");
  });

  it("sends nothing without marketing consent", async () => {
    const result = await relayMetaCapiBatch(batch, request({ cookie: "" }), fetcher);
    expect(result).toEqual({ status: "skipped", reason: "no_consent" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends nothing when Global Privacy Control is on", async () => {
    const result = await relayMetaCapiBatch(batch, request({ "sec-gpc": "1" }), fetcher);
    expect(result).toEqual({ status: "skipped", reason: "no_consent" });
  });

  it("refuses events from another website", async () => {
    const foreign = await relayMetaCapiBatch(batch, request({ origin: "https://evil.example" }), fetcher);
    expect(foreign).toEqual({ status: "skipped", reason: "origin_mismatch" });
    const otherSource = await relayMetaCapiBatch(
      { events: [{ ...batch.events[0]!, event_source_url: "https://evil.example/" }] },
      request({}),
      fetcher,
    );
    expect(otherSource).toEqual({ status: "skipped", reason: "origin_mismatch" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends nothing when the site has no Meta pixel configured", async () => {
    settings.value = { meta_pixel_id: "" };
    const result = await relayMetaCapiBatch(batch, request({}), fetcher);
    expect(result).toEqual({ status: "skipped", reason: "no_pixel" });
  });
});
