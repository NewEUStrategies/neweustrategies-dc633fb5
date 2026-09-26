// Klient WOŁAJĄCEGO dla funkcji uczestnika (konto albo gość).
//
// STAWKI: (1) klient zawsze niesie nagłówek hosta (`fetchWithTenantHost`) -
// inaczej `public_tenant_id()` wskazałby najemcę domyślnego; (2) ważny Bearer
// jest weryfikowany i PRZEKAZYWANY do klienta; (3) nieważny Bearer to
// `unauthorized`, nie cichy tryb gościa; (4) brak nagłówka = gość (`userId:
// null`), bez wołania `getClaims`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const req = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => req.current }));

const sdk = vi.hoisted(() => {
  const getClaims = vi.fn();
  const client = { auth: { getClaims } };
  return { createClient: vi.fn(() => client), getClaims, client };
});
vi.mock("@supabase/supabase-js", () => ({ createClient: sdk.createClient }));

const hostFetch = vi.hoisted(() => ({ fetchWithTenantHost: vi.fn() }));
vi.mock("@/integrations/supabase/tenant-host-fetch", () => hostFetch);

import { callerSupabase } from "@/lib/events/callerClient.server";

const URL_ = "https://supabase.example.com";
const KEY = "publishable-key-placeholder-not-a-secret";
const USER = "00000000-0000-4000-8000-000000000001";
const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_PUBLISHABLE_KEY };

function request(headers: Record<string, string>): { headers: Headers } {
  return { headers: new Headers(headers) };
}

function options(): Record<string, unknown> {
  const call = sdk.createClient.mock.calls.at(-1) as unknown[] | undefined;
  return (call?.[2] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_URL = URL_;
  process.env.SUPABASE_PUBLISHABLE_KEY = KEY;
  req.current = request({});
});

afterEach(() => {
  if (saved.url === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = saved.url;
  if (saved.key === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
  else process.env.SUPABASE_PUBLISHABLE_KEY = saved.key;
});

describe("callerSupabase - gość", () => {
  it("bez nagłówka: anonimowy klient z hostem, bez getClaims", async () => {
    const out = await callerSupabase();
    expect(out.userId).toBeNull();
    expect(out.client).toBe(sdk.client);
    expect(sdk.createClient).toHaveBeenCalledWith(URL_, KEY, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
      global: { fetch: hostFetch.fetchWithTenantHost },
    });
    expect(sdk.getClaims).not.toHaveBeenCalled();
  });

  it.each([
    ["inny schemat", { authorization: "Basic abc" }],
    ["pusty Bearer", { authorization: "Bearer    " }],
  ])("%s = gość", async (_label, headers) => {
    req.current = request(headers);
    await expect(callerSupabase()).resolves.toMatchObject({ userId: null });
    expect(sdk.getClaims).not.toHaveBeenCalled();
  });

  it("brak żądania (wywołanie poza kontekstem HTTP) = gość", async () => {
    req.current = undefined;
    await expect(callerSupabase()).resolves.toMatchObject({ userId: null });
    req.current = {};
    await expect(callerSupabase()).resolves.toMatchObject({ userId: null });
  });
});

describe("callerSupabase - konto", () => {
  it("ważny token: klient z nagłówkiem autoryzacji I hostem, userId = sub", async () => {
    req.current = request({ authorization: "Bearer token-syntetyczny" });
    sdk.getClaims.mockResolvedValue({ data: { claims: { sub: USER } }, error: null });
    const out = await callerSupabase();
    expect(out).toEqual({ client: sdk.client, userId: USER });
    expect(sdk.getClaims).toHaveBeenCalledWith("token-syntetyczny");
    expect(options()).toEqual({
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
      global: {
        headers: { Authorization: "Bearer token-syntetyczny" },
        fetch: hostFetch.fetchWithTenantHost,
      },
    });
  });

  it.each([
    ["błąd weryfikacji", { data: null, error: new Error("jwt expired") }],
    ["brak claims", { data: {}, error: null }],
    ["pusty sub", { data: { claims: { sub: "" } }, error: null }],
    ["sub nie-napis", { data: { claims: { sub: 5 } }, error: null }],
  ])("%s -> unauthorized (nie tryb gościa)", async (_label, result) => {
    req.current = request({ authorization: "Bearer zly" });
    sdk.getClaims.mockResolvedValue(result);
    await expect(callerSupabase()).rejects.toThrow("unauthorized");
  });
});

describe("callerSupabase - konfiguracja", () => {
  it.each(["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"])(
    "brak %s -> server_misconfigured",
    async (name) => {
      delete process.env[name];
      await expect(callerSupabase()).rejects.toThrow(/^server_misconfigured/);
      expect(sdk.createClient).not.toHaveBeenCalled();
    },
  );
});
