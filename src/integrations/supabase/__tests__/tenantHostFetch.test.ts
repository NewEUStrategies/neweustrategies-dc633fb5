// @vitest-environment node
//
// fetchWithTenantHost wstrzykuje DWA nagłówki w wywołania Supabase:
//   * `x-tenant-host` (re-audyt N2) - żeby baza rozstrzygnęła public_tenant_id()
//     per host żądania;
//   * `x-tenant-assert` (audyt 05.08 §4.1) - POŚWIADCZENIE krawędzi dla tego
//     samego hosta. Bez niego szczebel VERIFIED w bazie jest martwy i każde
//     żądanie idzie jako sama DEKLARACJA klienta.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TENANT_HOST_HEADER } from "@/lib/http/host";
import { TENANT_ASSERTION_HEADER } from "@/lib/http/tenantAssertion";
import { fetchWithTenantHost } from "@/integrations/supabase/tenant-host-fetch";

const state = vi.hoisted(() => ({
  host: null as string | null,
  assertion: null as string | null,
}));

vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: () => Promise.resolve(state.host),
  currentTenantAssertion: () => Promise.resolve(state.assertion),
  requestPublicHost: () => state.host,
}));

// Telemetria SSR jest ładowana dynamicznie wewnątrz timedFetch. Bez mocka
// pierwszy test płaci za transformację całego łańcucha @tanstack/react-start
// /server (>5 s w zimnym runnerze) i wywala się na timeoucie.
vi.mock("@/lib/http/ssrTiming.server", () => ({
  recordDbRoundTrip: vi.fn(),
}));

interface CapturedCall {
  input: RequestInfo | URL;
  init: RequestInit | undefined;
}

const calls: CapturedCall[] = [];

beforeEach(() => {
  calls.length = 0;
  state.host = null;
  state.assertion = null;
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
    state.assertion = "v1.edge1.Yi5leGFtcGxl.4000000000.c2ln";
    await fetchWithTenantHost(
      new Request("https://db.example/rest/v1/posts", { headers: { apikey: "anon-key" } }),
    );
    const headers = headersOfLastCall();
    expect(headers.get(TENANT_HOST_HEADER)).toBe("b.example");
    expect(headers.get(TENANT_ASSERTION_HEADER)).toBe("v1.edge1.Yi5leGFtcGxl.4000000000.c2ln");
    expect(headers.get("apikey")).toBe("anon-key");
  });
});

describe("fetchWithTenantHost - poświadczenie krawędzi", () => {
  it("dokłada poświadczenie obok hosta", async () => {
    state.host = "b.example";
    state.assertion = "v1.edge1.Yi5leGFtcGxl.4000000000.c2ln";
    await fetchWithTenantHost("https://db.example/rest/v1/posts");
    const headers = headersOfLastCall();
    expect(headers.get(TENANT_HOST_HEADER)).toBe("b.example");
    expect(headers.get(TENANT_ASSERTION_HEADER)).toBe("v1.edge1.Yi5leGFtcGxl.4000000000.c2ln");
  });

  it("brak poświadczenia NIE blokuje wysłania hosta (szczebel ASSERTED)", async () => {
    // Wdrożenie bez klucza podpisującego musi działać jak przed zmianą - baza
    // degraduje wtedy w stronę BEZPIECZNĄ (tenant domowy zalogowanego).
    state.host = "b.example";
    await fetchWithTenantHost("https://db.example/rest/v1/posts");
    const headers = headersOfLastCall();
    expect(headers.get(TENANT_HOST_HEADER)).toBe("b.example");
    expect(headers.has(TENANT_ASSERTION_HEADER)).toBe(false);
  });

  it("poświadczenie leci nawet bez rozstrzygniętego hosta", async () => {
    // Poświadczenie SAMO niesie host (podpisany), więc jest silniejszym
    // wejściem niż nagłówek hosta - nie wolno go gubić.
    state.assertion = "v1.edge1.Yi5leGFtcGxl.4000000000.c2ln";
    await fetchWithTenantHost("https://db.example/rest/v1/posts");
    const headers = headersOfLastCall();
    expect(headers.has(TENANT_HOST_HEADER)).toBe(false);
    expect(headers.get(TENANT_ASSERTION_HEADER)).toBe("v1.edge1.Yi5leGFtcGxl.4000000000.c2ln");
  });

  it("nigdy nie nadpisuje jawnie ustawionego poświadczenia", async () => {
    state.host = "b.example";
    state.assertion = "v1.edge1.Yi5leGFtcGxl.4000000000.c2ln";
    await fetchWithTenantHost("https://db.example/rest/v1/posts", {
      headers: { [TENANT_ASSERTION_HEADER]: "pinned" },
    });
    expect(headersOfLastCall().get(TENANT_ASSERTION_HEADER)).toBe("pinned");
  });
});

describe("fetchWithTenantHost - deadline SSR", () => {
  afterEach(() => {
    delete process.env.SSR_DB_DEADLINE_MS;
  });

  it("uzbraja sygnał deadline'u na wywołaniach SSR", async () => {
    await fetchWithTenantHost("https://db.example/rest/v1/posts");
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("przerywa wiszący fetch po przekroczeniu deadline'u", async () => {
    process.env.SSR_DB_DEADLINE_MS = "30";
    vi.stubGlobal(
      "fetch",
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    await expect(fetchWithTenantHost("https://db.example/rest/v1/hang")).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  it("sygnał wywołującego dalej działa obok deadline'u", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          // Abort może wyprzedzić rejestrację listenera (fetch woła się po
          // asynchronicznej rezolucji hosta) - honoruj stan `aborted`.
          if (init?.signal?.aborted) {
            reject(init.signal.reason);
            return;
          }
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    const pending = fetchWithTenantHost("https://db.example/rest/v1/posts", {
      signal: controller.signal,
    });
    controller.abort(new Error("caller-abort"));
    await expect(pending).rejects.toMatchObject({ message: "caller-abort" });
  });

  it("SSR_DB_DEADLINE_MS=off wyłącza deadline", async () => {
    process.env.SSR_DB_DEADLINE_MS = "off";
    await fetchWithTenantHost("https://db.example/rest/v1/posts");
    expect(calls[0]?.init?.signal ?? undefined).toBeUndefined();
  });
});
