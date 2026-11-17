// Handlery trzech narzędzi /mcp z tokenem wołającego.
//
// GRANICE ATRAPOWANE: `@supabase/supabase-js` (łańcuch PostgREST zapisujący
// ogniwa + RPC) i host najemcy. PRAWDZIWE: SDK MCP (`ToolContext`, `ToolError`)
// i wszystkie moduły `src/lib/mcp`.
import { ToolContext, ToolError, type ToolHandlerResult } from "@lovable.dev/mcp-js";
import { assertToolResult } from "@lovable.dev/mcp-js/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { RecordedChain, SupabaseFromStub } from "@/test/supabaseChain";

interface RpcCall {
  readonly fn: string;
  readonly args: unknown;
}

interface ClientOptions {
  readonly global?: { readonly headers?: Record<string, string> };
}

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  rpcCalls: [] as RpcCall[],
  rpcResults: new Map<string, { data: unknown; error: unknown }>(),
  clients: [] as { url: string; key: string; options: ClientOptions }[],
  host: "neweuropeanstrategies.com" as string | null,
}));

vi.mock("@supabase/supabase-js", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  h.db = supabaseFromStub();
  return {
    createClient: (url: string, key: string, options: ClientOptions) => {
      h.clients.push({ url, key, options });
      return {
        from: (table: string) => h.db!.from(table),
        rpc: (fn: string, args?: unknown) => {
          h.rpcCalls.push({ fn, args });
          return Promise.resolve(h.rpcResults.get(fn) ?? { data: null, error: null });
        },
      };
    },
  };
});

vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: () => Promise.resolve(h.host),
}));

import { MCP_CALLER_MESSAGES } from "@/lib/mcp/supabase";
import getPost from "@/lib/mcp/tools/get-post";
import listRecentPosts from "@/lib/mcp/tools/list-recent-posts";
import searchPosts from "@/lib/mcp/tools/search-posts";
import { fail, ok } from "@/test/supabaseChain";

const TOKEN = "test-oauth-access-token";
const TENANT = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-09-04T12:00:00.000Z");

/** Jak w SDK: `token` jest getterem prototypu - nie trafia do JSON-a ani logów. */
class TestBearer {
  get token(): string {
    return TOKEN;
  }
}

function callerContext(): ToolContext {
  return new ToolContext({
    type: "oauth",
    principal: {
      claims: { sub: "user-1", client_id: "client-1" },
      issuer: "https://abcdefghijklmnopqrst.supabase.co/auth/v1",
      resource: "https://neweuropeanstrategies.com/mcp",
      acceptedAudiences: ["authenticated"],
      scopes: [],
      sub: "user-1",
      clientId: "client-1",
    },
    bearer: new TestBearer(),
  });
}

const anonymous = new ToolContext(undefined);

function postRow(over: Partial<Record<string, string | null>> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "traktat-o-cle",
    title_pl: "Traktat o cle",
    title_en: "Treaty on tariffs",
    excerpt_pl: "Skrót po polsku",
    excerpt_en: "Excerpt in English",
    cover_image_url: "https://cdn.example.com/cover.jpg",
    published_at: "2026-08-01T10:00:00.000Z",
    post_format: "standard",
    ...over,
  };
}

function postsChain(): RecordedChain {
  const chain = h.db!.lastChain("posts");
  if (!chain) throw new Error("test: narzędzie nie zapytało tabeli `posts`");
  return chain;
}

function argsOfAll(chain: RecordedChain, method: string): ReadonlyArray<unknown>[] {
  return chain.calls.filter((call) => call.method === method).map((call) => call.args);
}

function textOf(result: ToolHandlerResult): string {
  const block = result.content?.[0];
  if (!block || block.type !== "text") throw new Error("test: brak bloku tekstowego");
  return block.text;
}

const summarySchema = z.object({
  slug: z.string(),
  title: z.string(),
  excerpt: z.string().nullable(),
  cover_image_url: z.string().nullable(),
  published_at: z.string().nullable(),
  post_format: z.string(),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  h.db!.reset();
  h.rpcCalls.length = 0;
  h.rpcResults.clear();
  h.rpcResults.set("public_tenant_id", { data: TENANT, error: null });
  h.clients.length = 0;
  h.host = "neweuropeanstrategies.com";
  vi.stubEnv("SUPABASE_URL", "https://db.example.com");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("tożsamość wołającego", () => {
  it.each([
    ["list_recent_posts", () => listRecentPosts.handler({ lang: "pl", limit: 10 }, anonymous)],
    ["search_posts", () => searchPosts.handler({ query: "cła", lang: "pl", limit: 10 }, anonymous)],
    ["get_post", () => getPost.handler({ slug: "x", lang: "pl" }, anonymous)],
  ])("%s bez tokenu rzuca ToolError i nie tworzy klienta bazy", async (_name, call) => {
    await expect(call()).rejects.toEqual(new ToolError(MCP_CALLER_MESSAGES.signInRequired));
    expect(h.clients).toHaveLength(0);
  });

  it("klient bazy niesie token wołającego i host najemcy, nie klucz serwisowy", async () => {
    h.db!.setResponse("posts", ok([]));
    await listRecentPosts.handler({ lang: "pl", limit: 5 }, callerContext());
    expect(h.clients).toHaveLength(1);
    const [client] = h.clients;
    expect(client.url).toBe("https://db.example.com");
    expect(client.key).toBe("sb_publishable_test");
    expect(client.options.global?.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      "x-tenant-host": "neweuropeanstrategies.com",
    });
  });

  it("bez konfiguracji bazy zwraca stały komunikat, bez szczegółów", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_URL", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      listRecentPosts.handler({ lang: "pl", limit: 5 }, callerContext()),
    ).rejects.toEqual(new ToolError(MCP_CALLER_MESSAGES.backendUnavailable));
    error.mockRestore();
  });
});

describe("zapytanie bazowe - wyłącznie opublikowane wpisy najemcy", () => {
  it("filtruje najemcę, status, kosz i datę publikacji", async () => {
    h.db!.setResponse("posts", ok([]));
    await listRecentPosts.handler({ lang: "pl", limit: 5 }, callerContext());
    const chain = postsChain();
    expect(argsOfAll(chain, "eq")).toEqual([
      ["tenant_id", TENANT],
      ["status", "published"],
    ]);
    expect(argsOfAll(chain, "is")).toEqual([["deleted_at", null]]);
    expect(argsOfAll(chain, "not")).toEqual([["published_at", "is", null]]);
    expect(argsOfAll(chain, "lte")).toEqual([["published_at", NOW.toISOString()]]);
    expect(argsOfAll(chain, "order")).toEqual([["published_at", { ascending: false }]]);
    expect(argsOfAll(chain, "limit")).toEqual([[5]]);
  });

  it("nie wybiera kolumn treści - ciało idzie wyłącznie przez bramkowane RPC", async () => {
    h.db!.setResponse("posts", ok([]));
    await listRecentPosts.handler({ lang: "en", limit: 5 }, callerContext());
    const [columns] = argsOfAll(postsChain(), "select")[0] ?? [];
    expect(columns).toBe(
      "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, post_format",
    );
  });

  it("błąd najemcy daje stały komunikat i nie odpytuje wpisów", async () => {
    h.rpcResults.set("public_tenant_id", { data: null, error: { code: "PGRST301" } });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      listRecentPosts.handler({ lang: "pl", limit: 5 }, callerContext()),
    ).rejects.toEqual(new ToolError(MCP_CALLER_MESSAGES.backendUnavailable));
    expect(h.db!.lastChain("posts")).toBeUndefined();
    error.mockRestore();
  });
});

describe("list_recent_posts", () => {
  it("oddaje wpisy w żądanym języku, zgodne ze schematem wyjścia", async () => {
    h.db!.setResponse("posts", ok([postRow()]));
    const result = await listRecentPosts.handler({ lang: "en", limit: 10 }, callerContext());
    await assertToolResult(result, { outputSchema: listRecentPosts.outputSchema });
    expect(result.structuredContent).toEqual({
      results: [
        summarySchema.parse({
          ...postRow(),
          title: "Treaty on tariffs",
          excerpt: "Excerpt in English",
        }),
      ],
    });
    expect(JSON.parse(textOf(result))).toEqual(
      z.object({ results: z.array(summarySchema) }).parse(result.structuredContent).results,
    );
  });

  it("błąd PostgREST nie wycieka do klienta", async () => {
    h.db!.setResponse("posts", fail('relation "posts" permission denied', "42501"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      listRecentPosts.handler({ lang: "pl", limit: 10 }, callerContext()),
    ).rejects.toEqual(new ToolError(MCP_CALLER_MESSAGES.backendUnavailable));
    expect(error).toHaveBeenCalledWith("[mcp] list_recent_posts failed", { code: "42501" });
    error.mockRestore();
  });
});

describe("search_posts", () => {
  it("szuka w tytule i zajawce wybranego języka", async () => {
    h.db!.setResponse("posts", ok([postRow()]));
    const result = await searchPosts.handler(
      { query: "cła", lang: "en", limit: 3 },
      callerContext(),
    );
    await assertToolResult(result, { outputSchema: searchPosts.outputSchema });
    expect(argsOfAll(postsChain(), "or")).toEqual([
      ["title_en.ilike.%cła%,excerpt_en.ilike.%cła%"],
    ]);
    expect(argsOfAll(postsChain(), "limit")).toEqual([[3]]);
  });

  it("fraza z samych metaznaków oddaje pustą listę bez zapytania", async () => {
    const result = await searchPosts.handler(
      { query: "%,()", lang: "pl", limit: 10 },
      callerContext(),
    );
    expect(result.structuredContent).toEqual({ results: [] });
    expect(h.clients).toHaveLength(0);
  });
});

describe("get_post", () => {
  it("oddaje metadane i ciało z bramkowanego RPC dla wołającego z dostępem", async () => {
    h.db!.setResponse("posts", ok(postRow()));
    h.rpcResults.set("get_entity_content", {
      data: [
        { content_pl: "<p>Treść</p>", content_en: null, builder_data: null, blocks_data: null },
      ],
      error: null,
    });
    const result = await getPost.handler({ slug: "traktat-o-cle", lang: "en" }, callerContext());
    await assertToolResult(result, { outputSchema: getPost.outputSchema });
    expect(argsOfAll(postsChain(), "eq")).toContainEqual(["slug", "traktat-o-cle"]);
    expect(h.rpcCalls).toContainEqual({
      fn: "get_entity_content",
      args: { _entity_type: "post", _entity_id: "11111111-1111-4111-8111-111111111111" },
    });
    expect(result.structuredContent).toMatchObject({
      post: {
        slug: "traktat-o-cle",
        title: "Treaty on tariffs",
        body: "<p>Treść</p>",
        body_available: true,
      },
    });
  });

  it("wpis płatny bez dostępu: metadane bez ciała, `body_available: false`", async () => {
    h.db!.setResponse("posts", ok(postRow()));
    h.rpcResults.set("get_entity_content", { data: [], error: null });
    const result = await getPost.handler({ slug: "traktat-o-cle", lang: "pl" }, callerContext());
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ post: { body: null, body_available: false } });
  });

  it("brak wpisu to poprawna odpowiedź, nie błąd", async () => {
    h.db!.setResponse("posts", ok(null));
    const result = await getPost.handler({ slug: "nie-ma", lang: "pl" }, callerContext());
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toBe('No published post with slug "nie-ma".');
    expect(result.structuredContent).toEqual({ post: null });
    expect(h.rpcCalls.map((call) => call.fn)).not.toContain("get_entity_content");
  });

  it("błąd RPC treści daje stały komunikat", async () => {
    h.db!.setResponse("posts", ok(postRow()));
    h.rpcResults.set("get_entity_content", { data: null, error: { code: "P0001" } });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      getPost.handler({ slug: "traktat-o-cle", lang: "pl" }, callerContext()),
    ).rejects.toEqual(new ToolError(MCP_CALLER_MESSAGES.backendUnavailable));
    error.mockRestore();
  });
});
