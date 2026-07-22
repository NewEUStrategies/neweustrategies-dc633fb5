// Server fns przepływu retencji przy anulowaniu subskrypcji.
//
//   submitRetentionFeedback  zapis ankiety (powód + komentarz) także wtedy,
//                            gdy użytkownik odrzucił kontrofertę,
//   acceptRetentionOffer     akceptacja kontrofertki: personalny kupon w
//                            ISTNIEJĄCYM module b2b_coupons (procent, liczba
//                            użyć i ważność z retention_settings) + zapis
//                            akceptacji w retention_feedback.
//
// Bezpieczeństwo: wszystko service-role z twardym sprawdzeniem własności
// subskrypcji (klient nie ma żadnych uprawnień zapisu do retention_feedback
// ani b2b_coupons). Anty-nadużyciowo: jedna zaakceptowana oferta na
// użytkownika w oknie 180 dni.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  couponSuffixFromBytes,
  couponValidUntil,
  retentionCouponCode,
} from "@/lib/retention/coupon";

const REDEEMED_WINDOW_DAYS = 180;

const feedbackSchema = z.object({
  subscriptionId: z.string().uuid(),
  reasonId: z.string().uuid().nullable(),
  reasonLabel: z.string().trim().min(1).max(200),
  comment: z.string().trim().max(2000).optional(),
  offerShown: z.boolean(),
});

const acceptSchema = feedbackSchema.omit({ offerShown: true });

interface OwnedSubscription {
  id: string;
  tenant_id: string;
}

async function loadOwnedSubscription(
  userId: string,
  subscriptionId: string,
): Promise<OwnedSubscription | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_subscriptions")
    .select("id, tenant_id")
    .eq("id", subscriptionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export const submitRetentionFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => feedbackSchema.parse(input))
  .handler(async ({ data, context }) => {
    const sub = await loadOwnedSubscription(context.userId, data.subscriptionId);
    if (!sub) throw new Error("subscription_not_found");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("retention_feedback").insert({
      tenant_id: sub.tenant_id,
      user_id: context.userId,
      subscription_id: sub.id,
      reason_id: data.reasonId,
      reason_label: data.reasonLabel,
      comment: data.comment?.trim() ? data.comment.trim() : null,
      offer_shown: data.offerShown,
      offer_accepted: false,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const acceptRetentionOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => acceptSchema.parse(input))
  .handler(async ({ data, context }) => {
    const sub = await loadOwnedSubscription(context.userId, data.subscriptionId);
    if (!sub) throw new Error("subscription_not_found");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("retention_settings")
      .select("enabled, discount_pct, discount_periods, coupon_valid_days")
      .eq("tenant_id", sub.tenant_id)
      .maybeSingle();
    if (settingsError) throw new Error(settingsError.message);
    if (!settings?.enabled) {
      return { ok: false as const, reason: "offer_disabled" as const };
    }

    // Jedna zaakceptowana kontrofertka w oknie czasowym - kupon nie może być
    // pompką rabatową odnawianą co miesiąc.
    const windowStart = new Date(
      Date.now() - REDEEMED_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data: prior, error: priorError } = await supabaseAdmin
      .from("retention_feedback")
      .select("id")
      .eq("tenant_id", sub.tenant_id)
      .eq("user_id", context.userId)
      .eq("offer_accepted", true)
      .gte("created_at", windowStart)
      .limit(1);
    if (priorError) throw new Error(priorError.message);
    if (prior && prior.length > 0) {
      return { ok: false as const, reason: "already_redeemed" as const };
    }

    const { randomBytes } = await import("node:crypto");
    const validUntil = couponValidUntil(new Date(), settings.coupon_valid_days);

    // Kod unikalny per tenant (constraint) - przy kolizji losujemy ponownie.
    let code = "";
    let created = false;
    for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
      code = retentionCouponCode(
        settings.discount_pct,
        couponSuffixFromBytes(new Uint8Array(randomBytes(8)), 6),
      );
      const { error } = await supabaseAdmin.from("b2b_coupons").insert({
        tenant_id: sub.tenant_id,
        code,
        name: "Oferta retencyjna",
        description:
          "Personalna kontrofertka z przepływu anulowania subskrypcji - wygenerowana automatycznie.",
        discount_kind: "percent",
        discount_percent: settings.discount_pct,
        max_redemptions: settings.discount_periods,
        valid_until: validUntil.toISOString(),
        active: true,
        metadata: {
          source: "retention",
          user_id: context.userId,
          subscription_id: sub.id,
        },
      });
      if (!error) {
        created = true;
      } else if (error.code !== "23505") {
        throw new Error(error.message);
      }
    }
    if (!created) throw new Error("coupon_code_collision");

    const { error: feedbackError } = await supabaseAdmin.from("retention_feedback").insert({
      tenant_id: sub.tenant_id,
      user_id: context.userId,
      subscription_id: sub.id,
      reason_id: data.reasonId,
      reason_label: data.reasonLabel,
      comment: data.comment?.trim() ? data.comment.trim() : null,
      offer_shown: true,
      offer_accepted: true,
      coupon_code: code,
    });
    if (feedbackError) throw new Error(feedbackError.message);

    return {
      ok: true as const,
      code,
      discountPct: settings.discount_pct,
      discountPeriods: settings.discount_periods,
      validUntil: validUntil.toISOString(),
    };
  });
