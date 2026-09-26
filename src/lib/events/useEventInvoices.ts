// Haki React Query ekranu FAKTUR studia.
//
// JEDNA FABRYKA KLUCZY zakorzeniona w `"event-invoices"`: kandydaci, lista
// i szczegoly dokumentow siedza w galezi wydarzenia, a ustawienia wystawcy
// (wspolne dla najemcy) obok niej. Kazda mutacja dokumentu uniewaznia CALA
// galaz wydarzenia - wystawienie zmienia jednoczesnie liste kandydatow
// (zamowienie "ma fakture"), liste dokumentow i szczegoly - oraz pakiety
// wydarzenia, bo wystawienie dopina firme CRM do zamowienia pakietu. Bez
// aktualizacji optymistycznych (konwencja modulu): ekran pokazuje to, co
// oddala baza.
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import type { EventInvoiceDocument } from "@/lib/events/eventInvoiceDocument";
import {
  cancelInvoice,
  createInvoiceCorrection,
  createInvoiceDraft,
  fetchEventInvoice,
  fetchEventInvoices,
  fetchInvoiceCandidates,
  fetchInvoiceSettings,
  invoiceFromProforma,
  issueInvoice,
  issuePendingInvoices,
  saveInvoiceSettings,
  setInvoicePaid,
  updateInvoiceDraft,
  updateInvoiceKsef,
  type CreateCorrectionInput,
  type CreateInvoiceDraftInput,
  type EventInvoiceCandidateRow,
  type EventInvoiceListRow,
  type EventInvoiceSettings,
  type EventInvoiceSettingsInput,
  type IssuePendingResult,
  type IssuedInvoice,
  type UpdateInvoiceDraftInput,
} from "@/lib/events/eventInvoicesApi";
import type { EventInvoiceKsefStatus } from "@/lib/events/eventInvoiceEnums";

export const eventInvoiceKeys = {
  all: ["event-invoices"] as const,
  settings: () => [...eventInvoiceKeys.all, "settings"] as const,
  event: (eventId: string) => [...eventInvoiceKeys.all, eventId] as const,
  candidates: (eventId: string) => [...eventInvoiceKeys.event(eventId), "candidates"] as const,
  list: (eventId: string) => [...eventInvoiceKeys.event(eventId), "list"] as const,
  detail: (eventId: string, invoiceId: string) =>
    [...eventInvoiceKeys.event(eventId), "detail", invoiceId] as const,
};

/** Galaz pakietow wydarzenia (literal jak w `useEventPackages.ts`). */
const PACKAGES_ROOT = "event-packages";

export function useInvoiceSettings(enabled = true): UseQueryResult<EventInvoiceSettings> {
  return useQuery({
    queryKey: eventInvoiceKeys.settings(),
    queryFn: fetchInvoiceSettings,
    enabled,
  });
}

export function useInvoiceCandidates(eventId: string): UseQueryResult<EventInvoiceCandidateRow[]> {
  return useQuery({
    queryKey: eventInvoiceKeys.candidates(eventId),
    queryFn: () => fetchInvoiceCandidates(eventId),
    enabled: eventId !== "",
  });
}

export function useEventInvoices(eventId: string): UseQueryResult<EventInvoiceListRow[]> {
  return useQuery({
    queryKey: eventInvoiceKeys.list(eventId),
    queryFn: () => fetchEventInvoices(eventId),
    enabled: eventId !== "",
  });
}

/** `null` = zamkniety edytor (klucz bezczynny, `skipToken` - bez zapytania). */
export function useEventInvoice(
  eventId: string,
  invoiceId: string | null,
): UseQueryResult<EventInvoiceDocument> {
  return useQuery({
    queryKey: eventInvoiceKeys.detail(eventId, invoiceId ?? ""),
    queryFn: eventId === "" || invoiceId === null ? skipToken : () => fetchEventInvoice(invoiceId),
  });
}

function useInvoiceMutation<TInput, TResult>(
  eventId: string,
  run: (input: TInput) => Promise<TResult>,
): UseMutationResult<TResult, Error, TInput> {
  const queryClient = useQueryClient();
  return useMutation<TResult, Error, TInput>({
    mutationFn: run,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: eventInvoiceKeys.event(eventId) });
      void queryClient.invalidateQueries({ queryKey: [PACKAGES_ROOT, eventId] });
    },
  });
}

export function useSaveInvoiceSettings(): UseMutationResult<
  EventInvoiceSettings,
  Error,
  EventInvoiceSettingsInput
> {
  const queryClient = useQueryClient();
  return useMutation<EventInvoiceSettings, Error, EventInvoiceSettingsInput>({
    mutationFn: saveInvoiceSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(eventInvoiceKeys.settings(), settings);
    },
  });
}

export function useCreateInvoiceDraft(eventId: string) {
  return useInvoiceMutation<CreateInvoiceDraftInput, string>(eventId, createInvoiceDraft);
}

export function useUpdateInvoiceDraft(eventId: string) {
  return useInvoiceMutation<UpdateInvoiceDraftInput, string>(eventId, updateInvoiceDraft);
}

export function useIssueInvoice(eventId: string) {
  return useInvoiceMutation<string, IssuedInvoice>(eventId, issueInvoice);
}

export function useIssuePendingInvoices(eventId: string) {
  return useInvoiceMutation<boolean, IssuePendingResult>(eventId, (collective) =>
    issuePendingInvoices(eventId, collective),
  );
}

export function useCancelInvoice(eventId: string) {
  return useInvoiceMutation<{ id: string; reason: string }, string>(eventId, (input) =>
    cancelInvoice(input.id, input.reason),
  );
}

export function useCreateInvoiceCorrection(eventId: string) {
  return useInvoiceMutation<CreateCorrectionInput, string>(eventId, createInvoiceCorrection);
}

export function useInvoiceFromProforma(eventId: string) {
  return useInvoiceMutation<string, string>(eventId, invoiceFromProforma);
}

export function useUpdateInvoiceKsef(eventId: string) {
  return useInvoiceMutation<{ id: string; status: EventInvoiceKsefStatus; number: string }, string>(
    eventId,
    updateInvoiceKsef,
  );
}

export function useSetInvoicePaid(eventId: string) {
  return useInvoiceMutation<{ id: string; paidAt: string | null }, string>(
    eventId,
    setInvoicePaid,
  );
}
