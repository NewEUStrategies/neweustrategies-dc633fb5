// Webhook wykluczeń dostawcy platformy: POST /platform/email/suppression
//
// Druga (obok /api/public/webhooks/resend) pętla zwrotna dostarczalności - Go
// API platformy raportuje tu odbicia, skargi i wypisy zgłoszone u dostawcy.
//
// PRZYCZYNA ŹRÓDŁOWA. Ten endpoint pisał do zaszłej tabeli `suppressed_emails`,
// której nie czytała wysyłka kampanii; webhook Resend pisał do kanonicznych
// `email_suppressions`, których nie czytała wysyłka transakcyjna. Dwa webhooki,
// dwie listy, żadna pełna. Teraz oba przechodzą przez `applyDeliveryEvent`, więc
// zdarzenie ląduje w logu dostarczalności (idempotentnie po identyfikatorze),
// aktualizuje stan dostawy odbiorcy kampanii i stawia blokadę o właściwej
// powadze - z eskalacją miękkich odbić i bez osłabiania mocniejszej blokady.
import { WebhookError, verifyWebhookRequest } from "@lovable.dev/webhooks-js";
import { createFileRoute } from "@tanstack/react-router";
import type { DeliveryEventKind } from "@/lib/email/deliveryEvents";

/**
 * Ładunek wysyłany przez Go API, gdy dostawca zgłosi odbicie, skargę lub wypis.
 */
interface SuppressionPayload {
  email: string;
  reason: "bounce" | "complaint" | "unsubscribe";
  message_id?: string;
  metadata?: Record<string, unknown>;
  is_retry: boolean;
  retry_count: number;
}

function parseSuppressionPayload(body: string): SuppressionPayload {
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null || !("data" in parsed)) {
    throw new Error("Missing data field in payload");
  }
  const data = (parsed as { data: SuppressionPayload }).data;
  if (!data?.email || !data?.reason) {
    throw new Error("Missing required fields: email, reason");
  }
  return data;
}

function redactEmail(email: string): string {
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return "***";
  return `${localPart[0]}***@${domain}`;
}

/**
 * Powód dostawcy -> rodzaj zdarzenia dostarczalności + klasa odbicia.
 *
 * `bounce` bez klasy traktujemy jako TWARDE: ten webhook raportuje wykluczenia,
 * czyli zdarzenia, po których dostawca sam przestaje przyjmować adres, a nie
 * chwilowe opóźnienia. Zaklasyfikowanie ich jako miękkich dałoby blokadę
 * wygasającą po dobie i powrót do dobijania się do martwej skrzynki.
 */
function classify(reason: SuppressionPayload["reason"]): {
  kind: DeliveryEventKind;
  bounceClass: "hard" | null;
  diagnostic: string;
} {
  switch (reason) {
    case "complaint":
      return {
        kind: "complained",
        bounceClass: null,
        diagnostic: "Spam complaint - recipient marked email as spam",
      };
    case "unsubscribe":
      // Wypis nie jest zdarzeniem dostawcy w sensie dostarczalności; blokadę
      // stawia osobna ścieżka niżej.
      return { kind: "other", bounceClass: null, diagnostic: "Recipient unsubscribed" };
    default:
      return {
        kind: "bounced",
        bounceClass: "hard",
        diagnostic: "Permanent bounce - email address is invalid or rejected",
      };
  }
}

export const Route = createFileRoute("/platform/email/suppression")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
          console.error("[platform-suppression] LOVABLE_API_KEY not configured");
          return Response.json({ error: "Server configuration error" }, { status: 500 });
        }

        // Podpis HMAC jest OBOWIĄZKOWY: bez niego endpoint byłby publicznym
        // sposobem wpisania dowolnego adresu na listę wykluczeń (cichy DoS na
        // pocztę wybranego odbiorcy).
        let payload: SuppressionPayload;
        try {
          const verified = await verifyWebhookRequest({
            req: request,
            secret: apiKey,
            parser: parseSuppressionPayload,
          });
          payload = verified.payload;
        } catch (error) {
          if (error instanceof WebhookError) {
            switch (error.code) {
              case "invalid_signature":
              case "stale_timestamp":
                console.error("[platform-suppression] rejected", { code: error.code });
                return Response.json({ error: error.code }, { status: 401 });
              case "invalid_payload":
              case "invalid_json":
                console.error("[platform-suppression] bad payload", { code: error.code });
                return Response.json({ error: "Invalid payload" }, { status: 400 });
              default:
                console.error("[platform-suppression] verification failed", { code: error.code });
                return Response.json({ error: "Verification failed" }, { status: 401 });
            }
          }
          console.error("[platform-suppression] unexpected verification error", { error });
          return Response.json({ error: "Internal error" }, { status: 500 });
        }

        const [{ supabaseAdmin }, suppression] = await Promise.all([
          import("@/integrations/supabase/client.server"),
          import("@/lib/email/suppression.server"),
        ]);

        const email = payload.email.trim().toLowerCase();
        const { kind, bounceClass, diagnostic } = classify(payload.reason);
        // Identyfikator zdarzenia musi być STABILNY między ponowieniami, inaczej
        // idempotencja po (provider, event_id) nic nie daje. Gdy dostawca nie
        // przysyła własnego, składamy go z adresu i powodu.
        const eventId = payload.message_id
          ? `platform:${payload.message_id}:${payload.reason}`
          : `platform:${email}:${payload.reason}`;

        if (kind === "other") {
          // Wypis: nie ma tu zdarzenia dostarczalności do zaksięgowania, jest
          // decyzja odbiorcy. Blokada `unsubscribe` zatrzymuje wysyłkę za zgodą,
          // ale nie potwierdzenia płatności (patrz suppressionPolicy).
          const tenantId = await suppression.resolveTenantForAddress(supabaseAdmin, email);
          if (!tenantId) {
            console.error("[platform-suppression] no tenant for address", {
              email_redacted: redactEmail(email),
            });
            return Response.json({ error: "Failed to write suppression" }, { status: 500 });
          }
          const ok = await suppression.recordSuppression(supabaseAdmin, {
            tenantId,
            email,
            reason: "unsubscribe",
            source: "system",
            provider: "platform",
            providerMessageId: payload.message_id ?? null,
            eventId,
            diagnostic,
          });
          if (!ok) return Response.json({ error: "Failed to write suppression" }, { status: 500 });
          return Response.json({ success: true, reason: payload.reason });
        }

        const applied = await suppression.applyDeliveryEvent(supabaseAdmin, {
          provider: "platform",
          eventId,
          eventType: `platform.${payload.reason}`,
          kind,
          email,
          providerMessageId: payload.message_id ?? null,
          bounceClass,
          diagnostic,
          occurredAt: new Date().toISOString(),
          payload: payload.metadata ?? {},
        });

        if (!applied.ok) {
          console.error("[platform-suppression] apply failed", {
            email_redacted: redactEmail(email),
            reason: payload.reason,
          });
          // 500 => dostawca ponowi; idempotencja po eventId czyni retry bezpiecznym.
          return Response.json({ error: "Failed to write suppression" }, { status: 500 });
        }

        console.log("[platform-suppression] processed", {
          email_redacted: redactEmail(email),
          reason: payload.reason,
          duplicate: applied.duplicate,
          suppressed: applied.suppressed,
          retry_count: payload.retry_count,
        });

        return Response.json({
          success: true,
          duplicate: applied.duplicate,
          suppressed: applied.suppressed,
        });
      },
    },
  },
});
