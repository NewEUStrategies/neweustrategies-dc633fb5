// Wspólny model widoku "Stany rozliczeń i zwrotów" (klient + serwer).
// Czyste funkcje bez zależności od bazy - testowane jednostkowo.
import type { Database } from "@/integrations/supabase/types";

/** Status zamówienia w bazie (enum `order_status`). */
type OrderStatus = Database["public"]["Enums"]["order_status"];

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
  amountCents: number;
  refundedCents: number;
  currency: string;
  environment: string;
  refundJobState: string | null;
  refundJobError: string | null;
  needsReview: boolean;
}

/**
 * Stan rozliczenia: częściowy zwrot opłaconego zamówienia ma własny stan.
 * Pełny zwrot zapisuje się jako `refunded` (`refunds.server.ts`); `paid`
 * z kwotą zwrotu sięgającą kwoty zamówienia też czyta się jako „zwrócone".
 * Każdy inny status bazy jest stanem rozliczenia wprost.
 */
export function deriveSettlementStatus(
  rawStatus: OrderStatus,
  amountCents: number,
  refundedCents: number,
): SettlementStatus {
  if (rawStatus === "paid" && refundedCents > 0) {
    return refundedCents >= amountCents && amountCents > 0 ? "refunded" : "partially_refunded";
  }
  return rawStatus;
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
