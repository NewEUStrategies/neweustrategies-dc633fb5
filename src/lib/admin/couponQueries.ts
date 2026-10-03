// UNIEWAŻNIANIE PO MUTACJI KUPONU B2B - jedno miejsce dla wszystkich ekranów,
// które kupony tworzą, przełączają, kasują albo generują hurtem.
//
// PO CO. Kupony czytają DWA niezależne wpisy cache'u: lista panelu
// (`["admin", "b2b-coupons"]`, razem z katalogami planów i poziomów pod nią)
// i analityka kuponów na /admin/coupons/analytics, która od 2026-10 mieszka pod
// fabryką analityki (`["admin-analytics", <najemca>, "b2b-coupons", od, do]`).
// Mutacje unieważniały wyłącznie pierwszy, a `b2b_coupons_analytics` liczy po
// WSZYSTKICH kuponach najemcy (LEFT JOIN do realizacji) - nowy kod, skasowany
// kod i hurt wygenerowany z kampanii zmieniają ranking od razu. Bez drugiego
// unieważnienia analityka pokazywała skasowany kupon i nie znała nowego, dopóki
// nie minął `staleTime` albo ktoś nie przeładował strony.
//
// ZAKRES DAT jest nieznany w miejscu mutacji (stan ekranu analityki), więc
// unieważnienie idzie po PREFIKSIE najemcy (`analyticsCouponsPrefixKey`), który
// trafia w każdy zapamiętany zakres - i w nic poza analityką kuponów.
import type { QueryClient } from "@tanstack/react-query";

import { analyticsCouponsPrefixKey, analyticsRootKey } from "@/lib/analytics/queryKeys";

/** Lista kuponów panelu i jej katalogi (`plans`, `tiers`) - prefiks wspólny. */
export const ADMIN_COUPONS_KEY = ["admin", "b2b-coupons"] as const;

/**
 * Unieważnia listę kuponów i analitykę kuponów najemcy `tenantId`.
 *
 * NIEUSTALONY NAJEMCA (`null` - `useCurrentTenantId` jeszcze w drodze) nie jest
 * powodem, żeby analitykę pominąć: zapis już się odbył, tylko nie wiemy, pod
 * którym najemcą leży jego analityka. Wtedy unieważnienie idzie po KORZENIU
 * analityki - nadmiarowe, ale tanie (odświeżają się wyłącznie zapytania
 * aktywne, reszta dostaje tylko znacznik „nieaktualne"), a nigdy fałszywie
 * świeże.
 *
 * Obietnica rozstrzyga się po odświeżeniu aktywnych zapytań - `onSuccess`
 * mutacji może ją zwrócić, żeby `isPending` trwało do chwili, w której lista
 * już pokazuje zmianę.
 */
export async function invalidateCouponQueries(
  queryClient: QueryClient,
  tenantId: string | null,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ADMIN_COUPONS_KEY }),
    queryClient.invalidateQueries({
      queryKey: tenantId ? analyticsCouponsPrefixKey(tenantId) : analyticsRootKey(),
    }),
  ]);
}
