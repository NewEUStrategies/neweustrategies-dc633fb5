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
import { useCurrentTenantId } from "@/lib/tenant";
import { subscribeToTable } from "@/lib/realtime/tableChannelHub";
import { pendingCounterKeys } from "./keys";

export type UserCounterKey =
  | "notifications_unread"
  | "chat_unread"
  | "connections_pending"
  // Nieprzeczytane wpisy w klubach dyskusyjnych. Licznik utrzymuje trigger
  // `club_bump_unread` (migracja A18) - do 2026-08-08 nie mial po stronie
  // klienta ANI JEDNEGO czytelnika, wiec baza liczyla go dla nikogo.
  | "club_unread";
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

/**
 * Liczniki kolejek staffu (RLS: tylko staff tenanta widzi wiersze).
 *
 * PRZESTRZEŃ ROBOCZA JEST W KLUCZU I W FILTRZE - obie granice, nie jedna.
 * Klucz (`tenantScoped`) decyduje, czyj wynik oddaje CACHE po zmianie
 * tożsamości; `.eq("tenant_id", …)` decyduje, o co pytamy BAZĘ. Klucz bez
 * filtra zostawia zapytanie zależne wyłącznie od RLS w chwili pobrania, filtr
 * bez klucza - cache oddający licznik zgłoszeń poprzedniego najemcy jeszcze
 * przez 15 s (`staleTime`). Wzorzec jest ten sam co w panelach BI
 * (`GscBiDashboard`): najemca z `useCurrentTenantId`, `enabled` dopiero po
 * jego rozwiązaniu.
 */
export function useTenantPendingCounters(enabled: boolean): UseQueryResult<CounterMap> {
  const { user } = useAuth();
  const tenantId = useCurrentTenantId();
  return useQuery({
    queryKey: pendingCounterKeys.tenantScoped(tenantId, user?.id),
    enabled: enabled && !!user && Boolean(tenantId),
    staleTime: 15_000,
    queryFn: async (): Promise<CounterMap> => {
      // `enabled` wyżej gwarantuje najemcę. Rzut zamiast pustego filtra: gdyby
      // ta bramka kiedyś zmiękła, zapytanie ma paść, a nie po cichu spytać
      // o kolejki WSZYSTKICH najemców.
      if (!tenantId) throw new Error("liczniki kolejek bez rozwiązanej przestrzeni roboczej");
      const { data, error } = await supabase
        .from("tenant_pending_counters")
        .select("counter_key, value")
        .eq("tenant_id", tenantId);
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
          // PREFIKS, nie klucz konkretnej pary (najemca, konto): kanał nie
          // niesie najemcy, a unieważnienie całej gałęzi tylko wymusza
          // ponowne pobranie - danych nikomu nie pokazuje.
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
