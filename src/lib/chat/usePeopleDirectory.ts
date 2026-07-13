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
  /** Rola/stanowisko (kolumna profiles.job_title). */
  jobTitle: string | null;
  /** Tylko profile z weryfikacją zawodową (profiles.verified_at). */
  verifiedOnly: boolean;
}

export const EMPTY_PEOPLE_FILTERS: PeopleFilters = {
  specialization: null,
  company: null,
  location: null,
  jobTitle: null,
  verifiedOnly: false,
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
      filters.jobTitle,
      filters.verifiedOnly,
      pageSize,
    ],
    enabled: !!user,
    staleTime: 30_000,
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<PersonHit[]> => {
      // p_job_title/p_verified_only są nowsze niż wygenerowane typy - stąd cast.
      const { data, error } = await supabase.rpc("search_people", {
        p_query: q,
        p_specialization: filters.specialization ?? undefined,
        p_company: filters.company ?? undefined,
        p_location: filters.location ?? undefined,
        p_limit: pageSize,
        p_offset: pageParam,
        p_job_title: filters.jobTitle ?? undefined,
        p_verified_only: filters.verifiedOnly || undefined,
      } as never);
      if (error) throw error;
      return (data ?? []) as PersonHit[];
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
  job_title: { value: string; cnt: number }[];
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
      const facets: PeopleFacets = {
        specialization: [],
        company: [],
        location: [],
        job_title: [],
      };
      for (const row of data ?? []) {
        if (
          row.field === "specialization" ||
          row.field === "company" ||
          row.field === "location" ||
          row.field === "job_title"
        ) {
          facets[row.field].push({ value: row.value, cnt: row.cnt });
        }
      }
      return facets;
    },
  });
}
