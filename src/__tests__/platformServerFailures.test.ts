// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  captured: undefined as unknown,
  revalidate: undefined as undefined | ((r: Request) => Promise<boolean>),
  work: undefined as Promise<boolean> | undefined,
}));
vi.mock("@tanstack/react-start/server-entry", () => ({ default: { fetch: h.fetch } }));
vi.mock("../lib/error-capture", () => ({ consumeLastCapturedError: () => h.captured }));
vi.mock("../lib/error-page", () => ({ renderErrorPage: () => "<html>safe error</html>" }));
vi.mock("../lib/http/documentCache.server", () => ({
  revalidationHeader: () => ["x-revalidation", "test-marker"],
  setDocumentRevalidator: (fn: typeof h.revalidate) => {
    h.revalidate = fn;
  },
  applyDeferredDocumentStore: (response: Response, callback?: (work: Promise<boolean>) => void) => {
    if (h.work) callback?.(h.work);
    return response;
  },
}));
import entry from "../server";
import { LANG_COOKIE } from "../lib/i18n/langCookie";

beforeEach(() => {
  vi.clearAllMocks();
  h.captured = undefined;
  h.work = undefined;
});
const request = () => new Request("https://example.org/en/article");
describe("outer SSR failure boundary", () => {
  it.each([
    { code: "ECONNRESET" },
    { message: "request aborted" },
    { name: "AbortError" },
    { cause: { cause: new DOMException("client left", "AbortError") } },
  ])("returns non-cacheable 499 for a disconnected transport: %j", async (error) => {
    h.fetch.mockRejectedValueOnce(error);
    const response = await entry.fetch(request());
    expect(response.status).toBe(499);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });
  it("honors an already aborted request even when rejection has no details", async () => {
    const controller = new AbortController();
    controller.abort();
    h.fetch.mockRejectedValueOnce(null);
    expect((await entry.fetch(new Request(request(), { signal: controller.signal }))).status).toBe(
      499,
    );
  });
  it.each([undefined, new Error("private failure"), "rejected", 17])(
    "renders a safe 500 for a non-abort rejection: %s",
    async (error) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      h.fetch.mockRejectedValueOnce(error);
      const response = await entry.fetch(request());
      expect(response.status).toBe(500);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe("<html>safe error</html>");
      expect(log).toHaveBeenCalledWith(error);
      log.mockRestore();
    },
  );
  it("terminates cyclic cause chains and retains the original diagnostic", async () => {
    const one: { cause?: unknown } = {};
    const two = { cause: one };
    one.cause = two;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.fetch.mockRejectedValueOnce(one);
    expect((await entry.fetch(request())).status).toBe(500);
    expect(log).toHaveBeenCalledWith(one);
    log.mockRestore();
  });
  it.each([
    ["application/json", "not JSON"],
    ["application/json", '{"message":"expected domain error"}'],
    ["text/plain", "upstream unavailable"],
    [null, "upstream unavailable"],
  ])(
    "preserves a deliberate 503 response (%s) instead of normalizing arbitrary bodies",
    async (type, body) => {
      const headers = new Headers();
      if (type) headers.set("content-type", type);
      h.fetch.mockResolvedValueOnce(
        new Response(new TextEncoder().encode(body!), { status: 503, headers }),
      );
      const response = await entry.fetch(request());
      expect(response.status).toBe(503);
      expect(await response.text()).toBe(body);
    },
  );
  it("recognizes a captured abort behind h3's swallowed-error envelope", async () => {
    h.captured = { cause: { code: "ECONNRESET" } };
    h.fetch.mockResolvedValueOnce(
      Response.json({ unhandled: true, message: "HTTPError" }, { status: 500 }),
    );
    expect((await entry.fetch(request())).status).toBe(499);
  });
  it("keeps only the locale cookie in anonymous revalidation and awaits the store result", async () => {
    h.work = Promise.resolve(true);
    h.fetch.mockResolvedValueOnce(
      new Response("<html>fresh</html>", { headers: { "content-type": "text/html" } }),
    );
    const original = new Request(request(), {
      headers: {
        cookie: `sb-session=private; ${LANG_COOKIE}=en; other=private`,
        authorization: "Bearer private",
      },
    });
    expect(await h.revalidate!(original)).toBe(true);
    const synthetic = h.fetch.mock.calls[0][0] as Request;
    expect(synthetic.headers.get("cookie")).toBe(`${LANG_COOKIE}=en`);
    expect(synthetic.headers.get("authorization")).toBeNull();
    expect(synthetic.headers.get("x-revalidation")).toBe("test-marker");
  });
});
