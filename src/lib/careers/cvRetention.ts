// Kontrakt retencji plików CV - CZĘŚĆ CZYSTA (bez zależności serwerowych).
//
// Leży poza `src/lib/server/`, bo panel admina musi znać ten sam kształt wyniku,
// co job (żeby pokazać zaległości kolejki), a ochrona importów TanStacka blokuje
// `**/server/**` w środowisku klienta. Ten sam podział, co
// `lib/jobs/scheduler.ts` vs `lib/server/jobScheduler.server.ts`.

/** Powód, dla którego plik trafił do kolejki usunięć. */
export const CV_GC_REASONS = ["orphan", "application_deleted", "retention"] as const;
export type CvGcReason = (typeof CV_GC_REASONS)[number];

/** Jedna pozycja wydana przez `career_cv_gc_claim`. */
export interface CvGcClaim {
  path: string;
  reason: CvGcReason;
  attempts: number;
}

/** Wynik jednego przebiegu retencji - ląduje w logu przebiegów i w panelu. */
export interface CvRetentionResult {
  /** Ile plików skan dopisał do kolejki jako osierocone. */
  scannedOrphans: number;
  /** Ile plików skan dopisał jako wygasłe po okresie retencji. */
  scannedRetention: number;
  /** Ile ścieżek job pobrał do usunięcia w tym przebiegu. */
  claimed: number;
  /** Ile plików faktycznie zniknęło z magazynu. */
  deleted: number;
  /** Ile ścieżek wróciło do kolejki z błędem. */
  failed: number;
  /** Zaległość kolejki po przebiegu (pozycje jeszcze nieskasowane). */
  pending: number;
}

export function emptyRetentionResult(): CvRetentionResult {
  return {
    scannedOrphans: 0,
    scannedRetention: 0,
    claimed: 0,
    deleted: 0,
    failed: 0,
    pending: 0,
  };
}

function isReason(value: unknown): value is CvGcReason {
  return typeof value === "string" && (CV_GC_REASONS as readonly string[]).includes(value);
}

/**
 * Wynik `career_cv_gc_claim` (jsonb) -> lista ścieżek.
 *
 * RPC zwraca jsonb, a nie TABLE, bo nazwy kolumn kolejki kolidowałyby z nazwami
 * parametrów OUT w plpgsql. Parsowanie jest tutaj, żeby job nie ufał kształtowi
 * na słowo i żeby dało się je przetestować bez bazy.
 */
export function parseCvGcClaims(raw: unknown): CvGcClaim[] {
  if (!Array.isArray(raw)) return [];
  const out: CvGcClaim[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    const path = typeof row.path === "string" ? row.path.trim() : "";
    if (!path) continue;
    out.push({
      path,
      reason: isReason(row.reason) ? row.reason : "orphan",
      attempts: typeof row.attempts === "number" ? row.attempts : 0,
    });
  }
  return out;
}

/** Wynik `career_cv_gc_scan` (jsonb) -> dwie liczby. */
export function parseCvGcScan(raw: unknown): { orphans: number; retention: number } {
  if (typeof raw !== "object" || raw === null) return { orphans: 0, retention: 0 };
  const row = raw as Record<string, unknown>;
  const num = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  return { orphans: num(row.orphans), retention: num(row.retention) };
}
