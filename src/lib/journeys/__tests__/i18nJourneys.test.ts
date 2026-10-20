// Etykiety silnika ścieżek (S5) dla UI S8: KAŻDY kod unii - z TS i z SQL -
// ma napis PL i EN. Brak klucza na kanwie to surowe `adminJourneys.x.y`
// zamiast etykiety, a kod błędu publikacji bez napisu to komunikat, którego
// admin nie zrozumie. Bramka parytetu (`i18nParity.gate.test.ts`) pilnuje
// PL = EN; ten test - pokrycia list kodu.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { journeysDictionaries } from "@/lib/i18n-admin-journeys";
import { JOURNEY_SERIES_MAX_DAYS } from "../stats.functions";
import type { GraphIssueCode } from "../graph";
import type { JourneyMutationErrorCode } from "../journeys.functions";
import {
  JOURNEY_ENGINE_PHASES,
  JOURNEY_ENROLLMENT_STATUSES,
  JOURNEY_EXIT_REASONS,
  JOURNEY_STEP_OUTCOMES,
} from "../limits";
import { JOURNEY_EDGE_BRANCHES, JOURNEY_NODE_FAMILY, JOURNEY_NODE_TYPES } from "../nodeTypes";
import { JOURNEY_PREDICATE_KINDS } from "../predicates";
import { JOURNEY_TEMPLATE_KEYS } from "../templates";
import {
  journeyLabelKey,
  journeyTemplateLabelKeys,
  journeyTriggerI18nKey,
  journeyTriggerLabelKey,
  type JourneyLabelCodes,
  type JourneyLabelSection,
} from "../labels";
import { JOURNEY_TRIGGERS } from "../triggers";
import { JOURNEY_VARIABLE_KEYS } from "../variables";

type Tree = { [key: string]: string | Tree };
const { pl, en } = journeysDictionaries as unknown as { pl: Tree; en: Tree };
const section = (lang: Tree, name: string) => (lang.adminJourneys as Tree)[name] as Tree;

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const sql = (name: string) => readFileSync(join(MIGRATIONS, name), "utf8");

const TS_GRAPH_CODES: readonly GraphIssueCode[] = [
  "nodes_count",
  "node_id_duplicate",
  "trigger_count",
  "edge_dangling",
  "edge_into_trigger",
  "edge_duplicate_branch",
  "branches_incomplete",
  "params_invalid",
  "predicate_not_ancestor_email",
  "email_on_payment_failed",
  "graph_cycle",
  "node_unreachable",
  "workflow_overlap",
  "trigger_cycle",
  "entry_filter_history",
];
const MUTATION_CODES: readonly JourneyMutationErrorCode[] = [
  "forbidden",
  "conflict",
  "not_found",
  "duplicate",
  "limit_exceeded",
  "invalid",
  "unavailable",
  "template_unavailable",
];

function sqlGraphCodes(): string[] {
  const source = sql("20261020140200_journeys_predicates_consent.sql");
  const start = source.indexOf("CREATE OR REPLACE FUNCTION public.journey_validate_graph(");
  const body = source.slice(start, source.indexOf("$$;", source.indexOf("$$", start) + 2));
  return [...new Set([...body.matchAll(/'code', '([a-z_]+)'/g)].map((m) => m[1]))];
}

function leaves(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string" ? [`${prefix}${key}`] : leaves(value, `${prefix}${key}.`),
  );
}

describe("pokrycie kodów", () => {
  const cases: [string, readonly string[]][] = [
    ["nodeType", JOURNEY_NODE_TYPES],
    ["nodeFamily", [...new Set(Object.values(JOURNEY_NODE_FAMILY))]],
    ["branch", JOURNEY_EDGE_BRANCHES],
    ["enrollmentStatus", JOURNEY_ENROLLMENT_STATUSES],
    ["exitReason", JOURNEY_EXIT_REASONS],
    ["stepOutcome", JOURNEY_STEP_OUTCOMES],
    ["enginePhase", JOURNEY_ENGINE_PHASES],
    ["predicate", JOURNEY_PREDICATE_KINDS],
    ["triggerGroup", [...new Set(JOURNEY_TRIGGERS.map((t) => t.group))]],
    ["trigger", JOURNEY_TRIGGERS.map((t) => journeyTriggerI18nKey(t.eventType))],
    ["variable", JOURNEY_VARIABLE_KEYS],
    ["sendVerdict", ["ok", "no_consent", "unsubscribed", "suppressed", "capped", "quiet"]],
    ["graphIssue", [...TS_GRAPH_CODES, ...sqlGraphCodes()]],
    ["mutationError", MUTATION_CODES],
    [
      "simulationNote",
      [
        "duration",
        "until_time",
        "until_event",
        "simulated_bucket",
        "history_predicates_false",
        "would_run",
      ],
    ],
  ];

  it.each(cases)("%s: każdy kod ma napis PL i EN", (name, codes) => {
    for (const lang of [pl, en]) {
      const dict = section(lang, name);
      for (const code of codes) {
        expect(typeof dict[code], `${name}.${code}`).toBe("string");
        expect((dict[code] as string).trim().length, `${name}.${code}`).toBeGreaterThan(0);
      }
    }
  });

  it("walidator SQL zwraca kody spoza listy TS - też mają napisy", () => {
    expect(sqlGraphCodes()).toEqual(
      expect.arrayContaining(["graph_shape", "tag_length", "ab_weights"]),
    );
  });

  it("szablony: nazwa i opis w obu językach", () => {
    for (const lang of [pl, en]) {
      const templates = section(lang, "templates");
      for (const key of JOURNEY_TEMPLATE_KEYS) {
        const entry = templates[key] as Tree;
        expect(typeof entry?.name, key).toBe("string");
        expect(typeof entry?.description, key).toBe("string");
      }
    }
  });

  it("klucze z `labels.ts` istnieją w zarejestrowanym słowniku (PL i EN)", () => {
    const section = <S extends JourneyLabelSection>(
      name: S,
      codes: readonly JourneyLabelCodes[S][],
    ) => codes.map((code) => journeyLabelKey(name, code));
    const keys = [
      ...section("nodeType", JOURNEY_NODE_TYPES),
      ...section("exitReason", JOURNEY_EXIT_REASONS),
      ...section("predicate", JOURNEY_PREDICATE_KINDS),
      ...section("graphIssue", ["graph_cycle", "tag_length"]),
      ...section("simulationNote", ["would_run", "simulated_bucket"]),
      ...section("sendVerdict", ["capped", "quiet"]),
      ...JOURNEY_TRIGGERS.map((t) => journeyTriggerLabelKey(t.eventType)),
      ...JOURNEY_TEMPLATE_KEYS.flatMap((k) => Object.values(journeyTemplateLabelKeys(k))),
    ];
    for (const lng of ["pl", "en"]) {
      for (const key of keys) expect(i18n.exists(key, { lng }), `${lng}: ${key}`).toBe(true);
    }
  });

  it("klucz etykiety wyzwalacza: bez wersji, kropki na podkreślenia", () => {
    expect(journeyTriggerI18nKey("billing_subscription.payment_failed.v1")).toBe(
      "billing_subscription_payment_failed",
    );
    expect(journeyTriggerI18nKey("event.registration.cancelled.v12")).toBe(
      "event_registration_cancelled",
    );
  });
});

describe("parytet słowników", () => {
  it("PL i EN mają identyczne drzewo kluczy, bez pustych napisów", () => {
    expect(leaves(pl).sort()).toEqual(leaves(en).sort());
    const all = (tree: Tree): string[] =>
      Object.values(tree).flatMap((v) => (typeof v === "string" ? [v] : all(v)));
    for (const text of [...all(pl), ...all(en)]) expect(text.trim().length).toBeGreaterThan(0);
    expect(JOURNEY_SERIES_MAX_DAYS).toBeGreaterThan(0);
  });
});
