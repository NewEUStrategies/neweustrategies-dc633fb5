// Punkt końcowy protokołu MCP (streamable HTTP). Logika i granica ładowania
// SDK: `src/lib/mcp/routeHandlers.ts`.
import { createFileRoute } from "@tanstack/react-router";

import { handleMcpRequest } from "@/lib/mcp/routeHandlers";

export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      ANY: ({ request }) => handleMcpRequest({ request }),
    },
  },
});
