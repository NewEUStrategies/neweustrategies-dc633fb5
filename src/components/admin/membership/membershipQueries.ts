// Odczyt katalogu warstw członkostwa - JEDNO `queryOptions` dla Cennika
// (marketing warstwy) i Członkostwa (rdzeń warstwy, mapowanie planów).
//
// DLACZEGO WSPÓLNE. Oba panele czytały `membership_tiers` pod tym samym
// kluczem `billingKeys.admin.membershipTiers()`, każdy własną `queryFn`
// zapisaną w organizmie. Dwie funkcje pod jednym kluczem to ta sama pułapka co
// odpowiedzi retencji przed S1 (def. 13): kto pierwszy wypełni cache, ten
// decyduje, co widzi drugi ekran. Jedno `queryOptions` = jeden kształt wiersza,
// jedna kolejność (warstwy po randze, jak strona publiczna) i jeden wpis
// cache, który unieważniają reguła szyny `membership_tier.changed.v1`
// i mutatory `tierMutations.ts` - zapis w jednym panelu widać w drugim bez
// przeładowania.
//
// Moduł jest lekki celowo (bez warstwy nadań i katalogu członków): importuje
// go też chunk Cennika. Dom tymczasowy - `src/lib/billing/*` leży poza plikami
// toru T3 wycinka S1; przeniesienie obok `tierMutations.ts` to zgłoszenie
// „Do integracji".
import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { billingKeys } from "@/lib/billing/keys";
import type { MembershipTierRow } from "@/lib/billing/tierMutations";

/** Wszystkie warstwy najemcy (także nieaktywne) z tokenem `updated_at`. */
export function adminMembershipTiersQueryOptions() {
  return queryOptions({
    queryKey: billingKeys.admin.membershipTiers(),
    queryFn: async (): Promise<MembershipTierRow[]> => {
      const { data, error } = await supabase
        .from("membership_tiers")
        .select("*")
        .order("rank", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}
