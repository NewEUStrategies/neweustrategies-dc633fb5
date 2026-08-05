// Alias zgodności: POST /lovable/email/suppression -> /platform/email/suppression.
//
// Ten sam powód co przy hooku auth (patrz src/lib/email/platformCompat.server.ts):
// adres webhooka wykluczeń jest konfiguracją po stronie dostawcy, więc stara
// ścieżka musi żyć przez okno przepięcia - inaczej odbicia i skargi przestają
// wpadać na listę wykluczeń i psuje się reputacja nadawcy po cichu.
import { createFileRoute } from "@tanstack/react-router";

import { forwardToPlatformRoute } from "@/lib/email/platformCompat.server";

export const Route = createFileRoute("/lovable/email/suppression")({
  server: {
    handlers: {
      POST: ({ request }) => forwardToPlatformRoute(request, "/platform/email/suppression"),
    },
  },
});
