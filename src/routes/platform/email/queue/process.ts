// Powierzchnia HTTP drenu kolejek pocztowych: POST /platform/email/queue/process
//
// Cała logika ponowień, TTL, DLQ, limitu tempa i higieny listy żyje w
// src/lib/email/queueDrain.server.ts - JEDNEJ implementacji, którą wywołuje też
// tick zadań tła (pg_cron + pg_net co minutę, patrz runJobsTick). Wcześniej ten
// plik miał własną, drugą kopię tej logiki, a tick nie drenował kolejki w ogóle:
// dwa różne zachowania ponowień i jedna ścieżka, która w praktyce nigdy nie
// biegła, bo zadanie cron dla niej nie istniało w repozytorium.
//
// Endpoint zostaje dla środowisk z własnym harmonogramem (zewnętrzny cron,
// ręczne uruchomienie przy diagnostyce) i dla wypchnięcia kolejki bez czekania
// na następną minutę. Autoryzacja: klucz service_role jako Bearer - ten sam
// kontrakt, którego używa harmonogram bazy.
import { createFileRoute } from "@tanstack/react-router";

/** Górna granica wiadomości na jedno wywołanie HTTP (własny harmonogram). */
const MAX_MESSAGES_PER_REQUEST = 100;
/** Deadline przebiegu - bezpiecznie poniżej typowych timeoutów runtime. */
const REQUEST_DEADLINE_MS = 20_000;

export const Route = createFileRoute("/platform/email/queue/process")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!serviceKey) {
          console.error("[email-queue] SUPABASE_SERVICE_ROLE_KEY not configured");
          return Response.json({ error: "Server configuration error" }, { status: 500 });
        }

        const authHeader = request.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Porównanie w stałym czasie - ten sam standard co /api/public/jobs-tick.
        const { secretsEqual } = await import("@/lib/server/jobsTick.server");
        const token = authHeader.slice("Bearer ".length).trim();
        if (!(await secretsEqual(token, serviceKey))) {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }

        // Dren ciągnie kod server-only (service role, dostawca poczty) - import
        // dynamiczny, żeby nie trafił do bundla klienta (drzewo tras jest
        // importowane także po stronie przeglądarki).
        const [{ drainEmailQueues }, { supabaseAdmin }] = await Promise.all([
          import("@/lib/email/queueDrain.server"),
          import("@/integrations/supabase/client.server"),
        ]);

        const result = await drainEmailQueues(supabaseAdmin, {
          maxMessages: MAX_MESSAGES_PER_REQUEST,
          deadlineAt: Date.now() + REQUEST_DEADLINE_MS,
        });

        return Response.json(
          { processed: result.sent, ...result },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
