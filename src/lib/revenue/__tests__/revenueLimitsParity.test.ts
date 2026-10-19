// PARYTET LIMITÓW I SŁOWNIKÓW PRZYCHODU: `limits.ts` ⇄ CHECK-i migracji huba
// (SPEC §8.3, tabela PLAN_I0 §2.2).
//
// AGENTS: wartość za długa jest ODRZUCANA, nie przycinana - licznik w UI musi
// znać dokładnie limit bazy. Każdy fragment niżej jest zbudowany ze stałej TS
// i musi wystąpić w migracji DOSŁOWNIE (po wycięciu komentarzy i sprowadzeniu
// białych znaków do zapisu kanonicznego po obu stronach).
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { stripSqlComments } from "@/lib/ci/ownership";
import {
  DUNNING_OUTCOMES,
  EMIT_ERROR_LIMITS,
  MRR_MOVEMENT_KINDS,
  MRR_MOVEMENT_REASONS,
  PAYWALL_ENTITY_TYPES,
  PAYWALL_HIT_REASONS,
  RETENTION_OUTCOMES,
  REVENUE_EVENT_MARK_KINDS,
  REVENUE_INPUT_KINDS,
  REVENUE_LIMITS,
  SNOOZE_KINDS,
} from "../limits";

const KSIEGA = "supabase/migrations/20261020090000_hub_schema_revenue_ledger.sql";
const LEJEK = "supabase/migrations/20261020090100_hub_schema_funnel_ops.sql";
const HELPERY = "supabase/migrations/20261020090500_hub_shared_sql_helpers.sql";

/** Zapis kanoniczny: jedna spacja, bez spacji przy nawiasach i przecinkach. */
const kanon = (sql: string) =>
  sql
    .replace(/\s+/g, " ")
    .replace(/\s*([(),])\s*/g, "$1")
    .trim();

function migracja(plik: string): string {
  expect(existsSync(plik), `brak migracji toru A: ${plik}`).toBe(true);
  return kanon(stripSqlComments(readFileSync(plik, "utf8")));
}

const lista = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(",");
const L = REVENUE_LIMITS;

/** [opis, fragment SQL zbudowany ze stałej TS] */
type Fragmenty = readonly (readonly [string, string])[];

const KSIEGA_FRAGMENTY: Fragmenty = [
  ["mrr_movements.kind", `kind text NOT NULL CHECK (kind IN (${lista(MRR_MOVEMENT_KINDS)}))`],
  [
    "mrr_movements.reason",
    `reason text NOT NULL CHECK (reason IN (${lista(MRR_MOVEMENT_REASONS)}))`,
  ],
  [
    "dunning_cycles.outcome",
    `outcome text NOT NULL DEFAULT 'open' CHECK (outcome IN (${lista(DUNNING_OUTCOMES)}))`,
  ],
  [
    "revenue_event_marks.kind",
    `kind text NOT NULL CHECK (kind IN (${lista(REVENUE_EVENT_MARK_KINDS)}))`,
  ],
  ["revenue_event_marks.ref", `CHECK (char_length(ref) <= ${L.eventMarkRefMax})`],
];

const LEJEK_FRAGMENTY: Fragmenty = [
  [
    "paywall_hits.entity_type",
    `entity_type text NOT NULL CHECK (entity_type IN (${lista(PAYWALL_ENTITY_TYPES)}))`,
  ],
  ["paywall_hits.reason", `reason text NOT NULL CHECK (reason IN (${lista(PAYWALL_HIT_REASONS)}))`],
  ["paywall_hits.variant", `CHECK (variant ~ '${L.paywallVariantPattern.source}')`],
  [
    "paywall_hits.visitor_hash",
    `CHECK (char_length(visitor_hash) BETWEEN ${L.visitorHashMin} AND ${L.visitorHashMax})`,
  ],
  ["retention_feedback.outcome", `outcome text CHECK (outcome IN (${lista(RETENTION_OUTCOMES)}))`],
  [
    "checkout_settings.abandon_after_minutes",
    `abandon_after_minutes integer NOT NULL DEFAULT ${L.checkoutAbandonMinutesDefault}`,
  ],
  [
    "checkout_settings.abandon_after_minutes (zakres)",
    `CHECK (abandon_after_minutes BETWEEN ${L.checkoutAbandonMinutesMin} AND ${L.checkoutAbandonMinutesMax})`,
  ],
  [
    "revenue_manual_inputs.kind",
    `kind text NOT NULL CHECK (kind IN (${lista(REVENUE_INPUT_KINDS)}))`,
  ],
  [
    "revenue_manual_inputs.ratio",
    `CHECK (ratio BETWEEN ${L.inputRatioMin} AND ${L.inputRatioMax})`,
  ],
  ["revenue_manual_inputs.note", `CHECK (char_length(note) <= ${L.inputNoteMax})`],
  ["revenue_diagnostic_snoozes.check_id", `CHECK (check_id ~ '${L.checkIdPattern.source}')`],
  ["revenue_diagnostic_snoozes.scope_key", `CHECK (char_length(scope_key) <= ${L.scopeKeyMax})`],
  [
    "revenue_diagnostic_snoozes.kind",
    `kind text NOT NULL CHECK (kind IN (${lista(SNOOZE_KINDS)}))`,
  ],
  ["revenue_diagnostic_snoozes.scope_hash", `CHECK (char_length(scope_hash) <= ${L.scopeHashMax})`],
  [
    "revenue_diagnostic_snoozes.reason",
    `CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN ${L.snoozeReasonMin} AND ${L.snoozeReasonMax})`,
  ],
  ["revenue_diagnostic_snoozes.until", `until <= created_at + interval '${L.snoozeMaxDays} days'`],
];

const HELPERY_FRAGMENTY: Fragmenty = [
  [
    "domain_event_emit_errors.source",
    `CHECK (char_length(source) <= ${EMIT_ERROR_LIMITS.sourceMax})`,
  ],
  ["domain_event_emit_errors.error", `CHECK (char_length(error) <= ${EMIT_ERROR_LIMITS.errorMax})`],
];

describe.each([
  [KSIEGA, KSIEGA_FRAGMENTY],
  [LEJEK, LEJEK_FRAGMENTY],
  [HELPERY, HELPERY_FRAGMENTY],
] as const)("%s", (plik, fragmenty) => {
  it.each(fragmenty)("%s", (_opis, fragment) => {
    expect(migracja(plik)).toContain(kanon(fragment));
  });
});

describe("limity - spójność wewnętrzna", () => {
  it("wzorce TS zachowują się jak CHECK-i", () => {
    expect(L.paywallVariantPattern.test("default")).toBe(true);
    expect(L.paywallVariantPattern.test("x".repeat(33))).toBe(false);
    expect(L.checkIdPattern.test("catalog.plan_without_tier")).toBe(true);
    expect(L.checkIdPattern.test("catalog")).toBe(false);
  });

  it("domyślny czas porzucenia kasy mieści się w zakresie", () => {
    expect(L.checkoutAbandonMinutesDefault).toBeGreaterThanOrEqual(L.checkoutAbandonMinutesMin);
    expect(L.checkoutAbandonMinutesDefault).toBeLessThanOrEqual(L.checkoutAbandonMinutesMax);
  });
});
