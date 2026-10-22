// Zapytania i WSPÓLNE mutatory wygaszania newslettera w karcie „Retencja
// danych" (I9d-Y1): lista „do wygaszenia", wykluczenia i treść prośby.
//
// Klucze z fabryki `dataRetentionKeys` pod prefiksem najemcy - ten sam
// prefiks unieważnia reguła szyny `data_retention.changed.v1` (wykluczenie
// i cofnięcie emitują ją w SQL), więc druga karta odświeża listę sama.
// Mutatory nie pokazują toastów i nie importują i18n: zwracają `{ ok }`,
// a ekran mówi to swoimi słowami (jak mutatory I9c-X2).
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import type { DataRetentionNewsletterDueDto } from "./dataRetentionParse";
import { dataRetentionKeys } from "./keys";
import {
  excludeNewsletterSubscriber,
  getDataRetentionNewsletterDue,
  getNewsletterSunsetCopy,
  includeNewsletterSubscriber,
  previewNewsletterSunsetEmail,
  saveNewsletterSunsetCopy,
  type NewsletterExclusionInput,
  type NewsletterSunsetCopyDto,
  type PreviewNewsletterSunsetInput,
  type SaveNewsletterSunsetCopyInput,
} from "./newsletterSunset.functions";
import type { DataRetentionMutation, DataRetentionRead } from "./rpcResult";

const STALE_MS = 60_000;

export function dataRetentionNewsletterDueQueryOptions(tenantId: string | null) {
  return queryOptions<DataRetentionRead<DataRetentionNewsletterDueDto>>({
    queryKey: dataRetentionKeys.newsletterDue(tenantId ?? ""),
    queryFn: () => getDataRetentionNewsletterDue(),
    enabled: Boolean(tenantId),
    staleTime: STALE_MS,
    retry: 1,
  });
}

export function newsletterSunsetCopyQueryOptions(tenantId: string | null) {
  return queryOptions<DataRetentionRead<NewsletterSunsetCopyDto>>({
    queryKey: dataRetentionKeys.newsletterCopy(tenantId ?? ""),
    queryFn: () => getNewsletterSunsetCopy(),
    enabled: Boolean(tenantId),
    staleTime: STALE_MS,
    retry: 1,
  });
}

/**
 * Po wykluczeniu albo cofnięciu: cały prefiks najemcy - lista, liczby
 * podglądu karty (kandydaci) i stan kategorii zależą od wykluczeń.
 */
function useInvalidateTenant(tenantId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: dataRetentionKeys.tenant(tenantId) });
}

export function useExcludeNewsletterSubscriber(tenantId: string) {
  const refresh = useInvalidateTenant(tenantId);
  return useMutation({
    mutationFn: (input: NewsletterExclusionInput) => excludeNewsletterSubscriber({ data: input }),
    onSuccess: async () => {
      await refresh();
    },
  });
}

export function useIncludeNewsletterSubscriber(tenantId: string) {
  const refresh = useInvalidateTenant(tenantId);
  return useMutation({
    mutationFn: (input: NewsletterExclusionInput) => includeNewsletterSubscriber({ data: input }),
    onSuccess: async () => {
      await refresh();
    },
  });
}

/**
 * Zapis treści prośby z tokenem CAS. Udany zapis od razu podmienia odczyt
 * (nowy token do kolejnego zapisu bez czekania na refetch).
 */
export function useSaveNewsletterSunsetCopy(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveNewsletterSunsetCopyInput) => saveNewsletterSunsetCopy({ data: input }),
    onSuccess: async (result: DataRetentionMutation<NewsletterSunsetCopyDto>) => {
      if (result.ok) {
        queryClient.setQueryData(dataRetentionKeys.newsletterCopy(tenantId), {
          state: "ready",
          data: result.data,
        } satisfies DataRetentionRead<NewsletterSunsetCopyDto>);
      }
      await queryClient.invalidateQueries({
        queryKey: dataRetentionKeys.newsletterCopy(tenantId),
      });
    },
  });
}

/** Podgląd renderu (treść z edytora, także niezapisana) - bez cache. */
export function usePreviewNewsletterSunsetEmail() {
  return useMutation({
    mutationFn: (input: PreviewNewsletterSunsetInput) =>
      previewNewsletterSunsetEmail({ data: input }),
  });
}
