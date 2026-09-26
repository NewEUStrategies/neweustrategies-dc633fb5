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
import { BILLING_CATALOG, type PlanBillingInterval } from "@/lib/billing/catalog";
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
  /**
   * Cykl wprost z katalogu (`PlanBillingInterval`), nie własne wyliczenie
   * literałów. Lista rozjechała się przy dołożeniu `one_time` (miejsce
   * w Decision Labie): diagnostyka pokazywałaby wtedy katalog niepełny wobec
   * tego, co naprawdę synchronizuje `catalogSync`.
   */
  interval: PlanBillingInterval;
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
  /**
   * Rabat u operatora - `null` oznacza "powstanie przy pierwszym użyciu".
   * Dla kodu liczonego w naszej kasie (`countedAtCheckout`) to AKTYWNA kopia,
   * która nie powinna istnieć - panel każe ją wyłączyć.
   */
  providerDiscountId: string | null;
  /**
   * Kod wydarzenia (`event_ids`) albo kod bez rabatu: liczy go wyłącznie nasza
   * kasa (zakres biletu, rabat od KAŻDEGO miejsca, limit użyć), a synchronizacja
   * go pomija. Bez tej flagi panel obiecywał mu „przy pierwszym użyciu"
   * i podpowiadał synchronizację, która tego kodu nigdy nie wypchnie.
   */
  countedAtCheckout: boolean;
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

/**
 * Twardy warunek dostępu - wszystkie funkcje diagnostyczne go wołają - ORAZ
 * jedyne źródło najemcy dla ich zapytań.
 *
 * PO CO BRAMKA ODDAJE NAJEMCĘ. Gdy zwracała `void`, handler musiał pamiętać
 * o zakresie z własnej głowy, a warstwa danych rozstrzygała go DRUGI RAZ
 * z hosta żądania (`resolveTenantIdForHost`). To były dwie różne granice: rola
 * autoryzowana w obszarze wołającego, dane czytane z obszaru spod domeny.
 * Teraz najemca jest CZĘŚCIĄ WYNIKU bramki - zapytanie spod `service_role`
 * nie ma jak zapomnieć o `.eq("tenant_id", ...)`, bo wartość leży tuż obok.
 *
 * Najemca pochodzi z PROFILU wołającego, czyli dokładnie z tej płaszczyzny, po
 * której autoryzuje `has_role()` (`current_tenant_id()` czyta to samo pole).
 * Host żądania jest wyłącznie kontrolą spójności - patrz
 * `src/lib/server/callerTenant.server.ts`.
 *
 * Kolejność jest wiążąca: rola PRZED rozwiązaniem najemcy. Inaczej zwykły
 * zalogowany dotykałby bazy, zanim dostanie odmowę.
 */
export async function assertAdmin(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{ tenantId: string }> {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (data !== true) throw new Error("forbidden");
  const { assertCallerTenantMatchesHost } = await import("@/lib/server/callerTenant.server");
  return { tenantId: await assertCallerTenantMatchesHost(supabase, userId) };
}

/**
 * Alias zgodnościowy dla wołających, którzy jawnie proszą o najemcę.
 * Po ujednoliceniu `assertAdmin` sam go oddaje, więc obie nazwy znaczą JEDNO
 * i to samo - osobna implementacja byłaby drugim źródłem prawdy, czyli
 * dokładnie tym, co ta zmiana likwiduje.
 */
export async function assertAdminWithTenant(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{ tenantId: string }> {
  return assertAdmin(supabase, userId);
}

async function readDestinations(env: StripeEnv) {
  const { getStripeClient } = await import("@/lib/stripe.server");
  try {
    const stripe = await getStripeClient(env);
    const result = await stripe.webhookEndpoints.list({ limit: 100 });
    return result.data.map((d) => ({
      id: d.id,
      url: d.url ?? "",
      active: d.status === "enabled",
      events: Array.isArray(d.enabled_events) ? d.enabled_events.length : 0,
    }));
  } catch (e) {
    console.error("[payments] destinations lookup failed", e);
    return [];
  }
}

async function readCatalog(env: StripeEnv): Promise<CatalogPriceStatus[]> {
  const { getStripeClient } = await import("@/lib/stripe.server");
  const { resolvePricesByLookupKeys } = await import("@/lib/billing/adhocCheckout.server");
  const results: CatalogPriceStatus[] = [];
  try {
    const stripe = await getStripeClient(env);
    const priceByLookupKey = await resolvePricesByLookupKeys(
      stripe,
      BILLING_CATALOG.map((entry) => entry.priceId),
    );
    for (const entry of BILLING_CATALOG) {
      results.push({
        priceId: entry.priceId,
        productId: entry.productId,
        tierKey: entry.tierKey,
        interval: entry.interval,
        providerPriceId: priceByLookupKey.get(entry.priceId)?.id ?? null,
      });
    }
  } catch (e) {
    console.error("[payments] catalog probe failed", e);
    for (const entry of BILLING_CATALOG) {
      results.push({
        priceId: entry.priceId,
        productId: entry.productId,
        tierKey: entry.tierKey,
        interval: entry.interval,
        providerPriceId: null,
      });
    }
  }
  return results;
}

/**
 * Kod promocyjny operatora o danej treści. `activeOnly` pyta wyłącznie
 * o AKTYWNE - tak szukamy kopii kodu, który do operatora trafiać nie powinien:
 * kopia już wyłączona nie jest problemem i nie może świecić na czerwono.
 */
async function findPromotionCodeByCode(
  env: StripeEnv,
  code: string,
  activeOnly = false,
): Promise<string | null> {
  const { getStripeClient } = await import("@/lib/stripe.server");
  const stripe = await getStripeClient(env);
  const result = await stripe.promotionCodes.list({
    code,
    limit: 1,
    ...(activeOnly ? { active: true } : {}),
  });
  return result.data[0]?.id ?? null;
}

/**
 * Kod liczony wyłącznie w naszej kasie: kod wydarzenia albo kod bez rabatu.
 * Jedna reguła dla tabeli diagnostyki i dla synchronizacji - dwie kopie tego
 * warunku to tabela, która mówi „zsynchronizuj", i przycisk, który pomija.
 */
function countedAtCheckout(row: {
  event_ids?: string[] | null;
  applies_discount?: boolean | null;
}): boolean {
  return (row.event_ids ?? []).length > 0 || row.applies_discount === false;
}

/**
 * Tabela kuponów - ZAWSZE w zakresie najemcy admina. Klient serwisowy omija
 * RLS, więc bez `.eq("tenant_id", ...)` admin najemcy A oglądał kody
 * wszystkich najemców (i pytał o nie operatora).
 */
async function readCoupons(env: StripeEnv, tenantId: string): Promise<CouponDiscountStatus[]> {
  const supabase = await admin();
  const { data } = await supabase
    .from("b2b_coupons")
    .select(
      "code, active, discount_kind, discount_percent, discount_cents, currency, valid_from, valid_until, max_redemptions, redemptions_count, grants_tier_key, grants_duration_days, event_ids, applies_discount",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(50);

  const rows: CouponDiscountStatus[] = [];
  for (const c of data ?? []) {
    const code = String(c.code ?? "").toUpperCase();
    const local = countedAtCheckout(c);
    const providerDiscountId = code
      ? await findPromotionCodeByCode(env, code, local).catch(() => null)
      : null;
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
      countedAtCheckout: local,
    });
  }
  return rows;
}

/**
 * Kondycja dziennika webhookow - ZAWSZE w zakresie jednego najemcy.
 *
 * Klient jest serwisowy, wiec omija RLS: bez jawnego `.eq("tenant_id", ...)`
 * kontrolki `webhook_failures` i `webhook_traffic` liczyly ruch wszystkich
 * obszarow roboczych, a `lastEventAt` oddawal znacznik cudzego zdarzenia.
 */
async function readWebhookHealth(env: StripeEnv, tenantId: string): Promise<WebhookHealth> {
  const supabase = await admin();
  const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const { data } = await supabase
    .from("payment_webhook_events")
    .select("status, created_at, duration_ms")
    .eq("tenant_id", tenantId)
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

/**
 * Pełny raport diagnostyczny dla wskazanego środowiska I NAJEMCY.
 *
 * `tenantId` jest parametrem WYMAGANYM, bo jedyny bezpieczny sposób jego
 * podania to wynik bramki `assertAdminWithTenant` w warstwie server fn -
 * parametr opcjonalny zamieniłby pominięcie zakresu w cichy wyciek.
 */
export async function buildPaymentsDiagnostics(
  env: StripeEnv,
  tenantId: string,
): Promise<PaymentsDiagnostics> {
  const { paymentsConfiguredServer } = await import("@/lib/billing/mockMode.server");
  const configured = paymentsConfiguredServer();

  const [destinations, catalog, coupons, webhooks] = await Promise.all([
    configured ? readDestinations(env) : Promise.resolve([]),
    configured ? readCatalog(env) : Promise.resolve([]),
    readCoupons(env, tenantId),
    readWebhookHealth(env, tenantId),
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
 *
 * TYLKO KUPONY NAJEMCY ADMINA. Klient serwisowy omija RLS, więc bez filtra
 * admin najemcy A wypychał do operatora kody WSZYSTKICH najemców.
 *
 * KODY WYDARZEŃ NIE JADĄ DO OPERATORA. Kod ze studia wydarzenia (`event_ids`)
 * liczy nasza kasa: zakres wydarzenia i biletu, rabat kwotowy od KAŻDEGO
 * miejsca, limit użyć i wiersz realizacji. Jego kopia w Stripe była
 * rabatem `amount_off` zdejmowanym RAZ z całej sesji - dokładnie „kod
 * odejmuje się raz od całego zamówienia" - i bez śladu w bazie. Kod bez
 * rabatu (`applies_discount = false`, tylko odsłania bilety) nie ma czego
 * wypychać: jego kopia byłaby rabatem zero albo - przy braku kwot - 100%.
 *
 * FILTR SIEDZI W ZAPYTANIU, nie tylko w pętli: `limit(200)` liczy się PO nim,
 * więc najemca z setką kodów wydarzeń nie wypycha już kodów ogólnych poza
 * okno synchronizacji. Pętla powtarza tę samą regułę (`countedAtCheckout`)
 * jako bezpiecznik - kopia kodu wydarzenia u operatora to dokładnie ten błąd.
 *
 * KOPII WYPCHNIĘTYCH WCZEŚNIEJ ta funkcja NIE wyłącza: operator trzyma jedną
 * przestrzeń kodów dla wszystkich najemców, a kod o tej samej treści może być
 * u innego najemcy kodem ogólnym. Tabela diagnostyki pokazuje aktywną kopię,
 * a wyłączenie opisuje notatka operacyjna
 * (`docs/WDROZENIE_KOD_KWOTOWY_NA_BILET_2026-09-26.md`).
 */
export async function syncCouponDiscounts(
  env: StripeEnv,
  tenantId: string,
): Promise<{ created: number; existing: number; failed: number }> {
  const supabase = await admin();
  const { data } = await supabase
    .from("b2b_coupons")
    .select(
      "code, discount_kind, discount_percent, discount_cents, currency, valid_until, max_redemptions, event_ids, applies_discount",
    )
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .eq("applies_discount", true)
    // `event_ids` jest NOT NULL z domyślną pustą tablicą - kod ogólny to `{}`.
    .filter("event_ids", "eq", "{}")
    .limit(200);

  const { getStripeClient } = await import("@/lib/stripe.server");
  const { stripeCouponName } = await import("@/lib/billing/adhocCheckout.server");
  const stripe = await getStripeClient(env);

  let created = 0;
  let existing = 0;
  let failed = 0;
  for (const row of data ?? []) {
    const code = String(row.code ?? "").toUpperCase();
    if (!code) continue;
    if (countedAtCheckout(row)) continue;
    try {
      const found = await findPromotionCodeByCode(env, code);
      if (found) {
        existing += 1;
        continue;
      }
      const isPercent = row.discount_kind !== "fixed";
      const coupon = await stripe.coupons.create({
        name: stripeCouponName(code),
        duration: "once",
        ...(isPercent
          ? { percent_off: row.discount_percent ?? 0 }
          : {
              amount_off: Math.max(0, row.discount_cents ?? 0),
              currency: (row.currency ?? "PLN").toLowerCase(),
            }),
      });
      await stripe.promotionCodes.create({
        // API dahlia: kupon podpinamy przez obiekt `promotion`, nie płaskie `coupon`.
        promotion: { type: "coupon", coupon: coupon.id },
        code,
        ...(row.valid_until
          ? { expires_at: Math.floor(new Date(row.valid_until).getTime() / 1000) }
          : {}),
        ...(row.max_redemptions ? { max_redemptions: row.max_redemptions } : {}),
      });
      created += 1;
    } catch (e) {
      console.error("[payments] coupon sync failed", code, e);
      failed += 1;
    }
  }
  return { created, existing, failed };
}
