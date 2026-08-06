// Alias zgodności: POST /lovable/email/transactional/preview -> /platform/....
//
// Ten sam powód co przy podglądzie maili auth: panel Cloud -> Emails woła
// ścieżkę `/lovable/*`, a kanoniczna trasa mieszka pod `/platform/*`.
import { createFileRoute } from "@tanstack/react-router";

import { forwardToPlatformRoute } from "@/lib/email/platformCompat.server";

export const Route = createFileRoute("/lovable/email/transactional/preview")({
  server: {
    handlers: {
      POST: ({ request }) =>
        forwardToPlatformRoute(request, "/platform/email/transactional/preview"),
    },
  },
});
