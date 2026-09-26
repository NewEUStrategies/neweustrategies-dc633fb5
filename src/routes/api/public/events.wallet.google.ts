// POST /api/public/events/wallet/google - link „Dodaj do Google Wallet”.
//
// JSON ze strony biletu (`token`, `lang`) -> `{ saveUrl }`; przeglądarka sama
// przechodzi pod `saveUrl` (`window.location.assign`). Przekierowanie
// z serwera nie wchodzi w grę: CSP `form-action 'self'` obejmuje też
// przekierowania. Trasa jest CIENKA - logika w
// `lib/events/wallet/walletRoutes.server.ts`, ładowana przez `import()`.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/events/wallet/google")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { googleWalletPost } = await import("@/lib/events/wallet/walletRoutes.server");
        return googleWalletPost(request);
      },
    },
  },
});
