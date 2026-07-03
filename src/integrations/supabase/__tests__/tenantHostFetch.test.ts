// @vitest-environment node
//
// fetchWithTenantHost injects x-tenant-host into Supabase calls (re-audit N2)
// so the database can resolve public_tenant_id() per request host.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TENANT_HOST_HEADER } from "@/lib/http/host";
import { fetchWithTenantHost } from "@/integrations/supabase/tenant-host-fetch";

const state = vi.hoisted(() => ({ host: null as string | null }));

vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: () => Promise.resolve(state.host),
  requestPublicHost: () => state.host,
}));

interface CapturedCall {
  input: RequestInfo | URL;
  init: RequestInit | undefined;
}

const calls: CapturedCall[] = [];

beforeEach(() => {
  calls.length = 0;
  state.host = null;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return Promise.resolve(new Response("ok"));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function headersOfLastCall(): Headers {
  const last = calls[calls.length - 1];
  if (last.init?.headers) return new Headers(last.init.headers);
  if (last.input instanceof Request) return last.input.headers;
  return new Headers();
}

describe("fetchWithTenantHost", () => {
  it("passes through untouched when no host is resolvable", async () => {
    await fetchWithTenantHost("https://db.example/rest/v1/posts", { method: "GET" });
    expect(calls).toHaveLength(1);
    expect(headersOfLastCall().has(TENANT_HOST_HEADER)).toBe(false);
  });

  it("injects the tenant host header", async () => {
    state.host = "b.example";
    await fetchWithTenantHost("https://db.example/rest/v1/posts");
    expect(headersOfLastCall().get(TENANT_HOST_HEADER)).toBe("b.example");
  });

  it("preserves caller headers (apikey/authorization) alongside the injected one", async () => {
    state.host = "b.example";
    await fetchWithTenantHost("https://db.example/rest/v1/posts", {
      headers: { apikey: "anon-key", Authorization: "Bearer jwt" },
    });
    const headers = headersOfLastCall();
    expect(headers.get("apikey")).toBe("anon-key");
    expect(headers.get("authorization")).toBe("Bearer jwt");
    expect(headers.get(TENANT_HOST_HEADER)).toBe("b.example");
  });

  it("never clobbers an explicitly-set tenant host header", async () => {
    state.host = "b.example";
    await fetchWithTenantHost("https://db.example/rest/v1/posts", {
      headers: { [TENANT_HOST_HEADER]: "pinned.example" },
    });
    expect(headersOfLastCall().get(TENANT_HOST_HEADER)).toBe("pinned.example");
  });

  it("supports Request-object input", async () => {
    state.host = "b.example";
    await fetchWithTenantHost(
      new Request("https://db.example/rest/v1/posts", { headers: { apikey: "anon-key" } }),
    );
    const headers = headersOfLastCall();
    expect(headers.get(TENANT_HOST_HEADER)).toBe("b.example");
    expect(headers.get("apikey")).toBe("anon-key");
  });
});
