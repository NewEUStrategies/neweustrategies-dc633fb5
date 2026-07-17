// Sieć kontaktów - warstwa danych (RPC-only).
//
// Tabela user_connections nie ma żadnych grantów dla klientów: każda operacja
// (zaproszenie, odpowiedź, wycofanie, usunięcie) i każdy odczyt (moja sieć,
// zaproszenia, statusy, sugestie) przechodzi przez SECURITY DEFINER RPC
// z migracji 20260717123000. Dzięki temu odmowa zaproszenia pozostaje
// niewidoczna dla zapraszającego (prywatność jak na LinkedIn), a izolacja
// tenanta jest egzekwowana w bazie, nie w UI.
import { useEffect } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { pendingCounterKeys } from "@/lib/counters/keys";
import { subscribeToTable } from "@/lib/realtime/tableChannelHub";
import type { Database } from "@/integrations/supabase/types";
import { networkKeys } from "./keys";

type Fns = Database["public"]["Functions"];
export type MyConnectionRow = Fns["my_connections"]["Returns"][number];
export type ConnectionRequestRow = Fns["my_connection_requests"]["Returns"][number];
export type ConnectionSuggestionRow = Fns["connection_suggestions"]["Returns"][number];
export type NetworkCounts = Fns["my_network_counts"]["Returns"][number];

/** Relacja wołającego z drugą osobą; brak wiersza w DB = "none". */
export type ConnectionStatus = "none" | "pending_out" | "pending_in" | "connected";

export interface ConnectionState {
  status: ConnectionStatus;
  /** id wiersza user_connections (null przy statusie "none"). */
  connectionId: string | null;
}

export const NO_CONNECTION: ConnectionState = { status: "none", connectionId: null };

const PAGE_SIZE = 24;

/**
 * Statusy relacji z partią widocznych profili (np. strona /people) - jeden
 * batchowany RPC zamiast zapytania per karta.
 */
export function useConnectionStatuses(
  userIds: ReadonlyArray<string>,
): UseQueryResult<ReadonlyMap<string, ConnectionState>> {
  const { user } = useAuth();
  return useQuery({
    queryKey: networkKeys.statuses(user?.id, userIds),
    enabled: !!user && userIds.length > 0,
    staleTime: 15_000,
    queryFn: async (): Promise<ReadonlyMap<string, ConnectionState>> => {
      const { data, error } = await supabase.rpc("connection_statuses", {
        p_user_ids: [...userIds],
      });
      if (error) throw error;
      const map = new Map<string, ConnectionState>();
      for (const row of data ?? []) {
        if (
          row.status === "pending_out" ||
          row.status === "pending_in" ||
          row.status === "connected"
        ) {
          map.set(row.user_id, { status: row.status, connectionId: row.connection_id });
        }
      }
      return map;
    },
  });
}

/** Moja sieć (zaakceptowane) z wyszukiwaniem trgm i paginacją offsetową. */
export function useMyConnections(
  query: string,
  pageSize = PAGE_SIZE,
): UseInfiniteQueryResult<InfiniteData<MyConnectionRow[]>> {
  const { user } = useAuth();
  const q = query.trim();
  return useInfiniteQuery({
    queryKey: [...networkKeys.connections(user?.id, q), pageSize],
    enabled: !!user,
    staleTime: 30_000,
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<MyConnectionRow[]> => {
      const { data, error } = await supabase.rpc("my_connections", {
        p_query: q,
        p_limit: pageSize,
        p_offset: pageParam,
      });
      if (error) throw error;
      return data ?? [];
    },
    getNextPageParam: (lastPage, allPages) => {
      const total = lastPage[0]?.total_count ?? 0;
      const loaded = allPages.reduce((sum, page) => sum + page.length, 0);
      return lastPage.length === pageSize && loaded < total ? loaded : undefined;
    },
  });
}

/**
 * Zaproszenia: "in" = oczekujące na moją odpowiedź, "out" = wysłane przeze
 * mnie (odrzucone celowo wyglądają jak oczekujące - patrz migracja).
 */
export function useConnectionRequests(
  direction: "in" | "out",
): UseQueryResult<ConnectionRequestRow[]> {
  const { user } = useAuth();
  return useQuery({
    queryKey: networkKeys.requests(user?.id, direction),
    enabled: !!user,
    staleTime: 15_000,
    queryFn: async (): Promise<ConnectionRequestRow[]> => {
      const { data, error } = await supabase.rpc("my_connection_requests", {
        p_direction: direction,
        p_limit: 50,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Liczniki do nagłówka i zakładek /network. */
export function useNetworkCounts(): UseQueryResult<NetworkCounts> {
  const { user } = useAuth();
  return useQuery({
    queryKey: networkKeys.counts(user?.id),
    enabled: !!user,
    staleTime: 15_000,
    queryFn: async (): Promise<NetworkCounts> => {
      const { data, error } = await supabase.rpc("my_network_counts");
      if (error) throw error;
      return data?.[0] ?? { connections: 0, pending_in: 0, pending_out: 0 };
    },
  });
}

/** "Osoby, które możesz znać": wspólne kontakty + afiniczność (firma itd.). */
export function useConnectionSuggestions(limit = 12): UseQueryResult<ConnectionSuggestionRow[]> {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...networkKeys.suggestions(user?.id), limit],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<ConnectionSuggestionRow[]> => {
      const { data, error } = await supabase.rpc("connection_suggestions", {
        p_limit: limit,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

// Każda mutacja unieważnia cały zakres sieci + liczniki badge'ów: statusy na
// kartach, listy zaproszeń, sugestie i liczniki muszą się zgadzać naraz.
function invalidateNetwork(qc: QueryClient, uid: string | undefined): void {
  void qc.invalidateQueries({ queryKey: networkKeys.all });
  void qc.invalidateQueries({ queryKey: pendingCounterKeys.user(uid) });
}

/** Wyślij zaproszenie (opcjonalna notka do 300 znaków). */
export function useSendConnectionRequest(): UseMutationResult<
  string,
  Error,
  { userId: string; message?: string }
> {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ userId, message }) => {
      const { data, error } = await supabase.rpc("connection_request", {
        p_user_id: userId,
        p_message: message?.trim() ? message.trim() : undefined,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => invalidateNetwork(qc, user?.id),
  });
}

/** Odpowiedz na zaproszenie (akceptacja lub cicha odmowa). */
export function useRespondToConnectionRequest(): UseMutationResult<
  void,
  Error,
  { connectionId: string; accept: boolean }
> {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ connectionId, accept }) => {
      const { error } = await supabase.rpc("connection_respond", {
        p_connection_id: connectionId,
        p_accept: accept,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateNetwork(qc, user?.id),
  });
}

/** Wycofaj własne zaproszenie (usuwa wiersz - można zaprosić ponownie). */
export function useCancelConnectionRequest(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (connectionId) => {
      const { error } = await supabase.rpc("connection_cancel", {
        p_connection_id: connectionId,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateNetwork(qc, user?.id),
  });
}

/** Usuń osobę ze swojej sieci (dowolna ze stron, bez powiadomienia). */
export function useRemoveConnection(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (userId) => {
      const { error } = await supabase.rpc("connection_remove", { p_user_id: userId });
      if (error) throw error;
    },
    onSuccess: () => invalidateNetwork(qc, user?.id),
  });
}

/**
 * Realtime sieci: user_connections świadomie NIE jest w publikacji Realtime
 * (RPC-only, prywatność odmów), więc nasłuchujemy sygnałów pośrednich, które
 * zmieniają się w tej samej transakcji co relacja:
 *  - powiadomienie kind='connection' (nowe zaproszenie / akceptacja),
 *  - licznik connections_pending (obejmuje też ciche wycofanie zaproszenia).
 * Kanały są współdzielone przez tableChannelHub z dzwonkiem i badge'ami.
 */
export function useNetworkRealtime(): void {
  const qc = useQueryClient();
  const { user } = useAuth();
  const uid = user?.id;
  useEffect(() => {
    if (!uid) return;
    const unsubscribes = [
      subscribeToTable({ table: "notifications", filter: `user_id=eq.${uid}` }, (payload) => {
        const row = (payload.new ?? payload.old) as { kind?: string } | null;
        if (row?.kind === "connection") invalidateNetwork(qc, uid);
      }),
      subscribeToTable(
        { table: "user_pending_counters", filter: `user_id=eq.${uid}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as { counter_key?: string } | null;
          if (row?.counter_key === "connections_pending") invalidateNetwork(qc, uid);
        },
      ),
    ];
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [uid, qc]);
}
