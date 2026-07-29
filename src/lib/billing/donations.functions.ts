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
//   - dostawca: transakcja ad-hoc z `custom_data.kind=donation`, a po jej
//     opłaceniu webhook (oneTimeFulfilment) robi INSERT do public.donations
//     idempotentnie po identyfikatorze transakcji,
//   - mock (brak konfiguracji dostawcy): INSERT bezpośrednio tutaj.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import {
  donationInputSchema,
  donationStatusInputSchema,
} from "@/lib/billing/donations.schema";

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
  .validator((input: unknown) => donationInputSchema.parse(input))
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
        ? "Donation - New European Strategies"
        : "Darowizna - New European Strategies";
    const message = data.message?.trim() ? data.message.trim() : null;

    const { paymentsConfiguredServer } = await import("@/lib/billing/mockMode.server");
    if (paymentsConfiguredServer()) {
      // Kwota jest dowolna (darczyńca ją wybiera), więc katalog cen nic tu nie
      // daje - tworzymy transakcję z ceną osadzoną i otwieramy nakładkę po
      // identyfikatorze transakcji. Kwota jest ponownie walidowana schematem
      // po stronie serwera, klient nie ustala niczego innego.
      const { createAdhocTransaction, resolveEnvironment } = await import(
        "@/lib/billing/paddleTransaction.server"
      );
      const created = await createAdhocTransaction({
        environment: resolveEnvironment(data.environment),
        product: "donation",
        name: label,
        amountCents: data.amount_cents,
        currency: data.currency,
        quantity: 1,
        customData: {
          kind: "donation",
          tenant_id: hostTenantId,
          // Język formularza - webhook wysyła podziękowanie w tym samym języku.
          lang: data.lang,
          ...(donorUserId ? { user_id: donorUserId } : {}),
          ...(message ? { message: message.slice(0, 480) } : {}),
        },
      });
      if (!created.ok) {
        console.error("[donations] transaction failed", created.error);
        return { ok: false as const, error: "provider_failed" as const };
      }
      return {
        ok: true as const,
        mode: "paddle" as const,
        transactionId: created.transactionId,
      };
    }

    // Tryb mock (dev bez dostawcy): zapis od razu, żeby lejek dało się
    // przetestować. Fail-closed na produkcji (ten sam bezpiecznik co checkout) -
    // darowizna "mock" w realnym serwisie fałszowałaby statystyki i księgowość.
    const { mockCheckoutAllowed } = await import("@/lib/billing/mockMode.server");
    if (!mockCheckoutAllowed()) {
      console.error("[donations] billing unconfigured: refusing mock donation in production");
      return { ok: false as const, error: "billing_unconfigured" as const };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("donations").insert({
      tenant_id: hostTenantId,
      amount_cents: data.amount_cents,
      currency: data.currency,
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

/**
 * Status transakcji darowizny u operatora - zasila stronę podziękowania po
 * powrocie z nakładki płatności.
 *
 * Publiczny odczyt bez logowania (darczyńca może być anonimowy), więc
 * ujawniamy WYŁĄCZNIE dane, które płacący i tak właśnie widział: status,
 * kwotę i walutę. Bez adresu e-mail, danych klienta i wiadomości. Identyfikator
 * transakcji jest nieodgadywalny (`txn_` + ULID), a odczyt jest limitowany.
 */
export const getDonationTransactionStatus = createServerFn({ method: "GET" })
  .validator((input: unknown) => donationStatusInputSchema.parse(input))
  .handler(async ({ data }) => {
    const { rateLimit } = await import("@/lib/server/rate-limit.server");
    const ok = await rateLimit({
      scope: "donation.status",
      subjectId: data.transaction_id,
      max: 30,
      windowMinutes: 10,
    });
    if (!ok) throw new Error("rate_limited");

    const [{ gatewayFetch }, { resolveEnvironment }] = await Promise.all([
      import("@/lib/paddle.server"),
      import("@/lib/billing/paddleTransaction.server"),
    ]);
    try {
      const res = await gatewayFetch(
        resolveEnvironment(data.environment),
        `/transactions/${encodeURIComponent(data.transaction_id)}`,
      );
      if (!res.ok) {
        console.error("[donations] status lookup failed", res.status);
        return { ok: false as const, error: "not_found" as const };
      }
      const json = (await res.json()) as {
        data?: {
          status?: string;
          currency_code?: string;
          details?: { totals?: { grand_total?: string } };
        };
      };
      const txn = json.data;
      if (!txn?.status) return { ok: false as const, error: "not_found" as const };
      const grandTotal = Number(txn.details?.totals?.grand_total ?? NaN);
      return {
        ok: true as const,
        status: txn.status,
        amountCents: Number.isFinite(grandTotal) ? grandTotal : null,
        currency: txn.currency_code ?? null,
      };
    } catch (e) {
      console.error("[donations] status lookup threw", e);
      return { ok: false as const, error: "provider_failed" as const };
    }
  });
