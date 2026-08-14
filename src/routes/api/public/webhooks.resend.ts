// Webhook dostarczalności Resend: POST /api/public/webhooks/resend
//
// Domyka pętlę zwrotną wysyłki. Bez niego platforma wiedziała tylko tyle, że
// dostawca PRZYJĄŁ wiadomość - odbicia i skargi na spam ginęły, a kolejna
// kampania szła w te same martwe skrzynki. Wytyczne Google dla nadawców
// masowych wymagają utrzymania wskaźnika zgłoszeń spamu poniżej 0,30%
// (docelowo <0,10%) i natychmiastowego zaprzestania wysyłki na adresy, które
// zgłosiły spam - jedno i drugie wymaga konsumpcji tych zdarzeń.
//
// Bezpieczeństwo:
//   - podpis Svix jest OBOWIĄZKOWY (bez sekretu endpoint zwraca 503, nigdy nie
//     przetwarza treści) - inaczej byłby to publiczny sposób na wpisanie
//     dowolnego adresu na listę wykluczeń,
//   - okno tolerancji timestampa blokuje replay,
//   - idempotencja po svix-id: retry dostawcy nie policzy zdarzenia dwa razy,
//   - tenant NIGDY nie pochodzi z treści webhooka bez weryfikacji: ustala go
//     korelacja po provider_message_id (zapisanym w chwili wysyłki), a dopiero
//     w ostateczności jednoznaczne dopasowanie adresu (patrz
//     email_apply_delivery_event); tagi są jedynie podpowiedzią i muszą
//     zgadzać się z rekordem odbiorcy.
//
// Konfiguracja: RESEND_WEBHOOK_SECRET (whsec_...) w sekretach projektu +
// endpoint w panelu Resend nasłuchujący na email.bounced, email.complained,
// email.delivered, email.delivery_delayed, email.failed (opcjonalnie email.sent).
import { createFileRoute } from "@tanstack/react-router";
import {
  normalizeResendEvent,
  uuidTag,
  type NormalizedDeliveryEvent,
} from "@/lib/email/deliveryEvents";
import { readWebhookHeaders, verifyWebhookSignature } from "@/lib/email/webhookSignature.server";
import { applyDeliveryEvent } from "@/lib/email/suppression.server";

/** Payload webhooka jest mały; większy = nie nasz. */
const MAX_BODY_BYTES = 128 * 1024;

export const Route = createFileRoute("/api/public/webhooks/resend")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
    },
  },
});

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function handle(request: Request): Promise<Response> {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[resend-webhook] RESEND_WEBHOOK_SECRET not configured");
    return json({ error: "not_configured" }, 503);
  }

  const payload = await request.text();
  if (payload.length > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }

  const verified = verifyWebhookSignature(payload, readWebhookHeaders(request.headers), secret);
  if (!verified.ok) {
    // 401 dla podpisu, 400 dla braku nagłówków - dostawca rozróżnia te
    // przypadki w swoim panelu diagnostycznym.
    const status = verified.error === "missing_headers" ? 400 : 401;
    return json({ error: verified.error }, status);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const event = normalizeResendEvent(parsed);
  if (!event) return json({ error: "unsupported_payload" }, 400);

  try {
    const result = await applyEvent(verified.id, event, parsed);
    return json(result, 200);
  } catch (err) {
    console.error("[resend-webhook] handler error", event.eventType, err);
    // 500 => dostawca ponowi; idempotencja po svix-id czyni retry bezpiecznym.
    return json({ error: "handler_error" }, 500);
  }
}

async function applyEvent(
  eventId: string,
  event: NormalizedDeliveryEvent,
  rawPayload: unknown,
): Promise<Record<string, unknown>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const applied = await applyDeliveryEvent(supabaseAdmin, {
    provider: "resend",
    eventId,
    eventType: event.eventType,
    kind: event.kind,
    email: event.email,
    providerMessageId: event.messageId,
    bounceClass: event.bounceClass,
    diagnostic: event.diagnostic,
    occurredAt: event.occurredAt,
    // Tagi wysyłki są tylko PODPOWIEDZIĄ przy korelacji; SQL i tak preferuje
    // rekord odbiorcy po provider_message_id, więc podrobiony tag nie
    // przypisze zdarzenia do obcego tenanta (podpis i tak by na to nie pozwolił).
    tenantHint: uuidTag(event.tags, "tenant", "tenant_id"),
    campaignHint: uuidTag(event.tags, "campaign", "campaign_id"),
    subscriberHint: uuidTag(event.tags, "subscriber", "subscriber_id"),
    payload: rawPayload,
  });

  // Otwarcia i kliknięcia dostawcy NIE są niezależnym pomiarem: dostawca liczy
  // je tym samym mechanizmem, co my (piksel obrazka, przepisany link - w dodatku
  // przepisuje NASZ link `nl-click` jeszcze raz na swój). Dopóki obie ścieżki
  // pisały, jedno otwarcie dawało dwa wiersze i wskaźnik otwarć przekraczał
  // 100%. Dlatego zapis idzie przez tę samą bramkę źródła, co piksel: wiersz
  // powstanie WYŁĄCZNIE wtedy, gdy operator uczynił dostawcę źródłem prawdy
  // (NEWSLETTER_ENGAGEMENT_SOURCE=provider). Domyślnie ta gałąź jest cicha,
  // a `email_delivery_events` - dziennik dostarczalności, po który ten webhook
  // naprawdę istnieje - zapisuje się niezależnie, powyżej.
  if (
    (event.kind === "opened" || event.kind === "clicked") &&
    applied.campaignId &&
    !applied.duplicate
  ) {
    const { recordCampaignEvent } = await import("@/lib/newsletter/trackingEvents.server");
    await recordCampaignEvent({
      campaignId: applied.campaignId,
      subscriberId: applied.subscriberId,
      kind: event.kind === "opened" ? "open" : "click",
      url: event.url,
      source: "provider",
    });
  }

  return {
    ok: applied.ok,
    duplicate: applied.duplicate,
    kind: event.kind,
    suppressed: applied.suppressed,
  };
}

// Eksport dla testów: pełny handler (weryfikacja + rozgałęzienie odpowiedzi).
export { handle as __handleForTests };
