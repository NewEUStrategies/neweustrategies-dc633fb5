// Diagnostyka integracji płatności dla panelu admina.
//
// Zbiera w jednym miejscu to, czego dziś trzeba szukać po trzech ekranach:
// stan konfiguracji bramki, rejestrację odbiornika zdarzeń, kompletność
// katalogu cen, kondycję dziennika webhooków oraz odwzorowanie kuponów B2B
// na rabaty u operatora (kupony żyją w bazie, u operatora powstają leniwie -
// przy pierwszym użyciu kodu w checkoucie).
//
// Moduł server-only: wszystko idzie kluczem serwisowym po jawnym sprawdzeniu
// roli admina w warstwie server fn.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { BILLING_CATALOG } from "@/lib/billing/catalog";
import type { StripeEnv } from "@/lib/stripe.server";

export interface DiagnosticCheck {
  id: string;
  /** Klucz statusu - UI mapuje na kolor i tłumaczenie. */
  state: "ok" | "warn" | "error";
  /** Krótki, czytelny detal (nazwa endpointu, liczba braków itd.). */
  detail: string;
}

export interface CatalogPriceStatus {
  priceId: string;
  productId: string;
  tierKey: string;
  interval: "two_weeks" | "month" | "quarter" | "year";
  providerPriceId: string | null;
}

export interface CouponDiscountStatus {
  code: string;
  active: boolean;
  discountKind: "percent" | "fixed";
  discountPercent: number | null;
  discountCents: number | null;
  currency: string | null;
  validFrom: string | null;
  validUntil: string | null;
  maxRedemptions: number | null;
  timesRedeemed: number;
  /** Warstwa nadawana kuponem i długość nadania (dni) - „na jaki okres". */
  grantsTierKey: string | null;
  grantsDurationDays: number | null;
  /** Rabat u operatora - `null` oznacza "powstanie przy pierwszym użyciu". */
  providerDiscountId: string | null;
}

export interface WebhookHealth {
  total: number;
  processed: number;
  skipped: number;
  failed: number;
  received: number;
  lastEventAt: string | null;
  avgDurationMs: number | null;
}

export interface PaymentsDiagnostics {
  environment: StripeEnv;
  checks: DiagnosticCheck[];
  catalog: CatalogPriceStatus[];
  coupons: CouponDiscountStatus[];
  webhooks: WebhookHealth;
  destinations: Array<{ id: string; url: string; active: boolean; events: number }>;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Twardy warunek dostępu - wszystkie funkcje diagnostyczne go wołają. */
export async function assertAdmin(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (data !== true) throw new Error("forbidden");
}

async function readDestinations(env: StripeEnv) {
  const { gatewayFetch } = await import("@/lib/stripe.server");
  try {
    const res = await gatewayFetch(env, "/notification-settings");
    if (!res.ok) return [];
    const body = (await res.json()) as {
      data?: Array<{
        id: string;
        destination?: string;
        active?: boolean;
        subscribed_events?: unknown[];
      }>;
    };
    return (body.data ?? []).map((d) => ({
      id: d.id,
      url: d.destination ?? "",
      active: d.active !== false,
      events: Array.isArray(d.subscribed_events) ? d.subscribed_events.length : 0,
    }));
  } catch (e) {
    console.error("[payments] destinations lookup failed", e);
    return [];
  }
}

async function readCatalog(env: StripeEnv): Promise<CatalogPriceStatus[]> {
  const { gatewayFetch } = await import("@/lib/stripe.server");
  const results: CatalogPriceStatus[] = [];
  for (const entry of BILLING_CATALOG) {
    let providerPriceId: string | null = null;
    try {
      const res = await gatewayFetch(
        env,
        `/prices?external_id=${encodeURIComponent(entry.priceId)}`,
      );
      if (res.ok) {
        const body = (await res.json()) as { data?: Array<{ id: string }> };
        providerPriceId = body.data?.[0]?.id ?? null;
      }
    } catch (e) {
      console.error("[payments] price probe failed", entry.priceId, e);
    }
    results.push({
      priceId: entry.priceId,
      productId: entry.productId,
      tierKey: entry.tierKey,
      interval: entry.interval,
      providerPriceId,
    });
  }
  return results;
}

async function readCoupons(env: StripeEnv): Promise<CouponDiscountStatus[]> {
  const supabase = await admin();
  const { data } = await supabase
    .from("b2b_coupons")
    .select(
      "code, active, discount_kind, discount_percent, discount_cents, currency, valid_from, valid_until, max_redemptions, redemptions_count, grants_tier_key, grants_duration_days",
    )
    .order("created_at", { ascending: false })
    .limit(50);

  const { findDiscountByCode } = await import("@/lib/billing/paddleDiscounts.server");
  const rows: CouponDiscountStatus[] = [];
  for (const c of data ?? []) {
    const code = String(c.code ?? "").toUpperCase();
    const providerDiscountId = code ? await findDiscountByCode(env, code).catch(() => null) : null;
    rows.push({
      code,
      active: c.active !== false,
      discountKind: c.discount_kind === "fixed" ? "fixed" : "percent",
      discountPercent: c.discount_percent ?? null,
      discountCents: c.discount_cents ?? null,
      currency: c.currency ?? null,
      validFrom: c.valid_from ?? null,
      validUntil: c.valid_until ?? null,
      maxRedemptions: c.max_redemptions ?? null,
      timesRedeemed: c.redemptions_count ?? 0,
      grantsTierKey: c.grants_tier_key ?? null,
      grantsDurationDays: c.grants_duration_days ?? null,
      providerDiscountId,
    });
  }
  return rows;
}

async function readWebhookHealth(env: StripeEnv): Promise<WebhookHealth> {
  const supabase = await admin();
  const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const { data } = await supabase
    .from("payment_webhook_events")
    .select("status, created_at, duration_ms")
    .eq("environment", env)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1000);

  const rows = data ?? [];
  const durations = rows
    .map((r) => r.duration_ms)
    .filter((d): d is number => typeof d === "number" && d >= 0);
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  return {
    total: rows.length,
    processed: count("processed"),
    skipped: count("skipped"),
    failed: count("failed"),
    received: count("received"),
    lastEventAt: (rows[0]?.created_at as string | undefined) ?? null,
    avgDurationMs: durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null,
  };
}

/** Pełny raport diagnostyczny dla wskazanego środowiska. */
export async function buildPaymentsDiagnostics(env: StripeEnv): Promise<PaymentsDiagnostics> {
  const { paymentsConfiguredServer } = await import("@/lib/billing/mockMode.server");
  const configured = paymentsConfiguredServer();

  const [destinations, catalog, coupons, webhooks] = await Promise.all([
    configured ? readDestinations(env) : Promise.resolve([]),
    configured ? readCatalog(env) : Promise.resolve([]),
    readCoupons(env),
    readWebhookHealth(env),
  ]);

  const missingPrices = catalog.filter((c) => !c.providerPriceId);
  const appEndpoint = destinations.find((d) => d.url.includes("/api/public/payments/webhook"));

  const checks: DiagnosticCheck[] = [
    {
      id: "gateway_configured",
      state: configured ? "ok" : "error",
      detail: configured ? env : "missing_keys",
    },
    {
      id: "webhook_endpoint",
      state: !configured ? "warn" : appEndpoint ? (appEndpoint.active ? "ok" : "warn") : "error",
      detail: appEndpoint?.url ?? `${destinations.length}`,
    },
    {
      id: "catalog",
      state: !configured ? "warn" : missingPrices.length === 0 ? "ok" : "error",
      detail: `${catalog.length - missingPrices.length}/${catalog.length}`,
    },
    {
      id: "webhook_failures",
      state: webhooks.failed === 0 ? "ok" : "error",
      detail: `${webhooks.failed}/${webhooks.total}`,
    },
    {
      id: "webhook_traffic",
      state: webhooks.total > 0 ? "ok" : "warn",
      detail: webhooks.lastEventAt ?? "-",
    },
  ];

  return { environment: env, checks, catalog, coupons, webhooks, destinations };
}

/**
 * Wypycha aktywne kupony B2B do operatora, żeby rabat istniał zanim ktoś
 * pierwszy raz wpisze kod w nakładce płatności. Operacja jest idempotentna -
 * kod jest kluczem naturalnym po obu stronach.
 */
export async function syncCouponDiscounts(
  env: StripeEnv,
): Promise<{ created: number; existing: number; failed: number }> {
  const supabase = await admin();
  const { data } = await supabase
    .from("b2b_coupons")
    .select(
      "code, discount_kind, discount_percent, discount_cents, currency, valid_until, max_redemptions",
    )
    .eq("active", true)
    .limit(200);

  const { findDiscountByCode, createDiscount } =
    await import("@/lib/billing/paddleDiscounts.server");

  let created = 0;
  let existing = 0;
  let failed = 0;
  for (const row of data ?? []) {
    const code = String(row.code ?? "").toUpperCase();
    if (!code) continue;
    try {
      const found = await findDiscountByCode(env, code);
      if (found) {
        existing += 1;
        continue;
      }
      const id = await createDiscount(env, code, {
        discount_kind: row.discount_kind === "fixed" ? "fixed" : "percent",
        discount_percent: row.discount_percent ?? null,
        discount_cents: row.discount_cents ?? null,
        currency: row.currency ?? null,
        valid_until: row.valid_until ?? null,
        max_redemptions: row.max_redemptions ?? null,
      });
      if (id) created += 1;
      else failed += 1;
    } catch (e) {
      console.error("[payments] coupon sync failed", code, e);
      failed += 1;
    }
  }
  return { created, existing, failed };
}
