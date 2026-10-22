// `queryOptions` inwentarza dostępu huba (S3, kontrakt §5.4: 30 s).
//
// Klucz z fabryki I0 (`revenueKeys.accessInventory`) - prefiks
// `["admin-revenue", "access", najemca]`, w który trafiają reguły szyny
// `content_access.changed.v1`, `access_plan.changed.v1`,
// `membership_tier.changed.v1`, `paywall.hit.v1` (rozszerzenie panelu I0).
// Zmiana reguły w edytorze wpisu odświeża więc inwentarz w hubie bez
// przeładowania - i odwrotnie, naprawa z huba woła mutator modułu.
import { queryOptions } from "@tanstack/react-query";
import { revenueKeys } from "@/lib/revenue/keys";
import type { AccessInventoryRead } from "./dto";
import { getRevenueAccessInventory } from "./access.functions";

export const ACCESS_INVENTORY_STALE_MS = 30_000;
export const ACCESS_INVENTORY_GC_MS = 10 * 60_000;

export function revenueAccessInventoryQueryOptions(tenantId: string | null) {
  return queryOptions<AccessInventoryRead>({
    queryKey: revenueKeys.accessInventory(tenantId ?? ""),
    queryFn: () => getRevenueAccessInventory(),
    enabled: Boolean(tenantId),
    staleTime: ACCESS_INVENTORY_STALE_MS,
    gcTime: ACCESS_INVENTORY_GC_MS,
    retry: 1,
  });
}
