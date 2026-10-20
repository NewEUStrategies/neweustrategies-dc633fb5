// GRAF ŚCIEŻKI - schemat (zod) i walidacja dla edytora (S8), server fn
// i testów; ten sam zestaw reguł sprawdza baza przy publikacji
// (`journey_validate_graph`, 20261020140200) - kody błędów są wspólne, więc
// komunikat panelu jest ten sam niezależnie od tego, która strona odrzuciła.
//
// Reguły (SPEC §5.6): dokładnie jeden `trigger`; DAG (węzeł odwiedzany raz na
// zapis - na tym stoi idempotencja kroku); wszystkie węzły osiągalne;
// kompletne gałęzie (`if_else`: yes+no, `ab_split`: A+B z wagami = 100,
// `until_event`: event+timeout); węzły końcowe tylko `goal|exit`;
// otwarcie/kliknięcie wskazuje PRZODKA typu `send_email`; ≤ 60 węzłów; mail
// zakazany przy `billing_subscription.payment_failed.v1` (windykacja należy
// do `dunning.server.ts`).
// Ostrzeżenia (nie błędy): nakładanie z włączonym przepisem
// `workflow_definitions` o tym samym wyzwalaczu i akcji `create_crm_task`
// (dwa zadania na jedno zdarzenie) oraz cykl wyzwalaczy (akcja ustawia
// pole, na które patrzy wyzwalacz aktywnej ścieżki).
import { z } from "zod";
import { LIFECYCLE_STAGES } from "@/lib/crm/lifecycle";
import { JOURNEY_LIMITS, JOURNEY_REENTRY } from "./limits";
import {
  JOURNEY_EDGE_BRANCHES,
  JOURNEY_NODE_TYPES,
  requiredBranches,
  type JourneyEdgeBranch,
  type JourneyNodeType,
} from "./nodeTypes";
import {
  CRM_STAGES,
  ConditionSchema,
  PredicateSchema,
  isHistoryPredicate,
  predicateEmailNodeRef,
  type JourneyPredicate,
} from "./predicates";

/** Limit tagu pisarza CRM (`run_workflow_step`, panel CRM) - nie `tagMax` (64). */
export const JOURNEY_TAG_MAX = 40;
/** Wyzwalacz, przy którym ścieżka nie wysyła maili (windykacja). */
export const PAYMENT_FAILED_EVENT = "billing_subscription.payment_failed.v1";

const NODE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const EVENT_TYPE = z.string().regex(JOURNEY_LIMITS.triggerEventTypePattern);
const EMPTY = z.object({}).strict();

const WaitSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("duration"),
      minutes: z
        .number()
        .int()
        .min(JOURNEY_LIMITS.waitMinutesMin)
        .max(JOURNEY_LIMITS.waitMinutesMax),
    })
    .strict(),
  z
    .object({
      mode: z.literal("until_time"),
      // ISO: 1 = poniedziałek … 7 = niedziela (strefa `journey_settings.timezone`).
      weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
      time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    })
    .strict(),
  z
    .object({
      mode: z.literal("until_event"),
      eventType: EVENT_TYPE,
      condition: ConditionSchema,
      timeoutMinutes: z
        .number()
        .int()
        .min(JOURNEY_LIMITS.waitMinutesMin)
        .max(JOURNEY_LIMITS.untilEventTimeoutMaxMinutes),
    })
    .strict(),
]);
export type JourneyWait = z.infer<typeof WaitSchema>;

const TAG = z.string().trim().min(1).max(JOURNEY_TAG_MAX);

export const NODE_PARAMS_SCHEMAS = {
  trigger: EMPTY,
  wait: WaitSchema,
  send_email: EMPTY,
  ab_split: z
    .object({
      weights: z
        .object({ A: z.number().int().min(0).max(100), B: z.number().int().min(0).max(100) })
        .strict()
        .refine((w) => w.A + w.B === 100, { message: "ab_weights" }),
      winnerMetric: z.enum(["goal", "click"]),
    })
    .strict(),
  if_else: z
    .object({ match: z.enum(["all", "any"]), predicates: z.array(PredicateSchema).min(1).max(20) })
    .strict(),
  set_lifecycle_stage: z
    .object({
      // Etapy klienta ustawia wyłącznie płatność (billing).
      stage: z.enum(LIFECYCLE_STAGES).refine((s) => s !== "customer" && s !== "former_customer", {
        message: "lifecycle_stage",
      }),
    })
    .strict(),
  set_crm_stage: z.object({ stage: z.enum(CRM_STAGES), onlyForward: z.boolean() }).strict(),
  create_crm_task: z
    .object({
      title: z.string().trim().min(1).max(JOURNEY_LIMITS.taskTitleMax),
      description: z.string().max(JOURNEY_LIMITS.descriptionMax).optional(),
      dueInDays: z.number().int().min(0).max(JOURNEY_LIMITS.taskDueDaysMax),
      assignee: z.union([
        z.object({ mode: z.literal("owner_or_default") }).strict(),
        z.object({ mode: z.literal("user"), userId: z.string().uuid() }).strict(),
      ]),
    })
    .strict(),
  add_tag: z.object({ tag: TAG }).strict(),
  remove_tag: z.object({ tag: TAG }).strict(),
  newsletter_list: z
    .object({ op: z.enum(["add", "remove"]), listKey: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) })
    .strict(),
  notify_staff: z
    .object({
      recipients: z.union([
        z.literal("owner"),
        z.literal("admins"),
        z.object({ userIds: z.array(z.string().uuid()).min(1).max(20) }).strict(),
      ]),
      message: z.string().trim().min(1).max(JOURNEY_LIMITS.staffMessageMax),
    })
    .strict(),
  goal: z
    .object({ label: z.string().trim().min(1).max(JOURNEY_LIMITS.nameMax).optional() })
    .strict(),
  exit: EMPTY,
} as const satisfies Record<JourneyNodeType, z.ZodTypeAny>;

export const JourneyNodeSchema = z
  .object({
    id: z.string().regex(NODE_ID_RE),
    type: z.enum(JOURNEY_NODE_TYPES),
    params: z.unknown(),
    /** Pozycja na kanwie (S8) - silnik jej nie czyta. */
    position: z.object({ x: z.number(), y: z.number() }).strict().optional(),
  })
  .strict();
export type JourneyNode = z.infer<typeof JourneyNodeSchema>;

export const JourneyEdgeSchema = z
  .object({
    from: z.string().regex(NODE_ID_RE),
    to: z.string().regex(NODE_ID_RE),
    branch: z.enum(JOURNEY_EDGE_BRANCHES),
  })
  .strict();
export type JourneyEdge = z.infer<typeof JourneyEdgeSchema>;

export const JourneyGraphSchema = z
  .object({
    nodes: z.array(JourneyNodeSchema).max(JOURNEY_LIMITS.nodesMax * 2),
    edges: z.array(JourneyEdgeSchema).max(JOURNEY_LIMITS.nodesMax * 4),
  })
  .strict();
export type JourneyGraph = z.infer<typeof JourneyGraphSchema>;

const ExitEventSchema = z
  .object({ eventType: EVENT_TYPE, condition: ConditionSchema.optional() })
  .strict();

/** Ustawienia szkicu (`journey_definitions.draft.settings` -> `journey_versions`). */
export const JourneySettingsSchema = z
  .object({
    triggerEventType: EVENT_TYPE,
    triggerCondition: ConditionSchema.optional(),
    entryFilter: z.array(PredicateSchema).max(20).optional(),
    reentry: z.enum(JOURNEY_REENTRY).optional(),
    reentryCooldownDays: z
      .number()
      .int()
      .min(JOURNEY_LIMITS.cooldownDaysMin)
      .max(JOURNEY_LIMITS.cooldownDaysMax)
      .optional(),
    goal: ExitEventSchema.optional(),
    exitEvents: z.array(ExitEventSchema).max(10).optional(),
  })
  .strict();
export type JourneySettings = z.infer<typeof JourneySettingsSchema>;

export const JourneyDraftSchema = z
  .object({ graph: JourneyGraphSchema, settings: JourneySettingsSchema })
  .strict();
export type JourneyDraft = z.infer<typeof JourneyDraftSchema>;

/** Kody błędów - te same co `journey_validate_graph` (+ `params_invalid` z zod). */
export type GraphIssueCode =
  | "nodes_count"
  | "node_id_duplicate"
  | "trigger_count"
  | "edge_dangling"
  | "edge_into_trigger"
  | "edge_duplicate_branch"
  | "branches_incomplete"
  | "params_invalid"
  | "predicate_not_ancestor_email"
  | "email_on_payment_failed"
  | "graph_cycle"
  | "node_unreachable"
  // Ostrzeżenia.
  | "workflow_overlap"
  | "trigger_cycle"
  | "entry_filter_history";

export interface GraphIssue {
  code: GraphIssueCode;
  nodeId?: string;
  detail?: string;
}

export interface GraphValidation {
  ok: boolean;
  errors: GraphIssue[];
  warnings: GraphIssue[];
}

/** Włączony przepis automatyzacji (do ostrzeżenia o nakładaniu). */
export interface EnabledWorkflowRef {
  name: string;
  triggerEventType: string;
  actions: readonly string[];
}

/** Aktywna ścieżka najemcy (do ostrzeżenia o cyklu wyzwalaczy). */
export interface ActiveJourneyRef {
  name: string;
  triggerEventType: string;
}

export interface GraphValidationContext {
  triggerEventType?: string;
  entryFilter?: readonly JourneyPredicate[];
  workflows?: readonly EnabledWorkflowRef[];
  activeJourneys?: readonly ActiveJourneyRef[];
}

/**
 * Zdarzenia, które emituje akcja węzła - jeśli aktywna ścieżka startuje na
 * jednym z nich, akcja może zapisywać kontakty w kółko.
 */
export const ACTION_EMITS: Readonly<Partial<Record<JourneyNodeType, readonly string[]>>> = {
  set_crm_stage: ["crm_lead.stage_changed.v1", "crm_lead.updated.v1"],
  set_lifecycle_stage: ["crm_lead.lifecycle_changed.v1", "crm_lead.updated.v1"],
  add_tag: ["crm_lead.updated.v1"],
  remove_tag: ["crm_lead.updated.v1"],
  create_crm_task: ["crm_task.created.v1"],
};

/** Krawędzie wychodzące per węzeł. */
function outgoing(graph: JourneyGraph): Map<string, JourneyEdge[]> {
  const out = new Map<string, JourneyEdge[]>();
  for (const edge of graph.edges) {
    const list = out.get(edge.from) ?? [];
    list.push(edge);
    out.set(edge.from, list);
  }
  return out;
}

/** Przodkowie węzła (po krawędziach wstecz). */
export function ancestorsOf(graph: JourneyGraph, nodeId: string): Set<string> {
  const incoming = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = incoming.get(edge.to) ?? [];
    list.push(edge.from);
    incoming.set(edge.to, list);
  }
  const seen = new Set<string>();
  const stack = [...(incoming.get(nodeId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(incoming.get(id) ?? []));
  }
  return seen;
}

/** Kahn: kolejność topologiczna albo `null` przy cyklu. */
function topologicalOrder(graph: JourneyGraph): string[] | null {
  const indegree = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const edge of graph.edges) {
    if (indegree.has(edge.to)) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }
  const queue = [...indegree].filter(([, d]) => d === 0).map(([id]) => id);
  const order: string[] = [];
  const out = outgoing(graph);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const edge of out.get(id) ?? []) {
      const next = (indegree.get(edge.to) ?? 0) - 1;
      indegree.set(edge.to, next);
      if (next === 0) queue.push(edge.to);
    }
  }
  return order.length === graph.nodes.length ? order : null;
}

function reachableFrom(graph: JourneyGraph, start: string): Set<string> {
  const out = outgoing(graph);
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of out.get(id) ?? []) stack.push(edge.to);
  }
  return seen;
}

/**
 * Pełna walidacja grafu: kształt (zod), struktura i parametry. Zwraca listę
 * błędów zamiast rzucać - edytor pokazuje wszystkie naraz.
 */
export function validateJourneyGraph(
  input: unknown,
  context: GraphValidationContext = {},
): GraphValidation {
  const errors: GraphIssue[] = [];
  const warnings: GraphIssue[] = [];
  const parsed = JourneyGraphSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: [{ code: "params_invalid", detail: parsed.error.issues[0]?.path.join(".") }],
      warnings,
    };
  }
  const graph = parsed.data;
  const byId = new Map<string, JourneyNode>();
  for (const node of graph.nodes) {
    if (byId.has(node.id)) errors.push({ code: "node_id_duplicate", nodeId: node.id });
    byId.set(node.id, node);
  }
  if (graph.nodes.length === 0 || graph.nodes.length > JOURNEY_LIMITS.nodesMax) {
    errors.push({ code: "nodes_count" });
  }
  const triggers = graph.nodes.filter((n) => n.type === "trigger");
  if (triggers.length !== 1) errors.push({ code: "trigger_count" });
  const trigger = triggers[0];

  const seenBranch = new Set<string>();
  for (const edge of graph.edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) {
      errors.push({ code: "edge_dangling", nodeId: edge.from });
    }
    if (trigger && edge.to === trigger.id)
      errors.push({ code: "edge_into_trigger", nodeId: edge.from });
    const key = `${edge.from}\u0000${edge.branch}`;
    if (seenBranch.has(key)) errors.push({ code: "edge_duplicate_branch", nodeId: edge.from });
    seenBranch.add(key);
  }

  const out = outgoing(graph);
  for (const node of graph.nodes) {
    const params = NODE_PARAMS_SCHEMAS[node.type].safeParse(node.params ?? {});
    if (!params.success) {
      errors.push({
        code: "params_invalid",
        nodeId: node.id,
        detail: params.error.issues[0]?.message,
      });
    }
    const required = [...requiredBranches(node.type, node.params)].sort();
    const actual = [...new Set((out.get(node.id) ?? []).map((e) => e.branch))].sort();
    if (required.join(",") !== actual.join(",")) {
      errors.push({ code: "branches_incomplete", nodeId: node.id });
    }
    if (node.type === "send_email" && context.triggerEventType === PAYMENT_FAILED_EVENT) {
      errors.push({ code: "email_on_payment_failed", nodeId: node.id });
    }
    if (node.type === "if_else" && params.success) {
      const ancestors = ancestorsOf(graph, node.id);
      for (const predicate of (params.data as { predicates: JourneyPredicate[] }).predicates) {
        const ref = predicateEmailNodeRef(predicate);
        if (ref !== null && !(ancestors.has(ref) && byId.get(ref)?.type === "send_email")) {
          errors.push({ code: "predicate_not_ancestor_email", nodeId: node.id, detail: ref });
        }
      }
    }
  }

  if (topologicalOrder(graph) === null) {
    errors.push({ code: "graph_cycle" });
  } else if (trigger) {
    const reachable = reachableFrom(graph, trigger.id);
    for (const node of graph.nodes) {
      if (!reachable.has(node.id)) errors.push({ code: "node_unreachable", nodeId: node.id });
    }
  }

  // ── Ostrzeżenia ──
  const triggerType = context.triggerEventType;
  if (triggerType) {
    const hasTask = graph.nodes.some((n) => n.type === "create_crm_task");
    for (const wf of context.workflows ?? []) {
      if (
        hasTask &&
        wf.triggerEventType === triggerType &&
        wf.actions.includes("create_crm_task")
      ) {
        warnings.push({ code: "workflow_overlap", detail: wf.name });
      }
    }
  }
  const emitted = new Set(graph.nodes.flatMap((n) => ACTION_EMITS[n.type] ?? []));
  const watched = [
    ...(context.activeJourneys ?? []),
    ...(triggerType ? [{ name: "", triggerEventType: triggerType }] : []),
  ];
  for (const journey of watched) {
    if (emitted.has(journey.triggerEventType)) {
      warnings.push({ code: "trigger_cycle", detail: journey.name || journey.triggerEventType });
    }
  }
  if ((context.entryFilter ?? []).some(isHistoryPredicate)) {
    warnings.push({ code: "entry_filter_history" });
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Pusty szkic nowej ścieżki: sam wyzwalacz i wyjście. */
export function emptyJourneyGraph(): JourneyGraph {
  return {
    nodes: [
      { id: "trigger", type: "trigger", params: {} },
      { id: "exit", type: "exit", params: {} },
    ],
    edges: [{ from: "trigger", to: "exit", branch: "next" satisfies JourneyEdgeBranch }],
  };
}
