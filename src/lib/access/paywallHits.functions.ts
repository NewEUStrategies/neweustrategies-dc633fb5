// Uderzenie GOŚCIA w paywall (SPEC AD-16, `record_paywall_hit_visitor`).
//
// Konto liczy się samo (`record_paywall_hit` z sesją, `paywallOffer.ts`);
// gość nie ma `auth.uid()`, więc licznik idzie przez serwer: funkcja SQL jest
// wyłącznie dla `service_role`, a tożsamość i najemca NIGDY nie pochodzą
// z ładunku klienta.
//   * gość - skrót HMAC identyfikatora z PODPISANEGO cookie licznika
//     (`nes_mvid`, `meteringVisitor.server.ts`); surowy identyfikator nie
//     opuszcza serwera, a baza przyjmuje tylko `^[0-9a-f]{16,128}$`;
//   * najemca - zaufany host żądania (`requestProbeIdentity`).
// Bez ważnego cookie uderzenie NIE jest liczone i NIE wystawiamy cookie:
// pomiar nie ma podstawy, by zakładać nowy identyfikator przeglądarki
// (cookie zakłada wyłącznie konsumpcja limitu). Liczba gości z paywalla jest
// więc dolną granicą - opisane w raporcie S3 (Z-S3).
//
// Moduł zawiera WYŁĄCZNIE deklarację server function i importy (podział
// tss-serverfn-split): logika serwera ładuje się dynamicznie w handlerze.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { RpcCallable } from "@/lib/revenue/rpcCallable";

const hitSchema = z.object({
  entityType: z.enum(["post", "page", "media", "club"]),
  entityId: z.string().uuid(),
  reason: z.enum(["members", "paid", "tier_rank", "password", "quota", "registration"]),
  requiredTierKey: z.string().max(64).nullable(),
  variant: z.string().regex(/^[a-z0-9_-]{1,32}$/),
});

/** `true` = uderzenie zapisane; `false` = brak tożsamości gościa albo najemcy. */
export const recordPaywallHitVisitor = createServerFn({ method: "POST" })
  .validator((data: unknown) => hitSchema.parse(data))
  .handler(async ({ data }): Promise<boolean> => {
    const { meteringVisitorSecret, resolveMeteringVisitor } =
      await import("@/lib/access/meteringVisitor.server");
    const secret = meteringVisitorSecret();
    const visitorId = resolveMeteringVisitor(false);
    if (!secret || !visitorId) return false;
    const { requestProbeIdentity } = await import("@/lib/billing/couponRpc.server");
    const { tenantId } = await requestProbeIdentity();
    if (!tenantId) return false;
    // Ta sama biblioteka HMAC co token gościa (`visitorToken.ts`). Osobna
    // etykieta celu: ten sam identyfikator w innym liczniku daje inny skrót,
    // więc tabeli uderzeń nie da się złączyć z tabelą limitu gościa.
    const [{ hmac }, { sha256 }, { bytesToHex, utf8ToBytes }] = await Promise.all([
      import("@noble/hashes/hmac.js"),
      import("@noble/hashes/sha2.js"),
      import("@noble/hashes/utils.js"),
    ]);
    const visitorHash = bytesToHex(
      hmac(sha256, utf8ToBytes(secret), utf8ToBytes(`paywall_hit:${visitorId}`)),
    );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as unknown as RpcCallable).rpc(
      "record_paywall_hit_visitor",
      {
        p_visitor_hash: visitorHash,
        p_tenant: tenantId,
        p_entity_type: data.entityType,
        p_entity_id: data.entityId,
        p_reason: data.reason,
        p_required_tier_key: data.requiredTierKey,
        p_variant: data.variant,
      },
    );
    return !error;
  });
