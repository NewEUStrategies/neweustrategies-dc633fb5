// Trasa syntezy mowy dla wpisu: 129 mierzonych linii, ZERO pokrycia. To wejście
// do PŁATNEGO dostawcy (ElevenLabs) i jednocześnie potencjalny objazd wokół
// paywalla - treść płatnego artykułu dałoby się usłyszeć bez uprawnienia.
//
// Test jedzie REALNĄ ścieżką handlera; wymieniamy wyłącznie warstwę zewnętrzną:
// klienta bazy service-role, licznik rate-limit, katalog tenantów, planowanie
// kanonicznego głosu, storage i `fetch` do dostawcy. Reguły decyzyjne handlera
// (bramka dostępu, kolejność limitów, cache, mapowanie błędów) są testowane, nie
// atrapowane.
//
// Sześć gwarancji, których złamanie kosztuje pieniądze albo wypuszcza treść:
//
//   1. BRAMKA DOSTĘPU. Wpis nie-publiczny bez uprawnienia dostaje 404 - ten SAM
//      kod co brak wpisu, żeby TTS nie potwierdzał istnienia płatnej treści.
//   2. IZOLACJA TENANTÓW. Odczyt wpisu jest zawężony do tenanta HOSTA żądania;
//      service role omija RLS, więc ten filtr jest jedyną zaporą.
//   3. TRAFIENIE W CACHE NIE JEST DŁAWIONE ANI PŁATNE. Limity budżetowe
//      (godzinowy per IP i per wpis) wolno stosować WYŁĄCZNIE przy pudle cache.
//   4. LIMIT MINUTOWY JEST FAIL-OPEN, BUDŻETOWE FAIL-CLOSED. Awaria licznika nie
//      może blokować czytelnika, ale nie może też otworzyć kwoty dostawcy.
//   5. KONTRAKT WEJŚCIA. Głos i model rozstrzyga wyłącznie serwer - pola
//      `voiceId`/`model` w ciele żądania są IGNOROWANE, nie honorowane.
//   6. MAPOWANIE BŁĘDÓW DOSTAWCY. Wyczerpana kwota (402) i throttling (429) mają
//      własne kody; wszystko inne to 502.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

interface QueryResult {
  data: unknown;
  error: unknown;
}

const h = vi.hoisted(() => {
  const state: {
    /** Wynik `maybeSingle()` per tabela. */
    lookups: Record<string, QueryResult>;
    /** Zapisane łańcuchy: tabela + wywołane ogniwa + argumenty. */
    ops: { table: string; method: string; args: unknown[] }[];
    /** Odpowiedzi `rateLimit` w kolejności wywołań (scope -> wynik). */
    rateLimits: Record<string, boolean>;
    rateLimitCalls: { scope: string; subjectId: string; failClosed?: boolean }[];
    tenantId: string | null;
    host: string;
    downloadResult: { data: unknown; error?: unknown } | (() => never);
    uploadError: { message: string } | null;
    plan: {
      pin: { voiceId: string; model: string; voiceSource: "post" | "tenant" };
      storagePath: string;
      rendition: unknown;
      fresh: boolean;
      registryAvailable: boolean;
    };
    recorded: unknown[];
    fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
    fetchCalls: { url: string; body: unknown; headers: Record<string, string> }[];
    authedClients: { url: string; key: string; authorization?: string }[];
    rpcCalls: { fn: string; args: Record<string, unknown> }[];
    entitlement: QueryResult;
  } = {
    lookups: {},
    ops: [],
    rateLimits: {},
    rateLimitCalls: [],
    tenantId: "ten_1",
    host: "example.com",
    downloadResult: { data: null },
    uploadError: null,
    plan: {
      pin: {
        voiceId: "JBFqnCBsd6RMkjVDRZzb",
        model: "eleven_multilingual_v2",
        voiceSource: "tenant",
      },
      storagePath: "ten_1/post_1/pl.mp3",
      rendition: null,
      fresh: false,
      registryAvailable: true,
    },
    recorded: [],
    fetchImpl: async () => new Response(new ArrayBuffer(8), { status: 200 }),
    fetchCalls: [],
    authedClients: [],
    rpcCalls: [],
    entitlement: { data: null, error: null },
  };

  interface Chain extends PromiseLike<QueryResult> {
    [method: string]: unknown;
  }

  let table = "";
  const record =
    (method: string) =>
    (...args: unknown[]): Chain => {
      state.ops.push({ table, method, args });
      return chain;
    };
  const lookup = (): Promise<QueryResult> =>
    Promise.resolve(state.lookups[table] ?? { data: null, error: null });

  const terminals: Record<string, unknown> = {
    maybeSingle: lookup,
    single: lookup,
    then: (ok: unknown, err: unknown) =>
      Promise.resolve(lookup()).then(
        ok as (v: QueryResult) => unknown,
        err as (e: unknown) => unknown,
      ),
  };
  const cache = new Map<string, unknown>();
  const chain: Chain = new Proxy({} as Chain, {
    get(_t, prop: string | symbol) {
      if (typeof prop !== "string") return undefined;
      if (prop in terminals) return terminals[prop];
      let fn = cache.get(prop);
      if (!fn) {
        fn = record(prop);
        cache.set(prop, fn);
      }
      return fn;
    },
  });

  const storageOps: { bucket: string; method: string; path: string }[] = [];
  const client = {
    from: (t: string) => {
      table = t;
      state.ops.push({ table: t, method: "from", args: [t] });
      return chain;
    },
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          storageOps.push({ bucket, method: "download", path });
          if (typeof state.downloadResult === "function") state.downloadResult();
          return state.downloadResult;
        },
        upload: async (path: string) => {
          storageOps.push({ bucket, method: "upload", path });
          return { error: state.uploadError };
        },
      }),
    },
  };

  return { state, client, storageOps };
});

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: h.client }));
// Klient wiązany JWT wywołującego - handler tworzy go DYNAMICZNIE, żeby anonimowe
// żądania po publiczne wpisy nie ciągnęły supabase-js do izolatu.
vi.mock("@supabase/supabase-js", () => ({
  createClient: (
    url: string,
    key: string,
    options: { global: { headers: Record<string, string> } },
  ) => {
    h.state.authedClients.push({ url, key, authorization: options.global.headers.Authorization });
    return {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        h.state.rpcCalls.push({ fn, args });
        return h.state.entitlement;
      },
    };
  },
}));
vi.mock("@tanstack/react-start/server", () => ({ getRequestIP: () => "203.0.113.7" }));
vi.mock("@/lib/server/rate-limit.server", () => ({
  rateLimit: async (input: {
    scope: string;
    subjectId: string;
    failClosed?: boolean;
  }): Promise<boolean> => {
    h.state.rateLimitCalls.push(input);
    return h.state.rateLimits[input.scope] ?? true;
  },
}));
vi.mock("@/lib/http/requestHost", () => ({ trustedPublicHost: async () => h.state.host }));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: async () => h.state.tenantId,
}));
vi.mock("@/lib/server/tts.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/tts.server")>();
  return {
    ...actual,
    resolveCanonicalTtsPlan: async () => h.state.plan,
    recordTtsRendition: async (input: unknown) => void h.state.recorded.push(input),
    // Koalescencja jest przezroczysta w teście: wywołujemy fabrykę raz.
    coalesceTtsSynthesis: async (_key: string, run: () => Promise<ArrayBuffer>) => run(),
  };
});

import { __handleForTests as handle } from "./post-tts";

const POST_ID = "11111111-1111-1111-1111-111111111111";

function req(
  body: unknown,
  headers: Record<string, string> = {},
  init: { badJson?: boolean } = {},
): Request {
  return {
    json: init.badJson
      ? () => Promise.reject(new SyntaxError("Unexpected token"))
      : () => Promise.resolve(body),
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  } as unknown as Request;
}

function publishedPost(overrides: Record<string, unknown> = {}) {
  return {
    id: POST_ID,
    title_pl: "Rola Unii Europejskiej",
    title_en: "The role of the EU",
    content_pl: "<p>Treść <strong>polska</strong> artykułu.</p>",
    content_en: "<p>English body.</p>",
    blocks_data: null,
    status: "published",
    tenant_id: "ten_1",
    tts_voice_pl: null,
    tts_voice_en: null,
    ...overrides,
  };
}

/** Ogniwa łańcucha PostgREST zapisane dla danej tabeli. */
function opsFor(table: string) {
  return h.state.ops.filter((o) => o.table === table);
}

const originalFetch = globalThis.fetch;
const originalEnv = {
  key: process.env.ELEVENLABS_API_KEY,
  url: process.env.SUPABASE_URL,
  publishable: process.env.SUPABASE_PUBLISHABLE_KEY,
};

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  h.state.ops.length = 0;
  h.state.rateLimitCalls.length = 0;
  h.state.rateLimits = {};
  h.state.recorded.length = 0;
  h.state.fetchCalls.length = 0;
  h.state.authedClients.length = 0;
  h.state.rpcCalls.length = 0;
  h.state.entitlement = { data: null, error: null };
  h.storageOps.length = 0;
  h.state.tenantId = "ten_1";
  h.state.host = "example.com";
  h.state.downloadResult = { data: null };
  h.state.uploadError = null;
  h.state.plan = {
    pin: {
      voiceId: "JBFqnCBsd6RMkjVDRZzb",
      model: "eleven_multilingual_v2",
      voiceSource: "tenant",
    },
    storagePath: "ten_1/post_1/pl.mp3",
    rendition: null,
    fresh: false,
    registryAvailable: true,
  };
  h.state.lookups = {
    posts: { data: publishedPost(), error: null },
    content_access: { data: null, error: null },
  };
  process.env.ELEVENLABS_API_KEY = "xi-test-key";
  process.env.SUPABASE_URL = "https://db.example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    h.state.fetchCalls.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : null,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return h.state.fetchImpl(String(url), init);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnv("ELEVENLABS_API_KEY", originalEnv.key);
  restoreEnv("SUPABASE_URL", originalEnv.url);
  restoreEnv("SUPABASE_PUBLISHABLE_KEY", originalEnv.publishable);
  h.state.fetchImpl = async () => new Response(new ArrayBuffer(8), { status: 200 });
  vi.restoreAllMocks();
});

describe("post-tts - walidacja wejścia", () => {
  it("nieparsowalny JSON daje 400, bez dotykania bazy", async () => {
    const res = await handle(req(null, {}, { badJson: true }));
    expect(res.status).toBe(400);
    expect(opsFor("posts")).toHaveLength(0);
  });

  it("brak `postId` daje 400", async () => {
    const res = await handle(req({ lang: "pl" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid postId" });
  });

  it("`postId` niepasujący do wzorca UUID daje 400 (bez zapytania do bazy)", async () => {
    const res = await handle(req({ postId: "../../etc/passwd", lang: "pl" }));
    expect(res.status).toBe(400);
    expect(opsFor("posts")).toHaveLength(0);
  });

  it("`postId` za krótki daje 400", async () => {
    const res = await handle(req({ postId: "abc", lang: "pl" }));
    expect(res.status).toBe(400);
    expect(h.state.rateLimitCalls).toHaveLength(0);
  });

  it("nieznany język degraduje do polskiego, nie do błędu", async () => {
    const res = await handle(req({ postId: POST_ID, lang: "de" }));
    expect(res.status).toBe(200);
    expect(h.state.fetchCalls[0].body).toMatchObject({ text: expect.stringContaining("Rola") });
  });

  it("KONTRAKT: `voiceId` i `model` z ciała żądania są IGNOROWANE", async () => {
    await handle(
      req({ postId: POST_ID, lang: "pl", voiceId: "atakujacyGlos1", model: "eleven_turbo_v2" }),
    );
    expect(h.state.fetchCalls[0].url).toContain("JBFqnCBsd6RMkjVDRZzb");
    expect(h.state.fetchCalls[0].body).toMatchObject({ model_id: "eleven_multilingual_v2" });
  });
});

describe("post-tts - konfiguracja i katalog tenantów", () => {
  it("BRAK SEKRETU dostawcy daje 503, nie 500 i nie próbę syntezy", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    const res = await handle(req({ postId: POST_ID, lang: "pl" }));
    expect(res.status).toBe(503);
    expect(h.state.fetchCalls).toHaveLength(0);
  });

  it("brak sekretu jest sprawdzany PO limicie minutowym (nadużycie dławimy zawsze)", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    await handle(req({ postId: POST_ID, lang: "pl" }));
    expect(h.state.rateLimitCalls.map((c) => c.scope)).toEqual(["post-tts:ip:min"]);
  });

  it("NIEZNANY HOST (brak tenanta) daje 503 i nie czyta wpisu", async () => {
    h.state.tenantId = null;
    const res = await handle(req({ postId: POST_ID, lang: "pl" }));
    expect(res.status).toBe(503);
    expect(opsFor("posts")).toHaveLength(0);
  });
});

describe("post-tts - izolacja tenantów i status wpisu", () => {
  it("odczyt wpisu jest ZAWĘŻONY do tenanta hosta (service role omija RLS)", async () => {
    await handle(req({ postId: POST_ID, lang: "pl" }));
    const eqs = opsFor("posts")
      .filter((o) => o.method === "eq")
      .map((o) => o.args);
    expect(eqs).toContainEqual(["tenant_id", "ten_1"]);
    expect(eqs).toContainEqual(["id", POST_ID]);
  });

  it("BRAK WPISU daje 404", async () => {
    h.state.lookups.posts = { data: null, error: null };
    const res = await handle(req({ postId: POST_ID, lang: "pl" }));
    expect(res.status).toBe(404);
    expect(h.state.fetchCalls).toHaveLength(0);
  });

  it("BŁĄD ODCZYTU wpisu daje 404 (nie 500 - nie zdradzamy stanu bazy)", async () => {
    h.state.lookups.posts = { data: null, error: { message: "permission denied" } };
    const res = await handle(req({ postId: POST_ID, lang: "pl" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Post not found" });
  });

  it("SZKIC dostaje 404, nie 403 - inaczej TTS potwierdzałby istnienie szkicu", async () => {
    h.state.lookups.posts = { data: publishedPost({ status: "draft" }), error: null };
    const res = await handle(req({ postId: POST_ID, lang: "pl" }));
    expect(res.status).toBe(404);
    expect(h.state.fetchCalls).toHaveLength(0);
  });
});

describe("post-tts - bramka dostępu (paywall)", () => {
  it("wpis PUBLICZNY nie wymaga tokenu", async () => {
    h.state.lookups.content_access = { data: { mode: "public" }, error: null };
    const res = await handle(req({ postId: POST_ID, lang: "pl" }));
    expect(res.status).toBe(200);
    expect(h.state.fetchCalls).toHaveLength(1);
  });

  it("brak wiersza dostępu (nieustawiony) też jest publiczny", async () => {
    h.state.lookups.content_access = { data: null, error: null };
    const res = await handle(req({ postId: POST_ID, lang: "pl" }));
    expect(res.status).toBe(200);
    expect(h.state.fetchCalls).toHaveLength(1);
  });

  it("wpis PŁATNY BEZ TOKENU daje 404 i NIE woła dostawcy", async () => {
    h.state.lookups.content_access = { data: { mode: "paid" }, error: null };
    const res = await handle(req({ postId: POST_ID, lang: "pl" }));
    expect(res.status).toBe(404);
    expect(h.state.fetchCalls).toHaveLength(0);
  });

  it("wpis TYLKO DLA ZALOGOWANYCH bez tokenu daje 404", async () => {
    h.state.lookups.content_access = { data: { mode: "members" }, error: null };
    const res = await handle(req({ postId: POST_ID, lang: "pl" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Post not found" });
  });

  it("wpis na HASŁO nigdy nie jest syntezowany (dowód odblokowania tu nie dociera)", async () => {
    h.state.lookups.content_access = { data: { mode: "password" }, error: null };
    const res = await handle(
      req({ postId: POST_ID, lang: "pl" }, { authorization: "Bearer token-abc" }),
    );
    expect(res.status).toBe(404);
    expect(h.state.fetchCalls).toHaveLength(0);
  });

  it("nagłówek autoryzacji BEZ prefiksu `Bearer` nie daje uprawnienia", async () => {
    h.state.lookups.content_access = { data: { mode: "paid" }, error: null };
    const res = await handle(req({ postId: POST_ID, lang: "pl" }, { authorization: "token-abc" }));
    expect(res.status).toBe(404);
    expect(h.state.fetchCalls).toHaveLength(0);
  });

  it("wiersz dostępu jest czytany dla TEGO wpisu i typu `post`", async () => {
    h.state.lookups.content_access = { data: { mode: "public" }, error: null };
    await handle(req({ postId: POST_ID, lang: "pl" }));
    const eqs = opsFor("content_access")
      .filter((o) => o.method === "eq")
      .map((o) => o.args);
    expect(eqs).toContainEqual(["entity_type", "post"]);
    expect(eqs).toContainEqual(["entity_id", POST_ID]);
  });
});

describe("post-tts - bramka dostępu: czytelnik UPRAWNIONY", () => {
  beforeEach(() => {
    h.state.lookups.content_access = { data: { mode: "paid" }, error: null };
  });

  it("token + potwierdzone uprawnienie => 200 i synteza", async () => {
    h.state.entitlement = { data: true, error: null };
    const res = await handle(
      req({ postId: POST_ID, lang: "pl" }, { authorization: "Bearer jwt-uprawniony" }),
    );
    expect(res.status).toBe(200);
    expect(h.state.fetchCalls).toHaveLength(1);
  });

  it("uprawnienie liczy `has_content_access` dla TEGO wpisu, nie dla czegokolwiek", async () => {
    h.state.entitlement = { data: true, error: null };
    await handle(req({ postId: POST_ID, lang: "pl" }, { authorization: "Bearer jwt" }));
    expect(h.state.rpcCalls).toEqual([
      { fn: "has_content_access", args: { _entity_type: "post", _entity_id: POST_ID } },
    ]);
  });

  it("klient uprawnienia jest WIĄZANY JWT wywołującego (RPC czyta z niego auth.uid())", async () => {
    h.state.entitlement = { data: true, error: null };
    await handle(req({ postId: POST_ID, lang: "pl" }, { authorization: "Bearer jwt-abc" }));
    expect(h.state.authedClients).toHaveLength(1);
    expect(h.state.authedClients[0].authorization).toBe("Bearer jwt-abc");
  });

  it("klient uprawnienia używa klucza PUBLICZNEGO, nigdy service-role", async () => {
    h.state.entitlement = { data: true, error: null };
    await handle(req({ postId: POST_ID, lang: "pl" }, { authorization: "Bearer jwt" }));
    expect(h.state.authedClients[0].key).toBe("sb_publishable_test");
    expect(h.state.authedClients[0].url).toBe("https://db.example.supabase.co");
  });

  it("ODMOWA uprawnienia (`false`) daje 404 - ten sam kod co brak wpisu", async () => {
    h.state.entitlement = { data: false, error: null };
    const res = await handle(
      req({ postId: POST_ID, lang: "pl" }, { authorization: "Bearer jwt-bez-planu" }),
    );
    expect(res.status).toBe(404);
    expect(h.state.fetchCalls).toHaveLength(0);
  });

  it("BŁĄD RPC nie jest traktowany jako uprawnienie (fail-closed)", async () => {
    h.state.entitlement = { data: true, error: { message: "JWT expired" } };
    const res = await handle(
      req({ postId: POST_ID, lang: "pl" }, { authorization: "Bearer stary" }),
    );
    expect(res.status).toBe(404);
    expect(h.state.fetchCalls).toHaveLength(0);
  });

  it("wartość RPC inna niż DOKŁADNIE `true` nie daje dostępu", async () => {
    h.state.entitlement = { data: "true", error: null };
    const res = await handle(req({ postId: POST_ID, lang: "pl" }, { authorization: "Bearer jwt" }));
    expect(res.status).toBe(404);
    expect(h.state.rpcCalls).toHaveLength(1);
  });

  it("BRAK konfiguracji klienta publicznego => 404, a RPC nie jest nawet wołane", async () => {
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    h.state.entitlement = { data: true, error: null };
    const res = await handle(req({ postId: POST_ID, lang: "pl" }, { authorization: "Bearer jwt" }));
    expect(res.status).toBe(404);
    expect(h.state.rpcCalls).toHaveLength(0);
  });

  it("PUSTY token po prefiksie `Bearer ` nie tworzy klienta uprawnienia", async () => {
    const res = await handle(req({ postId: POST_ID, lang: "pl" }, { authorization: "Bearer    " }));
    expect(res.status).toBe(404);
    expect(h.state.authedClients).toHaveLength(0);
  });
});

describe("post-tts - zapis wygenerowanego audio do cache", () => {
  it("uploaduje do PRYWATNEGO bucketa pod ścieżką z planu", async () => {
    await handle(req({ postId: POST_ID, lang: "pl" }));
    await vi.waitFor(() =>
      expect(h.storageOps).toContainEqual({
        bucket: "tts-cache",
        method: "upload",
        path: "ten_1/post_1/pl.mp3",
      }),
    );
    expect(h.state.fetchCalls).toHaveLength(1);
  });

  it("PO UDANYM uploadzie zapisuje rejestr nagrania (nigdy przed)", async () => {
    await handle(req({ postId: POST_ID, lang: "pl" }));
    await vi.waitFor(() => expect(h.state.recorded).toHaveLength(1));
    expect(h.state.recorded[0]).toMatchObject({
      postId: POST_ID,
      lang: "pl",
      storagePath: "ten_1/post_1/pl.mp3",
    });
  });

  it("BŁĄD UPLOADU nie psuje odpowiedzi i NIE zapisuje rejestru", async () => {
    h.state.uploadError = { message: "Bucket not found" };
    const res = await handle(req({ postId: POST_ID, lang: "pl" }));
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(h.storageOps.some((o) => o.method === "upload")).toBe(true));
    expect(h.state.recorded).toHaveLength(0);
  });

  it("REJESTR NIEDOSTĘPNY (środowisko przed migracją): upload idzie, zapisu rejestru nie ma", async () => {
    h.state.plan = { ...h.state.plan, registryAvailable: false };
    const res = await handle(req({ postId: POST_ID, lang: "pl" }));
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(h.storageOps.some((o) => o.method === "upload")).toBe(true));
    expect(h.state.recorded).toHaveLength(0);
  });
});

describe("post-tts - dławienie", () => {
  it("LIMIT MINUTOWY biegnie PRZED czymkolwiek kosztownym i zwraca 429 z Retry-After", async () => {
    h.state.rateLimits["post-tts:ip:min"] = false;
    const res = await handle(req({ postId: POST_ID, lang: "pl" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
  });

  it("limit minutowy jest FAIL-OPEN (bez `failClosed`) - awaria licznika nie blokuje czytelnika", async () => {
    await handle(req({ postId: POST_ID, lang: "pl" }));
    const minute = h.state.rateLimitCalls.find((c) => c.scope === "post-tts:ip:min");
    expect(minute).toBeDefined();
    expect(minute?.failClosed).toBeUndefined();
  });

  it("limity BUDŻETOWE są FAIL-CLOSED - awaria licznika nie może otworzyć kwoty dostawcy", async () => {
    await handle(req({ postId: POST_ID, lang: "pl" }));
    const budget = h.state.rateLimitCalls.filter((c) => c.scope !== "post-tts:ip:min");
    expect(budget.map((c) => c.scope)).toEqual(["post-tts:ip:hour", "post-tts:post:hour"]);
    expect(budget.every((c) => c.failClosed === true)).toBe(true);
  });

  it("limit GODZINOWY per IP zwraca 429 z godzinnym Retry-After", async () => {
    h.state.rateLimits["post-tts:ip:hour"] = false;
    const res = await handle(req({ postId: POST_ID, lang: "pl" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("3600");
  });

  it("limit PER WPIS zwraca 429 i jest kluczowany parą (wpis, język)", async () => {
    h.state.rateLimits["post-tts:post:hour"] = false;
    const res = await handle(req({ postId: POST_ID, lang: "en" }));
    expect(res.status).toBe(429);
    expect(h.state.rateLimitCalls.find((c) => c.scope === "post-tts:post:hour")?.subjectId).toBe(
      `${POST_ID}:en`,
    );
  });

  it("TRAFIENIE W CACHE nie uruchamia limitów budżetowych (nic nie kosztuje)", async () => {
    h.state.plan = { ...h.state.plan, fresh: true };
    h.state.downloadResult = { data: new Blob(["mp3"]) };

    const res = await handle(req({ postId: POST_ID, lang: "pl" }));

    expect(res.status).toBe(200);
    expect(h.state.rateLimitCalls.map((c) => c.scope)).toEqual(["post-tts:ip:min"]);
  });
});

describe("post-tts - cache i ETag", () => {
  it("TRAFIENIE W CACHE zwraca audio z nagłówkiem `X-Tts-Cache: hit`", async () => {
    h.state.plan = { ...h.state.plan, fresh: true };
    h.state.downloadResult = { data: new Blob(["mp3"]) };

    const res = await handle(req({ postId: POST_ID, lang: "pl" }));

    expect(res.headers.get("X-Tts-Cache")).toBe("hit");
    expect(h.state.fetchCalls).toHaveLength(0);
  });

  it("cache jest czytany z PRYWATNEGO bucketa i tylko ze ścieżki z planu", async () => {
    h.state.plan = { ...h.state.plan, fresh: true };
    h.state.downloadResult = { data: new Blob(["mp3"]) };

    await handle(req({ postId: POST_ID, lang: "pl" }));

    expect(h.storageOps).toContainEqual({
      bucket: "tts-cache",
      method: "download",
      path: "ten_1/post_1/pl.mp3",
    });
  });

  it("plan NIEŚWIEŻY (zmieniony głos albo treść) POMIJA zapisany obiekt", async () => {
    h.state.plan = { ...h.state.plan, fresh: false };
    h.state.downloadResult = { data: new Blob(["stare-audio"]) };

    const res = await handle(req({ postId: POST_ID, lang: "pl" }));

    expect(h.storageOps.filter((o) => o.method === "download")).toHaveLength(0);
    expect(res.headers.get("X-Tts-Cache")).toBe("miss");
  });

  it("BRAK OBIEKTU w buckecie degraduje do syntezy, nie do błędu", async () => {
    h.state.plan = { ...h.state.plan, fresh: true };
    h.state.downloadResult = { data: null };

    const res = await handle(req({ postId: POST_ID, lang: "pl" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Tts-Cache")).toBe("miss");
  });

  it("WYJĄTEK ze storage (brak bucketa w starym środowisku) też degraduje do syntezy", async () => {
    h.state.plan = { ...h.state.plan, fresh: true };
    h.state.downloadResult = () => {
      throw new Error("Bucket not found");
    };

    const res = await handle(req({ postId: POST_ID, lang: "pl" }));

    expect(res.status).toBe(200);
    expect(h.state.fetchCalls).toHaveLength(1);
  });

  it("odpowiedź niesie prywatny `Cache-Control` i ETag zależny od głosu", async () => {
    const res = await handle(req({ postId: POST_ID, lang: "pl" }));
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=86400");
    expect(res.headers.get("ETag")).toContain("JBFqnCBsd6RMkjVDRZzb");
  });

  it("PASUJĄCY `If-None-Match` daje 304 bez ciała i bez syntezy", async () => {
    const first = await handle(req({ postId: POST_ID, lang: "pl" }));
    const etag = first.headers.get("ETag")!;
    h.state.fetchCalls.length = 0;

    const res = await handle(req({ postId: POST_ID, lang: "pl" }, { "if-none-match": etag }));

    expect(res.status).toBe(304);
    expect(h.state.fetchCalls).toHaveLength(0);
  });

  it("NIEPASUJĄCY `If-None-Match` (stary głos) nie daje 304", async () => {
    const res = await handle(
      req({ postId: POST_ID, lang: "pl" }, { "if-none-match": '"tts-stary-hash-glos-model"' }),
    );
    expect(res.status).toBe(200);
    expect(h.state.fetchCalls).toHaveLength(1);
  });
});

describe("post-tts - treść do syntezy", () => {
  it("skleja tytuł z treścią i zdejmuje znaczniki HTML", async () => {
    await handle(req({ postId: POST_ID, lang: "pl" }));
    const text = String((h.state.fetchCalls[0].body as { text: string }).text);
    expect(text).toContain("Rola Unii Europejskiej");
    expect(text).not.toContain("<strong>");
  });

  it("wariant EN bierze tytuł i treść angielską", async () => {
    await handle(req({ postId: POST_ID, lang: "en" }));
    const text = String((h.state.fetchCalls[0].body as { text: string }).text);
    expect(text).toContain("The role of the EU");
    expect(text).toContain("English body");
  });

  it("brak treści w danym języku degraduje do drugiego, nie do pustki", async () => {
    h.state.lookups.posts = {
      data: publishedPost({ content_en: null, title_en: null }),
      error: null,
    };
    await handle(req({ postId: POST_ID, lang: "en" }));
    const text = String((h.state.fetchCalls[0].body as { text: string }).text);
    expect(text).toContain("Rola Unii Europejskiej");
    expect(text).toContain("polska");
  });

  it("dokument BLOKOWY wygrywa nad legacy HTML", async () => {
    h.state.lookups.posts = {
      data: publishedPost({
        blocks_data: {
          pl: {
            version: 1,
            blocks: [
              { id: "h1", type: "heading", data: { level: 2, text: "Nagłówek z bloku" } },
              { id: "p1", type: "paragraph", data: { text: "Akapit z bloku" } },
            ],
          },
        },
      }),
      error: null,
    };
    await handle(req({ postId: POST_ID, lang: "pl" }));
    const text = String((h.state.fetchCalls[0].body as { text: string }).text);
    expect(text).toContain("Nagłówek z bloku");
    expect(text).not.toContain("Treść polska artykułu");
  });

  it("bloki listy i FAQ wchodzą do narracji", async () => {
    h.state.lookups.posts = {
      data: publishedPost({
        content_pl: null,
        content_en: null,
        blocks_data: {
          pl: {
            version: 1,
            blocks: [
              {
                id: "l1",
                type: "list",
                data: { items: ["Punkt pierwszy", { text: "Punkt drugi" }] },
              },
              { id: "f1", type: "faq", data: { items: [{ q: "Pytanie", a: "Odpowiedź" }] } },
              { id: "x1", type: "image", data: { src: "https://example.com/a.png" } },
            ],
          },
        },
      }),
      error: null,
    };
    await handle(req({ postId: POST_ID, lang: "pl" }));
    const text = String((h.state.fetchCalls[0].body as { text: string }).text);
    expect(text).toContain("Punkt pierwszy");
    expect(text).toContain("Odpowiedź");
  });

  it("WPIS BEZ CZYTELNEJ TREŚCI daje 422, nie puste żądanie do dostawcy", async () => {
    h.state.lookups.posts = {
      data: publishedPost({ title_pl: "", title_en: "", content_pl: "", content_en: "" }),
      error: null,
    };
    const res = await handle(req({ postId: POST_ID, lang: "pl" }));
    expect(res.status).toBe(422);
    expect(h.state.fetchCalls).toHaveLength(0);
  });

  it("TEKST ZA DŁUGI jest przycinany do limitu dostawcy, nie odrzucany", async () => {
    h.state.lookups.posts = {
      data: publishedPost({ content_pl: `<p>${"a".repeat(20_000)}</p>` }),
      error: null,
    };
    await handle(req({ postId: POST_ID, lang: "pl" }));
    const text = String((h.state.fetchCalls[0].body as { text: string }).text);
    expect(text.length).toBe(5000);
    expect(h.state.fetchCalls).toHaveLength(1);
  });
});

describe("post-tts - błędy dostawcy", () => {
  it("WYCZERPANA KWOTA daje 402 z czytelnym komunikatem", async () => {
    h.state.fetchImpl = async () =>
      new Response(JSON.stringify({ detail: { status: "quota_exceeded" } }), { status: 401 });
    const res = await handle(req({ postId: POST_ID, lang: "pl" }));
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("quota") });
  });

  it("THROTTLING dostawcy (429) jest przekazywany z Retry-After", async () => {
    h.state.fetchImpl = async () => new Response("slow down", { status: 429 });
    const res = await handle(req({ postId: POST_ID, lang: "pl" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
  });

  it("INNY błąd dostawcy daje 502", async () => {
    h.state.fetchImpl = async () => new Response("boom", { status: 500 });
    const res = await handle(req({ postId: POST_ID, lang: "pl" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "TTS upstream failed" });
  });

  it("AWARIA SIECI (wyjątek z fetch) też daje 502, nie 500", async () => {
    h.state.fetchImpl = async () => {
      throw new Error("ECONNRESET");
    };
    const res = await handle(req({ postId: POST_ID, lang: "pl" }));
    expect(res.status).toBe(502);
    expect(h.state.recorded).toHaveLength(0);
  });

  it("nieczytelne ciało błędu nie wywraca mapowania (502, nie wyjątek)", async () => {
    h.state.fetchImpl = async () =>
      ({
        ok: false,
        status: 503,
        text: () => Promise.reject(new Error("stream closed")),
      }) as unknown as Response;
    const res = await handle(req({ postId: POST_ID, lang: "pl" }));
    expect(res.status).toBe(502);
    expect(h.state.fetchCalls).toHaveLength(1);
  });
});

describe("post-tts - żądanie do dostawcy i zapis do cache", () => {
  it("woła kanoniczny głos z planu i przekazuje sekret w nagłówku", async () => {
    await handle(req({ postId: POST_ID, lang: "pl" }));
    expect(h.state.fetchCalls[0].url).toContain(
      "https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb",
    );
    expect(h.state.fetchCalls[0].headers["xi-api-key"]).toBe("xi-test-key");
  });

  it("prosi o mp3 i podaje ustawienia głosu", async () => {
    await handle(req({ postId: POST_ID, lang: "pl" }));
    expect(h.state.fetchCalls[0].url).toContain("output_format=mp3_44100_128");
    expect(h.state.fetchCalls[0].body).toMatchObject({
      voice_settings: { stability: 0.5, use_speaker_boost: true },
    });
  });

  it("odpowiedź syntezy jest oznaczona jako `miss` i ma typ audio", async () => {
    const res = await handle(req({ postId: POST_ID, lang: "pl" }));
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(res.headers.get("X-Tts-Cache")).toBe("miss");
  });
});
