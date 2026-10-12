// Odbiornik zdarzeń od Stripe.
// Autoryzacja: wyłącznie podpis HMAC (`stripe-signature`, `verifyWebhook`) -
// Stripe nie publikuje stabilnej listy adresów IP dla bramki webhooków, więc
// (inaczej niż u poprzedniego dostawcy) NIE ma tu allowlisty IP. Podpis
// kryptograficzny jest jedyną i wystarczającą warstwą autoryzacji.
//
// Sama obsługa zdarzeń mieszka w `webhookDispatch.server`, a jej wykonanie
// i domknięcie dziennika we wspólnym rdzeniu `webhookReplay.server` - tym
// samym, który odtwarza zdarzenia z panelu admina, z uzgadniania i z
// automatycznej zamiatarki.
import { createFileRoute } from "@tanstack/react-router";
import { verifyWebhook, type StripeEnv } from "@/lib/stripe.server";
import { normalizeStripeEvent } from "@/lib/billing/stripeEvents.server";
import { runAfterResponse } from "@/lib/http/waitUntil.server";

/**
 * Sugerowana przerwa przed ponowieniem (s) dla odpowiedzi „spróbuj później".
 * Stripe i tak ponawia według własnego harmonogramu; nagłówek mówi pozostałym
 * klientom (np. `curl --retry` przy ręcznej powtórce), że to stan chwilowy.
 */
const RETRY_AFTER_S = "60";

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

  const { claimWebhookEvent } = await import("@/lib/billing/webhookLog.server");
  const eventType = normalized?.eventType ?? verified.type;
  const raw = (normalized?.data ?? {}) as Record<string, unknown>;
  const customData = raw.customData as { userId?: unknown } | null | undefined;
  const ref = {
    eventId: verified.id,
    eventType,
    environment: env,
    occurredAt,
    subscriptionId:
      (typeof raw.subscriptionId === "string" ? raw.subscriptionId : null) ??
      (typeof raw.id === "string" && eventType.startsWith("subscription.") ? raw.id : null),
    customerId: typeof raw.customerId === "string" ? raw.customerId : null,
    userId: typeof customData?.userId === "string" ? customData.userId : null,
    payload: verified as unknown,
  };

  // Idempotencja: Stripe ponawia dostarczenie tego samego zdarzenia.
  //
  // Kod odpowiedzi jest tu decyzją o pieniądzach: 2xx znaczy dla operatora
  // „mam, nie ponawiaj". Dlatego:
  //   * dziennik nieczytelny -> 503 i ZERO obsługi (fail-closed). Obsługa bez
  //     rezerwacji mogła biec równolegle z drugą dostawą tego samego zdarzenia,
  //     a padnięta zostawała bez wiersza, którego zamiatarka by szukała,
  //   * zdarzenie w toku -> 409: pierwsza obsługa może jeszcze paść, więc
  //     operator MUSI ponowić. Dawne 200 „duplicate" kończyło ponawianie
  //     i zdarzenie, którego obsługa zginęła z workerem, wisiało na zawsze,
  //   * zdarzenie domknięte -> 200 `duplicate`.
  let claim: Awaited<ReturnType<typeof claimWebhookEvent>>;
  try {
    claim = await claimWebhookEvent(ref);
  } catch (e) {
    console.error("[payments] webhook log failed", e);
    return new Response("Webhook log unavailable", {
      status: 503,
      headers: { "Retry-After": RETRY_AFTER_S },
    });
  }
  if (claim === "done") return Response.json({ received: true, duplicate: true });
  if (claim === "in_progress") {
    return new Response("Webhook event in progress", {
      status: 409,
      headers: { "Retry-After": RETRY_AFTER_S },
    });
  }

  // Zdarzenie od Stripe to najwcześniejszy sygnał, że integracja znowu żyje
  // (np. po podłączeniu nowego konta). Kontrola odcisku i ewentualne
  // odtworzenie katalogu idą "za odpowiedzią", żeby nie opóźniać ACK.
  runAfterResponse(
    import("@/lib/billing/catalogAutoSync.server")
      .then(({ ensureCatalogSynced }) => ensureCatalogSynced(env))
      .catch((e: unknown) => console.error("[payments] auto-sync check failed", e)),
  );

  // Obsługa i domknięcie wiersza (z czasem obsługi - w panelu widać od razu,
  // czy handler zaczyna się ślimaczyć) idą wspólnym rdzeniem z panelem,
  // uzgadnianiem i zamiatarką. Zdarzenie spoza zakresu integracji (np. sesja
  // "unpaid" albo typ, którego nie obsługujemy) jest domykane jako `skipped`
  // i potwierdzane, żeby Stripe przestał ponawiać.
  const { processClaimedWebhookEvent } = await import("@/lib/billing/webhookReplay.server");
  const outcome = await processClaimedWebhookEvent({
    eventId: verified.id,
    environment: env,
    occurredAt,
    normalized,
  });
  if (outcome.status === "failed") return new Response("Webhook error", { status: 500 });
  return Response.json({ received: true });
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
