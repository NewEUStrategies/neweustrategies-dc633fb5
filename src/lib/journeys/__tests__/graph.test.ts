// Walidacja grafu ścieżki (S5): te same reguły co `journey_validate_graph`
// przy publikacji - DAG, gałęzie, osiągalność, limit węzłów, zakaz maila przy
// `payment_failed` i ostrzeżenia edytora. Edytor pokazuje WSZYSTKIE błędy
// naraz, więc walidator zbiera listę zamiast rzucać.
import { describe, expect, it } from "vitest";
import {
  JourneyDraftSchema,
  JourneySettingsSchema,
  PAYMENT_FAILED_EVENT,
  ancestorsOf,
  emptyJourneyGraph,
  validateJourneyGraph,
  type JourneyGraph,
} from "../graph";
import { JOURNEY_LIMITS } from "../limits";
import {
  HISTORY_PREDICATE_KINDS,
  PredicateSchema,
  isHistoryPredicate,
  predicateEmailNodeRef,
} from "../predicates";

type Node = JourneyGraph["nodes"][number];
type Edge = JourneyGraph["edges"][number];

const n = (id: string, type: Node["type"], params: unknown = {}): Node => ({ id, type, params });
const e = (from: string, to: string, branch: Edge["branch"] = "next"): Edge => ({
  from,
  to,
  branch,
});

/** Wyzwalacz -> mail -> czekanie -> warunek (kliknięcie maila) -> cel / wyjście. */
function sample(): JourneyGraph {
  return {
    nodes: [
      n("t", "trigger"),
      n("mail", "send_email"),
      n("wait", "wait", { mode: "duration", minutes: 60 }),
      n("check", "if_else", {
        match: "all",
        predicates: [{ kind: "email_clicked", nodeId: "mail" }],
      }),
      n("goal", "goal", { label: "Kliknął" }),
      n("out", "exit"),
    ],
    edges: [
      e("t", "mail"),
      e("mail", "wait"),
      e("wait", "check"),
      e("check", "goal", "yes"),
      e("check", "out", "no"),
    ],
  };
}

const codes = (graph: unknown, ctx = {}) =>
  validateJourneyGraph(graph, ctx).errors.map((i) => i.code);

describe("graf poprawny", () => {
  it("przykład i pusty szkic przechodzą bez błędów i ostrzeżeń", () => {
    expect(validateJourneyGraph(sample())).toEqual({ ok: true, errors: [], warnings: [] });
    expect(validateJourneyGraph(emptyJourneyGraph()).ok).toBe(true);
  });

  it("A/B z wagami 100 i czekanie na zdarzenie z dwiema gałęziami", () => {
    const graph: JourneyGraph = {
      nodes: [
        n("t", "trigger"),
        n("ab", "ab_split", { weights: { A: 30, B: 70 }, winnerMetric: "click" }),
        n("a", "send_email"),
        n("b", "send_email"),
        n("w", "wait", {
          mode: "until_event",
          eventType: "checkout.completed.v1",
          condition: { kind: "subscription" },
          timeoutMinutes: 1440,
        }),
        n("done", "goal"),
        n("x", "exit"),
      ],
      edges: [
        e("t", "ab"),
        e("ab", "a", "A"),
        e("ab", "b", "B"),
        e("a", "w"),
        e("b", "w"),
        e("w", "done", "event"),
        e("w", "x", "timeout"),
      ],
    };
    expect(codes(graph)).toEqual([]);
  });
});

describe("struktura", () => {
  it("kształt spoza schematu = params_invalid ze ścieżką pola", () => {
    const result = validateJourneyGraph({ nodes: [{ id: "a b", type: "trigger" }], edges: [] });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatchObject({ code: "params_invalid", detail: "nodes.0.id" });
    expect(codes(null)).toEqual(["params_invalid"]);
  });

  it("zero węzłów i więcej niż limit", () => {
    expect(codes({ nodes: [], edges: [] })).toEqual(
      expect.arrayContaining(["nodes_count", "trigger_count"]),
    );
    const many: JourneyGraph = {
      nodes: [
        n("t", "trigger"),
        ...Array.from({ length: JOURNEY_LIMITS.nodesMax }, (_, i) => n(`x${i}`, "exit")),
      ],
      edges: Array.from({ length: JOURNEY_LIMITS.nodesMax }, (_, i) => e("t", `x${i}`)),
    };
    expect(codes(many)).toContain("nodes_count");
  });

  it("duplikat id, dwa wyzwalacze, krawędź do nikąd i do wyzwalacza", () => {
    const graph = sample();
    graph.nodes.push(n("mail", "send_email"), n("t2", "trigger"));
    graph.edges.push(e("goal", "ghost"), e("out", "t"));
    const found = codes(graph);
    expect(found).toEqual(
      expect.arrayContaining([
        "node_id_duplicate",
        "trigger_count",
        "edge_dangling",
        "edge_into_trigger",
      ]),
    );
  });

  it("dwie krawędzie tej samej gałęzi i niekompletne gałęzie", () => {
    const graph = sample();
    graph.edges.push(e("check", "out", "yes"));
    graph.edges = graph.edges.filter((edge) => !(edge.from === "check" && edge.branch === "no"));
    const found = codes(graph);
    expect(found).toContain("edge_duplicate_branch");
    expect(found).toContain("branches_incomplete");
  });

  it("węzeł końcowy z krawędzią wychodzącą i akcja bez wyjścia", () => {
    const graph: JourneyGraph = {
      nodes: [n("t", "trigger"), n("tag", "add_tag", { tag: "vip" }), n("x", "exit")],
      edges: [e("t", "tag"), e("x", "tag")],
    };
    const result = validateJourneyGraph(graph);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        { code: "branches_incomplete", nodeId: "tag" },
        { code: "branches_incomplete", nodeId: "x" },
      ]),
    );
  });

  it("cykl = graph_cycle (DAG: węzeł odwiedzany raz na zapis)", () => {
    const graph: JourneyGraph = {
      nodes: [
        n("t", "trigger"),
        n("a", "wait", { mode: "duration", minutes: 5 }),
        n("b", "wait", { mode: "duration", minutes: 5 }),
      ],
      edges: [e("t", "a"), e("a", "b"), e("b", "a")],
    };
    expect(codes(graph)).toContain("graph_cycle");
  });

  it("węzeł nieosiągalny z wyzwalacza", () => {
    const graph = sample();
    graph.nodes.push(n("orphan", "exit"));
    expect(validateJourneyGraph(graph).errors).toContainEqual({
      code: "node_unreachable",
      nodeId: "orphan",
    });
  });
});

describe("parametry", () => {
  it("wagi A/B ≠ 100, etap klienta, tag > 40, za krótkie czekanie", () => {
    const graph: JourneyGraph = {
      nodes: [
        n("t", "trigger"),
        n("ab", "ab_split", { weights: { A: 50, B: 40 }, winnerMetric: "goal" }),
        n("life", "set_lifecycle_stage", { stage: "customer" }),
        n("tag", "add_tag", { tag: "x".repeat(41) }),
        n("w", "wait", { mode: "duration", minutes: 1 }),
        n("x", "exit"),
      ],
      edges: [
        e("t", "ab"),
        e("ab", "life", "A"),
        e("ab", "tag", "B"),
        e("life", "w"),
        e("tag", "w"),
        e("w", "x"),
      ],
    };
    const result = validateJourneyGraph(graph);
    const invalid = result.errors.filter((i) => i.code === "params_invalid");
    expect(invalid.map((i) => i.nodeId).sort()).toEqual(["ab", "life", "tag", "w"]);
    expect(invalid.find((i) => i.nodeId === "ab")?.detail).toBe("ab_weights");
    expect(invalid.find((i) => i.nodeId === "life")?.detail).toBe("lifecycle_stage");
  });

  it("warunek otwarcia/kliknięcia musi wskazywać PRZODKA typu send_email", () => {
    const graph = sample();
    const check = graph.nodes.find((node) => node.id === "check") as Node;
    check.params = {
      match: "any",
      predicates: [
        { kind: "email_opened", nodeId: "nowhere" },
        { kind: "email_clicked", nodeId: "wait" },
        { kind: "email_opened", nodeId: "mail", withinHours: 48, excludeMachine: true },
      ],
    };
    const errors = validateJourneyGraph(graph).errors;
    expect(errors).toEqual([
      { code: "predicate_not_ancestor_email", nodeId: "check", detail: "nowhere" },
      { code: "predicate_not_ancestor_email", nodeId: "check", detail: "wait" },
    ]);
  });

  it("mail zakazany przy payment_failed (windykacja należy do dunning)", () => {
    const result = validateJourneyGraph(sample(), { triggerEventType: PAYMENT_FAILED_EVENT });
    expect(result.errors).toEqual([{ code: "email_on_payment_failed", nodeId: "mail" }]);
    expect(validateJourneyGraph(sample(), { triggerEventType: "account.registered.v1" }).ok).toBe(
      true,
    );
  });
});

describe("ostrzeżenia", () => {
  const taskGraph = (): JourneyGraph => ({
    nodes: [
      n("t", "trigger"),
      n("task", "create_crm_task", {
        title: "Zadzwoń",
        dueInDays: 1,
        assignee: { mode: "owner_or_default" },
      }),
      n("stage", "set_crm_stage", { stage: "qualified", onlyForward: true }),
      n("x", "exit"),
    ],
    edges: [e("t", "task"), e("task", "stage"), e("stage", "x")],
  });

  it("przepis automatyzacji o tym samym wyzwalaczu z zadaniem CRM = workflow_overlap", () => {
    const result = validateJourneyGraph(taskGraph(), {
      triggerEventType: "checkout.abandoned.v1",
      workflows: [
        {
          name: "Porzucony koszyk",
          triggerEventType: "checkout.abandoned.v1",
          actions: ["create_crm_task"],
        },
        { name: "Inny", triggerEventType: "account.registered.v1", actions: ["create_crm_task"] },
        { name: "Tag", triggerEventType: "checkout.abandoned.v1", actions: ["add_tag"] },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([{ code: "workflow_overlap", detail: "Porzucony koszyk" }]);
  });

  it("akcja emitująca wyzwalacz aktywnej (albo tej) ścieżki = trigger_cycle", () => {
    const result = validateJourneyGraph(taskGraph(), {
      triggerEventType: "crm_lead.stage_changed.v1",
      activeJourneys: [{ name: "Etapy", triggerEventType: "crm_lead.updated.v1" }],
    });
    expect(result.warnings).toEqual([
      { code: "trigger_cycle", detail: "Etapy" },
      { code: "trigger_cycle", detail: "crm_lead.stage_changed.v1" },
    ]);
  });

  it("warunek historii w filtrze wejścia = entry_filter_history (zawsze fałsz)", () => {
    const result = validateJourneyGraph(emptyJourneyGraph(), {
      entryFilter: [{ kind: "email_opened", nodeId: "m" }],
    });
    expect(result.warnings).toEqual([{ code: "entry_filter_history" }]);
  });
});

describe("przodkowie", () => {
  it("idą wstecz po krawędziach, bez potomków i bez samego węzła", () => {
    expect([...ancestorsOf(sample(), "check")].sort()).toEqual(["mail", "t", "wait"]);
    expect(ancestorsOf(sample(), "t").size).toBe(0);
  });
});

describe("ustawienia i szkic", () => {
  it("ustawienia: typ zdarzenia, polityka wejścia, limity karencji", () => {
    expect(
      JourneySettingsSchema.safeParse({
        triggerEventType: "account.registered.v1",
        reentry: "cooldown",
        reentryCooldownDays: 30,
        goal: { eventType: "checkout.completed.v1", condition: { kind: "subscription" } },
        exitEvents: [{ eventType: "subscription.renewed.v1" }],
      }).success,
    ).toBe(true);
    expect(JourneySettingsSchema.safeParse({ triggerEventType: "zly typ" }).success).toBe(false);
    expect(
      JourneySettingsSchema.safeParse({
        triggerEventType: "account.registered.v1",
        reentryCooldownDays: JOURNEY_LIMITS.cooldownDaysMax + 1,
      }).success,
    ).toBe(false);
  });

  it("szkic = graf + ustawienia, nic więcej (strict)", () => {
    const settings = { triggerEventType: "account.registered.v1" };
    expect(JourneyDraftSchema.safeParse({ graph: sample(), settings }).success).toBe(true);
    expect(JourneyDraftSchema.safeParse({ graph: sample(), settings, extra: 1 }).success).toBe(
      false,
    );
  });
});

describe("warunki", () => {
  it("porównanie warstw wymaga listy warstw", () => {
    expect(PredicateSchema.safeParse({ kind: "plan", op: "tier_in" }).success).toBe(false);
    expect(
      PredicateSchema.safeParse({ kind: "plan", op: "tier_at_least", tierKeys: ["pro"] }).success,
    ).toBe(true);
    expect(PredicateSchema.safeParse({ kind: "plan", op: "has_paid" }).success).toBe(true);
  });

  it("pole ładunku wejścia: in / not_in z listą wartości", () => {
    const ok = PredicateSchema.safeParse({
      kind: "trigger_field",
      key: "reason",
      op: "not_in",
      values: ["paused"],
    });
    expect(ok.success).toBe(true);
    expect(
      PredicateSchema.safeParse({ kind: "trigger_field", key: "reason", op: "eq", values: ["x"] })
        .success,
    ).toBe(false);
  });

  it("odwołanie do maila i warunki historii", () => {
    const opened = PredicateSchema.parse({ kind: "email_opened", nodeId: "m1" });
    const tag = PredicateSchema.parse({ kind: "has_tag", tag: "vip" });
    expect(predicateEmailNodeRef(opened)).toBe("m1");
    expect(predicateEmailNodeRef(tag)).toBeNull();
    expect(isHistoryPredicate(opened)).toBe(true);
    expect(isHistoryPredicate(tag)).toBe(false);
    expect(HISTORY_PREDICATE_KINDS).toContain("event_since_enrollment");
  });
});
