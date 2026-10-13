// Wspólny model widoku "Stany rozliczeń i zwrotów" (klient + serwer).
// Czyste funkcje bez zależności od bazy - testowane jednostkowo.

export const SETTLEMENT_STATUSES = [
  "pending",
  "processing",
  "paid",
  "partially_refunded",
  "refunded",
  "failed",
  "canceled",
] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const REFUND_JOB_STATES = ["pending", "processing", "done", "review", "failed"] as const;

export interface SettlementFilter {
  status: SettlementStatus | "all";
  /** Data lokalna RRRR-MM-DD (włącznie) albo pusta. */
  from: string;
  /** Data lokalna RRRR-MM-DD (włącznie) albo pusta. */
  to: string;
}

export interface SettlementRow {
  id: string;
  createdAt: string;
  kind: string;
  status: SettlementStatus;
  rawStatus: string;
  amountCents: number;
  refundedCents: number;
  currency: string;
  environment: string | null;
  refundJobState: string | null;
  refundJobError: string | null;
  needsReview: boolean;
}

/** Stan rozliczenia: częściowy zwrot opłaconego zamówienia ma własny stan. */
export function deriveSettlementStatus(
  rawStatus: string,
  amountCents: number,
  refundedCents: number,
): SettlementStatus {
  if (rawStatus === "paid" && refundedCents > 0) {
    return refundedCents >= amountCents && amountCents > 0 ? "refunded" : "partially_refunded";
  }
  if (rawStatus === "cancelled") return "canceled";
  return (SETTLEMENT_STATUSES as readonly string[]).includes(rawStatus)
    ? (rawStatus as SettlementStatus)
    : "pending";
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Zakres dni lokalnych (Europe/Warsaw nie jest potrzebny - granice z klienta w ISO). */
export function dateRangeToIso(
  from: string,
  to: string,
): { fromIso: string | null; toIso: string | null } {
  const fromIso = DATE_RE.test(from) ? new Date(`${from}T00:00:00`).toISOString() : null;
  let toIso: string | null = null;
  if (DATE_RE.test(to)) {
    const end = new Date(`${to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    toIso = end.toISOString();
  }
  return { fromIso, toIso };
}

export function filterSettlementRows(
  rows: readonly SettlementRow[],
  status: SettlementFilter["status"],
): SettlementRow[] {
  return status === "all" ? [...rows] : rows.filter((r) => r.status === status);
}
