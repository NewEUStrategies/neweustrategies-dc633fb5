// Dostęp do bazy akcji „przenieś trwające subskrypcje na cenę katalogu v6.2".
//
// JEDYNE MIEJSCE Z `supabaseAdmin` W TEJ ŚCIEŻCE. Rola serwisowa omija RLS,
// a dziennik `subscription_price_migrations` jest server-only (bez polityk,
// 20261018160000) - więc granicą najemcy jest wyłącznie filtr w zapytaniu.
// Dlatego każde zapytanie niesie `.eq("tenant_id", tenantId)` (odczyt,
// aktualizacja) albo `tenant_id: input.tenantId` w ładunku (upsert), a najemca
// przychodzi WYŁĄCZNIE z sesji admina (`assertCallerTenantMatchesHost`
// w server function), nigdy z ładunku żądania.
//
// Plik leży w `src/lib/server/`, a nie obok orkiestracji w `lib/billing/`:
// bramka `serviceRoleTenantScope.gate.test.ts` skanuje ten katalog i wymaga
// wpisu w rejestrze czytników service-role. To statyczny dowód filtra przy
// każdej zmianie zapytania, a nie obietnica w komentarzu.
import type { RepricingEmailStatus } from "@/lib/billing/subscriptionRepricing";

/** Wiersz lustra `subscriptions` - kandydat do przeniesienia. */
export interface RepricingCandidate {
  id: string;
  user_id: string;
  provider_subscription_id: string;
  price_id: string;
  status: string;
  quantity: number;
}

/** Plan najemcy w kształcie potrzebnym do kontroli ceny docelowej i maila. */
export interface RepricingTenantPlan {
  id: string;
  tier_key: string | null;
  interval: string | null;
  price_cents: number | null;
  currency: string | null;
  active: boolean | null;
  volume_threshold_seats: number | null;
  volume_price_cents: number | null;
  sort_order: number | null;
  created_at: string | null;
  name_pl: string | null;
  name_en: string | null;
  description_pl: string | null;
  trial_days: number | null;
}

export interface RepricingLogRow {
  id: string;
  provider_subscription_id: string;
  to_provider_price_id: string;
  from_provider_price_id: string;
  status: "applied" | "skipped" | "failed";
  reason: string | null;
  attempts: number;
  email_status: Exclude<RepricingEmailStatus, null>;
  lookup_key: string;
  quantity: number;
  currency: string;
  billing_interval: string;
  from_amount_cents: number;
  to_amount_cents: number;
  effective_at: string | null;
  applied_at: string | null;
  user_id: string | null;
  subscription_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RepricingLogUpsert {
  tenantId: string;
  campaign: string;
  environment: "sandbox" | "live";
  subscriptionId: string | null;
  providerSubscriptionId: string;
  userId: string | null;
  lookupKey: string;
  fromPriceId: string;
  toPriceId: string;
  quantity: number;
  currency: string;
  billingInterval: string;
  fromAmountCents: number;
  toAmountCents: number;
  effectiveAt: string | null;
  status: "applied" | "skipped" | "failed";
  reason: string | null;
  attempts: number;
  appliedAt: string | null;
  emailStatus: Exclude<RepricingEmailStatus, null>;
  actorUserId: string;
}

const LOG_COLUMNS =
  "id, provider_subscription_id, to_provider_price_id, from_provider_price_id, status, reason, attempts, email_status, lookup_key, quantity, currency, billing_interval, from_amount_cents, to_amount_cents, effective_at, applied_at, user_id, subscription_id, created_at, updated_at";

const PLAN_COLUMNS =
  "id, tier_key, interval, price_cents, currency, active, volume_threshold_seats, volume_price_cents, sort_order, created_at, name_pl, name_en, description_pl, trial_days";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Strona kandydatów: subskrypcje najemcy w środowisku, na cenach objętych
 * kampanią, w statusach rozliczanych. Kursor po `id` - stabilna kolejność,
 * którą przerwany przebieg wznawia bez dubli i bez luk.
 */
export async function listRepricingCandidates(input: {
  tenantId: string;
  environment: "sandbox" | "live";
  lookupKeys: readonly string[];
  statuses: readonly string[];
  cursor: string | null;
  limit: number;
}): Promise<RepricingCandidate[]> {
  const supabase = await admin();
  let query = supabase
    .from("subscriptions")
    .select("id, user_id, provider_subscription_id, price_id, status, quantity")
    .eq("tenant_id", input.tenantId)
    .eq("environment", input.environment)
    .in("price_id", [...input.lookupKeys])
    .in("status", [...input.statuses])
    .order("id", { ascending: true })
    .limit(input.limit);
  if (input.cursor) query = query.gt("id", input.cursor);
  const { data, error } = await query;
  if (error) throw new Error(`repricing: subscriptions lookup failed: ${error.message}`);
  return (data ?? []) as RepricingCandidate[];
}

/** Plany najemcy - źródło kwot v6.2, z którymi musi się zgadzać cena operatora. */
export async function loadRepricingTenantPlans(tenantId: string): Promise<RepricingTenantPlan[]> {
  const supabase = await admin();
  const { data, error } = await supabase
    .from("access_plans")
    .select(PLAN_COLUMNS)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(`repricing: access_plans lookup failed: ${error.message}`);
  return (data ?? []) as RepricingTenantPlan[];
}

/** Wpisy dziennika dla subskrypcji strony (po identyfikatorze operatora). */
export async function loadRepricingLogRows(input: {
  tenantId: string;
  environment: "sandbox" | "live";
  campaign: string;
  providerSubscriptionIds: readonly string[];
}): Promise<RepricingLogRow[]> {
  if (input.providerSubscriptionIds.length === 0) return [];
  const supabase = await admin();
  const { data, error } = await supabase
    .from("subscription_price_migrations")
    .select(LOG_COLUMNS)
    .eq("tenant_id", input.tenantId)
    .eq("environment", input.environment)
    .eq("campaign", input.campaign)
    .in("provider_subscription_id", [...input.providerSubscriptionIds]);
  if (error) throw new Error(`repricing: log lookup failed: ${error.message}`);
  return (data ?? []) as RepricingLogRow[];
}

/**
 * Zapis wyniku dla (środowisko, subskrypcja, cena docelowa) - klucz unikalny
 * tabeli jest pierwszą warstwą idempotencji: powtórka nadpisuje ten sam
 * wiersz zamiast dokładać drugi.
 */
export async function upsertRepricingLogRow(input: RepricingLogUpsert): Promise<void> {
  const supabase = await admin();
  const { error } = await supabase.from("subscription_price_migrations").upsert(
    {
      tenant_id: input.tenantId,
      campaign: input.campaign,
      environment: input.environment,
      subscription_id: input.subscriptionId,
      provider_subscription_id: input.providerSubscriptionId,
      user_id: input.userId,
      lookup_key: input.lookupKey,
      from_provider_price_id: input.fromPriceId,
      to_provider_price_id: input.toPriceId,
      quantity: input.quantity,
      currency: input.currency,
      billing_interval: input.billingInterval,
      from_amount_cents: input.fromAmountCents,
      to_amount_cents: input.toAmountCents,
      effective_at: input.effectiveAt,
      status: input.status,
      reason: input.reason,
      attempts: input.attempts,
      applied_at: input.appliedAt,
      email_status: input.emailStatus,
      actor_user_id: input.actorUserId,
    },
    { onConflict: "environment,provider_subscription_id,to_provider_price_id" },
  );
  if (error) throw new Error(`repricing: log write failed: ${error.message}`);
}

/** Wynik wysyłki maila po przeniesieniu (kolejka transakcyjna). */
export async function updateRepricingEmailStatus(input: {
  tenantId: string;
  environment: "sandbox" | "live";
  providerSubscriptionId: string;
  toPriceId: string;
  emailStatus: Exclude<RepricingEmailStatus, null>;
}): Promise<void> {
  const supabase = await admin();
  const { error } = await supabase
    .from("subscription_price_migrations")
    .update({
      email_status: input.emailStatus,
      email_queued_at: input.emailStatus === "queued" ? new Date().toISOString() : null,
    })
    .eq("tenant_id", input.tenantId)
    .eq("environment", input.environment)
    .eq("provider_subscription_id", input.providerSubscriptionId)
    .eq("to_provider_price_id", input.toPriceId);
  if (error) throw new Error(`repricing: email status write failed: ${error.message}`);
}

/** Dziennik w panelu - najnowsze wpisy najemcy, opcjonalnie po statusie. */
export async function listRepricingLog(input: {
  tenantId: string;
  campaign: string;
  status: "applied" | "skipped" | "failed" | null;
  limit: number;
}): Promise<RepricingLogRow[]> {
  const supabase = await admin();
  let query = supabase
    .from("subscription_price_migrations")
    .select(LOG_COLUMNS)
    .eq("tenant_id", input.tenantId)
    .eq("campaign", input.campaign)
    .order("updated_at", { ascending: false })
    .limit(input.limit);
  if (input.status) query = query.eq("status", input.status);
  const { data, error } = await query;
  if (error) throw new Error(`repricing: log list failed: ${error.message}`);
  return (data ?? []) as RepricingLogRow[];
}
