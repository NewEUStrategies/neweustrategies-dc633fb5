// Moduł "Wprowadzenia" (LinkedIn-style bridge introductions) - warstwa danych.
//
// Łańcuch: requester -> bridge -> target. Wszystkie RPC są SECURITY DEFINER
// i egzekwują:
//   - tenant_id (izolacja organizacji, przechodnio przez user_connections),
//   - relacje requester<->bridge oraz bridge<->target muszą być zaakceptowane,
//   - target musi zezwalać na komunikację: brak blokady pary, opt-in
//     `discoverable` i `connections_allowed_from` - trzy bramki dołożone
//     migracją 20260913171000; do tamtej pory zdanie wyżej było NIEPRAWDZIWE
//     i osoba, która zablokowała proszącego, dostawała powiadomienie
//     o przekazanym wprowadzeniu,
//   - jeden aktywny request na trójkę - `introduction_requests_active_uidx`
//     (indeks częściowy na `status = 'pending'`, ta sama migracja). Powtórne
//     wywołanie zwraca id istniejącej prośby zamiast zakładać drugi wiersz,
//     więc `usedBridges` w dialogu jest od teraz WYGODĄ INTERFEJSU, a nie
//     jedyną ochroną.
// RPC dostępne w projekcie:
//   - request_introduction(p_bridge, p_target, p_message) -> uuid,
//   - respond_introduction(p_id, p_action) -> void,
//   - my_introduction_requests(p_role) -> lista wierszy z widoczną
//     tożsamością każdej ze stron (baza sama dobiera zakres pól).
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Database } from "@/integrations/supabase/types";

type Fns = Database["public"]["Functions"];
export type IntroductionRow = Fns["my_introduction_requests"]["Returns"][number];

/**
 * Rola z perspektywy zalogowanego użytkownika. WYMAGANA i bez wartości "all".
 *
 * "all" było tu wartością domyślną i szło 1:1 do `p_role`, gdzie rola
 * rozstrzyga się przez `CASE p_role WHEN 'bridge' ... ELSE FALSE END`
 * (20260724120000:64-71) - czyli dla "all" predykat `WHERE` był FAŁSZYWY:
 * zero wierszy, zero błędów, zero sygnału. `useMyIntroductions()` bez
 * argumentu wyglądało jak "wszystkie moje wprowadzenia" i zwracało pustą
 * listę. Defekt był uśpiony (wszystkie wywołania produkcyjne podają rolę
 * jawnie), więc była to pułapka na następnego czytelnika, nie awaria.
 *
 * Wybrano usunięcie wartości, a nie dopisanie jej obsługi w bazie: wartość,
 * która nigdy nie ma sensu, nie powinna dać się wpisać. Rola bez domyślnej
 * znaczy też, że każde nowe wywołanie MUSI rozstrzygnąć, o czyje wprowadzenia
 * pyta - a kompilator wskazuje miejsca, które tego nie zrobiły.
 */
export type IntroductionRole = "requester" | "bridge" | "target";

/** Status wiersza introduction_requests (zgodny z CHECK w bazie). */
export type IntroductionStatus = "pending" | "forwarded" | "declined" | "withdrawn";

export const INTRO_MESSAGE_MIN = 20;
export const INTRO_MESSAGE_MAX = 600;

const keys = {
  list: (userId: string, role: IntroductionRole) =>
    ["network", "introductions", userId, role] as const,
};

/** Lista wprowadzeń dla zalogowanego użytkownika w wybranej roli. */
export function useMyIntroductions(
  role: IntroductionRole,
): UseQueryResult<ReadonlyArray<IntroductionRow>> {
  const { user } = useAuth();
  return useQuery({
    queryKey: keys.list(user?.id ?? "none", role),
    enabled: Boolean(user?.id),
    staleTime: 15_000,
    queryFn: async (): Promise<ReadonlyArray<IntroductionRow>> => {
      const { data, error } = await supabase.rpc("my_introduction_requests", {
        p_role: role,
      });
      if (error) throw error;
      return (data ?? []) as ReadonlyArray<IntroductionRow>;
    },
  });
}

export interface RequestIntroductionInput {
  bridgeId: string;
  targetId: string;
  message: string;
}

/** Wyślij prośbę o wprowadzenie (requester -> bridge -> target). */
export function useRequestIntroduction(): UseMutationResult<
  string,
  Error,
  RequestIntroductionInput
> {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({
      bridgeId,
      targetId,
      message,
    }: RequestIntroductionInput): Promise<string> => {
      const trimmed = message.trim();
      if (trimmed.length < INTRO_MESSAGE_MIN || trimmed.length > INTRO_MESSAGE_MAX) {
        throw new Error("Message length out of range");
      }
      const { data, error } = await supabase.rpc("request_introduction", {
        p_bridge: bridgeId,
        p_target: targetId,
        p_message: trimmed,
      });
      if (error) throw error;
      return String(data);
    },
    onSuccess: () => {
      if (user?.id) {
        void qc.invalidateQueries({
          queryKey: ["network", "introductions", user.id],
        });
      }
    },
  });
}

export interface RespondIntroductionInput {
  id: string;
  /** bridge: forward/decline · requester: withdraw (zgodne z respond_introduction). */
  action: "forward" | "decline" | "withdraw";
}

/** Odpowiedź na prośbę (bridge: forward/decline, requester: withdraw). */
export function useRespondIntroduction(): UseMutationResult<void, Error, RespondIntroductionInput> {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ id, action }: RespondIntroductionInput): Promise<void> => {
      const { error } = await supabase.rpc("respond_introduction", {
        p_id: id,
        p_action: action,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      if (user?.id) {
        void qc.invalidateQueries({
          queryKey: ["network", "introductions", user.id],
        });
      }
    },
  });
}
