// Hooki NABORU PRELEGENTÓW po stronie uczestnika: strona naboru (anonimowa),
// zgłoszenia i panel prelegenta (zalogowany), kolejka recenzenta.
//
// DWA KORZENIE KLUCZY, BO DWIE WIDOWNIE:
//   * `["event-cfp-public", slug]` - dane jednakowe dla każdego widza strony;
//   * `["event-cfp-me", slug, ...]` - dane WOŁAJĄCEGO (zgłoszenia, panel,
//     kolejka). Ten korzeń unieważnia globalna synchronizacja zdarzeń domeny
//     (`eventInvalidationMap`) po każdej zmianie zgłoszenia i oceny.
// Wylogowanie czyści cały cache (`useAuth`), więc klucz własnych danych nie
// musi nieść identyfikatora konta - tak samo jak `["event-me", slug, ...]`.
//
// ZAPYTANIA PERSONALNE MAJĄ `enabled` - bez sesji nie ma o co pytać (baza
// odpowiedziałaby `auth_required`).
//
// ODPOWIEDŹ NA PRZYJĘCIE I WYCOFANIE SIĘGAJĄ POZA NABÓR: potwierdzenie dopisuje
// prelegenta do publicznej listy, a rezygnacja/wycofanie anuluje zapis z biletem
// i zdejmuje z listy (razem z materiałami). Dlatego te dwie mutacje odświeżają
// też panel „Moje" (`["event-me", slug]`), listę prelegentów i ich materiały.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  deleteSpeakerMaterial,
  fetchCfpPublic,
  fetchCfpReview,
  fetchCfpReviewQueue,
  fetchMyCfpSubmissions,
  fetchSpeakerPanel,
  respondCfpSubmission,
  saveCfpReview,
  saveCfpSubmission,
  saveSpeakerMaterial,
  saveSpeakerProfile,
  submitCfpSubmission,
  withdrawCfpSubmission,
  type CfpReviewInput,
  type CfpSubmissionSaveInput,
  type SpeakerMaterialInput,
  type SpeakerProfileInput,
} from "@/lib/events/cfpPublicApi";
import { speakerMaterialsKeys } from "@/lib/events/speakerMaterialsPublic";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";
import type {
  CfpMySubmissions,
  CfpPublic,
  CfpReviewDetail,
  CfpReviewQueue,
  CfpWriteResult,
  SpeakerPanel,
} from "@/lib/events/cfpSurface";

export const cfpPublicKeys = {
  all: ["event-cfp-public"] as const,
  slug: (slug: string) => [...cfpPublicKeys.all, slug] as const,
};

export const cfpMeKeys = {
  all: ["event-cfp-me"] as const,
  slug: (slug: string) => [...cfpMeKeys.all, slug] as const,
  submissions: (slug: string) => [...cfpMeKeys.slug(slug), "submissions"] as const,
  panel: (slug: string) => [...cfpMeKeys.slug(slug), "panel"] as const,
  queue: (slug: string) => [...cfpMeKeys.slug(slug), "queue"] as const,
  review: (slug: string, submissionId: string) =>
    [...cfpMeKeys.slug(slug), "review", submissionId] as const,
};

/**
 * Faza naboru może przejść z `scheduled` w `open` w trakcie wizyty, a strona
 * i tak odczytuje stan z bazy - minuta to kompromis między świeżością a ruchem.
 */
const PUBLIC_STALE_MS = 60_000;

/**
 * `enabled` = `false` do montażu: strona i zakładka naboru czytają fazę
 * WYŁĄCZNIE po stronie klienta (SSR i pierwszy render są identyczne).
 */
export function useCfpPublic(
  slug: string,
  enabled = true,
): UseQueryResult<CfpPublic | null, Error> {
  return useQuery({
    queryKey: cfpPublicKeys.slug(slug),
    queryFn: () => fetchCfpPublic(slug),
    enabled: enabled && slug !== "",
    staleTime: PUBLIC_STALE_MS,
  });
}

export function useMyCfpSubmissions(
  slug: string,
  enabled: boolean,
): UseQueryResult<CfpMySubmissions | null, Error> {
  return useQuery({
    queryKey: cfpMeKeys.submissions(slug),
    queryFn: () => fetchMyCfpSubmissions(slug),
    enabled: enabled && slug !== "",
    staleTime: 30_000,
  });
}

export function useSpeakerPanel(
  slug: string,
  enabled: boolean,
): UseQueryResult<SpeakerPanel | null, Error> {
  return useQuery({
    queryKey: cfpMeKeys.panel(slug),
    queryFn: () => fetchSpeakerPanel(slug),
    enabled: enabled && slug !== "",
    staleTime: 30_000,
  });
}

export function useCfpReviewQueue(
  slug: string,
  enabled: boolean,
): UseQueryResult<CfpReviewQueue | null, Error> {
  return useQuery({
    queryKey: cfpMeKeys.queue(slug),
    queryFn: () => fetchCfpReviewQueue(slug),
    enabled: enabled && slug !== "",
  });
}

/** `null` = żadne zgłoszenie nie jest otwarte do oceny. */
export function useCfpReview(
  slug: string,
  submissionId: string | null,
): UseQueryResult<CfpReviewDetail, Error> {
  return useQuery({
    queryKey: cfpMeKeys.review(slug, submissionId ?? "none"),
    queryFn: () => fetchCfpReview(submissionId as string),
    enabled: submissionId !== null,
  });
}

/** Każdy zapis po stronie uczestnika odświeża jego gałąź tego wydarzenia. */
function useMeMutation<TInput, TResult>(
  slug: string,
  run: (input: TInput) => Promise<TResult>,
  extraKeys: ReadonlyArray<readonly unknown[]> = [],
): UseMutationResult<TResult, Error, TInput> {
  const queryClient = useQueryClient();
  return useMutation<TResult, Error, TInput>({
    mutationFn: run,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cfpMeKeys.slug(slug) });
      for (const key of extraKeys) void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

/** Klucze poza naborem, które zmienia potwierdzenie, rezygnacja i wycofanie. */
function acceptanceSideEffectKeys(slug: string): ReadonlyArray<readonly unknown[]> {
  return [["event-me", slug], [WIDGET_QUERY_ROOTS.speakers], speakerMaterialsKeys.all];
}

export function useSaveCfpSubmission(slug: string) {
  return useMeMutation<CfpSubmissionSaveInput, CfpWriteResult>(slug, saveCfpSubmission);
}

export function useSubmitCfpSubmission(slug: string) {
  return useMeMutation<string, CfpWriteResult>(slug, submitCfpSubmission);
}

export function useWithdrawCfpSubmission(slug: string) {
  return useMeMutation<string, CfpWriteResult>(
    slug,
    withdrawCfpSubmission,
    acceptanceSideEffectKeys(slug),
  );
}

export function useRespondCfpSubmission(slug: string) {
  return useMeMutation<{ id: string; confirm: boolean }, CfpWriteResult>(
    slug,
    (input) => respondCfpSubmission(input.id, input.confirm),
    acceptanceSideEffectKeys(slug),
  );
}

export function useSaveSpeakerProfile(slug: string) {
  return useMeMutation<SpeakerProfileInput, void>(slug, saveSpeakerProfile);
}

export function useSaveSpeakerMaterial(slug: string) {
  return useMeMutation<SpeakerMaterialInput, string>(slug, saveSpeakerMaterial);
}

export function useDeleteSpeakerMaterial(slug: string) {
  return useMeMutation<string, void>(slug, deleteSpeakerMaterial);
}

export function useSaveCfpReview(slug: string) {
  return useMeMutation<CfpReviewInput, void>(slug, saveCfpReview);
}
