// Publiczne statystyki darowizn dla widgetu CMS builder.
//
// Same wpłaty są zbierane w zewnętrznym serwisie zbiórkowym (zrzutka.pl,
// patrz donationsExternal.ts) - serwis NIE tworzy transakcji darowizn
// u operatora płatności (wymóg AUP Paddle). Tabela public.donations pozostaje
// rejestrem historycznych wpłat i wpisów dodawanych przez administrację;
// widget czyta z niej wyłącznie zagregowane sumy.
import { createServerFn } from "@tanstack/react-start";
import { normalizeCheckoutLocale, type CheckoutLocale } from "@/lib/billing/checkoutLocale";

/**
 * Publiczne, zagregowane statystyki darowizn dla widgetu CMS builder.
 * NIE wystawia PII (donor_email, message) - tylko sumy i historyczne kwoty
 * ostatnich N pozycji. Odczyt service-role (RLS na tabeli nie dopuszcza anona);
 * skopowane do tenantu hosta, tylko status='paid'. Cache 60s.
 */
export const getDonationsPublicStats = createServerFn({ method: "GET" }).handler(async () => {
  const [{ resolveTenantIdForHost }, { currentTenantHost }, { supabaseAdmin }] = await Promise.all([
    import("@/lib/server/tenant.server"),
    import("@/lib/http/requestHost"),
    import("@/integrations/supabase/client.server"),
  ]);
  const tenantId = await resolveTenantIdForHost(await currentTenantHost());
  if (!tenantId) {
    return {
      totalCents: 0,
      monthCents: 0,
      count: 0,
      monthCount: 0,
      currency: "PLN",
      recent: [] as { amount_cents: number; currency: string; created_at: string }[],
    };
  }

  // Data początku bieżącego miesiąca w UTC.
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  const { data, error } = await supabaseAdmin
    .from("donations")
    .select("amount_cents,currency,created_at")
    .eq("tenant_id", tenantId)
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) {
    console.error("[donations] public stats failed", error);
    return {
      totalCents: 0,
      monthCents: 0,
      count: 0,
      monthCount: 0,
      currency: "PLN",
      recent: [] as { amount_cents: number; currency: string; created_at: string }[],
    };
  }

  const rows = data ?? [];
  let totalCents = 0;
  let monthCents = 0;
  let monthCount = 0;
  for (const r of rows) {
    totalCents += r.amount_cents;
    if (r.created_at >= monthStart) {
      monthCents += r.amount_cents;
      monthCount += 1;
    }
  }
  const currency = rows[0]?.currency ?? "PLN";
  const recent = rows.slice(0, 5).map((r) => ({
    amount_cents: r.amount_cents,
    currency: r.currency,
    created_at: r.created_at,
  }));

  return {
    totalCents,
    monthCents,
    count: rows.length,
    monthCount,
    currency,
    recent,
  };
});

/** Publiczna konfiguracja darowizn dla formularza i CTA (bez sekretów). */
export const getDonationsConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { loadDonationsConfig } = await import("@/lib/billing/donations.server");
  return loadDonationsConfig();
});

export interface DonationCheckoutInput {
  environment: "sandbox" | "live";
  amountCents: number;
  recurring: boolean;
  donorEmail?: string;
  message?: string;
  returnUrl: string;
  locale?: CheckoutLocale;
}

/**
 * Otwiera sesję Stripe Embedded Checkout dla darowizny. Endpoint jest publiczny
 * (wpłata nie wymaga konta), więc kwota, waluta i limity są walidowane
 * WYŁĄCZNIE po stronie serwera, a próby są limitowane per IP.
 */
export const createDonationCheckout = createServerFn({ method: "POST" })
  .inputValidator((data: DonationCheckoutInput) => {
    if (data.environment !== "sandbox" && data.environment !== "live") {
      throw new Error("invalid_environment");
    }
    if (!Number.isFinite(data.amountCents)) throw new Error("invalid_amount");
    if (typeof data.returnUrl !== "string" || !data.returnUrl.startsWith("http")) {
      throw new Error("invalid_return_url");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const [{ getRequest }, { createDonationSession }] = await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/lib/billing/donations.server"),
    ]);

    let rateKey = "unknown-ip";
    try {
      const req = getRequest();
      const fwd = req.headers.get("x-forwarded-for");
      rateKey =
        req.headers.get("cf-connecting-ip") ??
        (fwd ? (fwd.split(",")[0]?.trim() ?? "unknown-ip") : "unknown-ip");
    } catch {
      /* brak kontekstu HTTP - wspólny kubełek limitu */
    }

    return createDonationSession({
      environment: data.environment,
      amountCents: data.amountCents,
      recurring: Boolean(data.recurring),
      donorEmail: data.donorEmail ?? null,
      message: data.message ?? null,
      returnUrl: data.returnUrl,
      locale: normalizeCheckoutLocale(data.locale),
      rateKey,
    });
  });
