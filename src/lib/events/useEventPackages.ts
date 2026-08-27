// Hooki pakietow grupowych wydarzenia.
//
// UNIEWAZNIAMY GALAZ WYDARZENIA, NIE POJEDYNCZE ZAPYTANIE. Zaproszenie na
// miejsce rusza jednoczesnie liste miejsc, licznik zaproszonych w zamowieniu i
// licznik przypisanych w pakiecie; kasowanie jednego klucza zostawialoby dwa
// ekrany z nieaktualna, ale wiarygodnie wygladajaca liczba.
//
// LISTY ZGLOSZEN TEZ SA NIEWAZNE PO ZAPROSZENIU: przyjete zaproszenie tworzy
// zapis uczestnika, wiec zakladka „Zgloszenia" musi go zobaczyc bez odswiezania
// strony. Stad drugi klucz w unievaznieniu.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  createPackageOrder,
  deleteEventPackage,
  fetchEventPackages,
  fetchPackageOrders,
  fetchPackageSeats,
  invitePackageSeat,
  revokePackageSeat,
  saveEventPackage,
  setPackageOrderStatus,
  type EventPackageInput,
  type EventPackageOrderRow,
  type EventPackageRow,
  type EventPackageSeatRow,
  type PackageOrderInput,
  type PackageOrderStatus,
  type PackageSeatInvite,
  type PackageSeatInviteInput,
} from "@/lib/events/packagesApi";
import { registrationKeys } from "@/lib/events/useEventRegistrations";

export const packageKeys = {
  all: ["event-packages"] as const,
  event: (eventId: string) => [...packageKeys.all, eventId] as const,
  list: (eventId: string) => [...packageKeys.event(eventId), "list"] as const,
  orders: (eventId: string, packageId: string | null) =>
    [...packageKeys.event(eventId), "orders", packageId ?? "all"] as const,
  seats: (orderId: string | null) =>
    orderId === null
      ? ([...packageKeys.all, "seats", "idle"] as const)
      : ([...packageKeys.all, "seats", orderId] as const),
};

export function useEventPackages(eventId: string): UseQueryResult<EventPackageRow[], Error> {
  return useQuery({
    queryKey: packageKeys.list(eventId),
    queryFn: () => fetchEventPackages(eventId),
    staleTime: 30_000,
  });
}

export function usePackageOrders(
  eventId: string,
  packageId: string | null,
): UseQueryResult<EventPackageOrderRow[], Error> {
  return useQuery({
    queryKey: packageKeys.orders(eventId, packageId),
    queryFn: () => fetchPackageOrders(eventId, packageId),
    staleTime: 15_000,
  });
}

export function usePackageSeats(
  orderId: string | null,
): UseQueryResult<EventPackageSeatRow[], Error> {
  return useQuery({
    queryKey: packageKeys.seats(orderId),
    queryFn: () => (orderId === null ? Promise.resolve([]) : fetchPackageSeats(orderId)),
    enabled: orderId !== null,
    staleTime: 10_000,
  });
}

function useEventInvalidation(eventId: string): () => void {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: packageKeys.event(eventId) });
    void client.invalidateQueries({ queryKey: packageKeys.all });
    void client.invalidateQueries({ queryKey: registrationKeys.event(eventId) });
  };
}

export function useSaveEventPackage(
  eventId: string,
): UseMutationResult<string, Error, EventPackageInput> {
  const invalidate = useEventInvalidation(eventId);
  return useMutation({
    mutationFn: saveEventPackage,
    onSuccess: invalidate,
  });
}

export function useDeleteEventPackage(eventId: string): UseMutationResult<boolean, Error, string> {
  const invalidate = useEventInvalidation(eventId);
  return useMutation({
    mutationFn: deleteEventPackage,
    onSuccess: invalidate,
  });
}

export function useCreatePackageOrder(
  eventId: string,
): UseMutationResult<string, Error, PackageOrderInput> {
  const invalidate = useEventInvalidation(eventId);
  return useMutation({
    mutationFn: createPackageOrder,
    onSuccess: invalidate,
  });
}

export interface OrderStatusChange {
  id: string;
  status: PackageOrderStatus;
}

export function useSetPackageOrderStatus(
  eventId: string,
): UseMutationResult<boolean, Error, OrderStatusChange> {
  const invalidate = useEventInvalidation(eventId);
  return useMutation({
    mutationFn: (input: OrderStatusChange) => setPackageOrderStatus(input.id, input.status),
    onSuccess: invalidate,
  });
}

export function useInvitePackageSeat(
  eventId: string,
): UseMutationResult<PackageSeatInvite, Error, PackageSeatInviteInput> {
  const invalidate = useEventInvalidation(eventId);
  return useMutation({
    mutationFn: invitePackageSeat,
    onSuccess: invalidate,
  });
}

export function useRevokePackageSeat(
  eventId: string,
): UseMutationResult<boolean, Error, string> {
  const invalidate = useEventInvalidation(eventId);
  return useMutation({
    mutationFn: revokePackageSeat,
    onSuccess: invalidate,
  });
}
