// Operacje na grafie ścieżki (S8) - czyste funkcje i jedno źródło menu.
//
// CO TEN PLIK DOWODZI.
//   1. Każda operacja (insertAfter, insertBranching, removeNode reconnect /
//      subtree, moveWithinSegment, mergeInto, duplicateSubtree,
//      replaceTerminal, resolveSplit) daje graf przechodzący
//      `validateJourneyGraph`, a operacja, która dołożyłaby błąd, jest
//      odrzucana (`would_break`) - np. usunięcie maila, o który pyta warunek.
//   2. Kolejność krawędzi: wstawienie w miejscu, scalenie na końcu - krok,
//      do którego dołączono gałąź, nie zmienia rodzica.
//   3. Wyzwalacz chroniony, limit 60 kroków, identyfikatory zgodne ze wzorcem,
//      parametry domyślne przechodzą schematy.
//   4. PARYTET: `availableOps` to jedyne źródło pozycji menu kanwy, listy
//      i klawiatury - KAŻDA pozycja dla KAŻDEGO kroku 14 szablonów wykonuje się
//      przez `applyOp` i daje graf poprawny; skróty Insert/Delete są
//      jednoznaczne, a etykiety mają tłumaczenie PL i EN.
import { describe, expect, it } from "vitest";

import {
  JOURNEY_OP_LABEL_KEY,
  NODE_ID_PATTERN,
  applyOp,
  availableOps,
  defaultParams,
  duplicateSubtree,
  duplicateTargets,
  insertAfter,
  insertBranching,
  mergeInto,
  mergeTargets,
  moveWithinSegment,
  newNodeId,
  opForShortcut,
  ownedSubtree,
  removeNode,
  replaceTerminal,
  resolveSplit,
  waitUntilEventParams,
  type JourneyOpResult,
} from "../ops";
import { buildJourneyView } from "../viewModel";
import {
  NODE_PARAMS_SCHEMAS,
  emptyJourneyGraph,
  validateJourneyGraph,
  type JourneyGraph,
} from "@/lib/journeys/graph";
import {
  JOURNEY_NODE_TYPES,
  type JourneyEdgeBranch,
  type JourneyNodeType,
} from "@/lib/journeys/nodeTypes";
import { JOURNEY_TEMPLATES } from "@/lib/journeys/templates";
import { journeysListDictionaries } from "@/lib/i18n-admin-journeys-list";

const node = (id: string, type: JourneyNodeType, params: unknown = defaultParams(type)) => ({
  id,
  type,
  params,
});
const edge = (from: string, to: string, branch: JourneyEdgeBranch = "next") => ({
  from,
  to,
  branch,
});

function ok(result: JourneyOpResult): JourneyGraph {
  if (!result.ok) throw new Error(`operacja odrzucona: ${result.error} ${result.codes ?? ""}`);
  return result.graph;
}

function expectValid(graph: JourneyGraph, triggerEventType?: string) {
  const check = validateJourneyGraph(graph, { triggerEventType });
  expect(check.errors, JSON.stringify(check.errors)).toEqual([]);
}

const welcome = () => structuredClone(JOURNEY_TEMPLATES.welcome_onboarding.graph);
const newsletter = () => structuredClone(JOURNEY_TEMPLATES.newsletter_welcome.graph);

/** Test A/B; ramię A: mail -> warunek „otworzył ten mail” -> cel / koniec; ramię B: koniec. */
function splitWithPredicate(): JourneyGraph {
  return {
    nodes: [
      node("t", "trigger"),
      node("ab", "ab_split"),
      node("ma", "send_email"),
      node("if", "if_else", { match: "all", predicates: [{ kind: "email_opened", nodeId: "ma" }] }),
      node("ga", "goal"),
      node("xa", "exit"),
      node("xb", "exit"),
    ],
    edges: [
      edge("t", "ab"),
      edge("ab", "ma", "A"),
      edge("ab", "xb", "B"),
      edge("ma", "if"),
      edge("if", "ga", "yes"),
      edge("if", "xa", "no"),
    ],
  };
}

describe("parametry domyślne i identyfikatory", () => {
  it.each(JOURNEY_NODE_TYPES)("%s: parametry domyślne przechodzą schemat", (type) => {
    expect(NODE_PARAMS_SCHEMAS[type].safeParse(defaultParams(type)).success).toBe(true);
  });

  it("parametry podane przez UI (teksty w języku panelu) też przechodzą schemat", () => {
    const params = defaultParams("create_crm_task", { taskTitle: "Call the contact" });
    expect(NODE_PARAMS_SCHEMAS.create_crm_task.safeParse(params).success).toBe(true);
    expect(NODE_PARAMS_SCHEMAS.wait.safeParse(waitUntilEventParams()).success).toBe(true);
  });

  it("newNodeId: najmniejszy wolny numer, wzorzec identyfikatora, rezerwacja", () => {
    const graph = welcome();
    expect(newNodeId(graph, "wait")).toBe("wait_1");
    const taken = new Set(["wait_1"]);
    expect(newNodeId(graph, "wait", taken)).toBe("wait_2");
    for (const type of JOURNEY_NODE_TYPES) expect(newNodeId(graph, type)).toMatch(NODE_ID_PATTERN);
    expect(newNodeId({ nodes: [{ id: "exit_1", type: "exit", params: {} }] }, "exit")).toBe(
      "exit_2",
    );
  });
});

describe("insertAfter / insertBranching", () => {
  it("krok liniowy w środku przejmuje dalszy ciąg; krawędzie w miejscu", () => {
    const graph = welcome();
    const index = graph.edges.findIndex((e) => e.from === "welcome");
    const result = insertAfter(graph, "welcome", "next", "add_tag");
    const next = ok(result);
    expectValid(next);
    const id = (result as Extract<JourneyOpResult, { ok: true }>).created[0];
    expect(id).toBe("add_tag_1");
    expect(next.edges[index]).toEqual(edge("welcome", id));
    expect(next.edges[index + 1]).toEqual(edge(id, "wait_3d"));
    expect(next.nodes).toHaveLength(graph.nodes.length + 1);
    // Wejście nie mutuje oryginału.
    expect(graph.nodes).toHaveLength(JOURNEY_TEMPLATES.welcome_onboarding.graph.nodes.length);
  });

  it("w brakującej gałęzi tworzy krok i „Koniec” (graf przestaje być niekompletny)", () => {
    const graph: JourneyGraph = {
      nodes: [node("t", "trigger"), node("if", "if_else"), node("x", "exit")],
      edges: [edge("t", "if"), edge("if", "x", "yes")],
    };
    const result = insertAfter(graph, "if", "no", "send_email");
    const next = ok(result);
    expectValid(next);
    expect((result as { created: string[] }).created).toEqual(["send_email_1", "exit_1"]);
  });

  it.each([
    ["if_else", undefined, ["yes", "no"]],
    ["ab_split", undefined, ["A", "B"]],
    ["wait", waitUntilEventParams(), ["event", "timeout"]],
  ] as const)(
    "rozgałęzienie %s: dalszy ciąg idzie pierwszą gałęzią, reszta dostaje „Koniec”",
    (type, params, branches) => {
      const graph = emptyJourneyGraph();
      const result = insertBranching(graph, "trigger", "next", type, params);
      const next = ok(result);
      expectValid(next);
      const id = (result as { created: string[] }).created[0];
      const out = next.edges.filter((e) => e.from === id);
      expect(out.map((e) => e.branch)).toEqual([...branches]);
      expect(out[0].to).toBe("exit");
      // insertAfter deleguje do insertBranching dla typów z kilkoma gałęziami.
      expect(insertAfter(graph, "trigger", "next", type, params)).toEqual(result);
    },
  );

  it("krok końcowy: nie w środek przepływu; na „Koniec” - zamiana; w pustą gałąź - dopisanie", () => {
    expect(insertAfter(welcome(), "welcome", "next", "goal")).toMatchObject({
      ok: false,
      error: "slot_occupied",
    });
    const swapped = ok(insertAfter(welcome(), "invite", "next", "goal"));
    expectValid(swapped);
    expect(swapped.nodes.some((n) => n.id === "done")).toBe(false);
    const open: JourneyGraph = {
      nodes: [node("t", "trigger"), node("if", "if_else"), node("x", "exit")],
      edges: [edge("t", "if"), edge("if", "x", "yes")],
    };
    expectValid(ok(insertAfter(open, "if", "no", "goal")));
  });

  it("odmowy: wyzwalacz, zła gałąź, brak kroku, limit 60 kroków", () => {
    expect(insertAfter(welcome(), "welcome", "next", "trigger")).toMatchObject({
      error: "trigger_protected",
    });
    expect(insertAfter(welcome(), "trigger", "yes", "wait")).toMatchObject({
      error: "branch_invalid",
    });
    expect(insertAfter(welcome(), "done", "next", "wait")).toMatchObject({
      error: "branch_invalid",
    });
    expect(insertAfter(welcome(), "ghost", "next", "wait")).toMatchObject({
      error: "node_missing",
    });
    const nodes = [node("t", "trigger")];
    const edges = [];
    for (let i = 0; i < 58; i += 1) {
      nodes.push(node(`w${i}`, "wait"));
      edges.push(edge(i === 0 ? "t" : `w${i - 1}`, `w${i}`));
    }
    nodes.push(node("x", "exit"));
    edges.push(edge("w57", "x"));
    const full: JourneyGraph = { nodes, edges };
    expect(full.nodes).toHaveLength(60);
    expectValid(full);
    expect(insertAfter(full, "w0", "next", "wait")).toMatchObject({
      ok: false,
      error: "limit_nodes",
    });
  });

  it("mail przy wyzwalaczu windykacji jest odrzucany (would_break z kodem walidatora)", () => {
    const graph = structuredClone(JOURNEY_TEMPLATES.payment_failed_crm.graph);
    const trigger = JOURNEY_TEMPLATES.payment_failed_crm.settings.triggerEventType;
    expect(
      insertAfter(graph, "trigger", "next", "send_email", undefined, { triggerEventType: trigger }),
    ).toEqual({
      ok: false,
      error: "would_break",
      codes: ["email_on_payment_failed"],
    });
    expect(
      insertAfter(graph, "trigger", "next", "wait", undefined, { triggerEventType: trigger }).ok,
    ).toBe(true);
  });
});

describe("removeNode", () => {
  it("reconnect: wejścia przechodzą na dalszy ciąg", () => {
    const next = ok(removeNode(welcome(), "wait_3d", "reconnect"));
    expectValid(next);
    expect(next.edges).toContainEqual(edge("welcome", "paid_check"));
    expect(next.nodes.some((n) => n.id === "wait_3d")).toBe(false);
  });

  it("reconnect rozgałęzienia zostawia pierwszą gałąź, resztę przycina", () => {
    const next = ok(removeNode(welcome(), "paid_check", "reconnect"));
    expectValid(next);
    expect(next.edges).toContainEqual(edge("wait_3d", "member"));
    for (const id of ["value", "wait_4d", "invite", "done"]) {
      expect(next.nodes.some((n) => n.id === id)).toBe(false);
    }
  });

  it("subtree: krok i dalsze kroki znikają, wejście kończy się nowym „Koniec”", () => {
    const next = ok(removeNode(welcome(), "value", "subtree"));
    expectValid(next);
    expect(next.nodes.map((n) => n.id)).not.toContain("invite");
    const end = next.edges.find((e) => e.from === "paid_check" && e.branch === "no");
    expect(next.nodes.find((n) => n.id === end?.to)?.type).toBe("exit");
  });

  it("mail, o który pyta warunek „otworzył”, nie da się usunąć (would_break)", () => {
    expect(removeNode(newsletter(), "hello", "reconnect")).toEqual({
      ok: false,
      error: "would_break",
      codes: ["predicate_not_ancestor_email"],
    });
  });

  it("wyzwalacz i krok końcowy są chronione", () => {
    expect(removeNode(welcome(), "trigger", "reconnect")).toMatchObject({
      error: "trigger_protected",
    });
    expect(removeNode(welcome(), "done", "subtree")).toMatchObject({ error: "terminal_protected" });
    expect(removeNode(welcome(), "ghost", "subtree")).toMatchObject({ error: "node_missing" });
  });
});

describe("moveWithinSegment", () => {
  it("zamienia krok z poprzednikiem i następnikiem w odcinku liniowym", () => {
    const up = ok(moveWithinSegment(welcome(), "wait_3d", "up"));
    expectValid(up);
    expect(buildJourneyView(up).order.slice(0, 4)).toEqual([
      "trigger",
      "wait_3d",
      "welcome",
      "paid_check",
    ]);
    const down = ok(moveWithinSegment(welcome(), "value", "down"));
    expectValid(down);
    expect(down.edges).toContainEqual(edge("paid_check", "wait_4d", "no"));
    expect(down.edges).toContainEqual(edge("value", "invite"));
  });

  it("nie przesuwa ponad wyzwalacz, rozgałęzienia ani kroku końcowego", () => {
    expect(moveWithinSegment(welcome(), "welcome", "up")).toMatchObject({ error: "not_movable" });
    expect(moveWithinSegment(welcome(), "paid_check", "up")).toMatchObject({
      error: "not_movable",
    });
    expect(moveWithinSegment(welcome(), "invite", "down")).toMatchObject({ error: "not_movable" });
    expect(moveWithinSegment(welcome(), "wait_3d", "down")).toMatchObject({ error: "not_movable" });
  });
});

describe("mergeInto", () => {
  it("koniec gałęzi dołącza do późniejszego kroku; krok docelowy nie zmienia rodzica", () => {
    const graph = welcome();
    const before = buildJourneyView(graph);
    const next = ok(mergeInto(graph, { from: "paid_check", branch: "yes" }, "invite"));
    expectValid(next);
    expect(next.nodes.some((n) => n.id === "member")).toBe(false);
    expect(next.edges[next.edges.length - 1]).toEqual(edge("paid_check", "invite", "yes"));
    const view = buildJourneyView(next);
    expect(view.nodes.get("invite")?.parentId).toBe("wait_4d");
    expect(view.merges).toEqual([
      {
        from: "paid_check",
        to: "invite",
        branch: "yes",
        targetNumber: view.numbering.get("invite"),
      },
    ]);
    expect(view.numbering.get("value")).toBe(before.numbering.get("value"));
  });

  it("tylko do kroku późniejszego i nie-przodka; nie do wyzwalacza ani bieżącego końca", () => {
    const graph = welcome();
    const targets = mergeTargets(graph, { from: "paid_check", branch: "yes" });
    expect(targets).not.toContain("trigger");
    expect(targets).not.toContain("welcome");
    expect(targets).not.toContain("paid_check");
    expect(targets).not.toContain("member");
    expect(targets).toContain("invite");
    expect(mergeInto(graph, { from: "paid_check", branch: "yes" }, "welcome")).toMatchObject({
      error: "target_invalid",
    });
    expect(mergeInto(graph, { from: "paid_check", branch: "no" }, "invite")).toMatchObject({
      error: "slot_occupied",
    });
  });
});

describe("duplicateSubtree", () => {
  it("bez celu: kopia jednego kroku tuż za oryginałem", () => {
    const result = duplicateSubtree(welcome(), "wait_3d");
    const next = ok(result);
    expectValid(next);
    const copy = (result as { created: string[] }).created[0];
    expect(next.edges).toContainEqual(edge("wait_3d", copy));
    expect(next.nodes.find((n) => n.id === copy)?.params).toEqual({
      mode: "duration",
      minutes: 3 * 24 * 60,
    });
  });

  it("z celem: całe poddrzewo w pusty koniec gałęzi, warunki wskazują kopie maili", () => {
    const graph = splitWithPredicate();
    expectValid(graph);
    expect([...ownedSubtree(graph, "ma")].sort()).toEqual(["ga", "if", "ma", "xa"]);
    expect(duplicateTargets(graph, "ma")).toEqual([{ from: "ab", branch: "B" }]);
    const result = duplicateSubtree(graph, "ma", { from: "ab", branch: "B" });
    const next = ok(result);
    expectValid(next);
    const created = (result as { created: string[] }).created;
    expect(created).toHaveLength(4);
    const copyIf = next.nodes.find((n) => n.type === "if_else" && n.id !== "if");
    const copyMail = next.nodes.find((n) => n.type === "send_email" && n.id !== "ma");
    expect((copyIf?.params as { predicates: { nodeId: string }[] }).predicates[0].nodeId).toBe(
      copyMail?.id,
    );
    expect(next.nodes.some((n) => n.id === "xb")).toBe(false);
  });

  it("odmowy: wyzwalacz, krok końcowy, cel wewnątrz poddrzewa, rozgałęzienie bez celu", () => {
    const graph = splitWithPredicate();
    expect(duplicateSubtree(graph, "t")).toMatchObject({ error: "trigger_protected" });
    expect(duplicateSubtree(graph, "xa")).toMatchObject({ error: "terminal_protected" });
    expect(duplicateSubtree(graph, "ma", { from: "if", branch: "no" })).toMatchObject({
      error: "target_invalid",
    });
    expect(duplicateSubtree(graph, "if")).toMatchObject({ error: "target_invalid" });
  });
});

describe("replaceTerminal i resolveSplit", () => {
  it("cel <-> koniec pod nowym identyfikatorem (statystyki nie przechodzą)", () => {
    const result = replaceTerminal(welcome(), "done", "goal");
    const next = ok(result);
    expectValid(next);
    const id = (result as { created: string[] }).created[0];
    expect(id).toBe("goal_1");
    expect(next.edges).toContainEqual(edge("invite", id));
    expect(replaceTerminal(welcome(), "done", "exit")).toMatchObject({ error: "target_invalid" });
    expect(replaceTerminal(welcome(), "welcome", "exit")).toMatchObject({ error: "not_terminal" });
  });

  it("„Zostaw B”: wagi 0/100, struktura i identyfikatory bez zmian", () => {
    const graph = splitWithPredicate();
    const next = ok(resolveSplit(graph, "ab", "B"));
    expectValid(next);
    expect(next.nodes.find((n) => n.id === "ab")?.params).toEqual({
      weights: { A: 0, B: 100 },
      winnerMetric: "click",
    });
    expect(next.edges).toEqual(graph.edges);
    expect(next.nodes.map((n) => n.id)).toEqual(graph.nodes.map((n) => n.id));
    expect(resolveSplit(graph, "ma", "A")).toMatchObject({ error: "not_split" });
  });
});

describe("availableOps - jedno źródło menu (kanwa = lista = klawiatura)", () => {
  const CASES: readonly (readonly [string, JourneyGraph, string | undefined])[] = [
    ...Object.values(JOURNEY_TEMPLATES).map(
      (template) => [template.key, template.graph, template.settings.triggerEventType] as const,
    ),
    ["split", splitWithPredicate(), "account.registered.v1"],
  ];

  it.each(CASES)(
    "%s: każda pozycja każdego kroku wykonuje się i daje graf poprawny",
    (_key, graph, trigger) => {
      const context = { triggerEventType: trigger };
      for (const current of graph.nodes) {
        const ops = availableOps(graph, current.id, context);
        expect(ops.filter((entry) => entry.shortcut === "Insert").length).toBeLessThanOrEqual(1);
        expect(ops.filter((entry) => entry.shortcut === "Delete").length).toBeLessThanOrEqual(1);
        for (const descriptor of ops) {
          const incoming = graph.edges.find((e) => e.to === current.id);
          const input = {
            type: "wait" as const,
            targetId: incoming
              ? mergeTargets(graph, { from: incoming.from, branch: incoming.branch })[0]
              : undefined,
            slot:
              descriptor.needs === "slot"
                ? duplicateTargets(graph, current.id, context, 1)[0]
                : undefined,
          };
          const result = applyOp(graph, current.id, descriptor, input, context);
          expect(result.ok, `${current.id}: ${descriptor.label} -> ${JSON.stringify(result)}`).toBe(
            true,
          );
          if (result.ok) expectValid(result.graph, trigger);
        }
      }
    },
  );

  it("menu kroku liniowego, rozgałęzienia, testu A/B, końca i wyzwalacza", () => {
    const graph = splitWithPredicate();
    expect(availableOps(graph, "t").map((o) => o.label)).toEqual(["insert"]);
    expect(availableOps(graph, "ab").map((o) => `${o.label}:${o.branch ?? o.value ?? ""}`)).toEqual(
      [
        "insertBranch:A",
        "insertBranch:B",
        "keepA:A",
        "keepB:B",
        "removeKeepFirst:",
        "removeSubtree:",
      ],
    );
    const xb = availableOps(graph, "xb").map((o) => o.label);
    expect(xb).toEqual(["replaceWithGoal", "mergeInto"]);
    // „ma” jest celem warunku - nie da się go usunąć, więc menu go nie oferuje.
    expect(availableOps(graph, "ma").map((o) => o.label)).not.toContain("remove");
    const linear = availableOps(welcome(), "wait_3d");
    expect(opForShortcut(linear, "Insert")?.kind).toBe("insert");
    expect(opForShortcut(linear, "Delete")?.kind).toBe("remove");
    expect(opForShortcut(availableOps(welcome(), "paid_check"), "Delete")?.kind).toBe(
      "removeSubtree",
    );
    expect(availableOps(welcome(), "ghost")).toEqual([]);
  });

  it("każda etykieta menu ma tłumaczenie PL i EN", () => {
    const { pl, en } = journeysListDictionaries;
    for (const key of Object.values(JOURNEY_OP_LABEL_KEY)) {
      const leaf = key.replace(
        "adminJourneys.common.ops.",
        "",
      ) as keyof typeof pl.adminJourneys.common.ops;
      expect(pl.adminJourneys.common.ops[leaf], key).toBeTruthy();
      expect(en.adminJourneys.common.ops[leaf], key).toBeTruthy();
    }
  });

  it("applyOp bez wymaganych danych odmawia zamiast zgadywać", () => {
    const graph = welcome();
    const insert = availableOps(graph, "welcome").find((o) => o.kind === "insert");
    expect(insert && applyOp(graph, "welcome", insert, {})).toMatchObject({
      error: "target_invalid",
    });
    const merge = availableOps(graph, "done").find((o) => o.kind === "mergeInto");
    expect(merge && applyOp(graph, "done", merge, {})).toMatchObject({ error: "target_invalid" });
  });
});
