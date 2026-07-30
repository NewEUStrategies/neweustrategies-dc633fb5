// Automatyczna synchronizacja katalogu po restarcie integracji operatora
// płatności (server-only).
//
// Odcisk integracji liczymy z klucza połączenia bramki - nigdy nie zapisujemy
// samego klucza, tylko skrót SHA-256 (16 znaków hex wystarcza do wykrycia
// zmiany konta). Gdy odcisk różni się od zapisanego w `payment_integration_state`,
// katalog jest odtwarzany, zanim ktokolwiek zdąży trafić na "cena nie istnieje".
import type { Json } from "@/integrations/supabase/types";
import { getConnectionApiKey, type PaddleEnv } from "@/lib/paddle.server";

import {
  catalogFingerprintSource,
  resyncReason,
  syncStatusFrom,
  type CatalogFingerprintEntry,
  type IntegrationSyncState,
  type ResyncReason,
} from "./catalogAutoSync";
import { PADDLE_CATALOG } from "./paddleCatalog";
import type { CatalogSyncReport } from "./paddleCatalogSync.server";


export interface AutoSyncOutcome {
  environment: PaddleEnv;
  ran: boolean;
  reason: ResyncReason | null;
  report: CatalogSyncReport | null;
  error?: string;
}

export interface IntegrationStateRow extends IntegrationSyncState {
  environment: PaddleEnv;
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
export async function integrationFingerprint(env: PaddleEnv): Promise<string> {
  const key = getConnectionApiKey(env);
  return (await sha256Hex(`${env}:${key}`)).slice(0, 16);
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function readState(env: PaddleEnv): Promise<{
  fingerprint: string | null;
  lastSyncedAt: string | null;
  lastStatus: IntegrationSyncState["lastStatus"];
  lastReason: string | null;
  lastError: string | null;
  lastReport: CatalogSyncReport | null;
}> {
  const supabase = await admin();
  const { data } = await supabase
    .from("payment_integration_state")
    .select("fingerprint, last_synced_at, last_status, last_reason, last_error, last_report")
    .eq("environment", env)
    .maybeSingle();

  return {
    fingerprint: data?.fingerprint ?? null,
    lastSyncedAt: data?.last_synced_at ?? null,
    lastStatus: (data?.last_status as IntegrationSyncState["lastStatus"]) ?? null,
    lastReason: data?.last_reason ?? null,
    lastError: data?.last_error ?? null,
    lastReport: (data?.last_report as CatalogSyncReport | null) ?? null,
  };
}

/** Stan integracji dla panelu administracyjnego. */
export async function getIntegrationState(env: PaddleEnv): Promise<IntegrationStateRow> {
  const [state, current] = await Promise.all([readState(env), integrationFingerprint(env)]);
  return {
    environment: env,
    fingerprint: state.fingerprint,
    lastSyncedAt: state.lastSyncedAt,
    lastStatus: state.lastStatus,
    lastReason: state.lastReason,
    lastError: state.lastError,
    lastReport: state.lastReport,
    fingerprintCurrent: state.fingerprint === current,
  };
}

/** Zapis wyniku ręcznej synchronizacji z panelu (odświeża odcisk integracji). */
export async function recordManualSync(
  env: PaddleEnv,
  report: CatalogSyncReport,
): Promise<void> {
  const [supabase, fingerprint] = await Promise.all([admin(), integrationFingerprint(env)]);
  await supabase.from("payment_integration_state").upsert(
    {
      environment: env,
      fingerprint,
      last_synced_at: report.ranAt,
      last_status: syncStatusFrom(report),
      last_reason: "manual",
      last_error: null,
      last_report: JSON.parse(JSON.stringify(report)) as Json,
    },
    { onConflict: "environment" },
  );
  checkedAt.set(env, Date.now());
}

/** Pamięć izolatu: nie pytamy bazy przy każdym zapytaniu o cenę. */
const inFlight = new Map<PaddleEnv, Promise<AutoSyncOutcome>>();
const checkedAt = new Map<PaddleEnv, number>();
const CHECK_DEBOUNCE_MS = 5 * 60 * 1000;

export function __resetAutoSyncCacheForTests(): void {
  inFlight.clear();
  checkedAt.clear();
}

async function runEnsure(env: PaddleEnv, force: boolean): Promise<AutoSyncOutcome> {
  const [state, fingerprint] = await Promise.all([readState(env), integrationFingerprint(env)]);
  const reason = force
    ? ("integration_restarted" as ResyncReason)
    : resyncReason({ ...state, currentFingerprint: fingerprint });

  if (!reason) return { environment: env, ran: false, reason: null, report: null };

  const supabase = await admin();
  const { syncPaddleCatalog } = await import("./paddleCatalogSync.server");

  try {
    const report = await syncPaddleCatalog(env);
    const status = syncStatusFrom(report);
    await supabase.from("payment_integration_state").upsert(
      {
        environment: env,
        fingerprint,
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
  env: PaddleEnv,
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
