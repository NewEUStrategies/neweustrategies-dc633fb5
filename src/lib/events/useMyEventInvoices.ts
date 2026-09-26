// Haki KUPUJACEGO: zamowienia do zafakturowania, prosby, wystawione dokumenty.
//
// Korzen `"event-invoices-me"` (jak `"event-meetings-mine"`): dane naleza do
// zalogowanego, wiec klucz nie zna wydarzenia. `enabled` przychodzi od
// wolajacego (sesja) - gosc nie odpytuje bazy o cudze dokumenty. Kazda
// mutacja uniewaznia cala galaz, bo prosba zmienia i liste zamowien, i to,
// co pokaze profil.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  cancelInvoiceRequest,
  fetchMyInvoiceSources,
  fetchMyInvoices,
  saveInvoiceRequest,
  type InvoiceRequestTarget,
  type MyInvoiceRow,
  type MyInvoiceSourceRow,
} from "@/lib/events/myEventInvoicesApi";
import type { InvoiceBuyerDraft } from "@/lib/events/eventInvoiceBuyerDraft";

export const myEventInvoiceKeys = {
  all: ["event-invoices-me"] as const,
  sources: () => [...myEventInvoiceKeys.all, "sources"] as const,
  documents: () => [...myEventInvoiceKeys.all, "documents"] as const,
};

export function useMyInvoiceSources(enabled: boolean): UseQueryResult<MyInvoiceSourceRow[]> {
  return useQuery({
    queryKey: myEventInvoiceKeys.sources(),
    queryFn: fetchMyInvoiceSources,
    enabled,
  });
}

export function useMyInvoices(enabled: boolean): UseQueryResult<MyInvoiceRow[]> {
  return useQuery({
    queryKey: myEventInvoiceKeys.documents(),
    queryFn: fetchMyInvoices,
    enabled,
  });
}

export interface SaveInvoiceRequestInput {
  target: InvoiceRequestTarget;
  buyer: InvoiceBuyerDraft;
}

export function useSaveInvoiceRequest(): UseMutationResult<string, Error, SaveInvoiceRequestInput> {
  const queryClient = useQueryClient();
  return useMutation<string, Error, SaveInvoiceRequestInput>({
    mutationFn: (input) => saveInvoiceRequest(input.target, input.buyer),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: myEventInvoiceKeys.all });
    },
  });
}

export function useCancelInvoiceRequest(): UseMutationResult<string, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<string, Error, string>({
    mutationFn: cancelInvoiceRequest,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: myEventInvoiceKeys.all });
    },
  });
}
