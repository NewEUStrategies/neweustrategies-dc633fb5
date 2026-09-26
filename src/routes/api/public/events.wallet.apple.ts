// POST /api/public/events/wallet/apple - przepustka Apple Wallet (`.pkpass`).
//
// Formularz ze strony biletu (`token`, `lang`, opcjonalnie `intent=check`).
// Trasa jest CIENKA: `routeTree.gen.ts` importuje ją zachłannie, więc podpis,
// ZIP i klient bazy wchodzą dopiero przez `import()` przy pierwszym żądaniu.
// Zapory, nagłówki i kody odpowiedzi opisuje `lib/events/wallet/walletRoutes.server.ts`.
// Prefiks `/api/public/*` omija broker uwierzytelnienia platformy - całe
// sprawdzenie (kształt kodu, limit tempa, najemca z hosta) jest w handlerze.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/events/wallet/apple")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { appleWalletPost } = await import("@/lib/events/wallet/walletRoutes.server");
        return appleWalletPost(request);
      },
    },
  },
});
