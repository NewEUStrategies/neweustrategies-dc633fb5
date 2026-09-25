// Werdykt „slug należy do osoby BEZ roli autora" (server fn nad RPC
// `member_slug_is_non_author`) - jedyne źródło 301 z /author na /people.
//
// CO TEN PLIK DOWODZI I DLACZEGO TO RYZYKO WARTE TESTU. Trasa
// (src/routes/author.$slug.tsx) czyta trzy stany: `true` -> 301, `false` ->
// hub z WSPÓLNYM `Cache-Control`, odrzucenie -> hub albo 404 z `no-store`.
// Handler musi więc odróżniać ODPOWIEDŹ od jej BRAKU:
//
//   1. AWARIA TO ODRZUCENIE, NIE `false`. supabase-js nie rzuca przy awarii:
//      sieć, 5xx, PGRST202 (brak funkcji) i statement timeout wracają jako
//      `{ error }`. Do 24.09.2026 handler zamieniał to na `false`, czyli na
//      werdykt „autor" - hub osoby bez roli autora wychodził z brzegu bez 301.
//   2. BRAK KONFIGURACJI TEŻ JEST BRAKIEM ODPOWIEDZI - bez klienta nie ma
//      kogo pytać, więc `false` byłoby zmyśleniem.
//   3. `true` WYŁĄCZNIE Z `true`. `null` i `false` z RPC to „zostań na
//      /author", nigdy przekierowanie.
//   4. KLIENT BEZ SESJI Z NAGŁÓWKIEM HOSTA - nic nie trzyma tożsamości między
//      żądaniami, a tenant jest tym samym, dla którego trasa czyta hub.
//   5. TOŻSAMOŚĆ CZYTELNIKA JEDZIE DO RPC, GDY JEST. Od migracji 0053 werdykt
//      zależy od WOŁAJĄCEGO (gość: `profiles_public`, zalogowany: czy
//      `get_member_profile` rozwiąże cel 301), a hub przy nawigacji SPA
//      czyta przeglądarkowy klient Z SESJĄ. Bearer, który `attachSupabaseAuth`
//      dokleja do żądania server fn, musi więc trafić do PostgREST - inaczej
//      zalogowany widzi hub osoby bez roli autora, a anonimowy werdykt `false`
//      zostawia go na /author zamiast 301 na /people. Bez bearera (SSR, gość)
//      klient zostaje anonimowy.
//   6. WERDYKT Z TOŻSAMOŚCIĄ NIE TRAFIA DO WSPÓLNEGO CACHE'A - `private,
//      no-store` PRZED zapytaniem, także gdy RPC padnie. Werdykt anonimowy
//      nagłówka nie rusza: w SSR ta funkcja biegnie w procesie żądania
//      dokumentu i opt-out odebrałby brzegowi każdy hub autora.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Treści werdyktu (kto jest autorem, czyj profil
// jest widoczny) - to ciało funkcji SQL, sprawdzane po stronie bazy. Tutaj
// nie ma ani jednego zapytania do Postgresa.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** Wywołania RPC: nazwa + argumenty, w kolejności. */
  rpcCalls: [] as { name: string; args: unknown }[],
  /** Odpowiedź RPC w kształcie postgrest-js: `{ data, error }`, bez rzutu. */
  rpcResult: { data: null, error: null } as {
    data: unknown;
    error: { message: string; code?: string } | null;
  },
  /** Argumenty `createClient(url, key, options)` - kolejne wywołania. */
  clients: [] as { url: unknown; key: unknown; options: unknown }[],
  tenantFetch: vi.fn(),
  /** Nagłówek `Authorization` żądania server fn; `null` = gość / SSR bez sesji. */
  authorization: null as string | null,
  /** Nagłówki cache ustawione przez handler, w kolejności. */
  cacheHeaders: [] as string[],
  /** Kolejność efektów handlera - dowód „opt-out PRZED zapytaniem". */
  effects: [] as string[],
}));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: (url: unknown, key: unknown, options: unknown) => {
    h.clients.push({ url, key, options });
    return {
      rpc: (name: string, args: unknown) => {
        h.rpcCalls.push({ name, args });
        h.effects.push("rpc");
        return Promise.resolve(h.rpcResult);
      },
    };
  },
}));

vi.mock("@/integrations/supabase/tenant-host-fetch", () => ({
  fetchWithTenantHost: h.tenantFetch,
}));

// Żądanie server fn: PRAWDZIWY `optionalBearerFromRequest` czyta z niego
// nagłówek, więc test mierzy drogę od nagłówka do klienta, a nie atrapę helpera.
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => ({
    headers: {
      get: (name: string) => (name.toLowerCase() === "authorization" ? h.authorization : null),
    },
  }),
}));

vi.mock("@/lib/http/responseHeaders", () => ({
  setCacheControlHeader: (value: string) => {
    h.cacheHeaders.push(value);
    h.effects.push(`cache:${value}`);
  },
}));

import { callServerFn, validateServerFnInput } from "@/test/serverFnHarness";
import { isNonAuthorMemberSlug } from "@/lib/profile/memberSlug.functions";

/** Wywołanie tak, jak robi to framework: walidator, potem handler. */
function ask(slug: string): Promise<boolean> {
  return callServerFn<boolean>(isNonAuthorMemberSlug, {
    data: { slug },
    context: { supabase: null },
  });
}

/** Strażnik runtime zamiast rzutowania. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Opcje JEDYNEGO klienta zbudowanego w wywołaniu - strażnikiem, bez rzutowań. */
function onlyClientOptions(): Record<string, unknown> {
  expect(h.clients).toHaveLength(1);
  const options = h.clients[0]?.options;
  if (!isRecord(options)) throw new Error("test: createClient bez opcji");
  return options;
}

/** Pole `global` opcji klienta. */
function globalOptions(options: Record<string, unknown>): Record<string, unknown> {
  const global = options["global"];
  if (!isRecord(global)) throw new Error("test: createClient bez `global`");
  return global;
}

beforeEach(() => {
  h.rpcCalls = [];
  h.clients = [];
  h.rpcResult = { data: null, error: null };
  h.authorization = null;
  h.cacheHeaders = [];
  h.effects = [];
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.example");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isNonAuthorMemberSlug - odpowiedź RPC", () => {
  it("`true` z RPC: werdykt `true` dla sluga z adresu", async () => {
    h.rpcResult = { data: true, error: null };
    await expect(ask("anna-kowalska")).resolves.toBe(true);
    expect(h.rpcCalls).toEqual([
      { name: "member_slug_is_non_author", args: { p_slug: "anna-kowalska" } },
    ]);
  });

  it("`false` z RPC: werdykt `false` (autor albo brak profilu - zostań na /author)", async () => {
    h.rpcResult = { data: false, error: null };
    await expect(ask("anna-kowalska")).resolves.toBe(false);
  });

  it("`null` z RPC: werdykt `false`, nigdy przekierowanie", async () => {
    h.rpcResult = { data: null, error: null };
    await expect(ask("anna-kowalska")).resolves.toBe(false);
  });
});

describe("isNonAuthorMemberSlug - brak odpowiedzi to odrzucenie, nie `false`", () => {
  // Kształty z postgrest-js: awaria `fetch` łapana w bibliotece (kod pusty),
  // brak funkcji w schemacie, przekroczony `statement_timeout`, 5xx bramy.
  it.each([
    { label: "awaria sieci", error: { message: "TypeError: fetch failed", code: "" } },
    { label: "brak funkcji (PGRST202)", error: { message: "Could not find", code: "PGRST202" } },
    { label: "statement timeout (57014)", error: { message: "canceling", code: "57014" } },
    { label: "5xx bramy", error: { message: "Bad Gateway", code: "502" } },
  ])("$label: obietnica ODRZUCA z komunikatem błędu", async ({ error }) => {
    h.rpcResult = { data: null, error };
    await expect(ask("anna-kowalska")).rejects.toThrow(error.message);
  });

  it("błąd wygrywa z danymi: `{ data: false, error }` nadal odrzuca", async () => {
    // Obecność `data` obok `error` nie może zamienić awarii w werdykt „autor".
    h.rpcResult = { data: false, error: { message: "upstream timeout" } };
    await expect(ask("anna-kowalska")).rejects.toThrow("upstream timeout");
  });

  it.each(["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"])(
    "brak %s: odrzucenie bez budowania klienta",
    async (name) => {
      vi.stubEnv(name, "");
      await expect(ask("anna-kowalska")).rejects.toThrow("brak konfiguracji");
      expect(h.clients).toHaveLength(0);
      expect(h.rpcCalls).toHaveLength(0);
    },
  );
});

describe("isNonAuthorMemberSlug - klient i wejście", () => {
  it("GOŚĆ (brak bearera): klient ANONIMOWY bez sesji, z nagłówkiem hosta tenanta", async () => {
    h.rpcResult = { data: false, error: null };
    await ask("anna-kowalska");
    const options = onlyClientOptions();
    expect(h.clients[0]?.url).toBe("https://project.supabase.example");
    expect(h.clients[0]?.key).toBe("publishable-key");
    expect(options["auth"]).toEqual({
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    });
    // Bez nagłówków: supabase-js wyśle wtedy klucz publikowalny, czyli rolę anon.
    expect(globalOptions(options)).toEqual({ fetch: h.tenantFetch });
  });

  it.each([
    { label: "pusty slug", slug: "" },
    { label: "slug dłuższy niż 200 znaków", slug: "a".repeat(201) },
  ])("walidator odrzuca: $label", ({ slug }) => {
    expect(() => validateServerFnInput(isNonAuthorMemberSlug, { slug })).toThrow();
  });

  it("walidator przepuszcza slug na granicy 200 znaków", () => {
    const slug = "a".repeat(200);
    expect(validateServerFnInput(isNonAuthorMemberSlug, { slug })).toEqual({ slug });
  });
});

describe("isNonAuthorMemberSlug - tożsamość czytelnika", () => {
  it("ZALOGOWANY: bearer z żądania trafia do PostgREST obok nagłówka hosta", async () => {
    // Ten sam czytelnik, co hub czytany w przeglądarce z jego sesją - werdykt
    // `true` wraca dla osoby bez roli autora, której profil ON otworzy na
    // /people (discoverable, połączenie, własny profil).
    h.authorization = "Bearer jwt-czytelnika";
    h.rpcResult = { data: true, error: null };
    await expect(ask("anna-kowalska")).resolves.toBe(true);
    const options = onlyClientOptions();
    expect(globalOptions(options)).toEqual({
      fetch: h.tenantFetch,
      headers: { Authorization: "Bearer jwt-czytelnika" },
    });
    // Token jest wyłącznie PRZEKAZANY: klient nadal nie trzyma sesji między
    // żądaniami, więc tożsamość nie przecieknie do następnego wołającego.
    expect(options["auth"]).toEqual({
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    });
  });

  it("ZALOGOWANY: `private, no-store` PRZED zapytaniem - werdykt jest per użytkownik", async () => {
    h.authorization = "Bearer jwt-czytelnika";
    h.rpcResult = { data: true, error: null };
    await ask("anna-kowalska");
    expect(h.cacheHeaders).toEqual(["private, no-store"]);
    expect(h.effects).toEqual(["cache:private, no-store", "rpc"]);
  });

  it("ZALOGOWANY i awaria RPC: odrzucenie, a opt-out cache'a już stoi", async () => {
    // Np. bearer odrzucony przez PostgREST (podróbka, wygasły): to brak
    // werdyktu, nie cudza warstwa i nie werdykt anonima.
    h.authorization = "Bearer podrobiony";
    h.rpcResult = { data: null, error: { message: "JWSInvalidSignature", code: "PGRST301" } };
    await expect(ask("anna-kowalska")).rejects.toThrow("JWSInvalidSignature");
    expect(h.cacheHeaders).toEqual(["private, no-store"]);
  });

  it("GOŚĆ: nagłówek cache'a NIETKNIĘTY - w SSR decyduje o nim trasa", async () => {
    h.rpcResult = { data: true, error: null };
    await ask("anna-kowalska");
    expect(h.cacheHeaders).toEqual([]);
  });

  it.each([
    { label: "obcy schemat (Basic)", header: "Basic dXNlcjpoYXNsbw==" },
    { label: "samo słowo Bearer", header: "Bearer    " },
  ])(
    "$label: nie jest bearerem - klient anonimowy, nagłówek cache'a nietknięty",
    async ({ header }) => {
      h.authorization = header;
      h.rpcResult = { data: false, error: null };
      await ask("anna-kowalska");
      expect(globalOptions(onlyClientOptions())).toEqual({ fetch: h.tenantFetch });
      expect(h.cacheHeaders).toEqual([]);
    },
  );
});
