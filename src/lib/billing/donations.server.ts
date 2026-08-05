// Własny system darowizn oparty o Stripe (server-only).
//
// Dwa tryby wpłaty:
//   * jednorazowa  -> Checkout Session `mode: "payment"` z `price_data`,
//   * cykliczna    -> Checkout Session `mode: "subscription"` z `price_data`
//                     i interwałem miesięcznym.
//
// Każda sesja ma odpowiednik w tabeli `donations` (status `pending`), więc
// webhook nie musi zgadywać kontekstu: wystarczy `metadata.donationId`.
// Darowizna nie jest sprzedażą towaru ani usługi, dlatego świadomie NIE
// włączamy tu `managed_payments` ani `automatic_tax` (inaczej niż w checkoucie
// planów i biletów).
import type Stripe from "stripe";
import { createStripeClient, getStripeErrorMessage, type StripeEnv } from "@/lib/stripe.server";
import { normalizeCheckoutLocale, type CheckoutLocale } from "@/lib/billing/checkoutLocale";
import {
  DONATIONS_DEFAULTS,
  DONATIONS_SETTINGS_KEY,
  normalizeDonationAmount,
  parseDonationsConfig,
  usesInternalDonations,
  type DonationsConfig,
} from "@/lib/billing/donationsConfig";

type SessionCreateParams = Parameters<Stripe["checkout"]["sessions"]["create"]>[0];

/**
 * Nazwa pozycji i opis widoczne w formularzu Stripe - ramka nie ma dostępu do
 * naszego i18n, więc treść musi trafić do sesji w języku kupującego.
 */
const DONATION_CHECKOUT_COPY: Record<
  CheckoutLocale,
  Record<"once" | "recurring", { name: string; description: string }>
> = {
  pl: {
    once: {
      name: "Darowizna",
      description: "Wsparcie działalności analitycznej New European Strategies",
    },
    recurring: {
      name: "Darowizna miesięczna",
      description: "Cykliczne wsparcie działalności analitycznej New European Strategies",
    },
  },
  en: {
    once: {
      name: "Donation",
      description: "Support the research work of New European Strategies",
    },
    recurring: {
      name: "Monthly donation",
      description: "Recurring support for the research work of New European Strategies",
    },
  },
};

export interface DonationSessionInput {
  environment: StripeEnv;
  amountCents: number;
  recurring: boolean;
  donorEmail?: string | null;
  donorName?: string | null;
  message?: string | null;
  userId?: string | null;
  returnUrl: string;
  /** Klucz limitu żądań - hash IP albo identyfikator użytkownika. */
  rateKey: string;
  /** Język formularza Stripe (ramka nie dziedziczy naszego i18n). */
  locale?: CheckoutLocale;
}

export type DonationSessionResult =
  | { ok: true; clientSecret: string; donationId: string }
  | { ok: false; error: string };

/** Konfiguracja darowizn z `site_settings` (fallback: wartości domyślne). */
export async function loadDonationsConfig(): Promise<DonationsConfig> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("site_settings")
    .select("value")
    .eq("key", DONATIONS_SETTINGS_KEY)
    .maybeSingle();
  if (error) {
    console.error("[donations] settings read failed", error.message);
    return DONATIONS_DEFAULTS;
  }
  return parseDonationsConfig(data?.value);
}

/**
 * Limit żądań: 10 prób otwarcia checkoutu na 10 minut dla jednego podmiotu.
 * Formularz jest publiczny (darowizna bez konta), więc bez tej bramki byłby
 * darmowym generatorem sesji u operatora.
 */
async function allowDonationAttempt(rateKey: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("rate_limit_hit", {
    _scope: "donation_checkout",
    _subject: rateKey,
    _max: 10,
    _window_minutes: 10,
  });
  if (error) {
    console.error("[donations] rate limit check failed", error.message);
    return true;
  }
  return data?.[0]?.allowed !== false;
}

/** Tworzy sesję darowizny i rejestruje ją jako wpłatę oczekującą. */
export async function createDonationSession(
  input: DonationSessionInput,
): Promise<DonationSessionResult> {
  const config = await loadDonationsConfig();
  if (!usesInternalDonations(config)) return { ok: false, error: "donations_disabled" };
  if (input.recurring && !config.allowRecurring) return { ok: false, error: "recurring_disabled" };

  const amountCents = normalizeDonationAmount(config, input.amountCents);
  if (amountCents === null) return { ok: false, error: "amount_out_of_range" };

  if (!(await allowDonationAttempt(input.rateKey))) return { ok: false, error: "rate_limited" };

  const [{ resolveTenantIdForHost }, { currentTenantHost }, { supabaseAdmin }] = await Promise.all([
    import("@/lib/server/tenant.server"),
    import("@/lib/http/requestHost"),
    import("@/integrations/supabase/client.server"),
  ]);
  const tenantId = await resolveTenantIdForHost(await currentTenantHost());
  if (!tenantId) return { ok: false, error: "tenant_unresolved" };

  const message = config.allowMessage ? (input.message?.trim().slice(0, 500) ?? null) : null;
  const donorEmail = input.donorEmail?.trim().toLowerCase().slice(0, 320) || null;

  const { data: donation, error: insertError } = await supabaseAdmin
    .from("donations")
    .insert({
      tenant_id: tenantId,
      user_id: input.userId ?? null,
      amount_cents: amountCents,
      currency: config.currency,
      donor_email: donorEmail,
      message,
      provider: "stripe",
      provider_session_id: `pending:${crypto.randomUUID()}`,
      status: "pending",
    })
    .select("id")
    .single();
  if (insertError || !donation) {
    console.error("[donations] pending row insert failed", insertError?.message);
    return { ok: false, error: "donation_record_failed" };
  }

  try {
    const stripe = createStripeClient(input.environment);
    const locale = normalizeCheckoutLocale(input.locale);
    const donationCopy = DONATION_CHECKOUT_COPY[locale][input.recurring ? "recurring" : "once"];
    const metadata: Record<string, string> = {
      purpose: "donation",
      donationId: donation.id,
      ...(input.userId ? { userId: input.userId } : {}),
    };

    const params: SessionCreateParams = {
      mode: input.recurring ? "subscription" : "payment",
      ui_mode: "embedded_page",
      locale,
      return_url: input.returnUrl,
      ...(donorEmail ? { customer_email: donorEmail } : {}),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: config.currency.toLowerCase(),
            unit_amount: amountCents,
            ...(input.recurring ? { recurring: { interval: "month" as const } } : {}),
            product_data: {
              name: donationCopy.name,
              description: donationCopy.description,
            },
          },
        },
      ],
      metadata,
      ...(input.recurring
        ? { subscription_data: { metadata } }
        : { payment_intent_data: { description: donationCopy.name, metadata } }),
    };

    const session = await stripe.checkout.sessions.create(params);
    if (!session.client_secret) throw new Error("session_missing_client_secret");

    await supabaseAdmin
      .from("donations")
      .update({ provider_session_id: session.id })
      .eq("id", donation.id);

    return { ok: true, clientSecret: session.client_secret, donationId: donation.id };
  } catch (e) {
    // Sesja nie powstała - kasujemy osierocony wiersz, żeby statystyki nie
    // zbierały pustych „oczekujących" wpłat.
    await supabaseAdmin.from("donations").delete().eq("id", donation.id);
    console.error("[donations] session create failed", e);
    return { ok: false, error: getStripeErrorMessage(e) };
  }
}

export interface DonationSettlement {
  donationId?: string | null;
  sessionId?: string | null;
  intentId?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  donorEmail?: string | null;
}

/**
 * Księguje opłaconą darowiznę (webhook). Idempotentne: wiersz jest odnajdywany
 * po `donationId` z metadanych albo po identyfikatorze sesji, a status ustawiany
 * na `paid` niezależnie od liczby ponowień dostawcy.
 */
export async function settleDonation(settlement: DonationSettlement): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const patch = {
    status: "paid",
    ...(settlement.intentId ? { provider_intent_id: settlement.intentId } : {}),
    ...(settlement.amountCents ? { amount_cents: settlement.amountCents } : {}),
    ...(settlement.currency ? { currency: settlement.currency.toUpperCase() } : {}),
    ...(settlement.donorEmail ? { donor_email: settlement.donorEmail.toLowerCase() } : {}),
  };

  if (settlement.donationId) {
    const { error } = await supabaseAdmin
      .from("donations")
      .update(patch)
      .eq("id", settlement.donationId);
    if (error) throw new Error(`donation settle failed: ${error.message}`);
    return true;
  }

  if (settlement.sessionId) {
    const { error } = await supabaseAdmin
      .from("donations")
      .update(patch)
      .eq("provider_session_id", settlement.sessionId);
    if (error) throw new Error(`donation settle failed: ${error.message}`);
    return true;
  }

  console.warn("[donations] settlement without donationId/sessionId - skipped");
  return false;
}
