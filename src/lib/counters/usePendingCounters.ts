// Zmaterializowane liczniki badge'ów - warstwa danych.
//
// Zamiast N zapytań COUNT(*) (dzwonek, czat, kolejki moderacji) czytamy małe
// tabele utrzymywane triggerami (migracja 20260711202000):
//   * user_pending_counters   - notifications_unread, chat_unread (per user);
//   * tenant_pending_counters - comments_pending, crm_leads_new (per tenant,
//     widoczne dla staffu).
// Realtime przez współdzielony tableChannelHub utrzymuje badge'e na żywo.
import { useEffect } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { subscribeToTable } from "@/lib/realtime/tableChannelHub";
import { pendingCounterKeys } from "./keys";

export type UserCounterKey = "notifications_unread" | "chat_unread";
export type TenantCounterKey = "comments_pending" | "crm_leads_new";

export type CounterMap = Readonly<Record<string, number>>;

export function usePendingCounters(): UseQueryResult<CounterMap> {
  const { user } = useAuth();
  return useQuery({
    queryKey: pendingCounterKeys.user(user?.id),
    enabled: !!user,
    staleTime: 15_000,
    queryFn: async (): Promise<CounterMap> => {
      const { data, error } = await supabase
        .from("user_pending_counters")
        .select("counter_key, value");
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const row of data ?? []) map[row.counter_key] = row.value;
      return map;
    },
  });
}

/** Pojedynczy licznik użytkownika (0, dopóki nie ma wiersza). */
export function useUserCounter(key: UserCounterKey): number {
  const q = usePendingCounters();
  return q.data?.[key] ?? 0;
}

/** Liczniki kolejek staffu (RLS: tylko staff tenanta widzi wiersze). */
export function useTenantPendingCounters(enabled: boolean): UseQueryResult<CounterMap> {
  const { user } = useAuth();
  return useQuery({
    queryKey: pendingCounterKeys.tenant(),
    enabled: enabled && !!user,
    staleTime: 15_000,
    queryFn: async (): Promise<CounterMap> => {
      const { data, error } = await supabase
        .from("tenant_pending_counters")
        .select("counter_key, value");
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const row of data ?? []) map[row.counter_key] = row.value;
      return map;
    },
  });
}

/**
 * Realtime liczników: jeden współdzielony kanał per użytkownik (+ opcjonalnie
 * kanał tenantowy dla staffu). Montowane obok badge'ów.
 */
export function usePendingCountersRealtime(options: { tenant?: boolean } = {}): void {
  const qc = useQueryClient();
  const { user } = useAuth();
  const uid = user?.id;
  const withTenant = options.tenant ?? false;

  useEffect(() => {
    if (!uid) return;
    const unsubscribes = [
      subscribeToTable({ table: "user_pending_counters", filter: `user_id=eq.${uid}` }, () => {
        void qc.invalidateQueries({ queryKey: pendingCounterKeys.user(uid) });
      }),
    ];
    if (withTenant) {
      unsubscribes.push(
        subscribeToTable({ table: "tenant_pending_counters" }, () => {
          void qc.invalidateQueries({ queryKey: pendingCounterKeys.tenant() });
        }),
      );
    }
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [uid, withTenant, qc]);
}

/**
 * Zawór bezpieczeństwa przy podejrzeniu dryfu: przelicz własne liczniki
 * z tabel źródłowych (RPC SECURITY DEFINER ograniczone do auth.uid()).
 */
export async function recomputeMyPendingCounters(): Promise<void> {
  const { error } = await supabase.rpc("recompute_my_pending_counters");
  if (error) throw error;
}
