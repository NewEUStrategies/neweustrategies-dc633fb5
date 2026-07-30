import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  clientIpFromHeaders,
  isAllowedWebhookIp,
  __resetIpAllowlistCache,
} from "@/lib/billing/webhookIpAllowlist.server";

const IPS = ["34.237.3.244/32", "34.195.105.136/32"];

function req(ip?: string): Request {
  return new Request("https://example.com/api/public/payments/webhook?env=live", {
    method: "POST",
    headers: ip ? { "x-forwarded-for": `${ip}, 10.0.0.1` } : {},
  });
}

function mockIps(ok = true) {
  return vi.fn(async () =>
    ok
      ? new Response(JSON.stringify({ data: { ipv4_cidrs: IPS } }), { status: 200 })
      : new Response("nope", { status: 500 }),
  );
}

describe("webhookIpAllowlist", () => {
  beforeEach(() => __resetIpAllowlistCache());
  afterEach(() => vi.unstubAllGlobals());

  it("czyta pierwszy adres z łańcucha proxy", () => {
    expect(clientIpFromHeaders(req("34.237.3.244").headers)).toBe("34.237.3.244");
  });

  it("przepuszcza adres operatora", async () => {
    vi.stubGlobal("fetch", mockIps());
    await expect(isAllowedWebhookIp(req("34.237.3.244"), "live")).resolves.toBe(true);
  });

  it("odrzuca obcy adres", async () => {
    vi.stubGlobal("fetch", mockIps());
    await expect(isAllowedWebhookIp(req("8.8.8.8"), "live")).resolves.toBe(false);
  });

  it("buforuje listę - jedno pobranie na wiele żądań", async () => {
    const f = mockIps();
    vi.stubGlobal("fetch", f);
    await isAllowedWebhookIp(req("8.8.8.8"), "live");
    await isAllowedWebhookIp(req("34.195.105.136"), "live");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("nie blokuje ruchu, gdy listy nie da się pobrać (zostaje podpis)", async () => {
    vi.stubGlobal("fetch", mockIps(false));
    await expect(isAllowedWebhookIp(req("8.8.8.8"), "live")).resolves.toBe(true);
  });

  it("nie blokuje, gdy nagłówki nie niosą adresu", async () => {
    const f = mockIps();
    vi.stubGlobal("fetch", f);
    await expect(isAllowedWebhookIp(req(), "live")).resolves.toBe(true);
    expect(f).not.toHaveBeenCalled();
  });
});
