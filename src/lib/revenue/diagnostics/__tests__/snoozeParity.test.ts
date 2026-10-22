// Parytet wyciszeń SQL ↔ TS (S7, SPEC §5.7: „snoozable=false dla critical
// w sync/data_quality").
//
// Tę samą decyzję podejmują dwie strony: rejestr TS (karta nie pokazuje
// „Wycisz", licznik paska ignoruje wyciszenie) i RPC
// `admin_revenue_diagnostic_snooze` (odmowa `not_snoozable`). Rozjazd w jedną
// stronę = przycisk, który zawsze kończy się błędem; w drugą = reguła
// krytyczna wyciszona obejściem panelu. Test czyta MIGRACJĘ (blok
// `unsnoozable:begin … end`) i walidację w jej ciele, więc dopisanie
// krytycznej reguły tylko po jednej stronie zapala CI.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { REVENUE_LIMITS, SNOOZE_KINDS } from "@/lib/revenue/limits";
import { SNOOZE_INVALID_CODES } from "../diagnostics.functions";
import { REVENUE_CHECKS, UNSNOOZABLE_CHECK_IDS } from "../registry";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20261020150100_revenue_diagnostic_snoozes.sql"),
  "utf8",
);

function unsnoozableFromSql(): string[] {
  const block = /-- unsnoozable:begin\n([\s\S]*?)-- unsnoozable:end/.exec(MIGRATION);
  if (!block) throw new Error("brak bloku unsnoozable:begin/end w 20261020150100");
  return [...block[1]!.matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map(([, id]) => id!);
}

describe("lista niewyciszalnych: SQL = lustro TS", () => {
  it("blok `unsnoozable` w migracji = UNSNOOZABLE_CHECK_IDS (bez kolejności)", () => {
    expect(unsnoozableFromSql().sort()).toEqual([...UNSNOOZABLE_CHECK_IDS].sort());
  });

  it("lista TS = reguły krytyczne obszarów sync i data_quality, każda `snoozable: false`", () => {
    const critical = REVENUE_CHECKS.filter(
      (c) => c.severity === "critical" && (c.area === "sync" || c.area === "data_quality"),
    ).map((c) => c.id);
    expect([...UNSNOOZABLE_CHECK_IDS].sort()).toEqual(critical.sort());
    for (const check of REVENUE_CHECKS) {
      expect(check.snoozable, check.id).toBe(!critical.includes(check.id));
    }
  });

  it("SQL sprawdza listę przed zapisem i odmawia kodem `not_snoozable`", () => {
    expect(MIGRATION).toMatch(
      /IF p_check_id = ANY \(v_unsnoozable\) THEN\s+RAISE EXCEPTION 'not_snoozable' USING ERRCODE = '22023'/,
    );
  });
});

describe("walidacja RPC = REVENUE_LIMITS (odrzucenie, nigdy przycięcie)", () => {
  it("wzorzec identyfikatora reguły", () => {
    expect(MIGRATION).toContain(`p_check_id !~ '${REVENUE_LIMITS.checkIdPattern.source}'`);
  });

  it("zakres, odcisk, powód i termin - te same granice co formularz", () => {
    expect(MIGRATION).toContain(`char_length(v_scope) > ${REVENUE_LIMITS.scopeKeyMax}`);
    expect(MIGRATION).toContain(`char_length(p_scope_hash) > ${REVENUE_LIMITS.scopeHashMax}`);
    expect(MIGRATION).toContain(
      `char_length(btrim(p_reason)) NOT BETWEEN ${REVENUE_LIMITS.snoozeReasonMin} AND ${REVENUE_LIMITS.snoozeReasonMax}`,
    );
    expect(MIGRATION).toContain(`now() + interval '${REVENUE_LIMITS.snoozeMaxDays} days'`);
  });

  it("rodzaje wyciszenia = SNOOZE_KINDS", () => {
    const kinds = /p_kind NOT IN \(([^)]*)\)/.exec(MIGRATION)?.[1] ?? "";
    expect([...kinds.matchAll(/'([a-z]+)'/g)].map(([, k]) => k)).toEqual([...SNOOZE_KINDS]);
  });

  it("każdy kod 22023 z SQL jest znany TS (stan `invalid`, nie wyjątek)", () => {
    const raised = [
      ...MIGRATION.matchAll(/RAISE EXCEPTION '([a-z_]+)' USING ERRCODE = '22023'/g),
    ].map(([, code]) => code!);
    expect(raised.length).toBeGreaterThan(0);
    for (const code of new Set(raised)) {
      expect(SNOOZE_INVALID_CODES as readonly string[], code).toContain(code);
    }
  });

  it("zakaz przycinania: ciało RPC nie skraca wartości (`left(` / `substr(`)", () => {
    const code = MIGRATION.replace(/--.*$/gm, "");
    expect(code).not.toMatch(/\bleft\(|\bsubstr(ing)?\(/i);
  });
});
