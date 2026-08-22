// Decyzja "czy odtworzyć katalog produktów i cen" - czysta logika, bez I/O.
//
// Restart integracji operatora płatności (nowe konto, odtworzone środowisko,
// rotacja klucza) zmienia odcisk połączenia. Wewnętrzne identyfikatory
// produktów/cen po tamtej stronie przestają istnieć, a aplikacja nadal zna
// tylko czytelne `external_id` - dlatego zmiana odcisku musi wymusić
// ponowną synchronizację, zanim ktokolwiek kliknie "Kup".

export type ResyncReason =
  "first_run" | "integration_restarted" | "catalog_changed" | "retry_after_failure" | "stale";

export interface IntegrationSyncState {
  fingerprint: string | null;
  /** Odcisk treści cennika (plany + mapowanie na ceny operatora). */
  catalogFingerprint?: string | null;
  lastSyncedAt: string | null;
  lastStatus: "ok" | "partial" | "failed" | null;
}

export interface ResyncInput extends IntegrationSyncState {
  currentFingerprint: string;
  /** Odcisk cennika policzony z aktualnego wdrożenia i bazy. */
  currentCatalogFingerprint?: string | null;
  now?: Date;
  /** Odświeżenie kontrolne, nawet gdy nic się nie zmieniło. */
  ttlMs?: number;
  /** Krótszy backoff po nieudanej próbie, żeby nie zapętlić wywołań. */
  retryAfterMs?: number;
}

export const CATALOG_SYNC_TTL_MS = 24 * 60 * 60 * 1000;
export const CATALOG_SYNC_RETRY_MS = 10 * 60 * 1000;

/**
 * Kanoniczna reprezentacja cennika - stabilna kolejność i tylko te pola,
 * które trafiają do operatora. Zmiana kwoty, waluty, nazwy, triala lub
 * dostępności planu zmienia odcisk, więc pierwsze zdarzenie po wdrożeniu
 * uruchamia synchronizację bez ręcznego klikania w panelu.
 */
export interface CatalogFingerprintEntry {
  priceId: string;
  productId: string;
  interval: string;
  perSeat?: boolean;
  amountCents: number | null;
  currency: string | null;
  name: string | null;
  description: string | null;
  trialDays: number | null;
  active: boolean;
  /**
   * Próg wolumenowy planu (`access_plans.volume_threshold_seats` /
   * `volume_price_cents`). MUSI być w odcisku: cena schodkowa jest cechą ceny
   * u operatora, a nie tylko podsumowania zamówienia. Bez tych dwóch pól
   * podniesienie rabatu wolumenowego w bazie nie zmieniłoby odcisku, więc
   * automat nigdy by go nie zsynchronizował - w cenniku 79 zł, u operatora 89.
   */
  volumeThresholdSeats: number | null;
  volumePriceCents: number | null;
}

export function catalogFingerprintSource(entries: readonly CatalogFingerprintEntry[]): string {
  return entries
    .map((e) =>
      [
        e.priceId,
        e.productId,
        e.interval,
        e.perSeat ? "seat" : "unit",
        e.amountCents ?? "",
        (e.currency ?? "").toUpperCase(),
        e.name ?? "",
        e.description ?? "",
        e.trialDays ?? "",
        e.active ? "1" : "0",
        e.volumeThresholdSeats ?? "",
        e.volumePriceCents ?? "",
      ].join("|"),
    )
    .sort()
    .join("\n");
}

/** Zwraca powód resynchronizacji albo `null`, gdy katalog jest aktualny. */
export function resyncReason(input: ResyncInput): ResyncReason | null {
  const {
    fingerprint,
    catalogFingerprint = null,
    lastSyncedAt,
    lastStatus,
    currentFingerprint,
    currentCatalogFingerprint = null,
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

  // Wdrożenie zmieniło cennik (nowy plan, inna kwota, trial) - odtwarzamy
  // katalog od razu, nie czekając na kontrolne odświeżenie po TTL.
  if (currentCatalogFingerprint && catalogFingerprint !== currentCatalogFingerprint) {
    return "catalog_changed";
  }

  return age >= ttlMs ? "stale" : null;
}

/** Status wyniku synchronizacji zapisywany w stanie integracji. */
export function syncStatusFrom(report: {
  failed: number;
  items: unknown[];
}): "ok" | "partial" | "failed" {
  if (report.failed === 0) return "ok";
  return report.failed >= report.items.length ? "failed" : "partial";
}
