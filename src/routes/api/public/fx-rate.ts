// Publiczny odczyt aktualnego kursu EUR/PLN z NBP (tabela A). Klient korzysta
// z tego endpointu do rozgrzania własnego cache modułu `fxRate.ts` - i tak
// jednocześnie NBP fetchuje serwer w server functions billingu, więc mamy
// jedno wspólne źródło prawdy i mniejsze ryzyko rate-limitów NBP przy
// równoległych klientach. Cache-Control 6 h, tyle samo co TTL w module.
import { createFileRoute } from "@tanstack/react-router";
import { ensureFxRateLoaded, getFxState } from "@/lib/billing/fxRate";

export const Route = createFileRoute("/api/public/fx-rate")({
  server: {
    handlers: {
      GET: async () => {
        await ensureFxRateLoaded();
        const s = getFxState();
        return new Response(
          JSON.stringify({
            eurPln: s.eurPln,
            effectiveDate: s.effectiveDate,
            source: s.source,
            fetchedAt: s.fetchedAt,
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "public, max-age=3600, s-maxage=21600",
            },
          },
        );
      },
    },
  },
});
