// Współdzielony odczyt konfiguracji darowizn po stronie klienta.
//
// Formularz `/donate`, strona `/support` i CTA widgetu CMS potrzebują tej samej
// odpowiedzi. Jeden `queryKey` + długi `staleTime` sprawiają, że trzy
// powierzchnie na jednej stronie kosztują JEDEN odczyt (serwer i tak trzyma
// wynik 60 s w cache per izolat), a przełączenie trybu w panelu propaguje się
// wszędzie naraz.
//
// Dopóki odpowiedź nie wróci, konsumenci dostają `DONATIONS_DEFAULTS` - stan
// „moduł włączony, własna kasa". To świadomy wybór: domyślka prowadzi na
// `/donate`, a ta strona i tak sama zdegraduje się do linku zewnętrznego, jeśli
// najemca zbiera przez zbiórkę. Odwrotna domyślka wyrzucałaby ludzi z serwisu.
import { useQuery } from "@tanstack/react-query";
import { getDonationsConfig } from "@/lib/billing/donations.functions";
import { DONATIONS_DEFAULTS, type DonationsConfig } from "@/lib/billing/donationsConfig";
import { resolveDonationTarget, type DonationTarget } from "@/lib/billing/donationTarget";

const donationsConfigQueryOptions = {
  queryKey: ["donations", "config"] as const,
  queryFn: () => getDonationsConfig(),
  staleTime: 5 * 60_000,
  gcTime: 30 * 60_000,
} as const;

export interface DonationsConfigState {
  config: DonationsConfig;
  target: DonationTarget;
  /** `true` tylko przy pierwszym pobraniu - do szkieletu formularza. */
  isLoading: boolean;
}

export function useDonationsConfig(): DonationsConfigState {
  const query = useQuery(donationsConfigQueryOptions);
  const config = query.data ?? DONATIONS_DEFAULTS;
  return { config, target: resolveDonationTarget(config), isLoading: query.isLoading };
}

/** Skrót dla powierzchni, które potrzebują wyłącznie celu (CTA, linki). */
export function useDonationTarget(): DonationTarget {
  return useDonationsConfig().target;
}
