// Odbiornik zdarzeń od Stripe.
// Autoryzacja: wyłącznie podpis HMAC (`stripe-signature`, `verifyWebhook`) -
// Stripe nie publikuje stabilnej listy adresów IP dla bramki webhooków, więc
// (inaczej niż u poprzedniego dostawcy) NIE ma tu allowlisty IP. Podpis
// kryptograficzny jest jedyną i wystarczającą warstwą autoryzacji.
//
// Sama obsługa zdarzeń mieszka w `webhookDispatch.server` - ten sam kod
// wykonuje ponowne przetworzenie z panelu admina.
import { createFileRoute } from "@tanstack/react-router";
import { verifyWebhook, type StripeEnv } from "@/lib/stripe.server";
import { normalizeStripeEvent } from "@/lib/billing/stripeEvents.server";
import { runAfterResponse } from "@/lib/http/waitUntil.server";

async function handleWebhookRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const envParam = url.searchParams.get("env");
  if (envParam !== "sandbox" && envParam !== "live") {
    return new Response("Invalid environment", { status: 400 });
  }
  const env: StripeEnv = envParam;

  let verified: Awaited<ReturnType<typeof verifyWebhook>>;
  try {
    verified = await verifyWebhook(request, env);
  } catch (e) {
    console.error("[payments] webhook signature rejected", e);
    return new Response("Invalid signature", { status: 400 });
  }

  const normalized = normalizeStripeEvent(verified);
  const occurredAt = new Date(verified.created * 1000).toISOString();

  const { claimWebhookEvent, finishWebhookEvent } = await import("@/lib/billing/webhookLog.server");
  const eventType = normalized?.eventType ?? verified.type;
  const raw = (normalized?.data ?? {}) as Record<string, unknown>;
  const ref = {
    eventId: verified.id,
    eventType,
    environment: env,
    occurredAt,
    subscriptionId:
      (typeof raw.subscriptionId === "string" ? raw.subscriptionId : null) ??
      (typeof raw.id === "string" && eventType.startsWith("subscription.") ? raw.id : null),
    customerId: typeof raw.customerId === "string" ? raw.customerId : null,
    userId:
      typeof (raw.customData as { userId?: string } | null)?.userId === "string"
        ? ((raw.customData as { userId?: string }).userId ?? null)
        : null,
    payload: verified as unknown,
  };

  // Idempotencja: Stripe ponawia dostarczenie tego samego zdarzenia.
  const fresh = await claimWebhookEvent(ref).catch((e) => {
    console.error("[payments] webhook log failed", e);
    return true;
  });
  if (!fresh) return Response.json({ received: true, duplicate: true });

  // Czas obsługi trafia do dziennika - w panelu widać od razu, czy handler
  // zaczyna się ślimaczyć (Stripe ponawia po timeoucie).
  const startedAt = Date.now();

  // Zdarzenie od Stripe to najwcześniejszy sygnał, że integracja znowu żyje
  // (np. po podłączeniu nowego konta). Kontrola odcisku i ewentualne
  // odtworzenie katalogu idą "za odpowiedzią", żeby nie opóźniać ACK.
  runAfterResponse(
    import("@/lib/billing/catalogAutoSync.server")
      .then(({ ensureCatalogSynced }) => ensureCatalogSynced(env))
      .catch((e: unknown) => console.error("[payments] auto-sync check failed", e)),
  );

  if (!normalized) {
    // Zdarzenie spoza zakresu integracji (np. sesja "unpaid" albo typ, którego
    // nie obsługujemy) - potwierdzamy odbiór, żeby Stripe przestał ponawiać.
    await finishWebhookEvent(ref, "skipped", { durationMs: Date.now() - startedAt });
    return Response.json({ received: true });
  }

  try {
    const { dispatchWebhookEvent } = await import("@/lib/billing/webhookDispatch.server");
    const outcome = await dispatchWebhookEvent({
      eventType: normalized.eventType,
      data: normalized.data,
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
