// WARSTWY CZŁONKOSTWA (`membership_tiers`) - DWAJ pisarze o ROZŁĄCZNYCH
// kolumnach (SPEC §3.2; S1 def. 11, PLAN S1 V25).
//
// DLACZEGO PODZIAŁ. Ten sam wiersz edytowały dwa panele: członkostwo
// (tożsamość, ranga, flagi egzekwowane przez bramki) i cennik (obietnica
// marketingowa). Członkostwo zapisywało przy okazji `benefits` i nazwy, więc
// zmiana benefitów w cenniku znikała po następnym zapisie rangi w drugiej
// karcie. Teraz:
//
//   * `useSaveTierCore`      - `/admin/membership`: `TIER_CORE_COLUMNS`,
//   * `useSaveTierMarketing` - `/admin/pricing?tab=tiers`: `TIER_MARKETING_COLUMNS`,
//
// oba z patchem jawnych kolumn i współbieżnością optymistyczną na surowym
// `updated_at` (konflikt = błąd `40001`, nie cichy lost update). Listy kolumn
// są TYMI SAMYMI listami co właściciele w `syncManifest.ts` - test pilnuje
// równości, więc trzeci zbiór nie powstanie.
//
// Tworzenie warstwy (klucz, ranga, nazwy) zostaje w członkostwie: bez nazwy
// warstwa nie istnieje, a cennik dopisuje jej marketing później.
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { couponKeys } from "@/lib/admin/couponKeys";
import { billingKeys } from "@/lib/billing/keys";
import {
  assertPatchColumns,
  invalidateKeys,
  revenueDomainKeys,
  staleWriteError,
} from "@/lib/billing/planQueries";
import { clubKeys } from "@/lib/clubs/queryKeys";
import type { RevenueDomain } from "@/lib/revenue/keys";
import { useCurrentTenantId } from "@/lib/tenant";

export type MembershipTierRow = Database["public"]["Tables"]["membership_tiers"]["Row"];
type MembershipTierWrite = Database["public"]["Tables"]["membership_tiers"]["Update"];

/** Rdzeń warstwy - właściciel `/admin/membership`. */
export const TIER_CORE_COLUMNS = [
  "key",
  "rank",
  "features",
  "active",
  "is_default",
] as const satisfies readonly (keyof MembershipTierRow)[];

/** Marketing warstwy - właściciel `/admin/pricing?tab=tiers`. */
export const TIER_MARKETING_COLUMNS = [
  "name_pl",
  "name_en",
  "description_pl",
  "description_en",
  "benefits",
  "badge_pl",
  "badge_en",
  "highlight",
  "cta_mode",
  "audience_key",
  "price_note_pl",
  "price_note_en",
  "contact_url",
  "per_seat",
  "pricing_visible",
] as const satisfies readonly (keyof MembershipTierRow)[];

export type TierCorePatch = Partial<Pick<MembershipTierWrite, (typeof TIER_CORE_COLUMNS)[number]>>;
export type TierMarketingPatch = Partial<
  Pick<MembershipTierWrite, (typeof TIER_MARKETING_COLUMNS)[number]>
>;

export interface SaveTierInput<P> {
  id: string;
  /** Surowe `updated_at` wiersza z chwili rozpoczęcia edycji (token). */
  expectedUpdatedAt: string;
  patch: P;
}

export interface CreateTierInput {
  key: string;
  rank: number;
  name_pl: string;
  name_en: string;
}

/** Domeny huba z reguły panelu `membership_tier.changed.v1`. */
const TIER_REVENUE_DOMAINS = [
  "offer",
  "access",
  "diagnostics",
] as const satisfies readonly RevenueDomain[];

async function patchTier(
  columns: readonly string[],
  input: SaveTierInput<MembershipTierWrite>,
): Promise<MembershipTierRow> {
  const patch: MembershipTierWrite = { ...input.patch };
  assertPatchColumns(patch, columns);
  const { data, error } = await supabase
    .from("membership_tiers")
    .update(patch)
    .eq("id", input.id)
    .eq("updated_at", input.expectedUpdatedAt)
    .select("*");
  if (error) throw error;
  const row = data?.[0];
  // 0 wierszy: ktoś zapisał warstwę po naszym odczycie (token się zmienił)
  // albo warstwa zniknęła - w obu przypadkach szkic admina jest nieaktualny.
  if (!row) throw staleWriteError();
  return row;
}

/** Zapis rdzenia (bez haka - testy i naprawy huba). */
export function saveTierCore(input: SaveTierInput<TierCorePatch>): Promise<MembershipTierRow> {
  return patchTier(TIER_CORE_COLUMNS, input);
}

/** Zapis marketingu (bez haka - testy i naprawy huba). */
export function saveTierMarketing(
  input: SaveTierInput<TierMarketingPatch>,
): Promise<MembershipTierRow> {
  return patchTier(TIER_MARKETING_COLUMNS, input);
}

/**
 * Nowa warstwa. `membership_tiers.tenant_id` NIE ma wartości domyślnej, więc
 * najemca przychodzi z SESJI (`useCurrentTenantId`) - nigdy z pierwszego
 * wiersza katalogu, jak dawniej (pusty katalog blokował pierwszą warstwę,
 * a wiersz z cache po zmianie obszaru roboczego wskazywał cudzego najemcę).
 * Polityka RLS i tak odrzuci najemcę spoza sesji.
 */
export async function createTier(
  tenantId: string | null,
  input: CreateTierInput,
): Promise<MembershipTierRow> {
  if (!tenantId) throw new Error("tenant_unresolved");
  const { data, error } = await supabase
    .from("membership_tiers")
    .insert({
      tenant_id: tenantId,
      key: input.key.trim(),
      rank: input.rank,
      name_pl: input.name_pl.trim(),
      name_en: input.name_en.trim(),
      benefits: [],
      features: {},
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTier(id: string): Promise<void> {
  const { data, error } = await supabase
    .from("membership_tiers")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  // RLS nie zgłasza błędu przy braku prawa - tylko nie usuwa. Sukces bez
  // usuniętego wiersza wprowadziłby admina w błąd.
  if (!data?.length) throw Object.assign(new Error("not_found"), { code: "P0002" });
}

export function useSaveTierCore() {
  const queryClient = useQueryClient();
  const tenantId = useCurrentTenantId();
  return useMutation({
    mutationFn: (input: SaveTierInput<TierCorePatch>) => saveTierCore(input),
    onSuccess: () => invalidateTierQueries(queryClient, tenantId),
  });
}

export function useSaveTierMarketing() {
  const queryClient = useQueryClient();
  const tenantId = useCurrentTenantId();
  return useMutation({
    mutationFn: (input: SaveTierInput<TierMarketingPatch>) => saveTierMarketing(input),
    onSuccess: () => invalidateTierQueries(queryClient, tenantId),
  });
}

export function useCreateTier() {
  const queryClient = useQueryClient();
  const tenantId = useCurrentTenantId();
  return useMutation({
    mutationFn: (input: CreateTierInput) => createTier(tenantId, input),
    onSuccess: () => invalidateTierQueries(queryClient, tenantId),
  });
}

export function useDeleteTier() {
  const queryClient = useQueryClient();
  const tenantId = useCurrentTenantId();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => deleteTier(id),
    onSuccess: () => invalidateTierQueries(queryClient, tenantId),
  });
}

/**
 * Klucze WSZYSTKICH czytelników warstwy: reguła rdzenia
 * `membership_tier.changed.v1` + dziedziny huba z rozszerzenia panelu.
 *
 * Dwa klucze stoją literałem, bo nie mają fabryki-liścia (ta sama decyzja co
 * w regule szyny, przypięta w `revenueInvalidation.test.ts`):
 *   * `["authz", "permission-matrix", "tiers"]` - prefiks
 *     `permissionMatrixKeys.tenantTiers` (plik hooków; import wciągnąłby tu
 *     warstwę zapytań macierzy uprawnień);
 *   * `["admin-membership-tiers"]` - zapytanie `VerificationDomainsCard`.
 * Brak fabryki dla nich to zgłoszenie „Do integracji".
 */
export function tierInvalidationKeys(tenantId: string | null): QueryKey[] {
  return [
    billingKeys.membershipTiers(),
    billingKeys.admin.membershipTiers(),
    billingKeys.currentTierAll(),
    billingKeys.crmLeadMembershipAll(),
    couponKeys.tiers(),
    ["authz", "permission-matrix", "tiers"],
    ["admin-membership-tiers"],
    billingKeys.admin.members(),
    clubKeys.all,
    ...revenueDomainKeys(TIER_REVENUE_DOMAINS, tenantId),
  ];
}

export function invalidateTierQueries(
  queryClient: QueryClient,
  tenantId: string | null,
): Promise<void> {
  return invalidateKeys(queryClient, tierInvalidationKeys(tenantId));
}
