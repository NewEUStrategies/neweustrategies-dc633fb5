// Zapytania i WSPÓLNE mutatory panelu pomiaru otwarć i kliknięć (I9d-Y2):
// „Poproś o zgodę na pomiar", stan treści zgody z oznaczeniem admina, treść
// maila prośby i mianownik wskaźników kampanii.
//
// Klucze z fabryki `newsletterKeys` (zero literałów). Stan treści zgody,
// podgląd prośby i treść maila leżą pod prefiksem `settings()`: oznaczenie
// emituje w SQL `newsletter_settings.changed.v1`, którego istniejąca reguła
// szyny unieważnia `settings()` - druga karta odświeża się sama, a zapis
// treści zgody w ustawieniach (zmiana skrótu = oznaczenie nieaktualne)
// odświeża ostrzeżenie tą samą drogą. Mutatory nie pokazują toastów i nie
// importują i18n: zwracają `{ ok }`, a ekran mówi to swoimi słowami.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { newsletterKeys } from "@/lib/newsletter/keys";
import {
  getCampaignMeasurement,
  getNewsletterConsentMeasurement,
  getNewsletterMeasurementCopy,
  getNewsletterMeasurementPreview,
  markNewsletterConsentMeasurement,
  previewNewsletterMeasurementEmail,
  requestNewsletterMeasurement,
  saveNewsletterMeasurementCopy,
  type MarkConsentMeasurementInput,
  type NewsletterMeasurementCopyDto,
  type PreviewNewsletterMeasurementInput,
  type RequestNewsletterMeasurementInput,
  type SaveNewsletterMeasurementCopyInput,
} from "./measurement.functions";
import type {
  CampaignMeasurementDto,
  ConsentMeasurementDto,
  NewsletterMeasurementPreviewDto,
} from "./measurementParse";
import type { DataRetentionMutation, DataRetentionRead } from "./rpcResult";

const STALE_MS = 60_000;

export function newsletterMeasurementPreviewQueryOptions(enabled = true) {
  return queryOptions<DataRetentionRead<NewsletterMeasurementPreviewDto>>({
    queryKey: newsletterKeys.measurementPreview(),
    queryFn: () => getNewsletterMeasurementPreview(),
    enabled,
    // Liczba kandydatów idzie do potwierdzenia startu - krótko świeża.
    staleTime: 15_000,
    retry: 1,
  });
}

export function newsletterConsentMeasurementQueryOptions(enabled = true) {
  return queryOptions<DataRetentionRead<ConsentMeasurementDto>>({
    queryKey: newsletterKeys.consentMeasurement(),
    queryFn: () => getNewsletterConsentMeasurement(),
    enabled,
    staleTime: STALE_MS,
    retry: 1,
  });
}

export function newsletterMeasurementCopyQueryOptions(enabled = true) {
  return queryOptions<DataRetentionRead<NewsletterMeasurementCopyDto>>({
    queryKey: newsletterKeys.measurementCopy(),
    queryFn: () => getNewsletterMeasurementCopy(),
    enabled,
    staleTime: STALE_MS,
    retry: 1,
  });
}

export function campaignMeasurementQueryOptions(campaignId: string | null) {
  return queryOptions<DataRetentionRead<CampaignMeasurementDto>>({
    queryKey: newsletterKeys.campaignMeasurement(campaignId ?? ""),
    queryFn: () => getCampaignMeasurement({ data: { campaignId: campaignId ?? "" } }),
    enabled: Boolean(campaignId),
    staleTime: STALE_MS,
    retry: 1,
  });
}

/**
 * Start prośby z liczbą potwierdzoną w podglądzie. Po każdym wyniku (także
 * `conflict` - lista zmieniła się po podglądzie) podgląd jest odświeżany:
 * admin potwierdza nową liczbę, nigdy starą.
 */
export function useRequestNewsletterMeasurement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RequestNewsletterMeasurementInput) =>
      requestNewsletterMeasurement({ data: input }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: newsletterKeys.measurementPreview() });
    },
  });
}

/** Oznaczenie „mój tekst obejmuje pomiar" - wynik od razu podmienia odczyt. */
export function useMarkNewsletterConsentMeasurement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: MarkConsentMeasurementInput) =>
      markNewsletterConsentMeasurement({ data: input }),
    onSuccess: async (result: DataRetentionMutation<ConsentMeasurementDto>) => {
      if (result.ok) {
        queryClient.setQueryData(newsletterKeys.consentMeasurement(), {
          state: "ready",
          data: result.data,
        } satisfies DataRetentionRead<ConsentMeasurementDto>);
      }
      // Oznaczenie zmienia też kandydatów prośby (zgody z oznaczoną treścią).
      await queryClient.invalidateQueries({ queryKey: newsletterKeys.measurementAll() });
    },
  });
}

/** Zapis treści maila prośby z tokenem CAS; udany zapis od razu podmienia odczyt. */
export function useSaveNewsletterMeasurementCopy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveNewsletterMeasurementCopyInput) =>
      saveNewsletterMeasurementCopy({ data: input }),
    onSuccess: async (result: DataRetentionMutation<NewsletterMeasurementCopyDto>) => {
      if (result.ok) {
        queryClient.setQueryData(newsletterKeys.measurementCopy(), {
          state: "ready",
          data: result.data,
        } satisfies DataRetentionRead<NewsletterMeasurementCopyDto>);
      }
      await queryClient.invalidateQueries({ queryKey: newsletterKeys.measurementCopy() });
    },
  });
}

/** Podgląd renderu (treść z edytora, także niezapisana) - bez cache. */
export function usePreviewNewsletterMeasurementEmail() {
  return useMutation({
    mutationFn: (input: PreviewNewsletterMeasurementInput) =>
      previewNewsletterMeasurementEmail({ data: input }),
  });
}
