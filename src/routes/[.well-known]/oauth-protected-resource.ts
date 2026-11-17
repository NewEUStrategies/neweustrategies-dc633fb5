// Metadane chronionego zasobu OAuth (RFC 9728) dla /mcp. Logika i granica
// ładowania SDK: `src/lib/mcp/routeHandlers.ts`.
import { createFileRoute } from "@tanstack/react-router";

import { handleProtectedResourceMetadataRequest } from "@/lib/mcp/routeHandlers";

export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
  server: {
    handlers: {
      ANY: ({ request }) => handleProtectedResourceMetadataRequest({ request }),
    },
  },
});
