// Jednorazowy link do portalu operatora płatności + wysyłka go mailem.
//
// Portal jest jedynym miejscem, w którym kupujący zmienia metodę płatności,
// pobiera faktury i anuluje subskrypcję. Adresy są jednorazowe i krótkotrwałe,
// więc nie da się ich zapisać na stałe - generujemy je na żądanie
// (użytkownik z profilu albo administrator z panelu) i wysyłamy mailem.
//
// Moduł jest server-only (klucze bramki + service role).
import type { SupabaseClient } from "@supabase/supabase-js";

import type { StripeEnv } from "@/lib/stripe.server";
import { resolveRecipient } from "@/lib/billing/notifications.server";
import { sendTxEmail } from "@/lib/email/transactional.server";

export interface PortalUrls {
  overviewUrl: string;
  updatePaymentMethodUrl: string | null;
  cancelUrl: string | null;
}

export type PortalLinkResult =
  { ok: true; urls: PortalUrls } | { ok: false; error: "no_customer" | "portal_failed" };

/** Najnowsza subskrypcja użytkownika w danym środowisku (service role). */
async function latestSubscription(
  supabase: SupabaseClient,
  userId: string,
  environment: StripeEnv,
): Promise<{ customerId: string; subscriptionId: string | null } | null> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("provider_customer_id, provider_subscription_id")
    .eq("user_id", userId)
    .eq("environment", environment)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.provider_customer_id) return null;
  return {
    customerId: data.provider_customer_id as string,
    subscriptionId: (data.provider_subscription_id as string | null) ?? null,
  };
}

/** Tworzy sesję portalu klienta dla wskazanego użytkownika. Nigdy nie rzuca. */
export async function createPortalLinkForUser(
  userId: string,
  environment: StripeEnv,
): Promise<PortalLinkResult> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const supabase = supabaseAdmin as unknown as SupabaseClient;

    const sub = await latestSubscription(supabase, userId, environment);
    if (!sub) return { ok: false, error: "no_customer" };

    const { createStripeClient } = await import("@/lib/stripe.server");
    const stripe = createStripeClient(environment);
    const returnUrl = process.env.PUBLIC_SITE_URL
      ? `${process.env.PUBLIC_SITE_URL}/profil`
      : "https://example.com/profil";
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.customerId,
      return_url: returnUrl,
    });
    // Portal Stripe jest jednym ogólnym adresem (bez osobnych podadresów per
    // akcja jak w Paddle) - użytkownik z niego samodzielnie wybiera anulowanie
    // czy zmianę metody płatności.
    return {
      ok: true,
      urls: {
        overviewUrl: session.url,
        updatePaymentMethodUrl: null,
        cancelUrl: null,
      },
    };
  } catch (err) {
    console.error("[billing] portal session failed", err);
    return { ok: false, error: "portal_failed" };
  }
}

export type PortalEmailResult =
  | { ok: true; email: string }
  | { ok: false; error: "no_customer" | "portal_failed" | "no_recipient" | "send_failed" };

export interface PortalEmailInput {
  userId: string;
  environment: StripeEnv;
  /**
   * Ziarno idempotencji. Administrator wysyłający link ponownie podaje nowe
   * ziarno (znacznik czasu), żeby kolejna wysyłka nie została odrzucona jako
   * duplikat - link w poprzednim mailu jest już zwykle zużyty.
   */
  idempotencySeed: string;
}

/** Wysyła mail z jednorazowym linkiem do portalu klienta. Nigdy nie rzuca. */
export async function sendPortalLinkEmail(input: PortalEmailInput): Promise<PortalEmailResult> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const supabase = supabaseAdmin as unknown as SupabaseClient;

    const recipient = await resolveRecipient(supabase, input.userId);
    if (!recipient) return { ok: false, error: "no_recipient" };

    const link = await createPortalLinkForUser(input.userId, input.environment);
    if (!link.ok) return { ok: false, error: link.error };

    const result = await sendTxEmail({
      type: "customer_portal_link",
      to: recipient.email,
      lang: recipient.lang,
      metaName: recipient.name,
      ctaUrl: link.urls.overviewUrl,
      idempotencyKey: `customer_portal_link:${input.userId}:${input.idempotencySeed}`,
    });
    if (!result.ok) return { ok: false, error: "send_failed" };
    return { ok: true, email: recipient.email };
  } catch (err) {
    console.error("[billing] portal link email failed", err);
    return { ok: false, error: "send_failed" };
  }
}
