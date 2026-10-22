// `queryOptions`, ocena i mutatory diagnostyki huba (S7, SPEC §5.4, Z-S6-08).
//
// JEDNO źródło klucza i `queryFn` dla Diagnostyki, karty „Wymaga uwagi",
// licznika na pasku huba i `RevenueSignalChip` w modułach: wszystkie czytają
// `revenueKeys.facts(t)` i `revenueKeys.snoozes(t)` - przy ciepłym cache chip
// w module nie wysyła ŻADNEGO żądania (test w `RevenueSignalChip.test.tsx`).
// Reguły szyny unieważniają prefiks `rev("diagnostics")`, więc zmiana planu,
// warstwy czy ustawień w innej karcie odświeża fakty bez odświeżania strony.
//
// BEZ `refetchInterval`: fakty zmieniają się wraz ze zdarzeniami modułów,
// a te i tak docierają szyną; odpytywanie co minutę 16 agregatów to koszt
// bez nowej informacji.
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import type { RevenueArea } from "@/lib/admin/revenue/hubTabs";
import { revenueKeys } from "@/lib/revenue/keys";
import {
  getRevenueFacts,
  getRevenueSnoozes,
  snoozeRevenueCheck,
  unsnoozeRevenueCheck,
  type RevenueDiagnosticsDenial,
  type RevenueFactsRead,
  type RevenueSnoozesRead,
  type RevenueSnoozeWrite,
  type SnoozeInputValue,
} from "./diagnostics.functions";
import type { RevenueFacts } from "./facts";
import {
  evaluateRegistry,
  isOpenFinding,
  REVENUE_CHECKS,
  type RevenueFinding,
  type RevenueSnooze,
} from "./registry";

export const FACTS_STALE_MS = 30_000;
export const FACTS_GC_MS = 10 * 60_000;

export interface DiagnosticsGate {
  /** Rola sesji to admin albo editor (bez roli zapytanie jest wyłączone). */
  roleOk?: boolean;
}

/**
 * Odmowa z middleware (`requireCrmStaff`) przychodzi jako WYJĄTEK z napisem
 * („Forbidden: mfa_required …", „Forbidden: … required") - zamieniamy go na
 * stan karty, bo ponowienie zapytania niczego tu nie naprawi.
 */
export function middlewareDenial(error: unknown): RevenueDiagnosticsDenial | null {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (message.includes("mfa_required")) return "mfa_required";
  if (message.startsWith("Forbidden")) return "forbidden";
  return null;
}

async function settleRead<T>(
  load: () => Promise<T>,
): Promise<T | { state: RevenueDiagnosticsDenial }> {
  try {
    return await load();
  } catch (error) {
    const denial = middlewareDenial(error);
    if (denial) return { state: denial };
    throw error;
  }
}

export function revenueFactsQueryOptions(tenantId: string | null, gate: DiagnosticsGate = {}) {
  return queryOptions<RevenueFactsRead>({
    // Bez najemcy zapytanie jest wyłączone; pusty napis trzyma tylko kształt klucza.
    queryKey: revenueKeys.facts(tenantId ?? ""),
    queryFn: () => settleRead(() => getRevenueFacts()),
    enabled: Boolean(tenantId) && gate.roleOk !== false,
    staleTime: FACTS_STALE_MS,
    gcTime: FACTS_GC_MS,
    retry: 1,
  });
}

export function revenueSnoozesQueryOptions(tenantId: string | null, gate: DiagnosticsGate = {}) {
  return queryOptions<RevenueSnoozesRead>({
    queryKey: revenueKeys.snoozes(tenantId ?? ""),
    queryFn: () => settleRead(() => getRevenueSnoozes()),
    enabled: Boolean(tenantId) && gate.roleOk !== false,
    staleTime: FACTS_STALE_MS,
    gcTime: FACTS_GC_MS,
    retry: 1,
  });
}

/** Ocena faktów i wyciszeń w diagnozy - jedna funkcja dla listy, karty i chipu. */
export function evaluateFindings(
  facts: RevenueFacts,
  snoozes: readonly RevenueSnooze[],
  nowMs: number = Date.now(),
): RevenueFinding[] {
  return evaluateRegistry(facts, snoozes, nowMs);
}

/**
 * `select` chipu: fakty WYŁĄCZNIE wskazanych obszarów. Wynik przechodzi przez
 * współdzielenie struktury React Query, więc chip renderuje się ponownie
 * tylko, gdy zmieni się któryś z jego obszarów.
 */
export function selectFactsForAreas(areas: readonly RevenueArea[]) {
  return (read: RevenueFactsRead): RevenueFactsRead => {
    if (read.state !== "ready") return read;
    const scoped: Partial<Record<RevenueArea, unknown>> = {};
    for (const area of areas) {
      if (area in read.facts.areas) scoped[area] = read.facts.areas[area];
    }
    return { state: "ready", facts: { ...read.facts, areas: scoped as RevenueFacts["areas"] } };
  };
}

/** Diagnozy dla obszarów (chip, karta modułu) - reguły spoza obszarów nie są oceniane. */
export function evaluateAreaFindings(
  facts: RevenueFacts,
  snoozes: readonly RevenueSnooze[],
  areas: readonly RevenueArea[],
  nowMs: number = Date.now(),
): RevenueFinding[] {
  return evaluateRegistry(
    facts,
    snoozes,
    nowMs,
    REVENUE_CHECKS.filter((check) => areas.includes(check.area)),
  );
}

/** Licznik paska: otwarte diagnozy krytyczne i ważne (bez obowiązujących wyciszeń). */
export function diagnosticsBadgeCount(findings: readonly RevenueFinding[]): number {
  return findings.filter((f) => f.severity !== "info" && isOpenFinding(f)).length;
}

/**
 * Hak licznika Diagnostyki na pasku huba (Z-S6-08; wpięcie w
 * `RevenueHubLayout` - I9). `null` = nie wiadomo (brak najemcy, odmowa,
 * ładowanie) - pasek nie pokazuje wtedy „0", które znaczyłoby „czysto".
 */
export function useDiagnosticsBadgeCount(
  tenantId: string | null,
  gate: DiagnosticsGate = {},
): number | null {
  const facts = useQuery(revenueFactsQueryOptions(tenantId, gate));
  const snoozes = useQuery(revenueSnoozesQueryOptions(tenantId, gate));
  return useMemo(() => {
    if (facts.data?.state !== "ready") return null;
    const active = snoozes.data?.state === "ready" ? snoozes.data.snoozes : [];
    return diagnosticsBadgeCount(evaluateFindings(facts.data.facts, active));
  }, [facts.data, snoozes.data]);
}

/** Klucze odświeżane po wyciszeniu: fakty (stan diagnozy) i wyciszenia. */
export function snoozeInvalidationKeys(tenantId: string) {
  return [revenueKeys.facts(tenantId), revenueKeys.snoozes(tenantId)] as const;
}

/** Wyciszenie (tylko admin - SQL odmawia redaktorowi, wynik `forbidden`). */
export function useSnoozeRevenueCheck(tenantId: string | null) {
  const qc = useQueryClient();
  return useMutation<RevenueSnoozeWrite, Error, SnoozeInputValue>({
    mutationFn: (input) => snoozeRevenueCheck({ data: input }),
    onSettled: () => {
      if (!tenantId) return;
      for (const queryKey of snoozeInvalidationKeys(tenantId)) {
        void qc.invalidateQueries({ queryKey });
      }
    },
  });
}

export function useUnsnoozeRevenueCheck(tenantId: string | null) {
  const qc = useQueryClient();
  return useMutation<RevenueSnoozeWrite, Error, { checkId: string; scopeKey?: string }>({
    mutationFn: (input) => unsnoozeRevenueCheck({ data: { scopeKey: "*", ...input } }),
    onSettled: () => {
      if (!tenantId) return;
      for (const queryKey of snoozeInvalidationKeys(tenantId)) {
        void qc.invalidateQueries({ queryKey });
      }
    },
  });
}
