// Warstwa React Query panelu „Automatyzacje" (/admin/workflows).
//
// PO CO OSOBNY MODUŁ. Klucze żyły jako literały w trasie i trzech panelach,
// a inwalidacja po zapisie była kopiowana do każdego `onSuccess` - wystarczyło,
// że jeden panel unieważnił `["admin", "workflow-definitions"]`, a drugi
// zapomniał o oknie przebiegów, i KPI nagłówka kłamały do przeładowania.
// Tu jest JEDNO `queryOptions` per odczyt (klucz z fabryki `workflowKeys`)
// i JEDEN zestaw mutacji z tą samą inwalidacją dla trasy i paneli.
//
// Szyna zdarzeń (`workflow_definition.changed.v1`, S4) unieważnia te same
// prefiksy w drugiej karcie - reguła mapy inwalidacji (integration request
// huba) trafia w klucze z tej samej fabryki.
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { workflowKeys } from "@/lib/admin/workflowKeys";
import { crmStaffUsersQueryOptions, type CrmStaffUser } from "@/lib/crm/leadMutations";
import {
  deleteWorkflowDefinition,
  fetchCorrelationTrace,
  fetchRecentWorkflowRuns,
  fetchWorkflowDefinitions,
  fetchWorkflowRuns,
  fetchWorkflowTemplates,
  installWorkflowTemplate,
  saveWorkflowDefinition,
  setWorkflowEnabled,
  type WorkflowDefinitionRow,
  type WorkflowDraft,
  type WorkflowRunsFilter,
} from "@/lib/admin/workflows";

/** Okno statystyk listy przepisów i KPI nagłówka (ostatnie N przebiegów). */
export const WORKFLOW_RUNS_WINDOW = 500;

export function workflowDefinitionsQueryOptions() {
  return queryOptions({
    queryKey: workflowKeys.definitions(),
    queryFn: fetchWorkflowDefinitions,
    staleTime: 30_000,
  });
}

export function workflowRunsWindowQueryOptions(limit: number = WORKFLOW_RUNS_WINDOW) {
  return queryOptions({
    queryKey: workflowKeys.runsWindow(limit),
    queryFn: () => fetchRecentWorkflowRuns(limit),
    staleTime: 30_000,
  });
}

export function workflowTemplatesQueryOptions() {
  return queryOptions({
    queryKey: workflowKeys.templates(),
    queryFn: fetchWorkflowTemplates,
    staleTime: 5 * 60_000,
  });
}

/**
 * Historia przebiegów. Klucz niesie filtr w postaci z UI (`null` = bez
 * filtra), a zapytanie dostaje parametry BEZ pustych pól (`params`) - stąd
 * dwa argumenty: kształt klucza nie może zależeć od tego, jak panel
 * składa parametry.
 */
export function workflowRunsQueryOptions(
  filter: { workflowId: string | null; status: "succeeded" | "failed" | null },
  params: WorkflowRunsFilter,
) {
  return queryOptions({
    queryKey: workflowKeys.runs(filter.workflowId, filter.status),
    queryFn: () => fetchWorkflowRuns(params),
    staleTime: 15_000,
    // Zmiana filtra pokazuje poprzednią listę do czasu nowej - tabela nie
    // zwija się do pustego stanu przy każdym kliknięciu.
    placeholderData: keepPreviousData,
  });
}

export function correlationTraceQueryOptions(correlationId: string | null, enabled: boolean) {
  return queryOptions({
    queryKey: workflowKeys.trace(correlationId),
    queryFn: () => fetchCorrelationTrace(correlationId ?? ""),
    enabled,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Zespół CRM (picker osoby w akcjach `assign_owner` / `create_crm_task`).
// ---------------------------------------------------------------------------

/**
 * Ta sama lista co picker właściciela w CRM i podpis autora w historii etapów
 * (`lib/crm/leadMutations`): jeden klucz i jedna funkcja pobrania, więc karta
 * leada i edytor przepisu dzielą wpis cache.
 */
export type WorkflowStaffUser = CrmStaffUser;
export const workflowStaffUsersQueryOptions = crmStaffUsersQueryOptions;

// ---------------------------------------------------------------------------
// Mutacje: jedna inwalidacja dla trasy i paneli.
// ---------------------------------------------------------------------------

/** Unieważnia wszystko, co zależy od listy przepisów (lista, okno, przebiegi). */
export function invalidateWorkflowDefinitions(qc: QueryClient): Promise<void> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: workflowKeys.definitions() }),
    qc.invalidateQueries({ queryKey: workflowKeys.runsWindow(WORKFLOW_RUNS_WINDOW) }),
  ]).then(() => undefined);
}

export interface WorkflowMutationCallbacks {
  onError?: (error: unknown) => void;
}

export function useSaveWorkflowDefinition(
  callbacks: WorkflowMutationCallbacks & {
    onSaved?: () => void;
  } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: WorkflowDraft) => saveWorkflowDefinition(draft),
    onSuccess: () => {
      callbacks.onSaved?.();
      void invalidateWorkflowDefinitions(qc);
    },
    onError: callbacks.onError,
  });
}

/**
 * Włącz / wyłącz przepis z OPTYMISTYCZNĄ zmianą przełącznika: odpowiedź
 * serwera przychodzi po kilkuset ms, a przełącznik, który „wraca" przed
 * zapisem, wygląda jak błąd. Porażka przywraca poprzedni stan listy.
 */
export function useSetWorkflowEnabled(callbacks: WorkflowMutationCallbacks = {}) {
  const qc = useQueryClient();
  const key = workflowKeys.definitions();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      setWorkflowEnabled(id, enabled),
    onMutate: async ({ id, enabled }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<WorkflowDefinitionRow[]>(key);
      if (previous) {
        qc.setQueryData<WorkflowDefinitionRow[]>(
          key,
          previous.map((row) => (row.id === id ? { ...row, enabled } : row)),
        );
      }
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) qc.setQueryData(key, context.previous);
      callbacks.onError?.(error);
    },
    onSettled: () => {
      void invalidateWorkflowDefinitions(qc);
    },
  });
}

export function useDeleteWorkflowDefinition(
  callbacks: WorkflowMutationCallbacks & {
    onDeleted?: () => void;
  } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteWorkflowDefinition(id),
    onSuccess: () => {
      callbacks.onDeleted?.();
      void invalidateWorkflowDefinitions(qc);
      // Usunięcie przepisu kasuje kaskadą jego przebiegi.
      void qc.invalidateQueries({ queryKey: workflowKeys.runsAll() });
    },
    onError: callbacks.onError,
  });
}

export function useInstallWorkflowTemplate(
  callbacks: WorkflowMutationCallbacks & {
    onInstalled?: () => void;
  } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => installWorkflowTemplate(key),
    onSuccess: () => {
      callbacks.onInstalled?.();
      void invalidateWorkflowDefinitions(qc);
    },
    onError: callbacks.onError,
  });
}
