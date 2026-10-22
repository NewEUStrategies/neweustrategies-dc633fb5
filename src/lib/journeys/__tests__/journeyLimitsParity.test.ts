// PARYTET LIMITÓW I SŁOWNIKÓW ŚCIEŻEK: `limits.ts` ⇄ CHECK-i migracji
// 20261020090300 / 20261020090400 (SPEC §8.3, tabela PLAN_I0 §2.2);
// słownik powodów wyjścia - z NAJNOWSZEJ definicji CHECK (20261020160600,
// I9b-A2: `account_deleted` po usunięciu konta).
//
// Te same stałe czytają zod grafu, liczniki znaków edytora i komunikaty
// błędów. Fragmenty niżej są budowane ze stałych TS i muszą wystąpić
// w migracji DOSŁOWNIE (po wycięciu komentarzy i sprowadzeniu białych znaków
// do zapisu kanonicznego po obu stronach).
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { stripSqlComments } from "@/lib/ci/ownership";
import { JOURNEY_STATUSES } from "@/lib/revenue/search";
import {
  JOURNEY_CATEGORIES,
  JOURNEY_ENGINE_PHASES,
  JOURNEY_ENROLLMENT_STATUSES,
  JOURNEY_EXIT_REASONS,
  JOURNEY_LIMITS,
  JOURNEY_MESSAGE_EVENT_KINDS,
  JOURNEY_REENTRY,
  JOURNEY_ROUTE_ROLES,
  JOURNEY_STEP_OUTCOMES,
  JOURNEY_STEP_STATUSES,
} from "../limits";

const RDZEN = "supabase/migrations/20261020090300_hub_schema_journeys_core.sql";
const WIADOMOSCI = "supabase/migrations/20261020090400_hub_schema_journeys_messaging.sql";
const RODO = "supabase/migrations/20261020160600_domain_events_account_erasure.sql";

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
const J = JOURNEY_LIMITS;

/** [opis, fragment SQL zbudowany ze stałej TS] */
type Fragmenty = readonly (readonly [string, string])[];

const RDZEN_FRAGMENTY: Fragmenty = [
  ["journey_definitions.key", `CHECK (key ~ '${J.keyPattern.source}')`],
  ["journey_definitions.name", `CHECK (char_length(name) BETWEEN ${J.nameMin} AND ${J.nameMax})`],
  ["journey_definitions.description", `CHECK (char_length(description) <= ${J.descriptionMax})`],
  ["journey_definitions.status", `CHECK (status IN (${lista(JOURNEY_STATUSES)}))`],
  ["journey_definitions.category", `CHECK (category IN (${lista(JOURNEY_CATEGORIES)}))`],
  ["journey_definitions.legal_basis", `CHECK (char_length(legal_basis) <= ${J.legalBasisMax})`],
  [
    "journey_definitions - podstawa prawna poza marketingiem",
    `CHECK (category = 'marketing' OR legal_basis IS NOT NULL)`,
  ],
  [
    "journey_versions.trigger_event_type",
    `CHECK (trigger_event_type ~ '${J.triggerEventTypePattern.source}')`,
  ],
  ["journey_versions.reentry", `CHECK (reentry IN (${lista(JOURNEY_REENTRY)}))`],
  [
    "journey_versions.reentry_cooldown_days",
    `CHECK (reentry_cooldown_days BETWEEN ${J.cooldownDaysMin} AND ${J.cooldownDaysMax})`,
  ],
  ["journey_event_routes.role", `CHECK (role IN (${lista(JOURNEY_ROUTE_ROLES)}))`],
  ["journey_enrollments.status", `CHECK (status IN (${lista(JOURNEY_ENROLLMENT_STATUSES)}))`],
  ["journey_step_runs.status", `CHECK (status IN (${lista(JOURNEY_STEP_STATUSES)}))`],
  ["journey_step_runs.outcome", `CHECK (outcome IN (${lista(JOURNEY_STEP_OUTCOMES)}))`],
  [
    "journey_settings.marketing_cap_per_7d",
    `CHECK (marketing_cap_per_7d BETWEEN ${J.capPer7dMin} AND ${J.capPer7dMax})`,
  ],
  [
    "journey_settings.machine_open_seconds",
    `CHECK (machine_open_seconds BETWEEN ${J.machineOpenSecondsMin} AND ${J.machineOpenSecondsMax})`,
  ],
  ["journey_engine_errors.phase", `CHECK (phase IN (${lista(JOURNEY_ENGINE_PHASES)}))`],
];

const WIADOMOSCI_FRAGMENTY: Fragmenty = [
  ["journey_email_contents.variant", `CHECK (variant ~ '${J.variantPattern.source}')`],
  [
    "journey_email_contents.subject_pl",
    `CHECK (char_length(subject_pl) BETWEEN ${J.subjectMin} AND ${J.subjectMax})`,
  ],
  ["journey_email_contents.subject_en", `CHECK (char_length(subject_en) <= ${J.subjectMax})`],
  ["journey_email_contents.preheader_pl", `CHECK (char_length(preheader_pl) <= ${J.preheaderMax})`],
  ["journey_email_contents.preheader_en", `CHECK (char_length(preheader_en) <= ${J.preheaderMax})`],
  ["journey_message_events.kind", `CHECK (kind IN (${lista(JOURNEY_MESSAGE_EVENT_KINDS)}))`],
];

// CHECK zastąpiony w 20261020160600 (DROP + ADD) - jego słownik żyje tam.
const RODO_FRAGMENTY: Fragmenty = [
  ["journey_enrollments.exit_reason", `CHECK (exit_reason IN (${lista(JOURNEY_EXIT_REASONS)}))`],
];

describe.each([
  [RDZEN, RDZEN_FRAGMENTY],
  [WIADOMOSCI, WIADOMOSCI_FRAGMENTY],
  [RODO, RODO_FRAGMENTY],
] as const)("%s", (plik, fragmenty) => {
  it.each(fragmenty)("%s", (_opis, fragment) => {
    expect(migracja(plik)).toContain(kanon(fragment));
  });
});

describe("wartości domyślne journey_settings", () => {
  /** `<kolumna> <typ> [NOT NULL] DEFAULT <wartość>` - typ kolumny nie jest kontraktem. */
  const domyslna = (kolumna: string) =>
    new RegExp(String.raw`\b${kolumna} [a-z]+(?: NOT NULL)? DEFAULT ([0-9]+)\b`).exec(
      migracja(RDZEN),
    )?.[1];

  it("limit maili w 7 dni i próg otwarcia maszynowego", () => {
    expect(Number(domyslna("marketing_cap_per_7d"))).toBe(J.capPer7dDefault);
    expect(Number(domyslna("machine_open_seconds"))).toBe(J.machineOpenSecondsDefault);
  });
});

describe("ramiona A/B (SPEC N11)", () => {
  it("edytor daje 2 ramiona, a CHECK dopuszcza tyle liter, ile liczy wzorzec", () => {
    const sql = migracja(WIADOMOSCI);
    const zakres = /CHECK\(variant ~ '\^\[([A-Z])-([A-Z])\]\$'\)/.exec(sql);
    expect(zakres, "CHECK wariantu w postaci ^[X-Y]$").not.toBeNull();
    const litery = zakres![2].charCodeAt(0) - zakres![1].charCodeAt(0) + 1;
    expect(litery).toBe(5);
    expect(J.abVariantsMax).toBe(2);
    expect(J.abVariantsMax).toBeLessThanOrEqual(litery);
    // Wyjścia kroku znają każdą literę wariantu, nie tylko dwie pierwsze.
    for (const litera of "ABCDE") expect(JOURNEY_STEP_OUTCOMES).toContain(litera);
  });

  it("wzorce TS zachowują się jak CHECK-i", () => {
    expect(J.keyPattern.test("welcome_onboarding")).toBe(true);
    expect(J.keyPattern.test("ab")).toBe(false);
    expect(J.triggerEventTypePattern.test("account.registered.v1")).toBe(true);
    expect(J.triggerEventTypePattern.test("account.v1")).toBe(false);
    expect(J.variantPattern.test("E")).toBe(true);
    expect(J.variantPattern.test("F")).toBe(false);
  });
});
