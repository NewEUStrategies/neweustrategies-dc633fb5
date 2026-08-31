// Automatyczna synchronizacja katalogu po restarcie integracji operatora
// płatności (server-only).
//
// Odcisk integracji liczymy z klucza połączenia bramki - nigdy nie zapisujemy
// samego klucza, tylko skrót SHA-256 (16 znaków hex wystarcza do wykrycia
// zmiany konta). Gdy odcisk różni się od zapisanego w `payment_integration_state`,
// katalog jest odtwarzany, zanim ktokolwiek zdąży trafić na "cena nie istnieje".
import type { Json } from "@/integrations/supabase/types";
import { getConnectionApiKey, type StripeEnv } from "@/lib/stripe.server";

import {
  catalogFingerprintSource,
  resyncReason,
  syncStatusFrom,
  type CatalogFingerprintEntry,
  type IntegrationSyncState,
  type ResyncReason,
} from "./catalogAutoSync";
import { BILLING_CATALOG } from "./catalog";
import type { CatalogSyncReport } from "./catalogSync.server";

export interface AutoSyncOutcome {
  environment: StripeEnv;
  ran: boolean;
  reason: ResyncReason | null;
  report: CatalogSyncReport | null;
  error?: string;
}

export interface IntegrationStateRow extends IntegrationSyncState {
  environment: StripeEnv;
  lastReason: string | null;
  lastError: string | null;
  lastReport: CatalogSyncReport | null;
  fingerprintCurrent: boolean;
  /** Czy zsynchronizowany katalog odpowiada aktualnemu cennikowi w bazie. */
  catalogCurrent: boolean;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Odcisk aktualnego połączenia z operatorem (skrót, nie sekret). */
export async function integrationFingerprint(env: StripeEnv): Promise<string> {
  const key = getConnectionApiKey(env);
  return (await sha256Hex(`${env}:${key}`)).slice(0, 16);
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function readState(env: StripeEnv): Promise<{
  fingerprint: string | null;
  catalogFingerprint: string | null;
  lastSyncedAt: string | null;
  lastStatus: IntegrationSyncState["lastStatus"];
  lastReason: string | null;
  lastError: string | null;
  lastReport: CatalogSyncReport | null;
}> {
  const supabase = await admin();
  const { data } = await supabase
    .from("payment_integration_state")
    .select(
      "fingerprint, catalog_fingerprint, last_synced_at, last_status, last_reason, last_error, last_report",
    )
    .eq("environment", env)
    .maybeSingle();

  return {
    fingerprint: data?.fingerprint ?? null,
    catalogFingerprint: data?.catalog_fingerprint ?? null,
    lastSyncedAt: data?.last_synced_at ?? null,
    lastStatus: (data?.last_status as IntegrationSyncState["lastStatus"]) ?? null,
    lastReason: data?.last_reason ?? null,
    lastError: data?.last_error ?? null,
    lastReport: (data?.last_report as CatalogSyncReport | null) ?? null,
  };
}

interface PlanFingerprintRow {
  tier_key: string | null;
  interval: string | null;
  price_cents: number | null;
  currency: string | null;
  name_pl: string | null;
  name_en: string | null;
  description_pl: string | null;
  trial_days: number | null;
  active: boolean | null;
  volume_threshold_seats: number | null;
  volume_price_cents: number | null;
}

/**
 * Odcisk treści cennika: mapowanie `BILLING_CATALOG` (kod, zmienia się przy
 * wdrożeniu) + wartości z `access_plans` (baza). Dzięki temu pierwsze zdarzenie
 * od operatora po wdrożeniu nowych planów odtwarza katalog samo.
 * Gdy odczyt bazy zawiedzie, zwracamy `null` - brak odcisku nie może wymuszać
 * synchronizacji w kółko.
 */
export async function catalogFingerprint(): Promise<string | null> {
  try {
    const supabase = await admin();
    const { data, error } = await supabase
      .from("access_plans")
      .select(
        "tier_key, interval, price_cents, currency, name_pl, name_en, description_pl, trial_days, active, volume_threshold_seats, volume_price_cents",
      );
    if (error) return null;
    const plans = (data ?? []) as PlanFingerprintRow[];

    const entries: CatalogFingerprintEntry[] = BILLING_CATALOG.map((entry) => {
      const plan =
        plans.find(
          (p) => p.tier_key === entry.tierKey && (p.interval ?? "month") === entry.interval,
        ) ?? plans.find((p) => p.tier_key === entry.tierKey);
      return {
        priceId: entry.priceId,
        productId: entry.productId,
        interval: entry.interval,
        perSeat: entry.perSeat,
        amountCents: plan?.price_cents ?? null,
        currency: plan?.currency ?? null,
        name: plan?.name_pl ?? plan?.name_en ?? null,
        description: plan?.description_pl ?? null,
        trialDays: plan?.trial_days ?? null,
        active: plan?.active !== false && plan !== undefined,
        volumeThresholdSeats: plan?.volume_threshold_seats ?? null,
        volumePriceCents: plan?.volume_price_cents ?? null,
      };
    });

    return (await sha256Hex(catalogFingerprintSource(entries))).slice(0, 16);
  } catch {
    return null;
  }
}

/** Stan integracji dla panelu administracyjnego. */
export async function getIntegrationState(env: StripeEnv): Promise<IntegrationStateRow> {
  const [state, current, catalog] = await Promise.all([
    readState(env),
    integrationFingerprint(env),
    catalogFingerprint(),
  ]);
  return {
    environment: env,
    fingerprint: state.fingerprint,
    catalogFingerprint: state.catalogFingerprint,
    lastSyncedAt: state.lastSyncedAt,
    lastStatus: state.lastStatus,
    lastReason: state.lastReason,
    lastError: state.lastError,
    lastReport: state.lastReport,
    fingerprintCurrent: state.fingerprint === current,
    catalogCurrent: catalog === null || state.catalogFingerprint === catalog,
  };
}

/** Zapis wyniku ręcznej synchronizacji z panelu (odświeża odcisk integracji). */
export async function recordManualSync(env: StripeEnv, report: CatalogSyncReport): Promise<void> {
  const [supabase, state, fingerprint, catalog] = await Promise.all([
    admin(),
    readState(env),
    integrationFingerprint(env),
    catalogFingerprint(),
  ]);
  const status = syncStatusFrom(report);
  await supabase.from("payment_integration_state").upsert(
    {
      environment: env,
      fingerprint,
      // Ta sama reguła, co na ścieżce automatycznej (`runEnsure`): odcisk
      // cennika znaczy „ten cennik jest u operatora wdrożony", więc zapisujemy
      // go WYŁĄCZNIE po pełnym powodzeniu. Zapis bezwarunkowy po częściowej
      // porażce z panelu wyciszał wykrywanie rozjazdu (`catalog_changed`) i
      // utrwalał cenę, która u operatora nie powstała - koszyk pokazywał jedną
      // kwotę, a operator pobierał drugą.
      catalog_fingerprint: status === "ok" ? catalog : state.catalogFingerprint,
      last_synced_at: report.ranAt,
      last_status: status,
      last_reason: "manual",
      last_error: null,
      last_report: JSON.parse(JSON.stringify(report)) as Json,
    },
    { onConflict: "environment" },
  );
  checkedAt.set(env, Date.now());
}

/** Pamięć izolatu: nie pytamy bazy przy każdym zapytaniu o cenę. */
const inFlight = new Map<StripeEnv, Promise<AutoSyncOutcome>>();
const checkedAt = new Map<StripeEnv, number>();
const CHECK_DEBOUNCE_MS = 5 * 60 * 1000;

export function __resetAutoSyncCacheForTests(): void {
  inFlight.clear();
  checkedAt.clear();
}

async function runEnsure(env: StripeEnv, force: boolean): Promise<AutoSyncOutcome> {
  const [state, fingerprint, catalog] = await Promise.all([
    readState(env),
    integrationFingerprint(env),
    catalogFingerprint(),
  ]);
  const reason = force
    ? ("integration_restarted" as ResyncReason)
    : resyncReason({
        ...state,
        currentFingerprint: fingerprint,
        currentCatalogFingerprint: catalog,
      });

  if (!reason) return { environment: env, ran: false, reason: null, report: null };

  const supabase = await admin();
  const { syncBillingCatalog } = await import("./catalogSync.server");

  try {
    const report = await syncBillingCatalog(env);
    const status = syncStatusFrom(report);
    await supabase.from("payment_integration_state").upsert(
      {
        environment: env,
        fingerprint,
        // Odcisk cennika zapisujemy dopiero po udanej synchronizacji - inaczej
        // częściowa porażka uznałaby zmieniony cennik za wdrożony.
        catalog_fingerprint: status === "ok" ? catalog : state.catalogFingerprint,
        last_synced_at: report.ranAt,

        last_status: status,
        last_reason: reason,
        last_error: null,
        last_report: JSON.parse(JSON.stringify(report)) as Json,
      },
      { onConflict: "environment" },
    );
    console.info("[payments] catalog auto-sync", env, reason, status);
    return { environment: env, ran: true, reason, report };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    // Zapisujemy porażkę bez odcisku - następne wejście spróbuje ponownie
    // po krótkim backoffie zamiast uznać integrację za zsynchronizowaną.
    await supabase.from("payment_integration_state").upsert(
      {
        environment: env,
        fingerprint: state.fingerprint,
        last_synced_at: new Date().toISOString(),
        last_status: "failed",
        last_reason: reason,
        last_error: message,
      },
      { onConflict: "environment" },
    );
    console.error("[payments] catalog auto-sync failed", env, message);
    return { environment: env, ran: false, reason, report: null, error: message };
  }
}

/**
 * Gwarantuje aktualny katalog u operatora. Bezpieczna do wywołania z każdej
 * ścieżki płatności: dedupe per izolat + debounce zapytań do bazy.
 */
export async function ensureCatalogSynced(
  env: StripeEnv,
  options: { force?: boolean } = {},
): Promise<AutoSyncOutcome> {
  const force = options.force === true;
  const existing = inFlight.get(env);
  if (existing) return existing;

  const last = checkedAt.get(env);
  if (!force && last && Date.now() - last < CHECK_DEBOUNCE_MS) {
    return { environment: env, ran: false, reason: null, report: null };
  }

  const run = runEnsure(env, force).finally(() => {
    inFlight.delete(env);
    checkedAt.set(env, Date.now());
  });
  inFlight.set(env, run);
  return run;
}
