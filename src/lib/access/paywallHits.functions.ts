// Uderzenie GOŚCIA w paywall (SPEC AD-16, `record_paywall_hit_visitor`).
//
// Konto liczy się samo (`record_paywall_hit` z sesją, `paywallOffer.ts`);
// gość nie ma `auth.uid()`, więc licznik idzie przez serwer: funkcja SQL jest
// wyłącznie dla `service_role`, a tożsamość i najemca NIGDY nie pochodzą
// z ładunku klienta.
//   * gość - skrót HMAC identyfikatora z PODPISANEGO cookie licznika
//     (`nes_mvid`) liczony przez `meteringVisitorDigest` - ten sam moduł,
//     który weryfikuje podpis dla limitu (`meteringVisitor.server.ts`), więc
//     odczyt cookie i wybór sekretu nie mają tu drugiej kopii; surowy
//     identyfikator nie opuszcza serwera, a baza przyjmuje tylko
//     `^[0-9a-f]{16,128}$`;
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
    const { meteringVisitorDigest } = await import("@/lib/access/meteringVisitor.server");
    // Osobna etykieta celu: ten sam gość w limicie i w uderzeniach daje dwa
    // różne skróty, więc tabeli uderzeń nie da się złączyć z tabelą limitu.
    const visitorHash = meteringVisitorDigest("paywall_hit");
    if (!visitorHash) return false;
    const { requestProbeIdentity } = await import("@/lib/billing/couponRpc.server");
    const { tenantId } = await requestProbeIdentity();
    if (!tenantId) return false;
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
