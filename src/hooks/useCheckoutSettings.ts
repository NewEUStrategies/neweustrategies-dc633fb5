// Odczyt ustawień checkoutu (kupony/podatki/faktury) po stronie klienta -
// strona /checkout pokazuje na ich podstawie wskazówkę o kodach promocyjnych,
// a panel admina edytuje singleton. Egzekwowanie i tak jest serwerowe
// (createCheckoutOrder czyta ustawienia własnym zapytaniem).
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  CHECKOUT_SETTINGS_COLUMNS,
  normalizeCheckoutSettings,
  type CheckoutSettings,
} from "@/lib/billing/checkoutSettings";

export const CHECKOUT_SETTINGS_QUERY_KEY = ["checkout-settings"] as const;

export async function fetchCheckoutSettings(): Promise<CheckoutSettings> {
  const { data, error } = await supabase
    .from("checkout_settings")
    .select(CHECKOUT_SETTINGS_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return normalizeCheckoutSettings(data);
}

export function useCheckoutSettings(): UseQueryResult<CheckoutSettings> {
  return useQuery({
    queryKey: CHECKOUT_SETTINGS_QUERY_KEY,
    queryFn: fetchCheckoutSettings,
    staleTime: 5 * 60_000,
  });
}
