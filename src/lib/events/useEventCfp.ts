// Hooki panelu NABORU PRELEGENTÓW (studio wydarzenia).
//
// JEDNA FABRYKA KLUCZY, JEDEN KORZEŃ `["event-cfp", eventId]`. Każda mutacja
// unieważnia CAŁĄ gałąź wydarzenia: decyzja zmienia listę, liczniki,
// szczegół i agregaty naraz, a trzymanie tej wiedzy w każdym przycisku
// kończy się ekranem, który po decyzji pokazuje stary stan.
//
// BEZ AKTUALIZACJI OPTYMISTYCZNYCH (konwencja modułu Wydarzeń): ekran pokazuje
// to, co zapisała baza, nie to, co przewidział klient.
//
// PRZYJĘCIE DOTYKA TRZECH INNYCH MODUŁÓW - rejestru prelegentów, agendy (szkic
// sesji) i zapisów (zapis prelegenta) - więc unieważnia też ich gałęzie tego
// wydarzenia. Inne wydarzenia zostają nietknięte.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  acceptCfpSubmission,
  decideCfpSubmission,
  deleteCfpField,
  fetchCfpCounts,
  fetchCfpFields,
  fetchCfpMaterials,
  fetchCfpReviewers,
  fetchCfpSettings,
  fetchCfpSubmissionDetail,
  fetchCfpSubmissions,
  publishCfpMaterial,
  removeCfpReviewer,
  reorderCfpFields,
  retryCfpPersonCrm,
  saveCfpField,
  saveCfpSettings,
  setCfpReviewer,
  type CfpAcceptInput,
  type CfpDecisionInput,
  type CfpFieldInput,
  type CfpFieldRow,
  type CfpMaterialRow,
  type CfpReviewerInput,
  type CfpReviewerRow,
  type CfpSettingsInput,
  type CfpSubmissionsPage,
  type CfpSubmissionsQuery,
} from "@/lib/events/cfpApi";
import type {
  CfpAcceptResult,
  CfpCounts,
  CfpSettings,
  CfpSubmissionDetail,
} from "@/lib/events/cfpSurface";
import { agendaKeys } from "@/lib/events/useEventSessions";
import { registrationKeys } from "@/lib/events/useEventRegistrations";

export const cfpKeys = {
  all: ["event-cfp"] as const,
  event: (eventId: string) => [...cfpKeys.all, eventId] as const,
  settings: (eventId: string) => [...cfpKeys.event(eventId), "settings"] as const,
  fields: (eventId: string) => [...cfpKeys.event(eventId), "fields"] as const,
  submissions: (query: CfpSubmissionsQuery) =>
    [...cfpKeys.event(query.eventId), "submissions", { ...query, q: query.q.trim() }] as const,
  counts: (eventId: string) => [...cfpKeys.event(eventId), "counts"] as const,
  detail: (eventId: string, submissionId: string) =>
    [...cfpKeys.event(eventId), "detail", submissionId] as const,
  reviewers: (eventId: string) => [...cfpKeys.event(eventId), "reviewers"] as const,
  materials: (eventId: string) => [...cfpKeys.event(eventId), "materials"] as const,
};

/** Lista zgłoszeń starzeje się szybko (recenzenci oceniają równolegle). */
const LIST_STALE_MS = 15_000;

export function useCfpSettings(eventId: string): UseQueryResult<CfpSettings, Error> {
  return useQuery({
    queryKey: cfpKeys.settings(eventId),
    queryFn: () => fetchCfpSettings(eventId),
    enabled: eventId !== "",
  });
}

export function useCfpFields(eventId: string): UseQueryResult<CfpFieldRow[], Error> {
  return useQuery({
    queryKey: cfpKeys.fields(eventId),
    queryFn: () => fetchCfpFields(eventId),
    enabled: eventId !== "",
  });
}

export function useCfpSubmissions(
  query: CfpSubmissionsQuery,
): UseQueryResult<CfpSubmissionsPage, Error> {
  return useQuery({
    queryKey: cfpKeys.submissions(query),
    queryFn: () => fetchCfpSubmissions(query),
    enabled: query.eventId !== "",
    staleTime: LIST_STALE_MS,
  });
}

export function useCfpCounts(eventId: string): UseQueryResult<CfpCounts, Error> {
  return useQuery({
    queryKey: cfpKeys.counts(eventId),
    queryFn: () => fetchCfpCounts(eventId),
    enabled: eventId !== "",
    staleTime: LIST_STALE_MS,
  });
}

/** `null` = szuflada zamknięta, zapytanie wyłączone. */
export function useCfpSubmissionDetail(
  eventId: string,
  submissionId: string | null,
): UseQueryResult<CfpSubmissionDetail, Error> {
  return useQuery({
    queryKey: cfpKeys.detail(eventId, submissionId ?? "none"),
    queryFn: () => fetchCfpSubmissionDetail(submissionId as string),
    enabled: submissionId !== null,
  });
}

export function useCfpReviewers(eventId: string): UseQueryResult<CfpReviewerRow[], Error> {
  return useQuery({
    queryKey: cfpKeys.reviewers(eventId),
    queryFn: () => fetchCfpReviewers(eventId),
    enabled: eventId !== "",
  });
}

export function useCfpMaterials(eventId: string): UseQueryResult<CfpMaterialRow[], Error> {
  return useQuery({
    queryKey: cfpKeys.materials(eventId),
    queryFn: () => fetchCfpMaterials(eventId),
    enabled: eventId !== "",
  });
}

/** Wszystkie mutacje naboru unieważniają gałąź wydarzenia - jeden helper. */
function useCfpMutation<TInput, TResult>(
  eventId: string,
  run: (input: TInput) => Promise<TResult>,
  extraKeys: ReadonlyArray<readonly unknown[]> = [],
): UseMutationResult<TResult, Error, TInput> {
  const queryClient = useQueryClient();
  return useMutation<TResult, Error, TInput>({
    mutationFn: run,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cfpKeys.event(eventId) });
      for (const key of extraKeys) void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function useSaveCfpSettings(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation<CfpSettings, Error, CfpSettingsInput>({
    mutationFn: saveCfpSettings,
    onSuccess: (settings) => {
      // Odpowiedź RPC JEST nowym stanem - ekran nie czeka na drugie zapytanie.
      queryClient.setQueryData(cfpKeys.settings(eventId), settings);
      void queryClient.invalidateQueries({ queryKey: cfpKeys.event(eventId) });
    },
  });
}

export function useSaveCfpField(eventId: string) {
  return useCfpMutation<CfpFieldInput, string>(eventId, saveCfpField);
}

export function useDeleteCfpField(eventId: string) {
  return useCfpMutation<string, void>(eventId, deleteCfpField);
}

export function useReorderCfpFields(eventId: string) {
  return useCfpMutation<string[], void>(eventId, (ids) => reorderCfpFields(eventId, ids));
}

export function useDecideCfpSubmission(eventId: string) {
  return useCfpMutation<CfpDecisionInput, void>(eventId, decideCfpSubmission);
}

export function useAcceptCfpSubmission(eventId: string) {
  return useCfpMutation<CfpAcceptInput, CfpAcceptResult>(eventId, acceptCfpSubmission, [
    agendaKeys.event(eventId),
    registrationKeys.event(eventId),
    ["admin-event-speakers", eventId],
    ["admin", "event", eventId, "speakers"],
  ]);
}

export function useRetryCfpCrm(eventId: string) {
  return useCfpMutation<string, void>(eventId, retryCfpPersonCrm);
}

export function useSetCfpReviewer(eventId: string) {
  return useCfpMutation<CfpReviewerInput, string>(eventId, setCfpReviewer);
}

export function useRemoveCfpReviewer(eventId: string) {
  return useCfpMutation<string, "deleted" | "deactivated">(eventId, removeCfpReviewer);
}

export function usePublishCfpMaterial(eventId: string) {
  return useCfpMutation<{ id: string; isPublished: boolean }, void>(eventId, (input) =>
    publishCfpMaterial(input.id, input.isPublished),
  );
}
