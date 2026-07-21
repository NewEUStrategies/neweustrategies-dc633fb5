// Czyste helpery warstwy danych modułu „Automatyzacje": parsowanie i
// serializacja kroków, wartości warunku (containment), walidacja draftu,
// agregacja statystyk przebiegów oraz parytet katalogu akcji z i18n.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {},
}));

import {
  WORKFLOW_ACTIONS,
  WORKFLOW_ACTION_PARAMS,
  aggregateRunStats,
  conditionToPairs,
  draftFromDefinition,
  emptyWorkflowDraft,
  isValidEventType,
  isWorkflowAction,
  pairsToCondition,
  parseConditionValue,
  parseWorkflowSteps,
  serializeWorkflowSteps,
  validateWorkflowDraft,
  type WorkflowDefinitionRow,
  type WorkflowStep,
} from "@/lib/admin/workflows";
import { workflowsPl, workflowsEn } from "@/lib/i18n-admin-workflows";

describe("parseWorkflowSteps", () => {
  it("parsuje kroki flagowych szablonów z migracji", () => {
    const steps = parseWorkflowSteps([
      { action: "create_crm_lead", params: { newsletter: true } },
      {
        action: "notify_followers",
        params: { kind: "content", href: "{post_href}", icon: "newspaper" },
      },
    ]);
    expect(steps).toEqual([
      { action: "create_crm_lead", params: { newsletter: true } },
      {
        action: "notify_followers",
        params: { kind: "content", href: "{post_href}", icon: "newspaper" },
      },
    ]);
  });

  it("odrzuca nieznane akcje i zdeformowane wpisy (kontrakt silnika)", () => {
    expect(
      parseWorkflowSteps([
        { action: "emit_event", params: {} },
        "tekst",
        42,
        null,
        { params: {} },
        { action: "notify_staff", params: { roles: ["admin"], nested: { x: 1 }, n: 7 } },
      ]),
    ).toEqual([{ action: "notify_staff", params: { roles: ["admin"] } }]);
  });

  it("zwraca [] dla nie-tablicy", () => {
    expect(parseWorkflowSteps({})).toEqual([]);
    expect(parseWorkflowSteps(null)).toEqual([]);
    expect(parseWorkflowSteps("x")).toEqual([]);
  });
});

describe("serializeWorkflowSteps", () => {
  it("przycina stringi i wyrzuca puste wartości", () => {
    const steps: WorkflowStep[] = [
      {
        action: "notify_user",
        params: { user_from: "  user_id  ", title_pl: "", icon: "bell" },
      },
    ];
    expect(serializeWorkflowSteps(steps)).toEqual([
      { action: "notify_user", params: { user_from: "user_id", icon: "bell" } },
    ]);
  });

  it("dzieli surowy CSV parametru roles na tablicę (edytor trzyma tekst)", () => {
    const steps: WorkflowStep[] = [
      { action: "notify_staff", params: { roles: " admin,  editor ,, " } },
    ];
    expect(serializeWorkflowSteps(steps)).toEqual([
      { action: "notify_staff", params: { roles: ["admin", "editor"] } },
    ]);
  });

  it("zachowuje roles podane jako tablica i wyrzuca pustą tablicę", () => {
    expect(
      serializeWorkflowSteps([
        { action: "notify_staff", params: { roles: ["admin"] } },
        { action: "notify_staff", params: { roles: [] } },
      ]),
    ).toEqual([
      { action: "notify_staff", params: { roles: ["admin"] } },
      { action: "notify_staff", params: {} },
    ]);
  });

  it("boolean: true zostaje, false wypada (default silnika)", () => {
    expect(
      serializeWorkflowSteps([
        { action: "create_crm_lead", params: { newsletter: true, marketing: false } },
      ]),
    ).toEqual([{ action: "create_crm_lead", params: { newsletter: true } }]);
  });

  it("round-trip: parse(serialize(x)) jest stabilne", () => {
    const steps: WorkflowStep[] = [
      { action: "add_cross_reference", params: { target_id_from: "post_id", relation: "related" } },
    ];
    expect(parseWorkflowSteps(serializeWorkflowSteps(steps))).toEqual(steps);
  });
});

describe("parseConditionValue / conditionToPairs", () => {
  it("typuje literały JSON, resztę zostawia tekstem", () => {
    expect(parseConditionValue("won")).toBe("won");
    expect(parseConditionValue("true")).toBe(true);
    expect(parseConditionValue("false")).toBe(false);
    expect(parseConditionValue("null")).toBe(null);
    expect(parseConditionValue("42")).toBe(42);
    expect(parseConditionValue("-3.5")).toBe(-3.5);
    expect(parseConditionValue('"quoted"')).toBe("quoted");
    expect(parseConditionValue('{"a":1}')).toEqual({ a: 1 });
    expect(parseConditionValue("{zepsuty json")).toBe("{zepsuty json");
  });

  it("round-trip par warunku zachowuje typy (kontrakt @> containment)", () => {
    const condition = { new_stage: "won", status: "pending", flag: true, depth: 2 };
    const pairs = conditionToPairs(condition);
    expect(pairsToCondition(pairs)).toEqual(condition);
  });

  it("pomija pary z pustym kluczem", () => {
    expect(pairsToCondition([{ key: "  ", value: "x" }])).toEqual({});
  });

  it("conditionToPairs: nie-obiekty dają []", () => {
    expect(conditionToPairs([])).toEqual([]);
    expect(conditionToPairs(null)).toEqual([]);
  });
});

describe("validateWorkflowDraft", () => {
  it("pusty draft zgłasza name, trigger i steps", () => {
    expect(validateWorkflowDraft(emptyWorkflowDraft())).toEqual(["name", "trigger", "steps"]);
  });

  it("poprawny draft przechodzi", () => {
    const draft = {
      ...emptyWorkflowDraft(),
      name: "Lead won -> staff",
      triggerEventType: "crm_lead.stage_changed.v1",
      steps: [{ action: "notify_staff", params: {} } satisfies WorkflowStep],
    };
    expect(validateWorkflowDraft(draft)).toEqual([]);
  });

  it("wartość warunku bez klucza zgłasza conditionKey", () => {
    const draft = {
      ...emptyWorkflowDraft(),
      name: "x",
      triggerEventType: "post.published.v1",
      steps: [{ action: "notify_staff", params: {} } satisfies WorkflowStep],
      conditionPairs: [{ key: "", value: "won" }],
    };
    expect(validateWorkflowDraft(draft)).toEqual(["conditionKey"]);
  });
});

describe("isValidEventType / isWorkflowAction", () => {
  it("akceptuje format agregat.czasownik.vN (CHECK z domain_events)", () => {
    expect(isValidEventType("post.published.v1")).toBe(true);
    expect(isValidEventType("newsletter_subscriber.confirmed.v12")).toBe(true);
    expect(isValidEventType("Post.published.v1")).toBe(false);
    expect(isValidEventType("post.published")).toBe(false);
    expect(isValidEventType("")).toBe(false);
  });

  it("isWorkflowAction rozpoznaje wyłącznie katalog silnika", () => {
    for (const action of WORKFLOW_ACTIONS) expect(isWorkflowAction(action)).toBe(true);
    expect(isWorkflowAction("emit_event")).toBe(false);
  });
});

describe("aggregateRunStats", () => {
  it("liczy total/failed i najświeższy przebieg per definicja", () => {
    const stats = aggregateRunStats([
      { workflow_id: "a", status: "succeeded", created_at: "2026-07-20T10:00:00Z" },
      { workflow_id: "a", status: "failed", created_at: "2026-07-20T12:00:00Z" },
      { workflow_id: "b", status: "succeeded", created_at: "2026-07-19T09:00:00Z" },
    ]);
    expect(stats.get("a")).toEqual({
      total: 2,
      failed: 1,
      lastRunAt: "2026-07-20T12:00:00Z",
      lastStatus: "failed",
    });
    expect(stats.get("b")).toEqual({
      total: 1,
      failed: 0,
      lastRunAt: "2026-07-19T09:00:00Z",
      lastStatus: "succeeded",
    });
  });
});

describe("draftFromDefinition", () => {
  it("mapuje wiersz DB na edytowalny draft", () => {
    const row: WorkflowDefinitionRow = {
      id: "def-1",
      tenant_id: "t-1",
      name: "Comment pending",
      template_key: "comment-pending-notify-staff",
      enabled: true,
      trigger_event_type: "comment.created.v1",
      condition: { status: "pending" },
      steps: [{ action: "notify_staff", params: { kind: "comment" } }],
      created_by: null,
      created_at: "2026-07-11T20:40:00Z",
      updated_at: "2026-07-11T20:40:00Z",
    };
    expect(draftFromDefinition(row)).toEqual({
      id: "def-1",
      name: "Comment pending",
      enabled: true,
      triggerEventType: "comment.created.v1",
      conditionPairs: [{ key: "status", value: "pending" }],
      steps: [{ action: "notify_staff", params: { kind: "comment" } }],
    });
  });
});

describe("parytet katalogu akcji z i18n (PL i EN)", () => {
  const dictionaries = [
    ["pl", workflowsPl.adminWorkflows] as const,
    ["en", workflowsEn.adminWorkflows] as const,
  ];

  it("każda akcja ma nazwę i opis w obu językach", () => {
    for (const [lang, dict] of dictionaries) {
      for (const action of WORKFLOW_ACTIONS) {
        const entry = dict.actions[action];
        expect(entry, `${lang}: brak wpisu actions.${action}`).toBeDefined();
        expect(entry.name.length).toBeGreaterThan(0);
        expect(entry.description.length).toBeGreaterThan(0);
      }
    }
  });

  it("każdy parametr formularza ma etykietę w obu językach", () => {
    const paramKeys = new Set(
      Object.values(WORKFLOW_ACTION_PARAMS).flatMap((specs) => specs.map((s) => s.key)),
    );
    for (const [lang, dict] of dictionaries) {
      const labels = dict.params as Record<string, string>;
      for (const key of paramKeys) {
        expect(labels[key], `${lang}: brak etykiety params.${key}`).toBeTruthy();
      }
    }
  });
});
