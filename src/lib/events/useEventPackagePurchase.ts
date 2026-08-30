// Hooki zakupu pakietu grupowego po stronie KUPUJACEGO.
//
// WYCENA JEST ZAPYTANIEM, NIE MUTACJA: `event_admission_quote` niczego nie
// zmienia, a ekran pyta o nia przy kazdej zmianie kodu rabatowego - stad
// `useQuery` z krotkim czasem swiezosci zamiast mutacji z lokalnym stanem.
//
// PO ZAKUPIE UNIEWAZNIAMY TAKZE OFERTE: zakup zdejmuje zestaw z puli, wiec
// „zostalo 3" na sasiedniej karcie musi sie przeliczyc bez odswiezania strony.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  fetchMyPackageOrders,
  fetchMyPackageSeats,
  fetchPackagesOffer,
  inviteMyPackageSeat,
  purchasePackage,
  quoteAdmission,
  type AdmissionQuote,
  type AdmissionQuoteInput,
  type BuyerSeatInvite,
  type BuyerSeatInviteInput,
  type EventPackageOfferRow,
  type MyPackageOrderRow,
  type MyPackageSeatRow,
  type PackagePurchaseInput,
  type PackagePurchaseResult,
} from "@/lib/events/admissionApi";

export const admissionKeys = {
  all: ["event-admission"] as const,
  offer: (slug: string) => [...admissionKeys.all, "offer", slug] as const,
  quote: (input: AdmissionQuoteInput) =>
    [
      ...admissionKeys.all,
      "quote",
      input.packageId ?? input.ticketTypeId ?? "none",
      (input.couponCode ?? "").trim().toUpperCase(),
    ] as const,
  myOrders: () => [...admissionKeys.all, "my-orders"] as const,
  mySeats: (orderId: string | null) =>
    [...admissionKeys.all, "my-seats", orderId ?? "idle"] as const,
};

export function usePackagesOffer(
  slug: string,
  enabled = true,
): UseQueryResult<EventPackageOfferRow[], Error> {
  return useQuery({
    queryKey: admissionKeys.offer(slug),
    queryFn: () => fetchPackagesOffer(slug),
    enabled: enabled && slug !== "",
    staleTime: 30_000,
  });
}

export function useAdmissionQuote(
  input: AdmissionQuoteInput | null,
): UseQueryResult<AdmissionQuote, Error> {
  return useQuery({
    queryKey: admissionKeys.quote(input ?? {}),
    queryFn: () => quoteAdmission(input as AdmissionQuoteInput),
    enabled: input !== null,
    staleTime: 10_000,
  });
}

export function useMyPackageOrders(enabled = true): UseQueryResult<MyPackageOrderRow[], Error> {
  return useQuery({
    queryKey: admissionKeys.myOrders(),
    queryFn: fetchMyPackageOrders,
    enabled,
    staleTime: 15_000,
  });
}

export function useMyPackageSeats(
  orderId: string | null,
): UseQueryResult<MyPackageSeatRow[], Error> {
  return useQuery({
    queryKey: admissionKeys.mySeats(orderId),
    queryFn: () => (orderId === null ? Promise.resolve([]) : fetchMyPackageSeats(orderId)),
    enabled: orderId !== null,
    staleTime: 10_000,
  });
}

function useInvalidate(): () => void {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: admissionKeys.all });
  };
}

export function usePurchasePackage(): UseMutationResult<
  PackagePurchaseResult,
  Error,
  PackagePurchaseInput
> {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: purchasePackage, onSuccess: invalidate });
}

export function useInviteMyPackageSeat(): UseMutationResult<
  BuyerSeatInvite,
  Error,
  BuyerSeatInviteInput
> {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: inviteMyPackageSeat, onSuccess: invalidate });
}
