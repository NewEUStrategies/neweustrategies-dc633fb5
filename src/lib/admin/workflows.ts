// Warstwa danych panelu „Automatyzacje" (/admin/workflows): deklaratywny
// silnik przepisów „gdy X -> zrób Y" z migracji 20260711204000.
//
// Zasady:
//  - CRUD definicji idzie zwykłym klientem pod RLS
//    (policy workflow_definitions_staff_all: tenant + staff); tenant_id przy
//    INSERT pinujemy jawnie z rpc current_tenant_id() (kolumna nie ma
//    defaultu, a policy WITH CHECK wymusza zgodność).
//  - workflow_runs / workflow_templates są read-only dla staffu (RLS SELECT).
//  - Instalacja przepisu z katalogu przez RPC install_workflow_template
//    (SECURITY DEFINER, idempotentna per tenant+template_key).
//  - Katalog akcji odzwierciedla CASE w public.run_workflow_step - silnik
//    rzuca wyjątkiem przy nieznanej akcji, więc lista tutaj jest kontraktem
//    edytora, a test jednostkowy pilnuje parytetu specyfikacji parametrów.
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import type { DomainEventRow } from "@/lib/realtime/domainEvents";

export type WorkflowDefinitionRow = Database["public"]["Tables"]["workflow_definitions"]["Row"];
export type WorkflowRunRow = Database["public"]["Tables"]["workflow_runs"]["Row"];
export type WorkflowTemplateRow = Database["public"]["Tables"]["workflow_templates"]["Row"];

// ---------------------------------------------------------------------------
// Katalog akcji (kontrakt z public.run_workflow_step).
// ---------------------------------------------------------------------------

export const WORKFLOW_ACTIONS = [
  "notify_user",
  "notify_staff",
  "notify_followers",
  "create_crm_lead",
  "add_cross_reference",
] as const;

export type WorkflowActionKey = (typeof WORKFLOW_ACTIONS)[number];

export function isWorkflowAction(value: string): value is WorkflowActionKey {
  return (WORKFLOW_ACTIONS as readonly string[]).includes(value);
}

/**
 * Deskryptor pojedynczego parametru akcji - napędza dynamiczny formularz
 * kroku w edytorze. `kind`:
 *  - text     - zwykłe pole tekstowe (wartość string),
 *  - boolean  - przełącznik (wartość boolean),
 *  - roles    - lista ról oddzielona przecinkami (wartość string[]).
 * `example` to podpowiedź/wartość domyślna silnika pokazywana jako placeholder.
 */
export interface WorkflowActionParamSpec {
  key: string;
  kind: "text" | "boolean" | "roles";
  example?: string;
}

// Parametry wspólne wszystkich akcji notyfikacyjnych (enqueue_notification):
// tytuły PL/EN obsługują {aggregate_id}, href dodatkowo {post_href}.
const NOTIFICATION_PARAMS: WorkflowActionParamSpec[] = [
  { key: "title_pl", kind: "text" },
  { key: "title_en", kind: "text" },
  { key: "href", kind: "text", example: "/admin/comments" },
  { key: "icon", kind: "text", example: "newspaper" },
  { key: "kind", kind: "text", example: "system" },
];

export const WORKFLOW_ACTION_PARAMS: Record<WorkflowActionKey, WorkflowActionParamSpec[]> = {
  notify_user: [
    { key: "user_id", kind: "text" },
    { key: "user_from", kind: "text", example: "user_id" },
    ...NOTIFICATION_PARAMS,
  ],
  notify_staff: [{ key: "roles", kind: "roles", example: "admin, editor" }, ...NOTIFICATION_PARAMS],
  notify_followers: [
    { key: "author_from", kind: "text", example: "author_id" },
    ...NOTIFICATION_PARAMS,
  ],
  create_crm_lead: [
    { key: "email_from", kind: "text", example: "email" },
    { key: "first_name_from", kind: "text", example: "first_name" },
    { key: "last_name_from", kind: "text", example: "last_name" },
    { key: "newsletter", kind: "boolean" },
    { key: "marketing", kind: "boolean" },
  ],
  add_cross_reference: [
    { key: "target_id", kind: "text" },
    { key: "target_id_from", kind: "text" },
    { key: "target_type", kind: "text", example: "post" },
    { key: "relation", kind: "text", example: "related" },
  ],
};

// ---------------------------------------------------------------------------
// Kroki: parsowanie i serializacja jsonb `steps`.
// ---------------------------------------------------------------------------

export type WorkflowStepParamValue = string | boolean | string[];

export interface WorkflowStep {
  action: WorkflowActionKey;
  params: Record<string, WorkflowStepParamValue>;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * Bezpieczne parsowanie kolumny jsonb `steps` do typowanej listy kroków.
 * Wpisy nieznane silnikowi (obca akcja / zdeformowany kształt) są pomijane -
 * edytor nigdy nie renderuje formularza, którego zapis mógłby uszkodzić dane.
 */
export function parseWorkflowSteps(raw: Json): WorkflowStep[] {
  if (!Array.isArray(raw)) return [];
  const steps: WorkflowStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const action = record.action;
    if (typeof action !== "string" || !isWorkflowAction(action)) continue;
    const params: Record<string, WorkflowStepParamValue> = {};
    const rawParams = record.params;
    if (rawParams && typeof rawParams === "object" && !Array.isArray(rawParams)) {
      for (const [key, value] of Object.entries(rawParams as Record<string, unknown>)) {
        if (typeof value === "string" || typeof value === "boolean") params[key] = value;
        else if (isStringArray(value)) params[key] = value;
      }
    }
    steps.push({ action, params });
  }
  return steps;
}

/**
 * Serializacja kroków do jsonb: puste stringi/tablice wypadają z params,
 * a parametry typu `roles` akceptują w drafcie także surowy CSV (edytor
 * trzyma tekst podczas pisania, żeby nie zjadać przecinków) - tu następuje
 * podział do string[].
 */
export function serializeWorkflowSteps(steps: WorkflowStep[]): Json {
  return steps.map((step) => {
    const rolesKeys = new Set(
      WORKFLOW_ACTION_PARAMS[step.action]
        .filter((spec) => spec.kind === "roles")
        .map((spec) => spec.key),
    );
    const params: Record<string, Json> = {};
    for (const [key, value] of Object.entries(step.params)) {
      if (typeof value === "string") {
        if (rolesKeys.has(key)) {
          const roles = value
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          if (roles.length > 0) params[key] = roles;
          continue;
        }
        const trimmed = value.trim();
        if (trimmed.length > 0) params[key] = trimmed;
      } else if (typeof value === "boolean") {
        if (value) params[key] = value;
      } else if (value.length > 0) {
        params[key] = value;
      }
    }
    return { action: step.action, params };
  });
}

// ---------------------------------------------------------------------------
// Warunek: pary klucz/wartość <-> jsonb containment (payload @> condition).
// ---------------------------------------------------------------------------

export interface ConditionPair {
  key: string;
  /** Surowy tekst z inputu; parsowany do JSON dopiero przy zapisie. */
  value: string;
}

/**
 * Wartość pary warunku: "won" zostaje stringiem, ale "true"/"42"/"null"
 * są interpretowane jako typy JSON - containment @> rozróżnia typy, a payloady
 * emiterów niosą też booleany i liczby.
 */
export function parseConditionValue(raw: string): Json {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  // Jawny literal JSON ('{"a":1}', '"tekst"', '[1,2]') przechodzi wprost.
  if (/^["[{]/.test(trimmed)) {
    try {
      return JSON.parse(trimmed) as Json;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

/** Reprezentacja wartości JSON w inpucie tekstowym (odwrotność parsowania). */
export function conditionValueToInput(value: Json): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function conditionToPairs(raw: Json): ConditionPair[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw).map(([key, value]) => ({
    key,
    value: conditionValueToInput(value as Json),
  }));
}

export function pairsToCondition(pairs: ConditionPair[]): Json {
  const condition: Record<string, Json> = {};
  for (const pair of pairs) {
    const key = pair.key.trim();
    if (key.length === 0) continue;
    condition[key] = parseConditionValue(pair.value);
  }
  return condition;
}

// ---------------------------------------------------------------------------
// Walidacje draftu.
// ---------------------------------------------------------------------------

// Kontrakt z CHECK-iem na domain_events: `<agregat>.<czasownik>.v<n>`.
const EVENT_TYPE_PATTERN = /^[a-z0-9_]+\.[a-z0-9_]+\.v[0-9]+$/;

export function isValidEventType(value: string): boolean {
  return EVENT_TYPE_PATTERN.test(value);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value.trim());
}

export interface WorkflowDraft {
  id: string | null;
  name: string;
  enabled: boolean;
  triggerEventType: string;
  conditionPairs: ConditionPair[];
  steps: WorkflowStep[];
}

export function emptyWorkflowDraft(): WorkflowDraft {
  return {
    id: null,
    name: "",
    enabled: true,
    triggerEventType: "",
    conditionPairs: [],
    steps: [],
  };
}

export function draftFromDefinition(row: WorkflowDefinitionRow): WorkflowDraft {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    triggerEventType: row.trigger_event_type,
    conditionPairs: conditionToPairs(row.condition),
    steps: parseWorkflowSteps(row.steps),
  };
}

/** Klucze błędów walidacji - mapowane na i18n w UI. */
export type WorkflowDraftError = "name" | "trigger" | "steps" | "conditionKey";

export function validateWorkflowDraft(draft: WorkflowDraft): WorkflowDraftError[] {
  const errors: WorkflowDraftError[] = [];
  if (draft.name.trim().length === 0) errors.push("name");
  if (!isValidEventType(draft.triggerEventType.trim())) errors.push("trigger");
  if (draft.steps.length === 0) errors.push("steps");
  if (draft.conditionPairs.some((p) => p.key.trim() === "" && p.value.trim() !== "")) {
    errors.push("conditionKey");
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Statystyki przebiegów (agregacja po stronie klienta z okna ostatnich runów).
// ---------------------------------------------------------------------------

export interface WorkflowRunStats {
  total: number;
  failed: number;
  lastRunAt: string | null;
  lastStatus: "succeeded" | "failed" | null;
}

/** Agregat per definicja z okna ostatnich przebiegów (rows DESC po dacie). */
export function aggregateRunStats(
  runs: readonly Pick<WorkflowRunRow, "workflow_id" | "status" | "created_at">[],
): Map<string, WorkflowRunStats> {
  const stats = new Map<string, WorkflowRunStats>();
  for (const run of runs) {
    const entry = stats.get(run.workflow_id) ?? {
      total: 0,
      failed: 0,
      lastRunAt: null,
      lastStatus: null,
    };
    entry.total += 1;
    if (run.status === "failed") entry.failed += 1;
    if (entry.lastRunAt === null || run.created_at > entry.lastRunAt) {
      entry.lastRunAt = run.created_at;
      entry.lastStatus = run.status === "failed" ? "failed" : "succeeded";
    }
    stats.set(run.workflow_id, entry);
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Zapytania i mutacje.
// ---------------------------------------------------------------------------

export async function fetchWorkflowDefinitions(): Promise<WorkflowDefinitionRow[]> {
  const { data, error } = await supabase
    .from("workflow_definitions")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Okno ostatnich przebiegów do statystyk listy definicji i KPI nagłówka. */
export async function fetchRecentWorkflowRuns(limit = 500): Promise<WorkflowRunRow[]> {
  const { data, error } = await supabase
    .from("workflow_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export interface WorkflowRunWithDefinition extends WorkflowRunRow {
  workflow_definitions: { name: string } | null;
}

export interface WorkflowRunsFilter {
  workflowId?: string;
  status?: "succeeded" | "failed";
  limit?: number;
}

export async function fetchWorkflowRuns(
  filter: WorkflowRunsFilter = {},
): Promise<WorkflowRunWithDefinition[]> {
  let query = supabase
    .from("workflow_runs")
    .select("*, workflow_definitions(name)")
    .order("created_at", { ascending: false })
    .limit(filter.limit ?? 200);
  if (filter.workflowId) query = query.eq("workflow_id", filter.workflowId);
  if (filter.status) query = query.eq("status", filter.status);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as WorkflowRunWithDefinition[];
}

export async function fetchWorkflowTemplates(): Promise<WorkflowTemplateRow[]> {
  const { data, error } = await supabase
    .from("workflow_templates")
    .select("*")
    .order("key", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function installWorkflowTemplate(key: string): Promise<string> {
  const { data, error } = await supabase.rpc("install_workflow_template", { p_key: key });
  if (error) throw error;
  return data;
}

export async function saveWorkflowDefinition(draft: WorkflowDraft): Promise<string> {
  const payload = {
    name: draft.name.trim(),
    trigger_event_type: draft.triggerEventType.trim(),
    condition: pairsToCondition(draft.conditionPairs),
    steps: serializeWorkflowSteps(draft.steps),
    enabled: draft.enabled,
  };

  if (draft.id) {
    const { error } = await supabase
      .from("workflow_definitions")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", draft.id);
    if (error) throw error;
    return draft.id;
  }

  // Kolumna tenant_id nie ma defaultu - pinujemy jawnie wartością, którą
  // policy WITH CHECK i tak wymusza (current_tenant_id() wołającego).
  const { data: tenantId, error: tenantErr } = await supabase.rpc("current_tenant_id");
  if (tenantErr) throw tenantErr;
  if (!tenantId) throw new Error("workflows: no tenant for current user");
  const { data: session } = await supabase.auth.getSession();

  const { data, error } = await supabase
    .from("workflow_definitions")
    .insert({
      ...payload,
      tenant_id: tenantId,
      created_by: session.session?.user.id ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function setWorkflowEnabled(id: string, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from("workflow_definitions")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteWorkflowDefinition(id: string): Promise<void> {
  const { error } = await supabase.from("workflow_definitions").delete().eq("id", id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Ślad korelacji: komenda -> zdarzenia -> workflowy -> dostawy integracji.
// ---------------------------------------------------------------------------

export interface CorrelationTraceDelivery {
  id: string;
  event_id: string | null;
  event_type: string;
  status: string;
  attempts: number;
  last_error: string | null;
  delivered_at: string | null;
  created_at: string;
  integration_endpoints: { name: string } | null;
}

export interface CorrelationTrace {
  correlationId: string;
  events: DomainEventRow[];
  runs: WorkflowRunWithDefinition[];
  deliveries: CorrelationTraceDelivery[];
}

/**
 * Pełny ślad „co się wydarzyło po moim kliknięciu": zdarzenia domenowe po
 * correlation_id (RPC), przebiegi workflow po tym samym id oraz dostawy
 * webhooków outboxu przypięte do zdarzeń śladu. Wszystko pod RLS staffu.
 */
export async function fetchCorrelationTrace(correlationId: string): Promise<CorrelationTrace> {
  const trimmed = correlationId.trim();
  const [eventsRes, runsRes] = await Promise.all([
    supabase.rpc("get_correlated_events", { p_correlation_id: trimmed }),
    supabase
      .from("workflow_runs")
      .select("*, workflow_definitions(name)")
      .eq("correlation_id", trimmed)
      .order("created_at", { ascending: true }),
  ]);
  if (eventsRes.error) throw eventsRes.error;
  if (runsRes.error) throw runsRes.error;

  const events = eventsRes.data ?? [];
  const runs = (runsRes.data ?? []) as WorkflowRunWithDefinition[];

  let deliveries: CorrelationTraceDelivery[] = [];
  if (events.length > 0) {
    const { data, error } = await supabase
      .from("integration_deliveries")
      .select(
        "id,event_id,event_type,status,attempts,last_error,delivered_at,created_at,integration_endpoints(name)",
      )
      .in(
        "event_id",
        events.map((e) => e.id),
      )
      .order("created_at", { ascending: true });
    if (error) throw error;
    deliveries = (data ?? []) as CorrelationTraceDelivery[];
  }

  return { correlationId: trimmed, events, runs, deliveries };
}
