// Warstwa danych macierzy uprawnień: warstwy członkostwa BIEŻĄCEGO tenanta.
//
// IZOLACJA OBSZARÓW ROBOCZYCH. `membership_tiers` jest per tenant i RLS pilnuje
// tego serwerowo (tenant_id = current_tenant_id()), ale zapytanie i tak filtruje
// po `tenant_id` jawnie - druga bramka po stronie klienta, dokładnie w duchu
// lib/tenant.ts. Klucz cache NIESIE tenant_id, więc przelogowanie do innego
// obszaru roboczego nie może pokazać kolumn warstw z poprzedniego (React Query
// serwowałby wtedy trafienie z cache pod wspólnym kluczem).
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTenantId } from "@/lib/tenant";
import type { TierInput } from "@/lib/authz/permissionMatrix";

export const permissionMatrixKeys = {
  /** Warstwy członkostwa jednego tenanta (kolumny macierzy). */
  tenantTiers: (tenantId: string | null) =>
    ["authz", "permission-matrix", "tiers", tenantId] as const,
  /** Prefiks do inwalidacji dla wszystkich tenantów. */
  all: () => ["authz", "permission-matrix"] as const,
};

/** Warstwy tenanta w kolejności rang (aktywne - nieaktywnych macierz nie opisuje). */
export async function fetchTenantMembershipTiers(tenantId: string): Promise<TierInput[]> {
  const { data, error } = await supabase
    .from("membership_tiers")
    .select("key, rank, name_pl, name_en, features, is_default")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("rank", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    key: row.key,
    rank: row.rank,
    name_pl: row.name_pl,
    name_en: row.name_en,
    features: row.features,
    is_default: row.is_default,
  }));
}

export interface TenantTiersState {
  readonly tiers: readonly TierInput[];
  readonly tenantId: string | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
}

/** Warstwy do kolumn macierzy + stan ładowania (bez warstw renderujemy same role). */
export function useTenantMembershipTiers(): TenantTiersState {
  const tenantId = useCurrentTenantId();
  const query: UseQueryResult<TierInput[]> = useQuery({
    enabled: tenantId !== null,
    queryKey: permissionMatrixKeys.tenantTiers(tenantId),
    queryFn: () => fetchTenantMembershipTiers(tenantId as string),
    staleTime: 5 * 60_000,
  });

  return {
    tiers: query.data ?? [],
    tenantId,
    isLoading: tenantId === null || query.isLoading,
    error: query.error instanceof Error ? query.error : null,
  };
}
