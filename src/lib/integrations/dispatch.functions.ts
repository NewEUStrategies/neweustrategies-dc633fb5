// Dispatcher outbound event routera (spójność między modułami, część 5/5).
//
// Zdarzenia domenowe są fanoutowane do integration_deliveries triggerem w DB
// (router czyta filtry endpointów per tenant). Ta funkcja serwerowa zdejmuje
// paczkę dostaw claim-em (FOR UPDATE SKIP LOCKED - równolegli dispatcherzy
// się nie gryzą), buduje żądanie w formacie odbiorcy (formats.ts: generyczny
// webhook + HMAC-SHA256, Slack Block Kit, HubSpot contact upsert) i raportuje
// wynik (backoff wykładniczy + status dead po 8 próbach liczy baza).
//
// Wywoływana opportunistycznie z panelu admina (ta sama doktryna co
// publish_due_posts: pierwszy tick przy wejściu staffu, bez osobnej
// infrastruktury schedulera po stronie aplikacji) oraz cronem jobs-tick.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "@/integrations/supabase/require-staff";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  formatDelivery,
  normalizeIntegrationKind,
  parseDeliveryEnvelope,
} from "@/lib/integrations/formats";

const DispatchInput = z.object({
  limit: z.number().int().min(1).max(100).default(20),
});

const SIGNATURE_HEADER = "x-nes-signature";
const DELIVERY_TIMEOUT_MS = 10_000;

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface DispatchSummary {
  claimed: number;
  delivered: number;
  failed: number;
}

/**
 * Rdzeń dispatchu - wołany przez server fn (panel) ORAZ jobs-tick (cron co
 * minutę), więc dostawy płyną bez wejścia staffu do panelu (domknięcie D2;
 * wcześniej outbox dreniło wyłącznie otwarcie /admin/crm).
 */
export async function runIntegrationDispatch(limit: number): Promise<DispatchSummary> {
  {
    const { data: batch, error } = await supabaseAdmin.rpc("claim_integration_deliveries", {
      p_limit: limit,
    });
    if (error) throw new Error(`integration dispatch: claim failed (${error.message})`);

    const deliveries = batch ?? [];
    let delivered = 0;
    let failed = 0;

    for (const delivery of deliveries) {
      const { data: endpoint, error: endpointError } = await supabaseAdmin
        .from("integration_endpoints")
        .select("url, enabled, integration")
        .eq("id", delivery.endpoint_id)
        .maybeSingle();

      let ok = false;
      let lastError: string | null = null;

      if (endpointError || !endpoint) {
        lastError = endpointError?.message ?? "endpoint missing";
      } else if (!endpoint.enabled) {
        lastError = "endpoint disabled";
      } else {
        // Secret lives in Supabase Vault (migracja 20260714090000); read it via
        // the service-role-only RPC. Dla webhooka to klucz HMAC, dla HubSpota
        // token Bearer - formats.ts decyduje, jak go użyć.
        const { data: secretVal } = await supabaseAdmin.rpc(
          "integration_endpoint_get_secret" as never,
          { _endpoint_id: delivery.endpoint_id } as never,
        );
        const secretText: unknown = secretVal;
        const secret = typeof secretText === "string" && secretText.length > 0 ? secretText : null;
        const kind = normalizeIntegrationKind(endpoint.integration);
        const formatted = formatDelivery({
          kind,
          endpointUrl: endpoint.url,
          envelope: parseDeliveryEnvelope(delivery.payload, delivery.event_type),
          raw: delivery.payload,
          secret,
        });

        if (formatted.kind === "skip") {
          // Zdarzenie nie mapuje się na format odbiorcy (np. HubSpot dostaje
          // tylko zdarzenia kontaktowe) - kończymy sukcesem bez HTTP.
          ok = true;
        } else if (formatted.kind === "fail") {
          lastError = formatted.reason;
        } else {
          const { url, body, headers, sign } = formatted.request;
          if (sign && secret) {
            headers[SIGNATURE_HEADER] = await hmacSha256Hex(secret, body);
          }
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
          try {
            // SSRF guard: endpoint.url is tenant-configured (import cached after first call).
            const { assertPublicHttpUrl } = await import("@/lib/http/egressGuard.server");
            await assertPublicHttpUrl(url);
            const response = await fetch(url, {
              method: "POST",
              headers,
              body,
              signal: controller.signal,
              redirect: "manual",
            });
            ok = response.ok;
            if (!ok) lastError = `HTTP ${response.status}`;
          } catch (e) {
            lastError = e instanceof Error ? e.message : "network error";
          } finally {
            clearTimeout(timer);
          }
        }
      }

      const { error: finishError } = await supabaseAdmin.rpc("finish_integration_delivery", {
        p_id: delivery.id,
        p_succeeded: ok,
        p_error: lastError ?? undefined,
      });
      if (finishError) {
        console.error("[integrations] finish_integration_delivery failed", {
          deliveryId: delivery.id,
          message: finishError.message,
        });
      }
      if (ok) delivered += 1;
      else failed += 1;
    }

    return { claimed: deliveries.length, delivered, failed };
  }
}

export const dispatchIntegrationDeliveries = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((input: unknown) => DispatchInput.parse(input ?? {}))
  .handler(async ({ data }): Promise<DispatchSummary> => runIntegrationDispatch(data.limit));
