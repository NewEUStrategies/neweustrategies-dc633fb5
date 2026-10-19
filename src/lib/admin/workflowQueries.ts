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
import { listStaffUsers } from "@/lib/crm.functions";
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

export interface WorkflowStaffUser {
  id: string;
  label: string;
}

/**
 * Klucz listy zespołu CRM. Fabryka `crmKeys` (I0) nie ma jeszcze wpisu dla
 * tej listy - do czasu dopisania `crmKeys.staffUsers()` (integration request
 * S4) klucz żyje tu jako funkcja, nie literał w komponencie, więc zamiana
 * będzie jedną linią.
 */
export const workflowStaffUsersKey = () => ["crm-staff-users"] as const;

function staffLabel(row: Record<string, unknown>): string {
  const display = typeof row.display_name === "string" ? row.display_name.trim() : "";
  if (display) return display;
  const first = typeof row.first_name === "string" ? row.first_name.trim() : "";
  const last = typeof row.last_name === "string" ? row.last_name.trim() : "";
  const full = `${first} ${last}`.trim();
  return full || String(row.id ?? "");
}

/** Wynik `listStaffUsers` (JSON w `json`) -> posortowana lista do pickera. */
export function parseStaffUsers(raw: { json: string } | null | undefined): WorkflowStaffUser[] {
  if (!raw || typeof raw.json !== "string") return [];
  let rows: unknown;
  try {
    rows = JSON.parse(raw.json);
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(
      (row): row is Record<string, unknown> =>
        Boolean(row) && typeof row === "object" && typeof (row as { id?: unknown }).id === "string",
    )
    .map((row) => ({ id: String(row.id), label: staffLabel(row) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function workflowStaffUsersQueryOptions() {
  return queryOptions({
    queryKey: workflowStaffUsersKey(),
    queryFn: async () => parseStaffUsers(await listStaffUsers()),
    // Skład zespołu zmienia się rzadko; edytor otwierany kilka razy pod rząd
    // nie musi pytać serwera za każdym razem.
    staleTime: 5 * 60_000,
  });
}

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
