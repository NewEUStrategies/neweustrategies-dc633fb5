// Wersja bieżącego deploya. Klient odpytuje ten endpoint co kilka minut
// (patrz src/lib/cacheBusting.ts) i - jeśli identyfikator się zmienił -
// wymusza odświeżenie zasobów po najbliższej nawigacji SPA. Dzięki temu
// po aktualizacji preview lub published użytkownik nie zostaje ze starym
// bundlem, który odwołuje się do usuniętych chunków (klasyczne "puste
// białe okno" po deployu).
//
// BUILD_ID jest wyliczany w module-scope w izolacji Workera. Cloudflare
// tworzy nowy isolate dla każdego deploya, więc nowa wartość pojawia się
// automatycznie bez żadnej konfiguracji CI. `no-store` gwarantuje, że
// żaden pośrednik (edge/browsera) nie zamrozi odpowiedzi.
import { createFileRoute } from "@tanstack/react-router";

const BUILD_ID =
  (typeof process !== "undefined" && process.env && process.env.LOVABLE_BUILD_ID) ||
  `rt-${Date.now().toString(36)}`;

export const Route = createFileRoute("/api/public/version")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify({ v: BUILD_ID }), {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store, max-age=0",
          },
        }),
    },
  },
});
