// Alias zgodności: POST /lovable/email/auth/preview -> /platform/email/auth/preview.
//
// Panel Cloud -> Emails renderuje podgląd szablonów, wołając kanoniczną ścieżkę
// `/lovable/email/*`. Po odmarkowaniu (PR #168) trasy żyją pod `/platform/*`,
// więc bez tego aliasu panel dostaje 404 i pokazuje „No preview available".
import { createFileRoute } from "@tanstack/react-router";

import { forwardToPlatformRoute } from "@/lib/email/platformCompat.server";

export const Route = createFileRoute("/lovable/email/auth/preview")({
  server: {
    handlers: {
      POST: ({ request }) => forwardToPlatformRoute(request, "/platform/email/auth/preview"),
    },
  },
});
