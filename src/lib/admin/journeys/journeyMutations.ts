// Mutatory ścieżek (S8) - hooki React Query nad zapisami S5 (SPEC §3.4).
//
// WYNIK, NIE WYJĄTEK. Server fn zapisów zwracają `JourneyMutation<T>`:
// `ok: false` z kodem (`conflict`, `invalid`, `duplicate`…) i powodem RPC
// (`key_taken`, `graph_invalid`…) to ODPOWIEDŹ, którą panel tłumaczy
// (`mutationErrorText`), a nie awaria - hook jej nie rzuca, więc `mutateAsync`
// zawsze oddaje wynik do komponentu. Wyjątkiem pozostaje to, czego panel nie
// rozstrzygnie: odmowa middleware (brak `aal2` -> `MfaRequiredNotice`), sieć.
//
// INWALIDACJA TYLKO KLUCZAMI `journeyKeys` (bramka `queryKeyLiterals`), po
// sukcesie i tylko tego, co zapis zmienił. Szyna (`journey.changed.v1`) i tak
// odświeży listę i szczegół w innych kartach - tu chodzi o kartę, która
// zapisała, żeby nie czekała na zdarzenie.
//
// SZKIC NIE UNIEWAŻNIA SZCZEGÓŁU. Autozapis edytora co 2 s z unieważnieniem
// `detail(id)` refetchowałby szczegół w trakcie pisania - nowy token przychodzi
// w wyniku zapisu, więc `useSaveJourneyDraft` wpisuje go do cache od razu
// (następny zapis nie dostanie `conflict` z własnym poprzednikiem), a resztę
// zostawia szynie. Ustawienia silnika unieważniają też kartę „Retencja danych”
// (`dataRetentionKeys.tenant`) - przełącznik piksela otwarć to ten sam wiersz.
import { useMutation, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import type { JourneyMutationResult, JourneyPublishResult, JourneySettingsDto } from "@/lib/journeys/dto";
import { emptyJourneyGraph, type JourneyDraft } from "@/lib/journeys/graph";
import {
  createJourney,
  enrollJourneyTest,
  exitJourneyEnrollment,
  installJourneyTemplate,
  publishJourney,
  saveJourneyDraft,
  saveJourneyEmailContent,
  saveJourneySettings,
  setJourneyStatus,
  skipJourneyWait,
  type JourneyMutation,
  type JourneySettingsPatch,
} from "@/lib/journeys/journeys.functions";
import { journeyKeys } from "@/lib/journeys/keys";
import { journeyLabelKey } from "@/lib/journeys/labels";
import type { JourneyCategory } from "@/lib/journeys/limits";
import type { JourneyTemplateKey } from "@/lib/journeys/templates/types";
import { dataRetentionKeys } from "@/lib/privacy/keys";
import type { JourneyDetailDto, JourneyDetailRead } from "./journeyEditor.functions";

export type JourneyMutationFailure = Extract<JourneyMutation<never>, { ok: false }>;

export interface JourneyInvalidationScope {
  tenantId: string | null;
  journeyId?: string | null;
  leadId?: string | null;
}

/**
 * Unieważnia zapytania ścieżek po zapisie: lista zawsze; szczegół, statystyki
 * i kontakty wskazanej ścieżki; ścieżki leada; zdrowie silnika najemcy
 * (liczba aktywnych ścieżek i kontaktów do wykonania).
 */
export async function invalidateJourneyQueries(
  queryClient: QueryClient,
  scope: JourneyInvalidationScope,
): Promise<void> {
  const keys: QueryKey[] = [journeyKeys.listAll()];
  if (scope.journeyId) {
    keys.push(
      journeyKeys.detail(scope.journeyId),
      journeyKeys.statsFor(scope.journeyId),
      journeyKeys.enrollmentsFor(scope.journeyId),
    );
  }
  if (scope.leadId) keys.push(journeyKeys.forLead(scope.leadId));
  if (scope.tenantId) keys.push(journeyKeys.engineHealth(scope.tenantId));
  await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

/** Powody RPC z własnym zdaniem w słowniku (reszta - sam kod błędu). */
export const JOURNEY_REASON_LABEL_KEY: Readonly<Record<string, string>> = {
  key_taken: "adminJourneys.common.reason.key_taken",
  draft_invalid: "adminJourneys.common.reason.draft_invalid",
  journey_archived: "adminJourneys.common.reason.journey_archived",
  not_published: "adminJourneys.common.reason.not_published",
  graph_invalid: "adminJourneys.common.reason.graph_invalid",
  content_missing: "adminJourneys.common.reason.content_missing",
  trigger_invalid: "adminJourneys.common.reason.trigger_invalid",
  goal_invalid: "adminJourneys.common.reason.goal_invalid",
  exit_invalid: "adminJourneys.common.reason.exit_invalid",
  node_not_email: "adminJourneys.common.reason.node_not_email",
  doc_invalid: "adminJourneys.common.reason.doc_invalid",
  doc_too_large: "adminJourneys.common.reason.doc_too_large",
  own_lead_missing: "adminJourneys.common.reason.own_lead_missing",
  not_waiting: "adminJourneys.common.reason.not_waiting",
  timezone_invalid: "adminJourneys.common.reason.timezone_invalid",
  assignee_not_staff: "adminJourneys.common.reason.assignee_not_staff",
};

/** Zdanie błędu zapisu: kod (`mutationError` z S5) + powód, jeśli go znamy. */
export function mutationErrorText(
  t: (key: string, options?: Record<string, unknown>) => string,
  failure: Pick<JourneyMutationFailure, "error" | "reason">,
): string {
  const base = t(journeyLabelKey("mutationError", failure.error));
  const reasonKey = failure.reason ? JOURNEY_REASON_LABEL_KEY[failure.reason] : undefined;
  return reasonKey ? `${base} ${t(reasonKey)}` : base;
}

// ── Ścieżka ──────────────────────────────────────────────────────────────────

export interface CreateJourneyInput {
  key: string;
  name: string;
  category: JourneyCategory;
  legalBasis: string | null;
  description: string | null;
  /**
   * Wyzwalacz pustej ścieżki. Szkic z `admin_journey_create` nie ma ustawień
   * (`settings: {}`), więc nie przechodzi `JourneyDraftSchema` - od razu
   * zapisujemy pusty graf z wyzwalaczem, tokenem z utworzenia.
   */
  triggerEventType?: string;
}

export type CreateJourneyOutcome =
  | { ok: true; data: JourneyMutationResult; draftSaved: boolean; draftError: JourneyMutationFailure | null }
  | JourneyMutationFailure;

export function useCreateJourney(tenantId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateJourneyInput): Promise<CreateJourneyOutcome> => {
      const created = await createJourney({
        data: {
          key: input.key,
          name: input.name,
          category: input.category,
          legalBasis: input.legalBasis,
          description: input.description,
        },
      });
      if (!created.ok) return created;
      if (!input.triggerEventType) return { ...created, draftSaved: false, draftError: null };
      const draft: JourneyDraft = {
        graph: emptyJourneyGraph(),
        settings: { triggerEventType: input.triggerEventType },
      };
      const saved = await saveJourneyDraft({
        data: { journeyId: created.data.id, expectedUpdatedAt: created.data.updatedAt, draft },
      });
      return saved.ok
        ? { ok: true, data: saved.data, draftSaved: true, draftError: null }
        : { ok: true, data: created.data, draftSaved: false, draftError: saved };
    },
    onSuccess: async (result) => {
      if (result.ok) await invalidateJourneyQueries(queryClient, { tenantId });
    },
  });
}

export interface InstallJourneyTemplateInput {
  templateKey: JourneyTemplateKey;
  key: string;
  name: string;
  locale: "pl" | "en";
}

export function useInstallJourneyTemplate(tenantId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: InstallJourneyTemplateInput) => installJourneyTemplate({ data: input }),
    onSuccess: async (result) => {
      if (result.ok) await invalidateJourneyQueries(queryClient, { tenantId });
    },
  });
}

export interface SaveJourneyDraftInput {
  expectedUpdatedAt: string;
  draft: JourneyDraft;
  name?: string;
  description?: string;
  category?: JourneyCategory;
  legalBasis?: string;
}

export function useSaveJourneyDraft(journeyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveJourneyDraftInput) =>
      saveJourneyDraft({ data: { journeyId, ...input } }),
    onSuccess: async (result, input) => {
      if (!result.ok) return;
      queryClient.setQueryData<JourneyDetailRead<JourneyDetailDto>>(
        journeyKeys.detail(journeyId),
        (previous) => {
          if (previous?.state !== "ready") return previous;
          const definition = previous.data.definition;
          return {
            state: "ready",
            data: {
              ...previous.data,
              definition: {
                ...definition,
                updatedAt: result.data.updatedAt,
                status: result.data.status,
                name: input.name ?? definition.name,
                description:
                  input.description === undefined ? definition.description : input.description || null,
                category: input.category ?? definition.category,
                legalBasis:
                  input.legalBasis === undefined ? definition.legalBasis : input.legalBasis || null,
              },
              draft: input.draft,
              draftValid: true,
              draftRaw: input.draft,
              draftIssue: null,
            },
          };
        },
      );
      await queryClient.invalidateQueries({ queryKey: journeyKeys.listAll() });
    },
  });
}

export interface SaveJourneyEmailContentInput {
  nodeId: string;
  variant: string;
  subjectPl: string;
  subjectEn: string | null;
  preheaderPl: string | null;
  preheaderEn: string | null;
  doc: unknown;
}

export function useSaveJourneyEmailContent(tenantId: string | null, journeyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveJourneyEmailContentInput) =>
      saveJourneyEmailContent({ data: { journeyId, ...input } }),
    onSuccess: async (result) => {
      // Treść nie rusza tokenu ścieżki, a flagę „treść = szablon” liczy serwer
      // - szczegół odświeżamy, żeby blokada publikacji zgasła po edycji.
      if (result.ok) await invalidateJourneyQueries(queryClient, { tenantId, journeyId });
    },
  });
}

export interface PublishJourneyInput {
  expectedUpdatedAt: string;
  mode: "drain" | "exit_all";
  draft?: JourneyDraft;
}

export function usePublishJourney(tenantId: string | null, journeyId: string) {
  const queryClient = useQueryClient();
  return useMutation<JourneyMutation<JourneyPublishResult>, Error, PublishJourneyInput>({
    mutationFn: (input) => publishJourney({ data: { journeyId, ...input } }),
    onSuccess: async (result) => {
      if (result.ok) await invalidateJourneyQueries(queryClient, { tenantId, journeyId });
    },
  });
}

export interface SetJourneyStatusInput {
  journeyId: string;
  status: "active" | "paused" | "archived";
  expectedUpdatedAt: string | null;
}

export function useSetJourneyStatus(tenantId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SetJourneyStatusInput) => setJourneyStatus({ data: input }),
    onSuccess: async (result, input) => {
      if (result.ok) {
        await invalidateJourneyQueries(queryClient, { tenantId, journeyId: input.journeyId });
      }
    },
  });
}

// ── Ustawienia silnika (admin) ───────────────────────────────────────────────

export interface SaveJourneySettingsInput {
  patch: JourneySettingsPatch;
  /** `null`, gdy wiersza ustawień jeszcze nie ma (`exists: false`). */
  expectedUpdatedAt: string | null;
}

export function useSaveJourneySettings(tenantId: string | null) {
  const queryClient = useQueryClient();
  return useMutation<JourneyMutation<JourneySettingsDto>, Error, SaveJourneySettingsInput>({
    mutationFn: (input) => saveJourneySettings({ data: input }),
    onSuccess: async (result) => {
      if (!result.ok || !tenantId) return;
      queryClient.setQueryData(journeyKeys.settings(tenantId), {
        state: "ready" as const,
        data: result.data,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: journeyKeys.settings(tenantId) }),
        queryClient.invalidateQueries({ queryKey: journeyKeys.engineHealth(tenantId) }),
        queryClient.invalidateQueries({ queryKey: dataRetentionKeys.tenant(tenantId) }),
      ]);
    },
  });
}

// ── Kontakt w ścieżce (test na sobie, czekanie, wyjście) ─────────────────────

export function useEnrollJourneyTest(tenantId: string | null, journeyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => enrollJourneyTest({ data: { journeyId } }),
    onSuccess: async (result) => {
      if (result.ok) {
        await invalidateJourneyQueries(queryClient, {
          tenantId,
          journeyId,
          leadId: result.data.leadId,
        });
      }
    },
  });
}

export function useSkipJourneyWait(tenantId: string | null, journeyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { enrollmentId: string }) => skipJourneyWait({ data: input }),
    onSuccess: async (result) => {
      if (result.ok) await invalidateJourneyQueries(queryClient, { tenantId, journeyId });
    },
  });
}

export function useExitJourneyEnrollment(tenantId: string | null, journeyId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { enrollmentId: string; leadId?: string | null }) =>
      exitJourneyEnrollment({ data: { enrollmentId: input.enrollmentId } }),
    onSuccess: async (result, input) => {
      if (result.ok) {
        await invalidateJourneyQueries(queryClient, {
          tenantId,
          journeyId,
          leadId: input.leadId ?? null,
        });
      }
    },
  });
}
