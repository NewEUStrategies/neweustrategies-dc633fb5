// Hooki katalogu specjalizacji klubów.
//
// Katalog jest mały i rzadko się zmienia, więc trzymamy go długo w cache -
// siatka na hubie nie może migotać przy każdym wejściu. Lista klubów
// w specjalizacji ma krótszy stale time, bo liczniki wątków żyją.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  deleteClubSpecialization,
  fetchAdminClubSpecializations,
  fetchClubsBySpecialization,
  fetchPublicClubSpecializations,
  setClubSpecializationActive,
  upsertClubSpecialization,
  type ClubSpecializationAdminRow,
  type ClubSpecializationClubsPage,
  type ClubSpecializationRow,
  type ClubSpecializationUpsertInput,
} from "@/lib/clubs/specializationsApi";

export const clubSpecializationKeys = {
  all: ["club-specializations"] as const,
  publicList: () => [...clubSpecializationKeys.all, "public"] as const,
  admin: () => [...clubSpecializationKeys.all, "admin"] as const,
  clubs: (slug: string, limit: number) =>
    [...clubSpecializationKeys.all, "clubs", slug, limit] as const,
};

const SPEC_STALE_MS = 5 * 60 * 1000;

export function useClubSpecializations(
  enabled = true,
): UseQueryResult<ClubSpecializationRow[], Error> {
  return useQuery({
    queryKey: clubSpecializationKeys.publicList(),
    queryFn: fetchPublicClubSpecializations,
    staleTime: SPEC_STALE_MS,
    enabled,
  });
}

export function useClubsBySpecialization(
  slug: string,
  limit = 60,
  enabled = true,
): UseQueryResult<ClubSpecializationClubsPage, Error> {
  return useQuery({
    queryKey: clubSpecializationKeys.clubs(slug, limit),
    queryFn: () => fetchClubsBySpecialization(slug, { limit }),
    staleTime: 30_000,
    enabled: enabled && slug.length > 0,
  });
}

export function useAdminClubSpecializations(
  enabled = true,
): UseQueryResult<ClubSpecializationAdminRow[], Error> {
  return useQuery({
    queryKey: clubSpecializationKeys.admin(),
    queryFn: fetchAdminClubSpecializations,
    staleTime: 30_000,
    enabled,
  });
}

function useSpecializationInvalidation(): () => void {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: clubSpecializationKeys.all });
  };
}

export function useUpsertClubSpecialization(): UseMutationResult<
  string,
  Error,
  ClubSpecializationUpsertInput
> {
  const invalidate = useSpecializationInvalidation();
  return useMutation({
    mutationFn: upsertClubSpecialization,
    onSuccess: invalidate,
  });
}

export function useSetClubSpecializationActive(): UseMutationResult<
  boolean,
  Error,
  { id: string; isActive: boolean }
> {
  const invalidate = useSpecializationInvalidation();
  return useMutation({
    mutationFn: ({ id, isActive }) => setClubSpecializationActive(id, isActive),
    onSuccess: invalidate,
  });
}

export function useDeleteClubSpecialization(): UseMutationResult<boolean, Error, string> {
  const invalidate = useSpecializationInvalidation();
  return useMutation({
    mutationFn: deleteClubSpecialization,
    onSuccess: invalidate,
  });
}
