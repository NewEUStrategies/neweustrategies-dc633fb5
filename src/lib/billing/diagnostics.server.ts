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
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import type { Database } from "@/integrations/supabase/types";
import { mapWithConcurrency } from "@/lib/async/pool";
import { BILLING_CATALOG, type PlanBillingInterval } from "@/lib/billing/catalog";
import { planCheckoutPricing } from "@/lib/billing/planPricing";
import { STRIPE_WEBHOOK_EVENT_TYPES } from "@/lib/billing/stripeEventTypes";
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

export interface WebhookDestination {
  id: string;
  url: string;
  active: boolean;
  /** Liczba włączonych typów zdarzeń (`*` liczy się jako jeden wpis). */
  events: number;
  /** Obsługiwane typy zdarzeń, których ten odbiornik nie subskrybuje. */
  missingEvents: string[];
}

export interface PaymentsDiagnostics {
  environment: StripeEnv;
  checks: DiagnosticCheck[];
  catalog: CatalogPriceStatus[];
  coupons: CouponDiscountStatus[];
  webhooks: WebhookHealth;
  destinations: WebhookDestination[];
  /**
   * Typy z `STRIPE_WEBHOOK_EVENT_TYPES`, których NIE włączył odbiornik naszej
   * aplikacji. Zdarzenie spoza subskrypcji nie przychodzi wcale - a brak
   * `checkout.session.expired` to rezerwacje kuponów, które nigdy nie wracają
   * do puli, brak `charge.dispute.closed` to dostęp, którego wygrany spór
   * nie przywraca. Panel pokazuje listę jako ostrzeżenie do poprawienia
   * w panelu operatora.
   */
  missingWebhookEvents: string[];
}

/** Ścieżka odbiornika zdarzeń aplikacji - po niej rozpoznajemy NASZ odbiornik. */
const APP_WEBHOOK_PATH = "/api/public/payments/webhook";

/**
 * Obsługiwane typy zdarzeń, których odbiornik nie subskrybuje. `*` u operatora
 * znaczy „wszystkie zdarzenia", więc niczego wtedy nie brakuje.
 */
export function missingWebhookEventTypes(enabledEvents: readonly string[]): string[] {
  if (enabledEvents.includes("*")) return [];
  const enabled = new Set(enabledEvents);
  return STRIPE_WEBHOOK_EVENT_TYPES.filter((type) => !enabled.has(type));
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
 * Bramka narzędzi, które ODTWARZAJĄ zdarzenia operatora albo czytają dziennik
 * webhooków: rola `super_admin` w obszarze wołającego, potem najemca z jego
 * profilu (skonfrontowany z hostem żądania) - kolejność jak w `assertAdmin`.
 *
 * Poprzeczka odtwarza politykę RLS dziennika - „payment_webhook_events admin
 * read" to `USING (tenant_id = current_tenant_id() AND is_super_admin())` -
 * bo ścieżki serwerowe czytają go spod `service_role`, z pominięciem RLS.
 * JEDNA bramka dla ponowienia z dziennika (`webhookRetry.functions`) i dla
 * uzgadniania (`reconcile.functions`): wcześniej uzgadnianie, które czyta ten
 * sam dziennik i odtwarza zdarzenie tą samą ścieżką, stało o szczebel niżej
 * (`admin`) - audyt wyd. 12, 16.8.
 *
 * Fail-closed: `null` z RPC (brak wiersza roli, brak grantu na funkcję) ani
 * żadna wartość prawdziwa-ale-nie-`true` nie przechodzi jako zgoda. Nie ma
 * gałęzi „super admin widzi wszystko": `is_super_admin()` w bazie samo jest
 * zawężone do `current_tenant_id()`.
 */
export async function assertSuperAdmin(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{ tenantId: string }> {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "super_admin",
  });
  if (error || data !== true) throw new Error("forbidden");
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

async function readDestinations(env: StripeEnv): Promise<WebhookDestination[]> {
  const { getStripeClient } = await import("@/lib/stripe.server");
  try {
    const stripe = await getStripeClient(env);
    const result = await stripe.webhookEndpoints.list({ limit: 100 });
    return result.data.map((d) => {
      const enabledEvents: string[] = Array.isArray(d.enabled_events) ? d.enabled_events : [];
      return {
        id: d.id,
        url: d.url ?? "",
        active: d.status === "enabled",
        events: enabledEvents.length,
        missingEvents: missingWebhookEventTypes(enabledEvents),
      };
    });
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
 * Ile zapytań o kod promocyjny naraz. Piaskownica operatora przyjmuje około
 * 25 odczytów na sekundę - pięć torów po kilkaset milisekund zostaje wyraźnie
 * poniżej, a 50 kodów tabeli to dziesięć „rund" zamiast pięćdziesięciu.
 */
const COUPON_LOOKUP_CONCURRENCY = 5;

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

  // Operator pytany o każdy kod - do `COUPON_LOOKUP_CONCURRENCY` naraz zamiast
  // po kolei (50 sekwencyjnych żądań przez bramkę to kilkanaście sekund
  // diagnostyki). Kolejność wyniku = kolejność tabeli.
  return mapWithConcurrency(data ?? [], COUPON_LOOKUP_CONCURRENCY, async (c) => {
    const code = String(c.code ?? "").toUpperCase();
    const local = countedAtCheckout(c);
    const providerDiscountId = code
      ? await findPromotionCodeByCode(env, code, local).catch(() => null)
      : null;
    return {
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
    } satisfies CouponDiscountStatus;
  });
}

/** Kondycja dziennika, którego nie udało się przeczytać - same zera. */
const UNREAD_WEBHOOK_HEALTH: WebhookHealth = {
  total: 0,
  processed: 0,
  skipped: 0,
  failed: 0,
  received: 0,
  lastEventAt: null,
  avgDurationMs: null,
};

/** Szczegół kontroli dziennika, gdy odczyt się nie udał. */
const WEBHOOK_READ_FAILED = "read_failed";

/**
 * Kondycja dziennika webhookow - ZAWSZE w zakresie jednego najemcy.
 *
 * Klient jest serwisowy, wiec omija RLS: bez jawnego `.eq("tenant_id", ...)`
 * kontrolki `webhook_failures` i `webhook_traffic` liczyly ruch wszystkich
 * obszarow roboczych, a `lastEventAt` oddawal znacznik cudzego zdarzenia.
 *
 * `null` = odczyt się NIE udał. Dawniej błąd był połykany, a pusty wynik
 * liczył się jak „zero zdarzeń": `webhook_failures` świeciło zielono („0/0")
 * dokładnie wtedy, gdy diagnostyka nie widziała ani jednego zdarzenia.
 */
async function readWebhookHealth(env: StripeEnv, tenantId: string): Promise<WebhookHealth | null> {
  const supabase = await admin();
  const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const { data, error } = await supabase
    .from("payment_webhook_events")
    .select("status, created_at, duration_ms")
    .eq("tenant_id", tenantId)
    .eq("environment", env)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) {
    console.error("[payments] webhook log health read failed", error.message);
    return null;
  }

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

  const [destinations, catalog, coupons, webhooksRead] = await Promise.all([
    configured ? readDestinations(env) : Promise.resolve([]),
    configured ? readCatalog(env) : Promise.resolve([]),
    readCoupons(env, tenantId),
    readWebhookHealth(env, tenantId),
  ]);
  const webhooks = webhooksRead ?? UNREAD_WEBHOOK_HEALTH;

  const missingPrices = catalog.filter((c) => !c.providerPriceId);
  const appEndpoints = destinations.filter((d) => d.url.includes(APP_WEBHOOK_PATH));
  // Aktywny odbiornik ma pierwszeństwo przed wyłączoną starą kopią tego samego
  // adresu - inaczej kontrola ostrzegałaby przy działającym odbiorze.
  const appEndpoint = appEndpoints.find((d) => d.active) ?? appEndpoints[0];
  // Subskrypcję zdarzeń sprawdzamy na odbiornikach, które faktycznie dostają
  // ruch (aktywne); dopiero gdy żaden nie jest aktywny - na wszystkich naszych,
  // żeby wyłączony odbiornik nie zasłonił braków, które wrócą po włączeniu.
  const activeAppEndpoints = appEndpoints.filter((d) => d.active);
  const eventEndpoints = activeAppEndpoints.length > 0 ? activeAppEndpoints : appEndpoints;
  const missingSet = new Set(eventEndpoints.flatMap((d) => d.missingEvents));
  const missingWebhookEvents = STRIPE_WEBHOOK_EVENT_TYPES.filter((type) => missingSet.has(type));
  const totalEventTypes = STRIPE_WEBHOOK_EVENT_TYPES.length;

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
      // Czy NASZ odbiornik subskrybuje każde obsługiwane zdarzenie. Brak
      // odbiornika to `error` (zdarzenia nie mają dokąd dojść), brakujące typy
      // - ostrzeżenie z listą w `missingWebhookEvents`.
      id: "webhook_events",
      state: !configured
        ? "warn"
        : eventEndpoints.length === 0
          ? "error"
          : missingWebhookEvents.length === 0
            ? "ok"
            : "warn",
      detail:
        eventEndpoints.length === 0
          ? "no_endpoint"
          : `${totalEventTypes - missingWebhookEvents.length}/${totalEventTypes}`,
    },
    {
      id: "catalog",
      state: !configured ? "warn" : missingPrices.length === 0 ? "ok" : "error",
      detail: `${catalog.length - missingPrices.length}/${catalog.length}`,
    },
    // Dziennik nieprzeczytany to `error` OBU kontroli - nie „0/0, w porządku".
    webhooksRead === null
      ? { id: "webhook_failures", state: "error", detail: WEBHOOK_READ_FAILED }
      : {
          id: "webhook_failures",
          state: webhooks.failed === 0 ? "ok" : "error",
          detail: `${webhooks.failed}/${webhooks.total}`,
        },
    webhooksRead === null
      ? { id: "webhook_traffic", state: "error", detail: WEBHOOK_READ_FAILED }
      : {
          id: "webhook_traffic",
          state: webhooks.total > 0 ? "ok" : "warn",
          detail: webhooks.lastEventAt ?? "-",
        },
  ];

  return {
    environment: env,
    checks,
    catalog,
    coupons,
    webhooks,
    destinations,
    missingWebhookEvents,
  };
}

export interface CouponSyncResult {
  created: number;
  existing: number;
  failed: number;
  /**
   * Kody świadomie NIE wypchnięte: najemca bez pola kodu Stripe, kod planowy
   * bez rozwiązanego produktu, kod przed datą startu, po terminie albo
   * z wyczerpanym limitem. Pominięcie nie jest porażką - to bramka.
   */
  skipped: number;
}

/** Wiersz kuponu czytany przez synchronizację. */
interface SyncCouponRow {
  id: string;
  code: string | null;
  discount_kind: string | null;
  discount_percent: number | null;
  discount_cents: number | null;
  currency: string | null;
  valid_from?: string | null;
  valid_until: string | null;
  max_redemptions: number | null;
  redemptions_count?: number | null;
  plan_ids?: string[] | null;
  event_ids?: string[] | null;
  applies_discount?: boolean | null;
}

/**
 * Klucz idempotencji wywołania operatora w synchronizacji: kupon + cel +
 * odcisk PARAMETRÓW. Ponowiony przebieg z tymi samymi parametrami oddaje ten
 * sam obiekt (przerwa między kuponem a kodem nie zostawia drugiego kuponu),
 * a kupon zmieniony w bazie dostaje nowy klucz - Stripe odrzuca klucz użyty
 * ponownie z innymi parametrami.
 */
function syncIdempotencyKey(couponId: string, purpose: string, params: unknown): string {
  const digest = createHash("sha256").update(JSON.stringify(params)).digest("hex").slice(0, 24);
  return `b2b_coupon_sync:${couponId}:${purpose}:${digest}`;
}

/**
 * Produkty operatora dla planów kodu planowego, po identyfikatorze planu.
 *
 * Plan -> wpis katalogu tą samą wyceną, którą liczy kasa (`planCheckoutPricing`),
 * wpis -> cena po `lookup_key` -> jej produkt u operatora. Plan, którego nie
 * da się tak rozwiązać, NIE trafia do mapy - wołający pomija wtedy cały kod
 * (fail-closed: kod bez zawężenia zadziałałby u operatora na każdy produkt).
 */
async function resolvePlanProducts(
  supabase: Awaited<ReturnType<typeof admin>>,
  stripe: Stripe,
  tenantId: string,
  planIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (planIds.length === 0) return out;
  const { data: plans, error } = await supabase
    .from("access_plans")
    .select("id, tier_key, interval")
    .eq("tenant_id", tenantId)
    .in("id", planIds);
  if (error) {
    console.error("[payments] coupon sync: plan lookup failed", error.message);
    return out;
  }
  const lookupByPlan = new Map<string, string>();
  for (const plan of plans ?? []) {
    const entry = planCheckoutPricing(plan)?.entry;
    if (entry) lookupByPlan.set(String(plan.id), entry.priceId);
  }
  if (lookupByPlan.size === 0) return out;
  const { resolvePricesByLookupKeys } = await import("@/lib/billing/adhocCheckout.server");
  const prices = await resolvePricesByLookupKeys(stripe, [...new Set(lookupByPlan.values())]);
  for (const [planId, lookupKey] of lookupByPlan) {
    const product = prices.get(lookupKey)?.product;
    const productId = typeof product === "string" ? product : product?.id;
    if (productId) out.set(planId, productId);
  }
  return out;
}

/**
 * Wypycha aktywne kupony B2B do operatora, żeby rabat istniał zanim ktoś
 * pierwszy raz wpisze kod w nakładce płatności. Operacja jest idempotentna -
 * kod jest kluczem naturalnym po obu stronach, a każde wywołanie zakładające
 * obiekt u operatora niesie klucz idempotencji (`syncIdempotencyKey`).
 *
 * TYLKO KUPONY NAJEMCY ADMINA. Klient serwisowy omija RLS, więc bez filtra
 * admin najemcy A wypychał do operatora kody WSZYSTKICH najemców.
 *
 * TYLKO NAJEMCA Z POLEM KODU STRIPE. Kod promocyjny działa wyłącznie w sesji
 * z `allow_promotion_codes`. Najemca, który pola nie włączył (domyślnie
 * wyłączone - PAY-06), nie ma gdzie kodu przyjąć, a kopia na wspólnym koncie
 * zadziałałaby u KAŻDEGO innego najemcy z włączonym polem. Nic nie wypychamy;
 * kody liczą się jako pominięte.
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
 * CO OPERATOR EGZEKWUJE, A CZEGO NIE. Konto Stripe jest WSPÓLNE dla instalacji,
 * więc kod promocyjny to obietnica szersza niż kupon w bazie. Zawężamy to, co
 * Stripe umie wymusić:
 *   - zakres planów: kod planowy (`plan_ids`) dostaje `applies_to.products`
 *     z produktami cen katalogowych tych planów; plan bez rozwiązanego
 *     produktu = kod pominięty (bez zawężenia działałby na wszystko);
 *   - termin (`expires_at`) i limit użyć (`max_redemptions`, liczony od
 *     użyć, które baza już zarezerwowała);
 *   - metadane `{ source, tenant_id, coupon_id }` na kodzie i kuponie - po nich
 *     realizacja i uzgadnianie rozpoznają, czyj kod zszedł z sesji.
 * Czego Stripe NIE wymusi: zakresu NAJEMCY (produkty katalogu są wspólne, więc
 * kod najemcy A działa w kasie najemcy B z włączonym polem), limitu na osobę
 * (`max_redemptions_per_user`), daty startu (`valid_from` - dlatego kod przed
 * startem po prostu nie jedzie, aż do kolejnej synchronizacji) ani rezerwacji
 * użycia w `b2b_coupon_redemptions` (liczniki bazy i operatora są rozłączne).
 * Siatką bezpieczeństwa jest realizacja zamówienia: kwota sesji niezgodna
 * z zamówieniem (rabat spoza bazy) kończy się flagą do przeglądu, a nie cichym
 * „opłacone".
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
): Promise<CouponSyncResult> {
  const supabase = await admin();
  const { data } = await supabase
    .from("b2b_coupons")
    .select(
      "id, code, discount_kind, discount_percent, discount_cents, currency, valid_from, valid_until, max_redemptions, redemptions_count, plan_ids, event_ids, applies_discount",
    )
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .eq("applies_discount", true)
    // `event_ids` jest NOT NULL z domyślną pustą tablicą - kod ogólny to `{}`.
    .filter("event_ids", "eq", "{}")
    .limit(200);
  const rows = ((data ?? []) as SyncCouponRow[]).filter(
    (row) => String(row.code ?? "") !== "" && !countedAtCheckout(row),
  );

  const result: CouponSyncResult = { created: 0, existing: 0, failed: 0, skipped: 0 };
  if (rows.length === 0) return result;

  // Ustawienia najemcy czytane w JEGO zakresie; awaria odczytu daje domyślne
  // (pole kodu wyłączone), więc kończy się pominięciem, a nie wypchnięciem.
  const { loadCheckoutSettings } = await import("@/lib/billing/checkoutSettings.server");
  const settings = await loadCheckoutSettings(supabase, tenantId);
  if (!settings.allow_promotion_codes) {
    result.skipped = rows.length;
    return result;
  }

  const { getStripeClient } = await import("@/lib/stripe.server");
  const { stripeCouponName } = await import("@/lib/billing/adhocCheckout.server");
  const stripe = await getStripeClient(env);

  const planProducts = await resolvePlanProducts(supabase, stripe, tenantId, [
    ...new Set(rows.flatMap((row) => row.plan_ids ?? [])),
  ]).catch((e: unknown) => {
    console.error("[payments] coupon sync: plan products lookup failed", e);
    return new Map<string, string>();
  });

  const nowMs = Date.now();
  for (const row of rows) {
    const code = String(row.code ?? "").toUpperCase();
    const planIds = row.plan_ids ?? [];
    const products = planIds.map((planId) => planProducts.get(planId));
    if (products.some((productId) => productId === undefined)) {
      console.error("[payments] coupon sync: plan product unresolved, code skipped", code);
      result.skipped += 1;
      continue;
    }
    if (row.valid_from && Date.parse(row.valid_from) > nowMs) {
      result.skipped += 1;
      continue;
    }
    const expiresAt = row.valid_until ? Math.floor(Date.parse(row.valid_until) / 1000) : null;
    if (expiresAt !== null && expiresAt * 1000 <= nowMs) {
      result.skipped += 1;
      continue;
    }
    const remaining =
      row.max_redemptions === null || row.max_redemptions === undefined
        ? null
        : row.max_redemptions - (row.redemptions_count ?? 0);
    if (remaining !== null && remaining <= 0) {
      result.skipped += 1;
      continue;
    }
    try {
      const found = await findPromotionCodeByCode(env, code);
      if (found) {
        result.existing += 1;
        continue;
      }
      const metadata = { source: "b2b_coupon_sync", tenant_id: tenantId, coupon_id: row.id };
      const isPercent = row.discount_kind !== "fixed";
      const productIds = [...new Set(products as string[])];
      const couponParams = {
        name: stripeCouponName(code),
        duration: "once" as const,
        ...(isPercent
          ? { percent_off: row.discount_percent ?? 0 }
          : {
              amount_off: Math.max(0, row.discount_cents ?? 0),
              currency: (row.currency ?? "PLN").toLowerCase(),
            }),
        ...(productIds.length > 0 ? { applies_to: { products: productIds } } : {}),
        metadata,
      };
      const coupon = await stripe.coupons.create(couponParams, {
        idempotencyKey: syncIdempotencyKey(row.id, "coupon", couponParams),
      });
      const promotionParams = {
        // API dahlia: kupon podpinamy przez obiekt `promotion`, nie płaskie `coupon`.
        promotion: { type: "coupon" as const, coupon: coupon.id },
        code,
        ...(expiresAt !== null ? { expires_at: expiresAt } : {}),
        ...(remaining !== null ? { max_redemptions: remaining } : {}),
        metadata,
      };
      await stripe.promotionCodes.create(promotionParams, {
        idempotencyKey: syncIdempotencyKey(row.id, "promotion_code", promotionParams),
      });
      result.created += 1;
    } catch (e) {
      console.error("[payments] coupon sync failed", code, e);
      result.failed += 1;
    }
  }
  return result;
}
