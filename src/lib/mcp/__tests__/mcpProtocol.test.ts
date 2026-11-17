// /mcp przez PRAWDZIWE SDK: trasy (401 + metadane zasobu) i protokół
// (lista narzędzi, walidacja wejścia, błąd narzędzia bez logowania).
//
// Bez sieci: żądania bez tokenu kończą się przed pobraniem JWKS, a protokół
// sprawdzamy w procesie (`withMcpClient` z handlerem zamiast adresu).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REF = "abcdefghijklmnopqrst";
const ISSUER = `https://${REF}.supabase.co/auth/v1`;
const PUBLIC_HOST = "neweuropeanstrategies.com";

function platformRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("x-forwarded-host", PUBLIC_HOST);
  headers.set("x-forwarded-proto", "https");
  return new Request(`http://worker.internal${path}`, { ...init, headers });
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_PROJECT_ID", REF);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("trasy /mcp", () => {
  it("bez tokenu odpowiada 401 i wskazuje publiczne metadane zasobu", async () => {
    const { handleMcpRequest } = await import("@/lib/mcp/routeHandlers");
    const response = await handleMcpRequest({
      request: platformRequest("/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      `resource_metadata="https://${PUBLIC_HOST}/.well-known/oauth-protected-resource"`,
    );
  });

  it("metadane zasobu ogłaszają /mcp i serwer autoryzacji projektu", async () => {
    const { handleProtectedResourceMetadataRequest } = await import("@/lib/mcp/routeHandlers");
    const response = await handleProtectedResourceMetadataRequest({
      request: platformRequest("/.well-known/oauth-protected-resource"),
    });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      resource: `https://${PUBLIC_HOST}/mcp`,
      authorization_servers: [ISSUER],
    });
  });

  it("nieudane ładowanie SDK daje 503 i ponawia przy następnym żądaniu", async () => {
    let attempts = 0;
    vi.doMock("@lovable.dev/mcp-js/stacks/tanstack", () => {
      attempts += 1;
      throw new Error("chunk load failed");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { handleMcpRequest } = await import("@/lib/mcp/routeHandlers");
    const first = await handleMcpRequest({ request: platformRequest("/mcp", { method: "POST" }) });
    expect(first.status).toBe(503);
    expect(first.headers.get("cache-control")).toBe("no-store");
    vi.doUnmock("@lovable.dev/mcp-js/stacks/tanstack");
    const second = await handleMcpRequest({ request: platformRequest("/mcp", { method: "POST" }) });
    expect(second.status).toBe(401);
    expect(attempts).toBe(1);
    error.mockRestore();
  });
});

describe("protokół MCP (w procesie, bez warstwy OAuth)", () => {
  async function openClient() {
    const [
      { defineMcp },
      { createTanStackMcpHandler },
      { withMcpClient },
      { default: listRecentPosts },
      { default: searchPosts },
      { default: getPost },
    ] = await Promise.all([
      import("@lovable.dev/mcp-js"),
      import("@lovable.dev/mcp-js/stacks/tanstack"),
      import("@lovable.dev/mcp-js/testing/server"),
      import("@/lib/mcp/tools/list-recent-posts"),
      import("@/lib/mcp/tools/search-posts"),
      import("@/lib/mcp/tools/get-post"),
    ]);
    // Te same narzędzia bez `auth` - sprawdzamy kontrakt protokołu, nie OAuth.
    const unauthenticated = defineMcp({
      name: "protocol-test",
      title: "Protocol test",
      instructions: "Protocol test server.",
      version: "0.0.0",
      tools: [listRecentPosts, searchPosts, getPost],
    });
    const handler = createTanStackMcpHandler(unauthenticated);
    return <T>(run: Parameters<typeof withMcpClient<T>>[1]) =>
      withMcpClient<T>(
        { endpoint: "http://localhost/mcp", handler: (request) => handler({ request }) },
        run,
      );
  }

  it("lista narzędzi: zamknięte wejście i zadeklarowane wyjście", async () => {
    const withClient = await openClient();
    const { tools } = await withClient((client) => client.listTools());
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "get_post",
      "list_recent_posts",
      "search_posts",
    ]);
    for (const tool of tools) {
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.outputSchema?.type).toBe("object");
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
  });

  it.each([
    ["list_recent_posts", { limit: 51 }],
    ["list_recent_posts", { lang: "de" }],
    ["search_posts", { query: "   " }],
    ["get_post", { slug: "x", extra: true }],
  ])("%s odrzuca niepoprawne wejście %j", async (name, args) => {
    const withClient = await openClient();
    const result = await withClient((client) => client.callTool({ name, arguments: args }));
    expect(result.isError).toBe(true);
  });

  it("wywołanie bez zalogowanego wołającego zwraca komunikat logowania", async () => {
    const [{ MCP_CALLER_MESSAGES }, withClient] = await Promise.all([
      import("@/lib/mcp/supabase"),
      openClient(),
    ]);
    const result = await withClient((client) =>
      client.callTool({ name: "list_recent_posts", arguments: {} }),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: MCP_CALLER_MESSAGES.signInRequired }]);
  });
});
