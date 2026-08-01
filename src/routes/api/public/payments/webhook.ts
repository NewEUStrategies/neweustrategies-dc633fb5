// Odbiornik zdarzeń od dostawcy płatności.
// Autoryzacja: wyłącznie podpis kryptograficzny dostawcy (bez sesji Supabase) -
// trasa musi pozostać publiczna, dlatego cała weryfikacja dzieje się poniżej.
//
// Sama obsługa zdarzeń mieszka w `webhookDispatch.server` - ten sam kod
// wykonuje ponowne przetworzenie z panelu admina.
import { createFileRoute } from "@tanstack/react-router";
import { verifyWebhook, type PaddleEnv } from "@/lib/paddle.server";
import { runAfterResponse } from "@/lib/http/waitUntil.server";

async function handleWebhookRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const env = (url.searchParams.get("env") === "live" ? "live" : "sandbox") as PaddleEnv;

  // Warstwa 1: adres nadawcy musi należeć do operatora (lista pobierana z jego
  // API, nigdy zaszyta w kodzie). Warstwa 2: podpis kryptograficzny poniżej.
  const { isAllowedWebhookIp } = await import("@/lib/billing/webhookIpAllowlist.server");
  if (!(await isAllowedWebhookIp(request, env))) {
    console.warn("[payments] webhook rejected - IP spoza allowlisty");
    return new Response("Forbidden", { status: 403 });
  }

  let event: Awaited<ReturnType<typeof verifyWebhook>>;
  try {
    event = await verifyWebhook(request, env);
  } catch (e) {
    console.error("[payments] webhook signature rejected", e);
    return new Response("Invalid signature", { status: 400 });
  }

  const { claimWebhookEvent, finishWebhookEvent } = await import("@/lib/billing/webhookLog.server");
  const raw = event.data as unknown as Record<string, unknown>;
  const occurredAt =
    typeof event.occurredAt === "string" ? event.occurredAt : new Date().toISOString();
  const ref = {
    eventId: event.eventId,
    eventType: String(event.eventType),
    environment: env,
    occurredAt,
    subscriptionId:
      (typeof raw.subscriptionId === "string" ? raw.subscriptionId : null) ??
      (typeof raw.id === "string" && String(event.eventType).startsWith("subscription.")
        ? raw.id
        : null),
    customerId: typeof raw.customerId === "string" ? raw.customerId : null,
    userId:
      typeof (raw.customData as { userId?: string } | null)?.userId === "string"
        ? ((raw.customData as { userId?: string }).userId ?? null)
        : null,
    payload: event as unknown,
  };

  // Idempotencja: operator ponawia dostarczenie tego samego zdarzenia.
  const fresh = await claimWebhookEvent(ref).catch((e) => {
    console.error("[payments] webhook log failed", e);
    return true;
  });
  if (!fresh) return Response.json({ received: true, duplicate: true });

  // Czas obsługi trafia do dziennika - w panelu widać od razu, czy handler
  // zaczyna się ślimaczyć (operator ponawia po timeoucie).
  const startedAt = Date.now();

  // Zdarzenie od operatora to najwcześniejszy sygnał, że integracja znowu
  // żyje (np. po podłączeniu nowego konta). Kontrola odcisku i ewentualne
  // odtworzenie katalogu idą "za odpowiedzią", żeby nie opóźniać ACK.
  runAfterResponse(
    import("@/lib/billing/catalogAutoSync.server")
      .then(({ ensureCatalogSynced }) => ensureCatalogSynced(env))
      .catch((e: unknown) => console.error("[payments] auto-sync check failed", e)),
  );

  try {
    const { dispatchWebhookEvent } = await import("@/lib/billing/webhookDispatch.server");
    const outcome = await dispatchWebhookEvent({
      eventType: String(event.eventType),
      data: event.data,
      environment: env,
      occurredAt,
    });
    await finishWebhookEvent(ref, outcome === "processed" ? "processed" : "skipped", {
      durationMs: Date.now() - startedAt,
    });
    return Response.json({ received: true });
  } catch (e) {
    console.error("[payments] webhook error", e);
    await finishWebhookEvent(ref, "failed", {
      error: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - startedAt,
    });
    return new Response("Webhook error", { status: 500 });
  }
}

/** Wejście dla testów - identyczna ścieżka jak trasa HTTP. */
export const __handleForTests = handleWebhookRequest;

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => handleWebhookRequest(request),
    },
  },
});
