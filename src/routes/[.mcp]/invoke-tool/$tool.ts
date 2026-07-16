// Request-time MCP boundary - see /mcp.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/.mcp/invoke-tool/$tool")({
  server: {
    handlers: {
      ANY: async (context) => {
        const [{ createTanStackInvokeToolHandler }, { default: mcp }] = await Promise.all([
          import("@lovable.dev/mcp-js/stacks/tanstack"),
          import("../../../lib/mcp/index"),
        ]);
        return createTanStackInvokeToolHandler(mcp, {
          resourcePath: "/mcp",
          metadataPath: "/.well-known/oauth-protected-resource",
          trustForwardedHost: true,
        })(context);
      },
    },
  },
});
