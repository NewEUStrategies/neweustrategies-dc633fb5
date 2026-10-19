// Odczyt nadań warstwy poza planem - JEDNO `queryOptions` dla listy w sekcji
// Nadania i licznika „Aktywne nadania" w nagłówku panelu Członkostwa.
//
// Osobny, mały moduł (a nie eksport z organizmu `GrantsSection`): dzięki temu
// organizm eksportuje wyłącznie komponent (szybkie odświeżanie w trybie
// deweloperskim), a lekki `membershipQueries.ts`, który importuje też chunk
// Cennika, nie wciąga warstwy nadań i katalogu członków.
import { queryOptions } from "@tanstack/react-query";

import { fetchMembershipGrants } from "@/lib/admin/membership-admin";
import { billingKeys } from "@/lib/billing/keys";

/** Nadania warstwy poza planem (aktywne i cofnięte - historia zostaje). */
export function adminMembershipGrantsQueryOptions() {
  return queryOptions({
    queryKey: billingKeys.admin.membershipGrants(),
    queryFn: fetchMembershipGrants,
  });
}
