// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ create: vi.fn(() => vi.fn()) }));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible: sdk.create }));
import {
  createLovableAiGatewayRunIdFetch as capture,
  createLovableAiGatewayProvider as provider,
  getLovableAiGatewayRunId as incoming,
  getLovableAiGatewayResponseHeaders as outgoing,
  withLovableAiGatewayRunIdHeader as wrap,
  LOVABLE_AIG_RUN_ID_HEADER_EXPORT as HEADER,
} from "../ai-gateway.server";

const encode = (s: string) => new TextEncoder().encode(s);
const ready = (id?: string) => ({ getRunId: () => id, waitForRunId: async () => id });
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("per-request AI gateway identity", () => {
  it.each([undefined, "", "   "])("waits for a minted id when the initial id is %s", async (id) => {
    const transport = vi.fn<typeof fetch>(
      async () => new Response(null, { headers: { [HEADER]: " minted " } }),
    );
    vi.stubGlobal("fetch", transport);
    const gateway = capture(id);
    expect(gateway.getRunId()).toBeUndefined();
    const waiting = gateway.waitForRunId();
    const response = await gateway.fetch("https://gateway.test/v1");
    expect(await waiting).toBe("minted");
    expect(gateway.getRunId()).toBe("minted");
    expect(response.headers.get(HEADER)).toBe("minted");
    await gateway.fetch(new URL("https://gateway.test/v1"));
    expect(new Headers(transport.mock.calls[1]?.[1]?.headers).get(HEADER)).toBe("minted");
  });
  it("keeps a caller's known run id, and respects an explicit outgoing override", async () => {
    const transport = vi.fn<typeof fetch>(
      async () => new Response(null, { headers: { [HEADER]: "other" } }),
    );
    vi.stubGlobal("fetch", transport);
    const gateway = capture(" known ");
    expect(await gateway.waitForRunId()).toBe("known");
    await gateway.fetch("https://gateway.test", { headers: { [HEADER]: "explicit" } });
    expect(new Headers(transport.mock.calls[0]?.[1]?.headers).get(HEADER)).toBe("explicit");
    expect(gateway.getRunId()).toBe("known");
  });
  it("preserves Request headers unless RequestInit explicitly replaces them", async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response(null));
    vi.stubGlobal("fetch", transport);
    const request = new Request("https://gateway.test", {
      headers: { authorization: "Bearer local-test", "content-type": "application/json" },
    });
    const gateway = capture("request-id");
    await gateway.fetch(request);
    expect(new Headers(transport.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(
      "Bearer local-test",
    );
    await gateway.fetch(request, { headers: { "x-explicit": "yes" } });
    expect(new Headers(transport.mock.calls[1]?.[1]?.headers).get("authorization")).toBeNull();
    expect(new Headers(transport.mock.calls[1]?.[1]?.headers).get("x-explicit")).toBe("yes");
  });
  it("settles waiters when the gateway sends no id, and can capture a later one", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null))
        .mockResolvedValueOnce(new Response(null, { headers: { [HEADER]: "later" } })),
    );
    const gateway = capture();
    const waiting = gateway.waitForRunId();
    await gateway.fetch("https://gateway.test");
    expect(await waiting).toBeUndefined();
    await gateway.fetch("https://gateway.test");
    expect(await gateway.waitForRunId()).toBe("later");
  });
  it("propagates network failure and releases id waiters", async () => {
    const error = new Error("upstream offline");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
    const gateway = capture();
    const waiting = gateway.waitForRunId();
    await expect(gateway.fetch("https://gateway.test")).rejects.toBe(error);
    expect(await waiting).toBeUndefined();
  });
  it("isolates concurrent requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(null, { headers: { [HEADER]: url.endsWith("a") ? "a" : "b" } }),
      ),
    );
    const a = capture();
    const b = capture();
    await Promise.all([a.fetch("https://gateway.test/a"), b.fetch("https://gateway.test/b")]);
    expect([a.getRunId(), b.getRunId()]).toEqual(["a", "b"]);
  });
  it.each([undefined, { structuredOutputs: false }, { structuredOutputs: true }])(
    "configures the compatible provider: %j",
    async (options) => {
      const gateway = provider("test-api-key", "id", options);
      expect(sdk.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "lovable",
          baseURL: "https://ai.gateway.lovable.dev/v1",
          supportsStructuredOutputs: options?.structuredOutputs ?? false,
          headers: { "Lovable-API-Key": "test-api-key", "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
          fetch: expect.any(Function),
        }),
      );
      expect(gateway.getRunId()).toBe("id");
      expect(await gateway.waitForRunId()).toBe("id");
    },
  );
  it.each([undefined, "", "  ", " run-123 "])("normalizes the incoming id: %s", (id) => {
    expect(
      incoming(
        new Request("https://site.test", { headers: id === undefined ? {} : { [HEADER]: id } }),
      ),
    ).toBe(id?.trim() || undefined);
  });
});

describe("AI response headers and stream lifecycle", () => {
  it("forwards only gateway metadata and exposes it together with existing CORS headers", () => {
    const headers = outgoing(
      {
        [HEADER]: "r1",
        "x-lovable-aig-cost": "2",
        authorization: "never-forward",
        "set-cookie": "never-forward",
      },
      {
        "Access-Control-Expose-Headers": "etag, , x-existing",
        "x-lovable-aig-model": "m",
        "content-type": "text/event-stream",
      },
    );
    expect(headers.get(HEADER)).toBe("r1");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("set-cookie")).toBeNull();
    expect(headers.get("content-type")).toBe("text/event-stream");
    expect(headers.get("Access-Control-Expose-Headers")?.split(", ").sort()).toEqual([
      "etag",
      "x-existing",
      "x-lovable-aig-cost",
      "x-lovable-aig-model",
      "x-lovable-aig-run-id",
    ]);
    expect(outgoing(undefined).get("Access-Control-Expose-Headers")).toBeNull();
  });
  it.each([undefined, "known"])("handles a bodyless response without waiting: %s", async (id) => {
    const gateway = { ...ready(id), waitForRunId: vi.fn() };
    const res = await wrap(
      new Response(null, { status: 204, statusText: "No Content", headers: { "x-base": "base" } }),
      gateway,
      { "x-extra": "extra" },
    );
    expect(res.status).toBe(204);
    expect(res.statusText).toBe("No Content");
    expect(res.body).toBeNull();
    expect(res.headers.get(HEADER)).toBe(id ?? null);
    expect(res.headers.get("x-extra")).toBe("extra");
    expect(gateway.waitForRunId).not.toHaveBeenCalled();
  });
  it.each([undefined, "stream-id"])("relays all bytes and status with id %s", async (id) => {
    const body = new ReadableStream({
      start(c) {
        c.enqueue(encode("first\n"));
        c.enqueue(encode("second\n"));
        c.close();
      },
    });
    const response = await wrap(
      new Response(body, {
        status: 201,
        statusText: "Created",
        headers: { "content-type": "text/event-stream" },
      }),
      ready(id),
      { "x-extra": "1" },
    );
    expect(response.status).toBe(201);
    expect(response.statusText).toBe("Created");
    expect(response.headers.get(HEADER)).toBe(id ?? null);
    expect(await response.text()).toBe("first\nsecond\n");
    expect(body.locked).toBe(false);
  });
  it("closes an empty stream and releases the upstream reader", async () => {
    const body = new ReadableStream({
      start(c) {
        c.close();
      },
    });
    expect(await (await wrap(new Response(body), ready())).text()).toBe("");
    expect(body.locked).toBe(false);
  });
  it("reports an upstream error before id readiness without an unhandled rejection", async () => {
    let resolve!: (value: string) => void;
    const error = new Error("stream failed first");
    const body = new ReadableStream({
      start(c) {
        c.error(error);
      },
    });
    const result = wrap(new Response(body), {
      getRunId: () => undefined,
      waitForRunId: () =>
        new Promise((r) => {
          resolve = r;
        }),
    });
    await new Promise((r) => setTimeout(r, 0));
    resolve("late-id");
    await expect((await result).text()).rejects.toBe(error);
    expect(body.locked).toBe(false);
  });
  it("preserves backpressure and propagates downstream cancellation", async () => {
    let produced = 0;
    const cancel = vi.fn();
    const body = new ReadableStream({
      pull(c) {
        produced++;
        c.enqueue(encode(String(produced)));
      },
      cancel,
    });
    const response = await wrap(new Response(body), ready("id"));
    await new Promise((r) => setTimeout(r, 0));
    expect(produced).toBeLessThanOrEqual(3);
    await response.body!.cancel("browser left");
    expect(cancel).toHaveBeenCalledWith("browser left");
    expect(body.locked).toBe(false);
  });
  it("cancels the upstream if id readiness itself rejects", async () => {
    const cancel = vi.fn();
    const error = new Error("gateway aborted");
    const body = new ReadableStream({ cancel });
    await expect(
      wrap(new Response(body), {
        getRunId: () => undefined,
        waitForRunId: async () => {
          throw error;
        },
      }),
    ).rejects.toBe(error);
    expect(cancel).toHaveBeenCalledWith(error);
    expect(body.locked).toBe(false);
  });
});
