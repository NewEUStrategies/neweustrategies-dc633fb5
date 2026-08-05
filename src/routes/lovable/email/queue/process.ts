// Alias zgodności: POST /lovable/email/queue/process -> /platform/email/queue/process.
//
// Dren kolejki bywa wołany przez harmonogram bazy (pg_net) i przez zewnętrzny
// cron, których adresy zapisano przed odmarkowaniem ścieżek. Alias utrzymuje
// stary adres przy życiu z identyczną autoryzacją (Bearer service_role).
import { createFileRoute } from "@tanstack/react-router";

import { forwardToPlatformRoute } from "@/lib/email/platformCompat.server";

export const Route = createFileRoute("/lovable/email/queue/process")({
  server: {
    handlers: {
      POST: ({ request }) => forwardToPlatformRoute(request, "/platform/email/queue/process"),
    },
  },
});
