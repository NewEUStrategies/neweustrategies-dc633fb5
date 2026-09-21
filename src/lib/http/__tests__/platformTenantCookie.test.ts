// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ assertion: vi.fn() }));
vi.mock("../requestHost.server", () => ({ assertionForRequest: h.assertion }));
import { tenantAssertionMiddleware } from "../tenantAssertionCookie.server";
type Input = { request: Request; next: () => Promise<unknown> };
const run = tenantAssertionMiddleware.options.server as unknown as (
  input: Input,
) => Promise<unknown>;
const req = (method = "GET", cookie = "") =>
  new Request("https://tenant.example/blog", { method, headers: { cookie } });
const html = () => new Response("html", { headers: { "content-type": "text/html" } });
beforeEach(() => {
  h.assertion.mockReset().mockResolvedValue("signed-value");
});
afterEach(() => vi.restoreAllMocks());
describe("tenant assertion middleware on real responses", () => {
  it("attaches a secure host-bound cookie and preserves a streamed envelope", async () => {
    const original = html();
    const envelope = { response: original, serverSsrCleanup: "stream", dispose: vi.fn() };
    const result = (await run({ request: req(), next: async () => envelope })) as typeof envelope;
    expect(result.response.body).toBe(original.body);
    expect(result.dispose).toBe(envelope.dispose);
    expect(result.response.headers.get("set-cookie")).toContain("nes_tenant_assert=signed-value");
    expect(result.response.headers.get("set-cookie")).toContain("Secure");
  });
  it.each([Response.json({ ok: true }), new Response(null), { handled: true }])(
    "leaves non-HTML results alone",
    async (result) => {
      expect(await run({ request: req(), next: async () => result })).toBe(result);
      expect(h.assertion).not.toHaveBeenCalled();
    },
  );
  it("does not mint a cookie for POST responses", async () => {
    const result = html();
    expect(await run({ request: req("POST"), next: async () => result })).toBe(result);
    expect(h.assertion).not.toHaveBeenCalled();
  });
  it.each([null, "signed-value"])("does not emit an unnecessary cookie (%s)", async (assertion) => {
    h.assertion.mockResolvedValue(assertion);
    const result = html();
    expect(
      await run({
        request: req("GET", "nes_tenant_assert=signed-value"),
        next: async () => result,
      }),
    ).toBe(result);
  });
  it("does not break a document when the signing layer rejects", async () => {
    h.assertion.mockRejectedValue(new Error("offline"));
    const result = html();
    expect(await run({ request: req(), next: async () => result })).toBe(result);
  });
});
