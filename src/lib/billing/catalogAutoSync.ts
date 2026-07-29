// Decyzja "czy odtworzyć katalog produktów i cen" - czysta logika, bez I/O.
//
// Restart integracji operatora płatności (nowe konto, odtworzone środowisko,
// rotacja klucza) zmienia odcisk połączenia. Wewnętrzne identyfikatory
// produktów/cen po tamtej stronie przestają istnieć, a aplikacja nadal zna
// tylko czytelne `external_id` - dlatego zmiana odcisku musi wymusić
// ponowną synchronizację, zanim ktokolwiek kliknie "Kup".

export type ResyncReason =
  | "first_run"
  | "integration_restarted"
  | "retry_after_failure"
  | "stale";

export interface IntegrationSyncState {
  fingerprint: string | null;
  lastSyncedAt: string | null;
  lastStatus: "ok" | "partial" | "failed" | null;
}

export interface ResyncInput extends IntegrationSyncState {
  currentFingerprint: string;
  now?: Date;
  /** Odświeżenie kontrolne, nawet gdy nic się nie zmieniło. */
  ttlMs?: number;
  /** Krótszy backoff po nieudanej próbie, żeby nie zapętlić wywołań. */
  retryAfterMs?: number;
}

export const CATALOG_SYNC_TTL_MS = 24 * 60 * 60 * 1000;
export const CATALOG_SYNC_RETRY_MS = 10 * 60 * 1000;

/** Zwraca powód resynchronizacji albo `null`, gdy katalog jest aktualny. */
export function resyncReason(input: ResyncInput): ResyncReason | null {
  const {
    fingerprint,
    lastSyncedAt,
    lastStatus,
    currentFingerprint,
    now = new Date(),
    ttlMs = CATALOG_SYNC_TTL_MS,
    retryAfterMs = CATALOG_SYNC_RETRY_MS,
  } = input;

  if (!fingerprint || !lastSyncedAt) return "first_run";
  if (fingerprint !== currentFingerprint) return "integration_restarted";

  const age = now.getTime() - new Date(lastSyncedAt).getTime();
  if (Number.isNaN(age)) return "first_run";

  if (lastStatus === "failed" || lastStatus === "partial") {
    return age >= retryAfterMs ? "retry_after_failure" : null;
  }
  return age >= ttlMs ? "stale" : null;
}

/** Status wyniku synchronizacji zapisywany w stanie integracji. */
export function syncStatusFrom(report: { failed: number; items: unknown[] }):
  | "ok"
  | "partial"
  | "failed" {
  if (report.failed === 0) return "ok";
  return report.failed >= report.items.length ? "failed" : "partial";
}
