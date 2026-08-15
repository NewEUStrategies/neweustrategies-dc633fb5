// Wyszukiwanie w treści rozmów: cienki hook nad RPC search_messages.
//
// Po stronie bazy wektor, zapytanie i podświetlenie idą przez JEDNĄ
// konfigurację `public.nes_polish` (migracja 20260815090000): fleksja tam,
// gdzie serwer ma słownik, `simple` + `unaccent` tam, gdzie go nie ma - w obu
// przypadkach z prefiksem na lemacie, więc pole filtruje listę w trakcie
// pisania. Do 15.08 komentarz obiecywał tu „polską fleksję", a wektor stał na
// gołym `simple` - siedem wydań audytu z rzędu.
//
// RPC lustrzanie egzekwuje warunki RLS (tenant, członkostwo, expires_at,
// cleared_before) i wyklucza tombstony, więc klient niczego nie musi
// filtrować. Snippet wraca w konwencji [[[ ]]] - renderowanie przez
// <SearchSnippet>, nigdy innerHTML.
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Database } from "@/integrations/supabase/types";
import { chatKeys } from "./keys";

export type MessageSearchHit =
  Database["public"]["Functions"]["search_messages"]["Returns"][number];

export const MESSAGE_SEARCH_MIN_CHARS = 2;

/**
 * @param q          Szukana fraza (wołający debounce'uje wejście).
 * @param conversationId null = wszystkie rozmowy wołającego (skrzynka),
 *                       id = tylko jedna rozmowa (pasek w oknie czatu).
 */
export function useMessageSearch(
  q: string,
  conversationId: string | null,
  enabled = true,
): UseQueryResult<MessageSearchHit[]> {
  const { user } = useAuth();
  const query = q.trim();
  return useQuery({
    queryKey: chatKeys.messageSearch(user?.id, conversationId, query),
    enabled: enabled && !!user && query.length >= MESSAGE_SEARCH_MIN_CHARS,
    staleTime: 30_000,
    // Poprzednie trafienia zostają widoczne podczas dopisywania frazy -
    // lista nie miga pustym stanem między zapytaniami.
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<MessageSearchHit[]> => {
      const { data, error } = await supabase.rpc("search_messages", {
        _q: query,
        _conversation_id: conversationId ?? undefined,
        _limit: 30,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}
