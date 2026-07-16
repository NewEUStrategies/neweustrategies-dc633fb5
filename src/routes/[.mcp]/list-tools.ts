// Request-time MCP boundary - see /mcp.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/.mcp/list-tools")({
  server: {
    handlers: {
      ANY: async (context) => {
        const [{ createTanStackListToolsHandler }, { default: mcp }] = await Promise.all([
          import("@lovable.dev/mcp-js/stacks/tanstack"),
          import("../../lib/mcp/index"),
        ]);
        return createTanStackListToolsHandler(mcp, {
          resourcePath: "/mcp",
          metadataPath: "/.well-known/oauth-protected-resource",
          trustForwardedHost: true,
        })(context);
      },
    },
  },
});
