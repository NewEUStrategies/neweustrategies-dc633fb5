// GET /api/public/events/wallet/availability - `{ apple, google }`.
//
// Mówi wyłącznie, które portfele są skonfigurowane na platformie (sekrety
// Pass Type ID i konta usługi Google są wspólne dla wszystkich najemców),
// więc odpowiedź jest publiczna i może leżeć w cache 5 minut. Strona biletu
// pyta o nią po montażu i chowa przyciski portfeli, których nie ma.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/events/wallet/availability")({
  server: {
    handlers: {
      GET: async () => {
        const { walletAvailabilityGet } = await import("@/lib/events/wallet/walletRoutes.server");
        return walletAvailabilityGet();
      },
    },
  },
});
