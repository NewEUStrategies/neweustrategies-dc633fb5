import { describe, expect, it, vi } from "vitest";
import { classifyWebhookStatus, deliverSignalWebhook } from "../signalWebhook.server";
import type { SignalEvent } from "../signals";

const event: SignalEvent = {
  id: "n-1",
  signal: "expert_ping",
  lang: "en",
  title: "You were asked to weigh in",
  body: "Anna is asking for your view.",
  url: "https://neweuropeanstrategies.com/club/k/t/x",
  createdAt: "2026-11-20T10:00:00.000Z",
};
const target = {
  url: "https://hooks.example.com/nes",
  secret: "whsec_x",
  format: "standard" as const,
};
const allow = async () => undefined;

describe("classifyWebhookStatus", () => {
  it.each([
    [200, "sent"],
    [204, "sent"],
    [404, "gone"],
    [410, "gone"],
    [429, "retry"],
    [503, "retry"],
    [400, "dead"],
    [301, "dead"],
  ])("%i -> %s", (status, outcome) => {
    expect(classifyWebhookStatus(status)).toBe(outcome);
  });
});

describe("deliverSignalWebhook", () => {
  it("wysyła podpisane żądanie bez śledzenia przekierowań", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const result = await deliverSignalWebhook(target, event, {
      deliveryId: "42",
      nowSec: 1_790_000_000,
      fetchImpl,
      assertPublicUrl: allow,
    });
    expect(result).toEqual({ outcome: "sent", status: 200, error: null });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(init.redirect).toBe("manual");
    expect(headers["X-NES-Event"]).toBe("expert_ping.created");
    expect(headers["X-NES-Delivery"]).toBe("42");
    expect(headers["X-NES-Signature"]).toMatch(/^t=1790000000,v1=[0-9a-f]{64}$/);
  });

  it("adres zablokowany bramką SSRF nie jest wywoływany", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const blocked = Object.assign(new Error("blocked_url:ip"), { reason: "ip" });
    const result = await deliverSignalWebhook(target, event, {
      deliveryId: "1",
      fetchImpl,
      assertPublicUrl: async () => {
        throw blocked;
      },
    });
    expect(result.outcome).toBe("dead");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("chwilowa awaria DNS to ponowienie, nie wyłączenie", async () => {
    const result = await deliverSignalWebhook(target, event, {
      deliveryId: "1",
      fetchImpl: vi.fn(),
      assertPublicUrl: async () => {
        throw Object.assign(new Error("blocked_url:dns"), { reason: "dns" });
      },
    });
    expect(result).toEqual({ outcome: "retry", status: null, error: "blocked_url:dns" });
  });

  it("adres o złym kształcie odpada przed bramką", async () => {
    const result = await deliverSignalWebhook(
      { ...target, url: "http://hooks.example.com/x" },
      event,
      {
        deliveryId: "1",
        assertPublicUrl: allow,
      },
    );
    expect(result).toEqual({ outcome: "dead", status: null, error: "invalid_url:scheme" });
  });

  it("błąd sieci to ponowienie", async () => {
    const result = await deliverSignalWebhook(target, event, {
      deliveryId: "1",
      assertPublicUrl: allow,
      fetchImpl: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    });
    expect(result).toEqual({ outcome: "retry", status: null, error: "network" });
  });
});
