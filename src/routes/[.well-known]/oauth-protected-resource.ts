// Request-time MCP boundary - see /mcp.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
  server: {
    handlers: {
      ANY: async (context) => {
        const [{ createTanStackOAuthProtectedResourceMetadataHandler }, { default: mcp }] =
          await Promise.all([
            import("@lovable.dev/mcp-js/stacks/tanstack"),
            import("../../lib/mcp/index"),
          ]);
        return createTanStackOAuthProtectedResourceMetadataHandler(mcp, {
          resourcePath: "/mcp",
          metadataPath: "/.well-known/oauth-protected-resource",
          trustForwardedHost: true,
        })(context);
      },
    },
  },
});
