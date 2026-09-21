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
import { readDegree, type ConnectionBridge, type ConnectionDegree } from "./degree";

type Fns = Database["public"]["Functions"];
export type MyConnectionRow = Fns["my_connections"]["Returns"][number];
export type ConnectionRequestRow = Fns["my_connection_requests"]["Returns"][number];
export type NetworkCounts = Fns["my_network_counts"]["Returns"][number];

/**
 * `mutual_visible_count` dołożone migracją 20260913172000 do OBU RPC stopnia.
 * Wygenerowany `types.ts` jeszcze go nie zna, bo regeneracja wymaga dostępu do
 * bazy i jest osobną zmianą (przepisuje ~20 tysięcy linii).
 *
 * DLACZEGO `Partial`, skoro baza zwraca tę kolumnę ZAWSZE. Bo w oknie wdrożenia
 * "kod nowy, baza jeszcze stara" jest ona realnie nieobecna, a typ ma opisywać
 * to, co może przyjść przez sieć, nie to, co powinno. Obietnica jest domykana
 * NIŻEJ - `ConnectionState.mutualVisibleCount` jest wymaganym `number`, bo
 * odczyt normalizuje brak do zera.
 *
 * Zero jest tu spadkiem BEZPIECZNYM w jedyną dopuszczalną stronę: podpowiedź
 * i przycisk wprowadzenia znikają. Odwrotny spadek (np. na `mutual_count`)
 * przywracałby dokładnie ten defekt, który ta migracja zamyka - link do listy,
 * która okaże się pusta.
 *
 * NIE POWTARZAMY tu błędu `bridge_avatar?: string` z useIntroductions: tam
 * augmentacja dokładała pole OPCJONALNE do wygenerowanego typu, który miał je
 * już jako WYMAGANE `string`, więc osłabiała kontrakt zamiast go uzupełnić.
 * Tutaj wygenerowany typ nie ma tego pola wcale.
 *
 * PRZY NAJBLIŻSZEJ REGENERACJI `types.ts`: usunąć `MutualVisible`, zdjąć
 * `?? 0` w `useConnectionStatuses` i w `SuggestionsTab` (src/routes/network.tsx).
 */
type MutualVisible = { readonly mutual_visible_count: number };
export type ConnectionStatusRow = Fns["connection_statuses"]["Returns"][number] &
  Partial<MutualVisible>;
export type ConnectionSuggestionRow = Fns["connection_suggestions"]["Returns"][number] &
  Partial<MutualVisible>;

/** Relacja wołającego z drugą osobą. Od v2 RPC zwraca wiersz także dla "none". */
export type ConnectionStatus = "none" | "pending_out" | "pending_in" | "connected";

export interface ConnectionState {
  status: ConnectionStatus;
  /** id wiersza user_connections (null przy statusie "none"). */
  connectionId: string | null;
  /**
   * Wspólne kontakty jako FAKT GRAFU - na tej liczbie stoi `degree` i ranking
   * sugestii. NIE POKAZUJEMY jej użytkownikowi: zawiera też mosty, których
   * baza nie ma prawa nazwać (`discoverable = false`, obcy tenant).
   */
  mutualCount: number;
  /**
   * Wspólne kontakty, które wołający ZOBACZY po kliknięciu w podpowiedź -
   * ten sam zbiór, co `mutual_connections`. To jest liczba do wyświetlenia
   * i to ona bramkuje przycisk prośby o wprowadzenie (patrz migracja
   * 20260913172000: rozjazd tych dwóch liczb prowadził na pustą listę).
   */
  mutualVisibleCount: number;
  /** Czy świeże zaproszenie ma sens (widoczność, tenant, blokady, polityka). */
  canInvite: boolean;
  /** Stopień oddalenia w grafie zaakceptowanych relacji (0 = poza zasięgiem). */
  degree: ConnectionDegree;
  /** Mój kontakt 1. stopnia otwierający ścieżkę do tej osoby (2°/3°). */
  bridge: ConnectionBridge | null;
}

export const NO_CONNECTION: ConnectionState = {
  status: "none",
  connectionId: null,
  mutualCount: 0,
  mutualVisibleCount: 0,
  canInvite: true,
  degree: 0,
  bridge: null,
};

const PAGE_SIZE = 24;
// Sufit `my_connection_requests` to 50 (RPC klamruje `p_limit`), więc strona
// mniejsza niż sufit jest tu warunkiem KONIECZNYM: przy 50 `lastPage.length
// === pageSize` byłoby prawdą także dla ostatniej pełnej strony obciętej przez
// klamrę i pętla dociągania nie miałaby jak się zatrzymać na właściwym wierszu.
const REQUESTS_PAGE_SIZE = 24;

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
      const rows: ReadonlyArray<ConnectionStatusRow> = data ?? [];
      for (const row of rows) {
        if (
          row.status === "none" ||
          row.status === "pending_out" ||
          row.status === "pending_in" ||
          row.status === "connected"
        ) {
          map.set(row.user_id, {
            status: row.status,
            connectionId: row.connection_id,
            mutualCount: row.mutual_count,
            mutualVisibleCount: row.mutual_visible_count ?? 0,
            canInvite: row.can_invite,
            ...readDegree(row),
          });
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
 *
 * STRONICOWANE OD 20260913. Wcześniej był to zwykły `useQuery` z `p_limit: 50`
 * i bez `p_offset`, a RPC klamruje limit do 50
 * (`LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 50)`), więc pięćdziesiąt
 * było TWARDYM SUFITEM. Wiersz niósł `total_count`, którego hook nie czytał
 * (`return data ?? []`), a odznaka zakładki brała `pending_in`/`pending_out`
 * z `my_network_counts`, liczone `COUNT(*)` po całej tabeli. Użytkownik z 60
 * zaproszeniami widział odznakę "60" nad listą pokazującą 50 i NIE MIAŁ JAK
 * dojść do pozostałych dziesięciu.
 *
 * Kształt jest teraz ten sam, co w `useMyConnections` wyżej (ten sam plik,
 * ten sam `getNextPageParam` oparty na `total_count`) - to wyrównanie do
 * istniejącego wzorca, nie nowy mechanizm.
 */
export function useConnectionRequests(
  direction: "in" | "out",
  pageSize = REQUESTS_PAGE_SIZE,
): UseInfiniteQueryResult<InfiniteData<ConnectionRequestRow[]>> {
  const { user } = useAuth();
  return useInfiniteQuery({
    queryKey: [...networkKeys.requests(user?.id, direction), pageSize],
    enabled: !!user,
    staleTime: 15_000,
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<ConnectionRequestRow[]> => {
      const { data, error } = await supabase.rpc("my_connection_requests", {
        p_direction: direction,
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
      const rows: ConnectionSuggestionRow[] = data ?? [];
      return rows;
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

export type PolicyItemFollowerRow = Fns["policy_item_followers"]["Returns"][number];

/**
 * "Kto jeszcze śledzi ten plik": widoczni obserwujący dossier trackera
 * w tenancie wołającego (RPC odrzuca anonimów i nieopublikowane dossier).
 */
export function usePolicyItemFollowers(
  itemId: string | null | undefined,
  limit = 12,
): UseQueryResult<PolicyItemFollowerRow[]> {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["network", "policy-followers", user?.id ?? "anon", itemId ?? "none", limit],
    enabled: !!user && !!itemId,
    staleTime: 60_000,
    queryFn: async (): Promise<PolicyItemFollowerRow[]> => {
      const { data, error } = await supabase.rpc("policy_item_followers", {
        p_item_id: itemId as string,
        p_limit: limit,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Grupa czatu wydarzenia (host/staff): idempotentne RPC tworzy krąg
 * z uczestników RSVP 'going' i zwraca id konwersacji.
 */
export function useCreateEventGroup(): UseMutationResult<string, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (eventId) => {
      const { data, error } = await supabase.rpc("create_event_group", {
        p_event_id: eventId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["chat"] });
    },
  });
}

/** Zgłoszenie użytkownika do moderacji (dedup i rate limit po stronie DB). */
export function useReportUser(): UseMutationResult<
  string,
  Error,
  { userId: string; reason: string; details?: string }
> {
  return useMutation({
    mutationFn: async ({ userId, reason, details }) => {
      const { data, error } = await supabase.rpc("report_user", {
        p_user_id: userId,
        p_reason: reason,
        p_details: details?.trim() ? details.trim() : undefined,
      });
      if (error) throw error;
      return data as string;
    },
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
