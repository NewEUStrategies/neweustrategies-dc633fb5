// Request-time boundary: the optional MCP SDK must not initialize with the
// global SSR route graph and take unrelated document/asset requests down.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      ANY: async (context) => {
        const [{ createTanStackMcpHandler }, { default: mcp }] = await Promise.all([
          import("@lovable.dev/mcp-js/stacks/tanstack"),
          import("../lib/mcp/index"),
        ]);
        return createTanStackMcpHandler(mcp, {
          resourcePath: "/mcp",
          metadataPath: "/.well-known/oauth-protected-resource",
          trustForwardedHost: true,
        })(context);
      },
    },
  },
});
