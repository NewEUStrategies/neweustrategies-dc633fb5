// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  request: vi.fn(),
  trusted: vi.fn(),
  mint: vi.fn(),
  assertion: vi.fn(),
}));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: h.request }));
vi.mock("@/lib/server/tenant.server", () => ({ resolveTrustedRequestHost: h.trusted }));
vi.mock("@/lib/server/tenantAssertion.server", () => ({ mintTenantHostAssertion: h.mint }));
vi.mock("../tenantAssertion", () => ({ browserTenantAssertion: h.assertion }));
import {
  currentServerHost,
  currentServerAssertion,
  assertionForRequest,
  trustedHostFromRequest,
} from "../requestHost.server";
import {
  currentTenantHost,
  currentTenantAssertion,
  requestPublicHost,
  trustedPublicHost,
} from "../requestHost";
const request = new Request("https://tenant.example/blog", { headers: { host: "tenant.example" } });
beforeEach(() => {
  vi.clearAllMocks();
  h.request.mockReturnValue(request);
  h.trusted.mockResolvedValue("tenant.example");
  h.mint.mockResolvedValue("signed-token");
  h.assertion.mockReturnValue("browser-token");
  vi.stubEnv("SSR", true);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("request host and tenant assertion boundary", () => {
  it("normalizes raw proxy hosts and distinguishes absent headers", () => {
    expect(
      requestPublicHost(
        new Request("https://x", {
          headers: { "x-forwarded-host": "EXAMPLE.ORG:443", host: "other.org" },
        }),
      ),
    ).toBe("example.org");
    expect(requestPublicHost(new Request("https://x"))).toBeNull();
  });
  it("validates the current and explicit request before minting any assertion", async () => {
    expect(await currentServerHost()).toBe("tenant.example");
    expect(await currentServerAssertion()).toBe("signed-token");
    expect(await assertionForRequest(request)).toBe("signed-token");
    expect(await trustedHostFromRequest(request)).toBe("tenant.example");
    expect(h.trusted).toHaveBeenCalledWith(request);
    expect(h.mint).toHaveBeenCalledWith("tenant.example");
  });
  it("does not sign unknown hosts", async () => {
    h.trusted.mockResolvedValue(null);
    expect(await currentServerAssertion()).toBeNull();
    expect(await assertionForRequest(request)).toBeNull();
    expect(h.mint).not.toHaveBeenCalled();
  });
  it.each([null, undefined])("tolerates missing request context (%s)", async (value) => {
    h.request.mockReturnValue(value);
    expect(await currentServerHost()).toBeNull();
    expect(h.trusted).not.toHaveBeenCalled();
  });
  it("tolerates context failure and unavailable signing keys", async () => {
    h.request.mockImplementation(() => {
      throw new Error("no request");
    });
    expect(await currentServerHost()).toBeNull();
    h.request.mockReturnValue(request);
    h.mint.mockRejectedValue(new Error("no signing key"));
    expect(await currentServerAssertion()).toBeNull();
    expect(await assertionForRequest(request)).toBeNull();
    h.trusted.mockRejectedValue(new Error("directory offline"));
    expect(await assertionForRequest(request)).toBeNull();
  });
  it("uses validated SSR values in the isomorphic facade", async () => {
    expect(await trustedPublicHost(request)).toBe("tenant.example");
    expect(await currentTenantHost()).toBe("tenant.example");
    expect(await currentTenantAssertion()).toBe("signed-token");
  });
  it("falls back when the trusted directory fails", async () => {
    h.trusted.mockRejectedValue(new Error("offline"));
    expect(await trustedPublicHost(request)).toBe("tenant.example");
    expect(await currentTenantHost()).toBeNull();
    expect(await currentTenantAssertion()).toBeNull();
  });
  it("uses the actual browser origin and its host-bound cookie", async () => {
    vi.stubGlobal("window", { location: { host: "BROWSER.EXAMPLE:443" } });
    expect(await currentTenantHost()).toBe("browser.example");
    expect(await currentTenantAssertion()).toBe("browser-token");
    expect(h.mint).not.toHaveBeenCalled();
  });
  it("has safe fallbacks outside SSR and outside a browser", async () => {
    vi.stubEnv("SSR", false);
    expect(await currentTenantHost()).toBeNull();
    expect(await currentTenantAssertion()).toBeNull();
    expect(await trustedPublicHost(request)).toBe("tenant.example");
    expect(h.trusted).not.toHaveBeenCalled();
  });
});
