// Server fns przepływu anulowania subskrypcji (S2, P01, P02, Z-09).
//
//   startRetentionFlow       otwarcie dialogu: wiersz `retention_feedback`
//                            z `outcome='started'` (mianownik „save rate")
//                            i rozstrzygnięcie, CO dialog może pokazać:
//                            same potwierdzenie (`enabled=false`), ankietę,
//                            ankietę z ofertą;
//   submitRetentionFeedback  decyzja klienta - UPDATE TEGO SAMEGO wiersza
//                            (`canceled` albo `saved`); „Anuluj mimo to"
//                            przed wyborem powodu zapisuje `not_given`
//                            (Z-09: CHECK I0 wymaga powodu przy `canceled`,
//                            a brak powodu NIE jest powodem „inny");
//   acceptRetentionOffer     przyjęcie oferty: rabat `repeating` na
//                            subskrypcji OPERATORA (`applyOffer.server.ts`),
//                            klucz idempotencji z id przepływu, 1 oferta na
//                            użytkownika w oknie 180 dni.
//
// DLACZEGO OFERTA TYLKO PRZY SUBSKRYPCJI OPERATORA. Rabat musi obniżyć
// NASTĘPNĄ płatność. Subskrypcja lokalna (bez lustra operatora - atrapa,
// zakup dożywotni) nie ma kolejnej płatności, którą dałoby się obniżyć, a
// kupon B2B do kasy był niewykonalny (P02) - lepiej nie obiecywać rabatu,
// niż obiecać taki, którego nie da się użyć.
//
// BEZPIECZEŃSTWO. Wszystko service-role z twardym sprawdzeniem własności
// subskrypcji (klient nie ma uprawnień zapisu do `retention_feedback`).
// Najemca i użytkownik z sesji/wiersza subskrypcji - NIGDY z payloadu.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Jedna przyjęta oferta na użytkownika w tym oknie (anty-pompka rabatowa). */
export const RETENTION_OFFER_WINDOW_DAYS = 180;
/** Etykieta braku powodu (Z-09) - ta sama co w SQL (`tg_retention_feedback_emit`). */
export const RETENTION_REASON_NOT_GIVEN = "not_given";
/** Otwarty przepływ młodszy niż to okno jest wznawiany, nie dublowany. */
const REUSE_STARTED_HOURS = 24;

const DAY_MS = 86_400_000;

const reasonFields = {
  reasonId: z.string().uuid().nullable(),
  // `null` = klient nie wybrał powodu („Anuluj mimo to" od razu).
  reasonLabel: z.string().trim().min(1).max(200).nullable(),
  comment: z.string().trim().max(2000).optional(),
};

const startSchema = z.object({ subscriptionId: z.string().uuid() });

const feedbackSchema = z.object({
  subscriptionId: z.string().uuid(),
  /** Wiersz z `startRetentionFlow`; brak = klient sprzed S2 (wstawienie). */
  feedbackId: z.string().uuid().nullable().optional(),
  outcome: z.enum(["canceled", "saved"]).default("canceled"),
  offerShown: z.boolean(),
  ...reasonFields,
});

const acceptSchema = z.object({
  subscriptionId: z.string().uuid(),
  feedbackId: z.string().uuid(),
  ...reasonFields,
});

/** Subskrypcja wołającego: lustro operatora albo wiersz lokalny. */
export type OwnedSubscription =
  | {
      kind: "provider";
      id: string;
      tenant_id: string;
      provider_subscription_id: string;
      environment: string;
      status: string;
    }
  | { kind: "local"; id: string; tenant_id: string };

/**
 * Własność subskrypcji: najpierw lustro operatora (`subscriptions`), potem
 * wiersz lokalny (`user_subscriptions`). Oba odczyty zawężone `user_id`
 * WOŁAJĄCEGO - id z klienta nie wystarcza. Błąd bazy jest zgłaszany, nie
 * mylony z brakiem własności.
 */
export async function loadOwnedSubscription(
  userId: string,
  subscriptionId: string,
): Promise<OwnedSubscription | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const provider = await supabaseAdmin
    .from("subscriptions")
    .select("id, tenant_id, provider_subscription_id, environment, status")
    .eq("id", subscriptionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (provider.error) throw new Error(provider.error.message);
  if (provider.data) return { kind: "provider", ...provider.data };

  const local = await supabaseAdmin
    .from("user_subscriptions")
    .select("id, tenant_id")
    .eq("id", subscriptionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (local.error) throw new Error(local.error.message);
  return local.data ? { kind: "local", ...local.data } : null;
}

interface OfferSettings {
  enabled: boolean;
  discount_pct: number;
  discount_periods: number;
}

async function loadSettings(tenantId: string): Promise<OfferSettings | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("retention_settings")
    .select("enabled, discount_pct, discount_periods")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/** Czy użytkownik przyjął już ofertę w oknie 180 dni. */
async function redeemedRecently(tenantId: string, userId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const windowStart = new Date(Date.now() - RETENTION_OFFER_WINDOW_DAYS * DAY_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from("retention_feedback")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("offer_accepted", true)
    .gte("created_at", windowStart)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

/** Oferta, którą dialog może pokazać - albo powód, dla którego jej nie ma. */
export type RetentionOfferAvailability =
  | { available: true; discountPct: number; discountPeriods: number }
  | { available: false; reason: "disabled" | "already_redeemed" | "no_provider" };

async function offerFor(
  sub: OwnedSubscription,
  settings: OfferSettings | null,
  userId: string,
): Promise<RetentionOfferAvailability> {
  if (!settings?.enabled || settings.discount_pct <= 0) {
    return { available: false, reason: "disabled" };
  }
  if (sub.kind !== "provider") return { available: false, reason: "no_provider" };
  if (await redeemedRecently(sub.tenant_id, userId)) {
    return { available: false, reason: "already_redeemed" };
  }
  return {
    available: true,
    discountPct: settings.discount_pct,
    discountPeriods: settings.discount_periods,
  };
}

function reasonColumns(data: {
  reasonId: string | null;
  reasonLabel: string | null;
  comment?: string;
}) {
  const label = data.reasonLabel?.trim() ? data.reasonLabel.trim() : null;
  return {
    // Brak wybranego powodu: `not_given` i BEZ id - „inny powód" wymaga
    // świadomego wyboru, a CHECK I0 wymaga etykiety przy `canceled/saved`.
    reason_id: label ? data.reasonId : null,
    reason_label: label ?? RETENTION_REASON_NOT_GIVEN,
    comment: data.comment?.trim() ? data.comment.trim() : null,
  };
}

// ── startRetentionFlow ──────────────────────────────────────────────────────

export interface RetentionFlowStart {
  feedbackId: string;
  /** `false` = operator wyłączył przepływ: dialog pokazuje samo potwierdzenie. */
  surveyEnabled: boolean;
  offer: RetentionOfferAvailability;
}

export const startRetentionFlow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => startSchema.parse(input))
  .handler(async ({ data, context }): Promise<RetentionFlowStart> => {
    const sub = await loadOwnedSubscription(context.userId, data.subscriptionId);
    if (!sub) throw new Error("subscription_not_found");
    const settings = await loadSettings(sub.tenant_id);
    const offer = await offerFor(sub, settings, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Ponowne otwarcie dialogu w ciągu doby wznawia TEN SAM przepływ - inaczej
    // każde „otwórz, zamknij, otwórz" dokładałoby rozpoczęty przepływ
    // i zaniżało skuteczność zatrzymania.
    const since = new Date(Date.now() - REUSE_STARTED_HOURS * 3_600_000).toISOString();
    const open = await supabaseAdmin
      .from("retention_feedback")
      .select("id")
      .eq("tenant_id", sub.tenant_id)
      .eq("user_id", context.userId)
      .eq("subscription_id", sub.id)
      .eq("outcome", "started")
      .gte("flow_started_at", since)
      .order("flow_started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (open.error) throw new Error(open.error.message);

    let feedbackId = open.data?.id ?? null;
    if (!feedbackId) {
      const inserted = await supabaseAdmin
        .from("retention_feedback")
        .insert({
          tenant_id: sub.tenant_id,
          user_id: context.userId,
          subscription_id: sub.id,
          outcome: "started",
          flow_started_at: new Date().toISOString(),
          reason_id: null,
          reason_label: null,
          offer_shown: false,
          offer_accepted: false,
        })
        .select("id")
        .single();
      if (inserted.error) throw new Error(inserted.error.message);
      feedbackId = inserted.data.id;
    }

    return { feedbackId, surveyEnabled: settings?.enabled === true, offer };
  });

// ── submitRetentionFeedback ─────────────────────────────────────────────────

export const submitRetentionFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => feedbackSchema.parse(input))
  .handler(async ({ data, context }) => {
    const sub = await loadOwnedSubscription(context.userId, data.subscriptionId);
    if (!sub) throw new Error("subscription_not_found");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const columns = {
      ...reasonColumns(data),
      offer_shown: data.offerShown,
      outcome: data.outcome,
    };

    if (data.feedbackId) {
      // Ten sam wiersz, tylko z `started` (albo `abandoned` po 24 h - klient
      // wrócił do otwartej karty): wynik raz zapisany się nie zmienia.
      const updated = await supabaseAdmin
        .from("retention_feedback")
        .update(columns)
        .eq("id", data.feedbackId)
        .eq("tenant_id", sub.tenant_id)
        .eq("user_id", context.userId)
        .in("outcome", ["started", "abandoned"])
        .select("id");
      if (updated.error) throw new Error(updated.error.message);
      if ((updated.data?.length ?? 0) > 0) {
        return { ok: true as const, feedbackId: data.feedbackId };
      }
    }

    // Klient sprzed S2 albo wiersz już domknięty: decyzja nie może zginąć,
    // więc trafia do nowego wiersza.
    const inserted = await supabaseAdmin
      .from("retention_feedback")
      .insert({
        tenant_id: sub.tenant_id,
        user_id: context.userId,
        subscription_id: sub.id,
        flow_started_at: new Date().toISOString(),
        offer_accepted: false,
        ...columns,
      })
      .select("id")
      .single();
    if (inserted.error) throw new Error(inserted.error.message);
    return { ok: true as const, feedbackId: inserted.data.id };
  });

// ── acceptRetentionOffer ────────────────────────────────────────────────────

export type AcceptRetentionOfferResult =
  | { ok: true; discountPct: number; discountPeriods: number }
  | {
      ok: false;
      reason: "offer_disabled" | "already_redeemed" | "no_provider" | "provider_error";
    };

export const acceptRetentionOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => acceptSchema.parse(input))
  .handler(async ({ data, context }): Promise<AcceptRetentionOfferResult> => {
    const sub = await loadOwnedSubscription(context.userId, data.subscriptionId);
    if (!sub) throw new Error("subscription_not_found");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Przepływ musi należeć do wołającego i tej subskrypcji. `saved` też
    // przechodzi: ponowienie po zerwanym połączeniu ma dostać ten sam wynik
    // (klucze idempotencji operatora), a nie odmowę.
    const flow = await supabaseAdmin
      .from("retention_feedback")
      .select("id, outcome, offer_accepted")
      .eq("id", data.feedbackId)
      .eq("tenant_id", sub.tenant_id)
      .eq("user_id", context.userId)
      .eq("subscription_id", sub.id)
      .maybeSingle();
    if (flow.error) throw new Error(flow.error.message);
    if (!flow.data || (flow.data.outcome !== "started" && flow.data.outcome !== "saved")) {
      throw new Error("retention_flow_not_found");
    }

    const settings = await loadSettings(sub.tenant_id);
    if (!settings?.enabled || settings.discount_pct <= 0) {
      return { ok: false, reason: "offer_disabled" };
    }
    if (sub.kind !== "provider") return { ok: false, reason: "no_provider" };
    if (!flow.data.offer_accepted && (await redeemedRecently(sub.tenant_id, context.userId))) {
      return { ok: false, reason: "already_redeemed" };
    }

    const [{ applyRetentionOffer }, { getStripeClient, resolveEnvironment }] = await Promise.all([
      import("@/lib/retention/applyOffer.server"),
      import("@/lib/stripe.server"),
    ]);
    // Środowisko z WIERSZA subskrypcji (nie z klienta); produkcja i tak
    // wymusza `live` (`resolveEnvironment`).
    const environment = resolveEnvironment(sub.environment === "live" ? "live" : "sandbox");
    const stripe = await getStripeClient(environment);
    const applied = await applyRetentionOffer(stripe, {
      providerSubscriptionId: sub.provider_subscription_id,
      feedbackId: data.feedbackId,
      terms: { discountPct: settings.discount_pct, discountPeriods: settings.discount_periods },
    });
    if (!applied.ok) {
      console.error("[retention] offer not applied", applied.error, applied.message ?? "");
      return { ok: false, reason: "provider_error" };
    }

    const saved = await supabaseAdmin
      .from("retention_feedback")
      .update({
        ...reasonColumns(data),
        outcome: "saved",
        offer_shown: true,
        offer_accepted: true,
        // Kupon operatora (nie kod do wpisania) - ślad, KTÓRY rabat dopięto.
        coupon_code: applied.couponId,
      })
      .eq("id", data.feedbackId)
      .eq("tenant_id", sub.tenant_id)
      .eq("user_id", context.userId);
    if (saved.error) throw new Error(saved.error.message);

    return {
      ok: true,
      discountPct: settings.discount_pct,
      discountPeriods: settings.discount_periods,
    };
  });
