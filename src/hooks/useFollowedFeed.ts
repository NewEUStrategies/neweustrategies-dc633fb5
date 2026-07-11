// Feed "Obserwowane": realne posty obserwowanych autorów / kategorii / tagów.
//
// Do tej pory zakładka Obserwowane renderowała wyłącznie chipy z nazwami
// obserwowanych bytów - obserwowanie autora nie miało żadnego efektu. RPC
// get_followed_feed zwraca opublikowane posty tenanta z tablicą reasons
// ('author' | 'category' | 'tag') i oknem total_count do paginacji.
import {
  useInfiniteQuery,
  type UseInfiniteQueryResult,
  type InfiniteData,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Database } from "@/integrations/supabase/types";

export type FollowedFeedItem =
  Database["public"]["Functions"]["get_followed_feed"]["Returns"][number];

const DEFAULT_PAGE_SIZE = 12;

export function useFollowedFeed(
  pageSize = DEFAULT_PAGE_SIZE,
): UseInfiniteQueryResult<InfiniteData<FollowedFeedItem[]>> {
  const { user } = useAuth();
  return useInfiniteQuery({
    queryKey: ["followed-feed", user?.id ?? "anon", pageSize],
    enabled: !!user,
    staleTime: 30_000,
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<FollowedFeedItem[]> => {
      const { data, error } = await supabase.rpc("get_followed_feed", {
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
