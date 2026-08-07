// Katalog osób: wyszukiwanie z filtrami fasetowymi i paginacją offsetową.
//
// search_people (SECURITY DEFINER, tylko authenticated) zwraca okno wyników
// z total_count, więc "Pokaż więcej" wie, kiedy skończyć. Fasety pochodzą z
// people_filter_options() - unikalne wartości specjalizacji/firmy/lokalizacji/
// roli oraz kody intencji (open_to) wśród widocznych (discoverable) profili
// tenanta wywołującego.
//
// WARSTWA SEMANTYCZNA (20260807144000): gdy tryb semantyczny jest włączony
// i fraza ma sens, hook najpierw prosi serwer o wektor zapytania
// (`embedPeopleQuery`), a potem podaje go do `search_people` jako
// `p_embedding`. BLEND LICZY BAZA, nie klient - inaczej stronicowanie
// offsetowe sortowałoby każdą stronę osobno i wyniki skakałyby przy "Pokaż
// więcej". Brak wektora (bramka bez embeddingów, krótka fraza, wyłączony
// przełącznik) = zachowanie dokładnie jak wcześniej: czysty trigram.
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
import {
  normalizeProfileIntents,
  serializeProfileIntents,
  type ProfileIntentCode,
} from "@/lib/profile/intents";
import { PEOPLE_SEMANTIC_MIN_CHARS } from "@/lib/search/peopleSemantic.functions";

export interface PeopleFilters {
  specialization: string | null;
  company: string | null;
  location: string | null;
  /** Rola/stanowisko (kolumna profiles.job_title). */
  jobTitle: string | null;
  /** Tylko profile z weryfikacją zawodową (profiles.verified_at). */
  verifiedOnly: boolean;
  /**
   * Intencja: "na co ta osoba jest otwarta" (profiles.open_to). Lista, nie
   * pojedyncza wartość - baza dopasowuje operatorem `&&` (OR w grupie), więc
   * multi-select nie wymaga zmiany kontraktu.
   */
  openTo: ProfileIntentCode[];
  /**
   * Tryb semantyczny: dopasowanie po ZNACZENIU frazy, nie po literalnym
   * podciągu. Kosztuje jedno wywołanie bramki AI per fraza (cache w procesie
   * serwera), więc jest jawnym wyborem użytkownika, nie domyślnym trybem.
   */
  semantic: boolean;
}

export const EMPTY_PEOPLE_FILTERS: PeopleFilters = {
  specialization: null,
  company: null,
  location: null,
  jobTitle: null,
  verifiedOnly: false,
  openTo: [],
  semantic: false,
};

const PAGE_SIZE = 24;

/** Czy dla tej frazy w ogóle warto pytać o wektor zapytania. */
export function shouldEmbedPeopleQuery(query: string, semantic: boolean): boolean {
  return semantic && query.trim().length >= PEOPLE_SEMANTIC_MIN_CHARS;
}

/**
 * Wektor zapytania dla trybu semantycznego. Osobny query (a nie fetch w środku
 * `queryFn` katalogu), żeby zmiana samych FILTRÓW nie prosiła bramki AI o ten
 * sam wektor jeszcze raz - cache React Query trzyma go per fraza.
 */
export function usePeopleQueryEmbedding(
  query: string,
  semantic: boolean,
): UseQueryResult<number[] | null> {
  const q = query.trim();
  const enabled = shouldEmbedPeopleQuery(q, semantic);
  return useQuery({
    queryKey: ["people", "query-embedding", q.toLowerCase()],
    enabled,
    // Wektor frazy nigdy się nie zmienia - trzymamy go do końca sesji karty.
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
    queryFn: async (): Promise<number[] | null> => {
      const { embedPeopleQuery } = await import("@/lib/search/peopleSemantic.functions");
      const { embedding } = await embedPeopleQuery({ data: { q } });
      return embedding;
    },
  });
}

export interface PeopleDirectoryResult {
  people: UseInfiniteQueryResult<InfiniteData<PersonHit[]>>;
  /** Czy wyniki są już wzbogacone semantycznie (UI pokazuje to jawnie). */
  semanticActive: boolean;
  /** Tryb włączony, ale bramka embeddingów nie odpowiedziała - degradacja. */
  semanticUnavailable: boolean;
}

export function usePeopleDirectory(
  query: string,
  filters: PeopleFilters,
  pageSize = PAGE_SIZE,
): PeopleDirectoryResult {
  const { user } = useAuth();
  const q = query.trim();
  const wantsSemantic = shouldEmbedPeopleQuery(q, filters.semantic);
  const embeddingQ = usePeopleQueryEmbedding(q, filters.semantic);
  const embedding = wantsSemantic ? (embeddingQ.data ?? null) : null;
  const openTo = normalizeProfileIntents(filters.openTo);

  const people = useInfiniteQuery({
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
      serializeProfileIntents(openTo),
      // Sam FAKT posiadania wektora jest częścią klucza (nie 768 liczb):
      // ranking zmienia się binarnie, a wektor jest funkcją frazy, która
      // już w kluczu jest.
      embedding !== null,
      pageSize,
    ],
    // Czekamy na wektor, zamiast pokazać wynik trigramowy i przesortować go
    // sekundę później - migający ranking jest gorszy niż moment ładowania.
    enabled: !!user && (!wantsSemantic || !embeddingQ.isLoading),
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
        p_job_title: filters.jobTitle ?? undefined,
        p_verified_only: filters.verifiedOnly || undefined,
        p_open_to: openTo.length > 0 ? openTo : undefined,
        p_embedding: embedding ?? undefined,
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

  return {
    people,
    semanticActive: embedding !== null,
    semanticUnavailable:
      wantsSemantic && !embeddingQ.isLoading && (embeddingQ.data ?? null) === null,
  };
}

export interface PeopleFacets {
  specialization: { value: string; cnt: number }[];
  company: { value: string; cnt: number }[];
  location: { value: string; cnt: number }[];
  job_title: { value: string; cnt: number }[];
  /** Kody intencji z licznikami - etykiety pochodzą z i18n, nie z bazy. */
  open_to: { value: ProfileIntentCode; cnt: number }[];
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
        open_to: [],
      };
      for (const row of data ?? []) {
        if (
          row.field === "specialization" ||
          row.field === "company" ||
          row.field === "location" ||
          row.field === "job_title"
        ) {
          facets[row.field].push({ value: row.value, cnt: row.cnt });
          continue;
        }
        if (row.field === "open_to") {
          // Kody nieznane katalogowi klienckiemu odpadają - fasety nie mogą
          // wprowadzić do URL-a wartości, której `search_people` nie przyjmie.
          const [code] = normalizeProfileIntents([row.value]);
          if (code) facets.open_to.push({ value: code, cnt: row.cnt });
        }
      }
      return facets;
    },
  });
}
