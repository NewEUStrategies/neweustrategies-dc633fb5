// Handlery tras /mcp i /.well-known/oauth-protected-resource.
//
// GRANICA ŁADOWANIA. SDK MCP (z `@modelcontextprotocol/server`, `jose`, `zod`
// v4) to kilkaset kB kodu serwera; statyczny import z pliku trasy wciągnąłby
// je do domknięcia każdego dokumentu i ewaluował przy KAŻDYM zimnym starcie
// (bramka `check:server-entry-purity`, `scripts/lib/serverVendorChunks.ts`).
// Dlatego trasy importują tylko ten moduł, a ten moduł sięga po SDK i po
// definicję serwera wyłącznie przez `import()` - przy pierwszym żądaniu MCP.
// Importy typów (`import type`) znikają przy kompilacji.
//
// JEDEN HANDLER NA IZOLAT. Handler SDK trzyma pamięć podręczną definicji
// i zestawu kluczy JWKS, więc budujemy go raz (leniwa obietnica) zamiast przy
// każdym żądaniu. Nieudane ładowanie nie zostaje w pamięci: następne żądanie
// próbuje od nowa, a bieżące dostaje 503 zamiast awarii całego Workera.
import type {
  TanStackMcpHandler,
  TanStackOAuthProtectedResourceMetadataHandler,
} from "@lovable.dev/mcp-js/stacks/tanstack";

export const MCP_RESOURCE_PATH = "/mcp";
export const MCP_METADATA_PATH = "/.well-known/oauth-protected-resource";

type McpRouteContext = Parameters<TanStackMcpHandler>[0];
type RouteHandler = TanStackMcpHandler | TanStackOAuthProtectedResourceMetadataHandler;

const loadDefinition = () => import("./index");

/** Opcje wspólne obu tras - jedna tożsamość zasobu OAuth. */
export const MCP_ROUTE_OPTIONS = {
  resourcePath: MCP_RESOURCE_PATH,
  metadataPath: MCP_METADATA_PATH,
  // Hosting Lovable nadpisuje X-Forwarded-Host/-Proto prawdziwym adresem
  // publicznym (także domeny własnej), więc ogłaszany zasób jest publiczny.
  trustForwardedHost: true,
  trustForwardedProto: true,
} as const;

function lazyRouteHandler(build: () => Promise<RouteHandler>) {
  let pending: Promise<RouteHandler> | undefined;
  return async (ctx: McpRouteContext): Promise<Response> => {
    pending ??= build().catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    let handler: RouteHandler;
    try {
      handler = await pending;
    } catch (error) {
      console.error("[mcp] SDK failed to load", error instanceof Error ? error.name : "unknown");
      return Response.json(
        { error: "mcp_unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "5" } },
      );
    }
    return handler(ctx);
  };
}

export const handleMcpRequest = lazyRouteHandler(async () => {
  const { createTanStackMcpHandler } = await import("@lovable.dev/mcp-js/stacks/tanstack");
  return createTanStackMcpHandler(loadDefinition, MCP_ROUTE_OPTIONS);
});

export const handleProtectedResourceMetadataRequest = lazyRouteHandler(async () => {
  const { createTanStackOAuthProtectedResourceMetadataHandler } = await import(
    "@lovable.dev/mcp-js/stacks/tanstack"
  );
  return createTanStackOAuthProtectedResourceMetadataHandler(loadDefinition, {
    ...MCP_ROUTE_OPTIONS,
    // To samo poświadczenie, które wtyczka Vite SDK ustawia na trasie metadanych
    // na hostingu Lovable: pośrednik platformy nadpisuje X-Forwarded-Host.
    forwardedHostTrustedByPlatform: true,
  });
});
