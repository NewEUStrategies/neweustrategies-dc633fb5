// Deklaracja maszynowa GPC: /.well-known/gpc.json
//
// Spec Global Privacy Control wymaga, aby serwis honorujący sygnał wystawił pod
// tą ścieżką dokument `{"gpc": true, "lastUpdate": "YYYY-MM-DD"}`. To jedyny
// sposób, w jaki przeglądarka, rozszerzenie albo audytor mogą SPRAWDZIĆ nasze
// oświadczenie - bez tego pliku honorowanie sygnału jest niewykrywalne z
// zewnątrz i formalnie niezadeklarowane.
//
// Odpowiedź jest stała i identyczna dla wszystkich hostów tenantów (deklaracja
// dotyczy zachowania platformy, nie treści), więc może leżeć długo w cache'u
// brzegowym. `/.well-known` jest wykluczone z NES Edge Cache
// (PUBLIC_DOCUMENT_DENY_PREFIXES) - i tak nie jest to dokument nawigacyjny.
import { createFileRoute } from "@tanstack/react-router";
import { buildGpcDeclaration } from "@/lib/consent/gpc";

/** Dzień w cache brzegowym + tydzień stale: deklaracja zmienia się latami. */
const CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

export const Route = createFileRoute("/.well-known/gpc.json")({
  server: {
    handlers: {
      GET: () =>
        new Response(`${JSON.stringify(buildGpcDeclaration())}\n`, {
          status: 200,
          headers: {
            // Spec wskazuje `application/json`; nagłówek nosniff dokłada
            // globalny securityHeadersMiddleware.
            "content-type": "application/json; charset=utf-8",
            "cache-control": CACHE_CONTROL,
          },
        }),
    },
  },
});
