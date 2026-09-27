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
//
// PRZYJĘCIE I DECYZJA ZMIENIAJĄ TEŻ STRONĘ WYDARZENIA, a zdarzenia domeny,
// które emitują ich RPC (`event_cfp_submission.decided.v1`,
// `event.registration.*`), mapa realtime tłumaczy wyłącznie na klucze panelu,
// zapisów i liczników - nie na publiczną listę prelegentów
// (`WIDGET_QUERY_ROOTS.speakers`) ani na materiały (`speakerMaterialsKeys`).
// Organizator, który po decyzji przechodzi na stronę wydarzenia w tej samej
// karcie, dostałby z cache listę sprzed decyzji. Stąd jawne unieważnienie -
// zawsze zawężone do TEGO wydarzenia.
//
// PUBLIKACJA MATERIAŁU ZMIENIA STRONĘ WYDARZENIA: dialog profilu prelegenta
// czyta opublikowane materiały własnym kluczem (`speakerMaterialsKeys`, świeży
// przez minutę), a RPC publikacji nie emituje zdarzenia domeny - bez jawnego
// unieważnienia gałęzi tego wydarzenia dialog pokazywałby starą listę.
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
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";
import type { SpeakersInput } from "@/lib/builder/speakersQuery";
import { speakerMaterialsKeys } from "@/lib/events/speakerMaterialsPublic";
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

/**
 * Decyzja może COFNĄĆ przyjęcie (z przyjętego albo potwierdzonego na rezerwę
 * albo odrzucenie) - baza anuluje wtedy zapis z biletem, zdejmuje z listy
 * prelegentów i z obsady sesji. Stąd te same klucze poza naborem, co przy
 * przyjęciu, i DODATKOWO publiczna lista prelegentów tego wydarzenia:
 * cofnięcie potwierdzonego przyjęcia usuwa wpis z `event_speaker_entries`
 * (nazwisko znika ze strony), a zdjęcie z obsady zmienia ścieżki na karcie.
 */
export function useDecideCfpSubmission(eventId: string) {
  return useCfpMutation<CfpDecisionInput, void>(eventId, decideCfpSubmission, [
    ...acceptanceSideEffectKeys(eventId),
    publicEventSpeakersKey(eventId),
  ]);
}

/**
 * Klucze poza naborem, które zmienia przyjęcie i jego cofnięcie.
 *
 * Publiczne materiały tego wydarzenia: przyjęcie zakłada prelegentowi zapis
 * `approved`, a cofnięcie go anuluje - to otwiera i zamyka jego kontu
 * materiały „dla zapisanych" (organizator bywa też prelegentem), a cofnięcie
 * potwierdzonego przyjęcia zdejmuje z listy, więc jego materiały znikają ze
 * strony.
 */
function acceptanceSideEffectKeys(eventId: string): Array<readonly unknown[]> {
  return [
    agendaKeys.event(eventId),
    registrationKeys.event(eventId),
    ["admin-event-speakers", eventId],
    ["admin", "event", eventId, "speakers"],
    speakerMaterialsKeys.event(eventId),
  ];
}

/**
 * Publiczna lista prelegentów TEGO wydarzenia - sekcja przeglądu, siatka
 * zakładki i widget buildera w trybie „event". Ich klucz to
 * `[WIDGET_QUERY_ROOTS.speakers, wejście]`, a wydarzenie siedzi W OBIEKCIE
 * wejścia; React Query dopasowuje obiekt częściowo, więc
 * `{ source: "event", eventId }` trafia w każdy limit tego wydarzenia, a omija
 * inne wydarzenia i katalog (`source: "directory"` czyta nakładki kont, nie
 * rejestr wydarzenia).
 *
 * PRZYJĘCIE TEGO NIE RUSZA: nikogo nie wpisuje na publiczną listę (robi to
 * dopiero potwierdzenie prelegenta, `useRespondCfpSubmission`), a szkic sesji
 * z obsadą nie jest opublikowany, więc nie zmienia ścieżek na karcie.
 */
function publicEventSpeakersKey(eventId: string): readonly unknown[] {
  const input = { source: "event", eventId } satisfies Partial<SpeakersInput>;
  return [WIDGET_QUERY_ROOTS.speakers, input];
}

export function useAcceptCfpSubmission(eventId: string) {
  return useCfpMutation<CfpAcceptInput, CfpAcceptResult>(
    eventId,
    acceptCfpSubmission,
    acceptanceSideEffectKeys(eventId),
  );
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

/** Publikacja i jej cofnięcie zmieniają też materiały na stronie wydarzenia. */
export function usePublishCfpMaterial(eventId: string) {
  return useCfpMutation<{ id: string; isPublished: boolean }, void>(
    eventId,
    (input) => publishCfpMaterial(input.id, input.isPublished),
    [speakerMaterialsKeys.event(eventId)],
  );
}
