// Server fn kanału darowizn / mecenatu (P1 z oceny konkurencyjnej - model
// "mecenatu obywatelskiego" Nowej Konfederacji).
//
// Publiczny endpoint BEZ logowania (darczyńca nie musi mieć konta), więc
// utwardzony jak submitContactMessage: limit per-IP fail-closed przy nieznanym
// IP + kwota walidowana serwerowo (klient nie ustala niczego poza kwotą
// w dozwolonym przedziale - darowizna nie nadaje żadnych uprawnień, więc
// manipulacja kwotą nie daje atakującemu nic).
//
// Darowizny NIE przechodzą przez payment_orders (wymaga user_id i zasila
// grantEntitlement). Ścieżka zapisu:
//   - Stripe: webhook checkout.session.completed z metadata.kind=donation
//     -> INSERT do public.donations (idempotentnie po provider_session_id),
//   - mock (brak klucza Stripe): INSERT bezpośrednio tutaj.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { donationInputSchema } from "@/lib/billing/donations.schema";

/**
 * Best-effort user id z tokenu Bearer żądania. Darowizna nie WYMAGA logowania,
 * więc brak/nieważny token = null (bez rzucania). Gdy token jest ważny, zwraca
 * `sub`, żeby darowizna nadała warstwę wspierającego zalogowanemu darczyńcy.
 */
async function resolveOptionalUserId(): Promise<string | null> {
  try {
    const req = getRequest();
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return null;
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) return null;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return null;
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(url, key, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getClaims(token);
    if (error || !data?.claims?.sub) return null;
    return String(data.claims.sub);
  } catch {
    return null;
  }
}

export const createDonationCheckout = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => donationInputSchema.parse(input))
  .handler(async ({ data }) => {
    // Klient IP z nagłówków proxy (ta sama derywacja co formularz kontaktowy).
    let clientIp: string | null = null;
    try {
      const req = getRequest();
      const fwd = req.headers.get("x-forwarded-for");
      const fwdFirst = fwd ? (fwd.split(",")[0]?.trim() ?? null) : null;
      clientIp = req.headers.get("cf-connecting-ip") ?? fwdFirst ?? req.headers.get("x-real-ip");
    } catch {
      // brak kontekstu HTTP (testy) - wspólny kubełek "unknown-ip" niżej
    }

    // Fail CLOSED na nieznanym IP - zdjęcie nagłówka nie omija limitu.
    const { rateLimit } = await import("@/lib/server/rate-limit.server");
    const ipOk = await rateLimit({
      scope: "donation.checkout",
      subjectId: clientIp ?? "unknown-ip",
      max: 5,
      windowMinutes: 10,
    });
    if (!ipOk) throw new Error("rate_limited");

    // Darowizna jest przypisywana najemcy przeglądanego hosta (jak kontakt).
    const [{ resolveTenantIdForHost }, { currentTenantHost }] = await Promise.all([
      import("@/lib/server/tenant.server"),
      import("@/lib/http/requestHost"),
    ]);
    const hostTenantId = await resolveTenantIdForHost(await currentTenantHost());
    if (!hostTenantId) throw new Error("tenant_unresolved");

    // Opcjonalne powiązanie z zalogowanym darczyńcą: darowizna działa też
    // anonimowo, ale gdy jest ważny token, zapisujemy user_id - trigger
    // donations_grant_supporter nada wtedy warstwę "Wspierający" (12 mies.).
    const donorUserId = await resolveOptionalUserId();

    const label =
      data.lang === "en"
        ? "Donation — New European Strategies"
        : "Darowizna — New European Strategies";
    const message = data.message?.trim() ? data.message.trim() : null;

    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    const origin = process.env.PUBLIC_SITE_URL ?? process.env.SITE_URL ?? process.env.URL ?? "";

    if (stripeSecret && origin) {
      const params = new URLSearchParams();
      params.set("mode", "payment");
      params.set("success_url", `${origin}/support?status=success`);
      params.set("cancel_url", `${origin}/support?status=cancelled`);
      params.set("line_items[0][price_data][currency]", "pln");
      params.set("line_items[0][price_data][unit_amount]", String(data.amount_cents));
      params.set("line_items[0][price_data][product_data][name]", label);
      params.set("line_items[0][quantity]", "1");
      // Rozpoznanie darowizny w webhooku + atrybucja najemcy i nota darczyńcy.
      params.set("metadata[kind]", "donation");
      params.set("metadata[tenant_id]", hostTenantId);
      if (donorUserId) params.set("metadata[user_id]", donorUserId);
      if (message) params.set("metadata[message]", message.slice(0, 480));
      params.set("submit_type", "donate");

      const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeSecret}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        console.error("[donations] stripe session failed", resp.status, txt.slice(0, 200));
        return { ok: false as const, error: "stripe_failed" as const };
      }
      const session = (await resp.json()) as { url: string };
      return { ok: true as const, mode: "stripe" as const, url: session.url };
    }

    // Tryb mock (dev bez Stripe): zapis od razu, żeby lejek dało się testować.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("donations").insert({
      tenant_id: hostTenantId,
      amount_cents: data.amount_cents,
      currency: "PLN",
      message,
      user_id: donorUserId,
      provider: "mock",
      provider_session_id: `mock_${crypto.randomUUID()}`,
    });
    if (error) {
      console.error("[donations] mock insert failed", error);
      return { ok: false as const, error: "mock_failed" as const };
    }
    return { ok: true as const, mode: "mock" as const, url: "/support?status=success&mock=1" };
  });

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

  // Data początku bieżącego miesiąca w UTC (spójne z admin.donations.tsx).
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
