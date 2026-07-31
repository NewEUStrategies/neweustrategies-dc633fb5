// Publiczne statystyki darowizn dla widgetu CMS builder.
//
// Same wpłaty są zbierane w zewnętrznym serwisie zbiórkowym (zrzutka.pl,
// patrz donationsExternal.ts) - serwis NIE tworzy transakcji darowizn
// u operatora płatności (wymóg AUP Paddle). Tabela public.donations pozostaje
// rejestrem historycznych wpłat i wpisów dodawanych przez administrację;
// widget czyta z niej wyłącznie zagregowane sumy.
import { createServerFn } from "@tanstack/react-start";

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
