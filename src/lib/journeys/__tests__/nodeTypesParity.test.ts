// PARYTET TS <-> SQL silnika ścieżek (S5).
//
// Edytor (S8) i walidacja TS znają węzły, warunki i limity; silnik SQL je
// WYKONUJE. Typ znany tylko jednej stronie nie daje błędu kompilacji - daje
// kontakt zatrzymany na zawsze (węzeł, którego `journey_advance` nie umie
// wykonać) albo graf, który TS przepuszcza, a publikacja odrzuca. Test czyta
// migracje S5 jako tekst (jak `journeyLimitsParity.test.ts`) i porównuje.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BILLING_OWNED_LIFECYCLE_STAGES, LIFECYCLE_STAGES } from "@/lib/crm/lifecycle";
import { deterministicMessageId } from "@/lib/email/messageId";
import { JOURNEY_SENDER_LIMITS } from "../dto";
import { JOURNEY_TAG_MAX } from "../graph";
import { JOURNEY_LIMITS } from "../limits";
import {
  JOURNEY_ACTION_NODE_TYPES,
  JOURNEY_NODE_FAMILY,
  JOURNEY_NODE_TYPES,
  isTerminalNodeType,
  requiredBranches,
} from "../nodeTypes";
import { JOURNEY_PREDICATE_KINDS } from "../predicates";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const read = (name: string) => readFileSync(join(MIGRATIONS, name), "utf8");
const ENGINE = read("20261020140100_journeys_engine.sql");
const PREDICATES = read("20261020140200_journeys_predicates_consent.sql");

/**
 * Plik z NAJNOWSZĄ definicją funkcji - baza po migracjach forward-only ma
 * ciało ostatniej (walidator grafu redefiniuje I9b: limit tagu, Z-S5-02).
 */
function latest(name: string): string {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .filter((f) => read(f).includes(`CREATE OR REPLACE FUNCTION public.${name}(`));
  expect(files.length, `brak definicji ${name}`).toBeGreaterThan(0);
  return read(files[files.length - 1]);
}
const VALIDATOR = latest("journey_validate_graph");

/** Ciało funkcji SQL od `CREATE OR REPLACE FUNCTION public.<name>(` do `$$;`. */
function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `brak funkcji ${name}`).toBeGreaterThanOrEqual(0);
  const open = sql.indexOf("$$", start);
  const close = sql.indexOf("$$;", open + 2);
  return sql.slice(open, close);
}

/** Etykiety `WHEN 'a', 'b' THEN` z ciała CASE. */
function whenLabels(body: string): Set<string> {
  const out = new Set<string>();
  for (const match of body.matchAll(/WHEN\s+((?:'[a-z_]+'(?:\s*,\s*)?)+)\s+THEN/g)) {
    for (const label of match[1].matchAll(/'([a-z_]+)'/g)) out.add(label[1]);
  }
  return out;
}

describe("typy węzłów", () => {
  it("lista walidatora SQL (`v_types`) = JOURNEY_NODE_TYPES", () => {
    const body = functionBody(VALIDATOR, "journey_validate_graph");
    const block = /v_types constant text\[\] := ARRAY\[([\s\S]*?)\];/.exec(body);
    expect(block).not.toBeNull();
    const sqlTypes = [...(block?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(sqlTypes).toEqual([...JOURNEY_NODE_TYPES]);
  });

  it("każdy węzeł ma gałąź wykonania w `journey_advance` albo `_journey_exec_action`", () => {
    const advance = whenLabels(functionBody(ENGINE, "journey_advance"));
    const actions = whenLabels(functionBody(ENGINE, "_journey_exec_action"));
    for (const type of JOURNEY_NODE_TYPES) {
      const family = JOURNEY_NODE_FAMILY[type];
      if (family === "action") {
        expect(actions.has(type), `akcja ${type} bez gałęzi _journey_exec_action`).toBe(true);
      } else {
        expect(advance.has(type), `węzeł ${type} bez gałęzi journey_advance`).toBe(true);
      }
    }
    // Akcje SQL = akcje TS (nowa akcja po jednej stronie to martwy węzeł).
    expect([...actions].sort()).toEqual([...JOURNEY_ACTION_NODE_TYPES].sort());
  });

  it("gałęzie wymagane = reguła SQL (`v_required`)", () => {
    expect(requiredBranches("goal")).toEqual([]);
    expect(requiredBranches("exit")).toEqual([]);
    expect(requiredBranches("ab_split")).toEqual(["A", "B"]);
    expect(requiredBranches("if_else")).toEqual(["yes", "no"]);
    expect(requiredBranches("wait", { mode: "until_event" })).toEqual(["event", "timeout"]);
    expect(requiredBranches("wait", { mode: "duration" })).toEqual(["next"]);
    expect(requiredBranches("wait", null)).toEqual(["next"]);
    expect(requiredBranches("send_email")).toEqual(["next"]);
    const body = functionBody(VALIDATOR, "journey_validate_graph");
    expect(body).toContain("WHEN v_type IN ('goal', 'exit') THEN ARRAY[]::text[]");
    expect(body).toContain("WHEN v_type = 'ab_split' THEN ARRAY['A', 'B']");
    expect(body).toContain("WHEN v_type = 'if_else' THEN ARRAY['yes', 'no']");
    expect(body).toContain("ARRAY['event', 'timeout']");
  });

  it("węzły końcowe to wyłącznie cel i wyjście", () => {
    expect(JOURNEY_NODE_TYPES.filter(isTerminalNodeType)).toEqual(["goal", "exit"]);
  });
});

describe("warunki (`if_else`, filtr wejścia)", () => {
  it("każdy rodzaj warunku ma gałąź interpretera `_journey_eval_predicate`", () => {
    const labels = whenLabels(functionBody(PREDICATES, "_journey_eval_predicate"));
    for (const kind of JOURNEY_PREDICATE_KINDS) {
      expect(labels.has(kind), `warunek ${kind} nieznany interpreterowi SQL`).toBe(true);
    }
  });
});

describe("limity wspólne z SQL", () => {
  it("węzłów ≤ 60, tag ≤ CRM_TAG_MAX (pisarz CRM), etapy cyklu bez etapów płatności", () => {
    const body = functionBody(VALIDATOR, "journey_validate_graph");
    expect(body).toContain(`v_count > ${JOURNEY_LIMITS.nodesMax}`);
    expect(body).toContain(`NOT BETWEEN 1 AND ${JOURNEY_TAG_MAX}`);
    const stages =
      /'set_lifecycle_stage' THEN\s+IF NOT \(COALESCE\(v_params ->> 'stage', ''\) = ANY \(ARRAY\[([\s\S]*?)\]\)\)/.exec(
        body,
      );
    expect(stages).not.toBeNull();
    const sqlStages = [...(stages?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    const billing: readonly string[] = BILLING_OWNED_LIFECYCLE_STAGES;
    expect(sqlStages).toEqual(LIFECYCLE_STAGES.filter((s) => !billing.includes(s)));
  });

  it("nadawca: nazwa ≤ 120 bez znaków nagłówka, odpowiedź ≤ 254 (CHECK)", () => {
    expect(PREDICATES).toContain(
      `char_length(btrim(sender_name)) BETWEEN 1 AND ${JOURNEY_SENDER_LIMITS.senderNameMax}`,
    );
    expect(PREDICATES).toContain(`char_length(reply_to) <= ${JOURNEY_SENDER_LIMITS.replyToMax}`);
  });
});

describe("tożsamość wiadomości", () => {
  it("`_journey_message_id` (SQL) = deterministicMessageId('journey:{zapis}:{węzeł}')", async () => {
    // Ta sama stała jest asercją pgTAP `journeys_tracking_stats_test.sql` -
    // obie strony liczą identyczny UUID, więc kolejka, dziennik wysyłek
    // i wiadomość ścieżki mają jedną tożsamość.
    await expect(
      deterministicMessageId("journey:00000000-0000-4000-8000-000000000001:mail_1"),
    ).resolves.toBe("adcf4729-2d9b-4ef2-bf9a-bdd0cbfe79f9");
    const tracking = read("20261020140500_journeys_tracking_stats.sql");
    expect(tracking).toContain("'journey:' || p_enrollment::text || ':' || p_node");
  });
});
