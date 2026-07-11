// Katalog osób: wyszukiwanie z filtrami fasetowymi i paginacją offsetową.
//
// search_people (SECURITY DEFINER, tylko authenticated) zwraca okno wyników
// z total_count, więc "Pokaż więcej" wie, kiedy skończyć. Fasety pochodzą z
// people_filter_options() - unikalne wartości specjalizacji/firmy/lokalizacji
// wśród widocznych (discoverable) profili tenanta wywołującego.
import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { PersonHit } from "@/lib/chat/types";

export interface PeopleFilters {
  specialization: string | null;
  company: string | null;
  location: string | null;
}

export const EMPTY_PEOPLE_FILTERS: PeopleFilters = {
  specialization: null,
  company: null,
  location: null,
};

const PAGE_SIZE = 24;

export function usePeopleDirectory(
  query: string,
  filters: PeopleFilters,
  pageSize = PAGE_SIZE,
): UseInfiniteQueryResult<InfiniteData<PersonHit[]>> {
  const { user } = useAuth();
  const q = query.trim();
  return useInfiniteQuery({
    queryKey: [
      "people",
      "directory",
      user?.id ?? "anon",
      q,
      filters.specialization,
      filters.company,
      filters.location,
      pageSize,
    ],
    enabled: !!user,
    staleTime: 30_000,
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<PersonHit[]> => {
      const { data, error } = await supabase.rpc("search_people", {
        p_query: q,
        p_specialization: filters.specialization ?? undefined,
        p_company: filters.company ?? undefined,
        p_location: filters.location ?? undefined,
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

export interface PeopleFacets {
  specialization: { value: string; cnt: number }[];
  company: { value: string; cnt: number }[];
  location: { value: string; cnt: number }[];
}

export function usePeopleFacets(): UseQueryResult<PeopleFacets> {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["people", "filter-options", user?.id ?? "anon"],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<PeopleFacets> => {
      const { data, error } = await supabase.rpc("people_filter_options");
      if (error) throw error;
      const facets: PeopleFacets = { specialization: [], company: [], location: [] };
      for (const row of data ?? []) {
        if (row.field === "specialization" || row.field === "company" || row.field === "location") {
          facets[row.field].push({ value: row.value, cnt: row.cnt });
        }
      }
      return facets;
    },
  });
}
