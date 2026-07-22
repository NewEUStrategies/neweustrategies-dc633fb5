// Warstwa danych Cennika 2.0: segmenty odbiorców (pricing_audiences) i FAQ
// cennika (pricing_faq_items). queryOptions są współdzielone przez loader
// trasy /pricing (prefetch SSR) i hooki komponentów - jeden klucz zapytania,
// jedno źródło prawdy, zero rozjazdów cache.
import { queryOptions, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type PricingAudienceRow = Database["public"]["Tables"]["pricing_audiences"]["Row"];
export type PricingFaqItemRow = Database["public"]["Tables"]["pricing_faq_items"]["Row"];

// Jawny filtr active=true: polityka publiczna RLS i tak go wymusza, ale admin
// (polityka staff read) widzi też wiersze nieaktywne - strona publiczna ma
// wyglądać identycznie niezależnie od roli oglądającego.
export function pricingAudiencesQueryOptions() {
  return queryOptions({
    queryKey: ["pricing-audiences"],
    staleTime: 60_000,
    queryFn: async (): Promise<PricingAudienceRow[]> => {
      const { data, error } = await supabase
        .from("pricing_audiences")
        .select("*")
        .eq("active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function pricingFaqQueryOptions() {
  return queryOptions({
    queryKey: ["pricing-faq"],
    staleTime: 60_000,
    queryFn: async (): Promise<PricingFaqItemRow[]> => {
      const { data, error } = await supabase
        .from("pricing_faq_items")
        .select("*")
        .eq("active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePricingAudiences(): UseQueryResult<PricingAudienceRow[]> {
  return useQuery(pricingAudiencesQueryOptions());
}

export function usePricingFaq(): UseQueryResult<PricingFaqItemRow[]> {
  return useQuery(pricingFaqQueryOptions());
}
