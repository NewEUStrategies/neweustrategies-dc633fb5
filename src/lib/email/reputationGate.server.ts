// Bramka reputacji nadawcy przed wysyłką kampanii (serwer).
//
// Suppression list broni pojedynczych adresów; ta bramka broni CAŁEJ domeny.
// Gdy wskaźnik skarg przekroczy twardy limit Google (0,30% dostarczonych),
// kolejna wysyłka nie naprawia sytuacji - pogłębia ją, a filtry zaczynają
// dotyczyć również poczty transakcyjnej z tej domeny. Dlatego przy
// przekroczeniu progu wysyłka jest ZATRZYMYWANA, a operator musi świadomie
// potwierdzić kontynuację (albo najpierw wyczyścić listę).
//
// Liczniki bierzemy z email_deliverability_counts (service role, tenant jawny),
// a progi i statusy z izomorficznego modułu reputation.ts - panel admina liczy
// dokładnie to samo, więc nie ma rozjazdu "UI mówi zielono, serwer blokuje".
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  computeReputation,
  EMPTY_COUNTS,
  type DeliverabilityCounts,
  type ReputationSummary,
} from "./reputation";

type DbClient = SupabaseClient<Database>;

/** Okno oceny reputacji: 30 dni to horyzont, w którym patrzą też dostawcy. */
export const REPUTATION_WINDOW_DAYS = 30;

type RpcCallable = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

function num(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Liczniki dostarczalności tenanta z ostatnich `days` dni. */
export async function fetchDeliverabilityCounts(
  admin: DbClient,
  tenantId: string,
  days: number = REPUTATION_WINDOW_DAYS,
): Promise<DeliverabilityCounts> {
  const { data, error } = await (admin as unknown as RpcCallable).rpc(
    "email_deliverability_counts",
    { p_tenant: tenantId, p_days: days },
  );
  if (error || typeof data !== "object" || data === null) {
    if (error) console.error("[reputation] counts failed", error.message);
    return EMPTY_COUNTS;
  }
  const row = data as Record<string, unknown>;
  return {
    sent: num(row, "sent"),
    delivered: num(row, "delivered"),
    bounced: num(row, "bounced"),
    hardBounced: num(row, "hard_bounced"),
    softBounced: num(row, "soft_bounced"),
    complained: num(row, "complained"),
    failed: num(row, "failed"),
    delayed: num(row, "delayed"),
    suppressedSends: num(row, "suppressed_sends"),
    activeSuppressions: num(row, "active_suppressions"),
  };
}

export interface SendGateVerdict {
  allowed: boolean;
  summary: ReputationSummary;
  counts: DeliverabilityCounts;
  /** Kod błędu do komunikatu w UI, np. "reputation_blocked:complaint_rate". */
  errorCode: string | null;
}

/**
 * Ocenia, czy tenant może teraz wysłać kampanię. `acknowledged` = operator
 * potwierdził świadomie ryzyko w UI - wtedy przepuszczamy, ale werdykt wraca
 * do wywołującego (loguje go i pokazuje ostrzeżenie).
 *
 * Fail-open przy błędzie odczytu liczników: awaria telemetrii nie może
 * zatrzymać komunikacji redakcji - EMPTY_COUNTS daje status
 * "insufficient_data", czyli brak blokady.
 */
export async function evaluateSendGate(
  admin: DbClient,
  tenantId: string,
  acknowledged = false,
): Promise<SendGateVerdict> {
  const counts = await fetchDeliverabilityCounts(admin, tenantId);
  const summary = computeReputation(counts);
  const blocked = summary.blocksSending && !acknowledged;
  return {
    allowed: !blocked,
    summary,
    counts,
    errorCode: blocked ? `reputation_blocked:${summary.blockReasons.join(",")}` : null,
  };
}
