// PĘTLA ZWROTNA sugestii kontaktów - warstwa danych (RPC-only).
//
// Do 20260807143000 "osoby, które możesz znać" nie miały pamięci decyzji:
// odrzucona osoba wracała przy każdym wejściu na zakładkę, bo funkcja
// odsiewała tylko ISTNIEJĄCE relacje. Ranking uczył się z danych i nigdy
// z zachowania użytkownika.
//
// Model jest świadomie prosty i odwracalny: ukrycie jest TRWAŁE (kto raz
// powiedział "nie, dziękuję", nie ma tego mówić drugi raz), a przywrócenie
// czyści całą listę jednym ruchem. Żadnego "przypomnę Ci za miesiąc" -
// to dokładnie zachowanie, które miało zniknąć.
//
// Tabela connection_suggestion_dismissals nie ma grantów klienckich: decyzja
// o pominięciu kogoś jest prywatna, więc pominięty nie może jej odczytać.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { networkKeys } from "./keys";

const dismissedCountKey = (uid: string | undefined) =>
  ["network", "suggestions", "dismissed-count", uid ?? "anon"] as const;

/** Ile sugestii użytkownik ukrył - podstawa dla "Przywróć ukryte (N)". */
export function useDismissedSuggestionsCount(): UseQueryResult<number> {
  const { user } = useAuth();
  return useQuery({
    queryKey: dismissedCountKey(user?.id),
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc("my_dismissed_suggestions_count");
      if (error) throw error;
      return typeof data === "number" ? data : 0;
    },
  });
}

/**
 * "Nie, dziękuję" dla jednej sugestii. Unieważnia CAŁY zakres sieci, nie tylko
 * listę sugestii: licznik ukrytych i sugestie muszą się zgadzać w tej samej
 * klatce, inaczej karta znika, a licznik jeszcze o niej nie wie.
 */
export function useDismissSuggestion(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (userId) => {
      const { error } = await supabase.rpc("dismiss_connection_suggestion", {
        p_user_id: userId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: networkKeys.all });
      void qc.invalidateQueries({ queryKey: dismissedCountKey(user?.id) });
    },
  });
}

/** Przywróć wszystkie ukryte sugestie. Zwraca liczbę przywróconych wierszy. */
export function useRestoreSuggestions(): UseMutationResult<number, Error, void> {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc("restore_connection_suggestions");
      if (error) throw error;
      return typeof data === "number" ? data : 0;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: networkKeys.all });
      void qc.invalidateQueries({ queryKey: dismissedCountKey(user?.id) });
    },
  });
}
