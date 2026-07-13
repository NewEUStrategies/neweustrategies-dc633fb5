// Dispatcher outbound event routera (spójność między modułami, część 5/5).
//
// Zdarzenia domenowe są fanoutowane do integration_deliveries triggerem w DB
// (router czyta filtry endpointów per tenant). Ta funkcja serwerowa zdejmuje
// paczkę dostaw claim-em (FOR UPDATE SKIP LOCKED - równolegli dispatcherzy
// się nie gryzą), wysyła HTTP POST z podpisem HMAC-SHA256 i raportuje wynik
// (backoff wykładniczy + status dead po 8 próbach liczy baza).
//
// Wywoływana opportunistycznie z panelu admina (ta sama doktryna co
// publish_due_posts: pierwszy tick przy wejściu staffu, bez osobnej
// infrastruktury schedulera po stronie aplikacji).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "@/integrations/supabase/require-staff";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DispatchInput = z.object({
  limit: z.number().int().min(1).max(100).default(20),
});

const SIGNATURE_HEADER = "x-nes-signature";
const EVENT_HEADER = "x-nes-event";
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

export const dispatchIntegrationDeliveries = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((input: unknown) => DispatchInput.parse(input ?? {}))
  .handler(async ({ data }): Promise<DispatchSummary> => {
    const { data: batch, error } = await supabaseAdmin.rpc("claim_integration_deliveries", {
      p_limit: data.limit,
    });
    if (error) throw new Error(`integration dispatch: claim failed (${error.message})`);

    const deliveries = batch ?? [];
    let delivered = 0;
    let failed = 0;

    for (const delivery of deliveries) {
      const { data: endpoint, error: endpointError } = await supabaseAdmin
        .from("integration_endpoints")
        .select("url, secret, enabled")
        .eq("id", delivery.endpoint_id)
        .maybeSingle();

      let ok = false;
      let lastError: string | null = null;

      if (endpointError || !endpoint) {
        lastError = endpointError?.message ?? "endpoint missing";
      } else if (!endpoint.enabled) {
        lastError = "endpoint disabled";
      } else {
        const body = JSON.stringify(delivery.payload);
        const headers: Record<string, string> = {
          "content-type": "application/json",
          [EVENT_HEADER]: delivery.event_type,
        };
        if (endpoint.secret) {
          headers[SIGNATURE_HEADER] = await hmacSha256Hex(endpoint.secret, body);
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
        try {
          // SSRF guard: endpoint.url is tenant-configured (import cached after first call).
          const { assertPublicHttpUrl } = await import("@/lib/http/egressGuard.server");
          await assertPublicHttpUrl(endpoint.url);
          const response = await fetch(endpoint.url, {
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
  });
