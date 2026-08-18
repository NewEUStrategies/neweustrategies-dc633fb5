// Czyste reguły paneli „Automatyzacje", wyniesione z ciał komponentów.
//
// Każda z nich siedziała w organizmie razem z `useQuery`, `useMutation`,
// i18n i Radiksowym Selectem, więc sprawdzenie jej wymagało wyrenderowania
// całego panelu. Same reguły są bezstanowe i rozstrzygają rzeczy, które
// użytkownik widzi wprost: czy szablon jest już zainstalowany, co poleci
// do zapytania o historię i czy wpisany identyfikator śladu ma sens.
import { isUuid, type WorkflowDefinitionRow, type WorkflowRunsFilter } from "@/lib/admin/workflows";

/**
 * Wartownik „wszystkie" dla Radiksowego `Select`. Pusty string jest tam
 * ZAREZERWOWANY (czyści zaznaczenie i wywala się przy `SelectItem value="">`),
 * więc brak filtra musi mieć własną, niepustą reprezentację.
 */
export const ALL_SENTINEL = "__all__";

/** Wartość dla `Select`: brak filtra pokazuje się jako wartownik. */
export function toSelectValue(filterValue: string | null): string {
  return filterValue ?? ALL_SENTINEL;
}

/** Wybór z `Select` na wartość filtra: wartownik znaczy „bez filtra". */
export function fromSelectValue(selected: string): string | null {
  return selected === ALL_SENTINEL ? null : selected;
}

/**
 * Klucze szablonów już zainstalowanych w tym obszarze roboczym.
 *
 * „Zainstalowany" znaczy: ISTNIEJE definicja z tym `template_key` - NIEZALEŻNIE
 * od tego, czy jest włączona. Ponowna instalacja tego samego szablonu jest
 * w bazie idempotentna per (tenant, template_key) i re-aktywuje istniejący
 * przepis, więc pokazanie wyłączonego szablonu jako „do zainstalowania"
 * obiecywałoby użytkownikowi nowy przepis, a dałoby reaktywację starego -
 * razem z jego zmodyfikowanymi krokami.
 */
export function installedTemplateKeys(definitions: readonly WorkflowDefinitionRow[]): Set<string> {
  const keys = new Set<string>();
  for (const definition of definitions) {
    if (definition.template_key !== null && definition.template_key !== undefined) {
      keys.add(definition.template_key);
    }
  }
  return keys;
}

/** Czy ten szablon ma już swój przepis w obszarze roboczym. */
export function isTemplateInstalled(
  templateKey: string | null,
  definitions: readonly WorkflowDefinitionRow[],
): boolean {
  return templateKey !== null && installedTemplateKeys(definitions).has(templateKey);
}

export interface RunsFilterState {
  workflowId: string | null;
  status: "succeeded" | "failed" | null;
}

/** Ile przebiegów pobiera panel historii za jednym razem. */
export const RUNS_PAGE_LIMIT = 200;

/**
 * Parametry zapytania o historię przebiegów.
 *
 * Puste filtry są POMIJANE, a nie wysyłane jako `null`: warstwa danych buduje
 * z nich łańcuch PostgREST, więc `workflowId: null` zawęziłoby wynik do
 * przebiegów o pustym `workflow_id` (czyli do zera) zamiast pokazać wszystkie.
 */
export function runsQueryParams(filter: RunsFilterState): WorkflowRunsFilter {
  const params: WorkflowRunsFilter = { limit: RUNS_PAGE_LIMIT };
  if (filter.workflowId) params.workflowId = filter.workflowId;
  if (filter.status) params.status = filter.status;
  return params;
}

export type TraceSubmission = { kind: "invalid" } | { kind: "search"; correlationId: string };

/**
 * Rozstrzygnięcie wysłania formularza śladu korelacji.
 *
 * Walidacja UUID stoi PRZED zapytaniem, bo `fetchCorrelationTrace` z byle
 * napisem kończy się błędem PostgREST-a o niepoprawnym typie - komunikatem,
 * z którego administrator nie wyczyta, że po prostu wkleił nie to pole.
 * Białe znaki są obcinane: identyfikator kopiuje się z logów i nagłówków,
 * więc spacja na końcu jest regułą, nie wyjątkiem.
 */
export function traceSubmission(rawInput: string): TraceSubmission {
  const trimmed = rawInput.trim();
  return isUuid(trimmed) ? { kind: "search", correlationId: trimmed } : { kind: "invalid" };
}

/**
 * Czy zapytanie o ślad ma w ogóle wystartować. Deep-link może przynieść
 * w adresie dowolny napis, a `enabled: false` jest tańsze niż okrągły obieg
 * zakończony błędem typu.
 */
export function traceQueryEnabled(correlationId: string | null): boolean {
  return correlationId !== null && isUuid(correlationId);
}
