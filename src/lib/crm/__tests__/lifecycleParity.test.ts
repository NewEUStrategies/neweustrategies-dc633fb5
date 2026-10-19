// PARYTET CYKLU ŻYCIA CRM: `lifecycle.ts` ⇄ migracja 20261020090200
// (SPEC AD-11, D-01; tabela PLAN_I0 §2.2).
//
// KOLEJNOŚĆ ETAPÓW JEST KONTRAKTEM (porządek lejka), więc fragment z listą
// musi wystąpić w migracji DOSŁOWNIE - ta sama lista w innej kolejności
// jest błędem, nie wariantem zapisu.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { stripSqlComments } from "@/lib/ci/ownership";
import {
  BILLING_OWNED_LIFECYCLE_STAGES,
  CRM_TASK_ORIGIN_REF_MAX,
  CRM_TASK_SOURCE_DEFAULT,
  CRM_TASK_SOURCES,
  LIFECYCLE_STAGE_DEFAULT,
  LIFECYCLE_STAGES,
  LIFECYCLE_WRITER_PRECEDENCE,
  LIFECYCLE_WRITERS,
  STAGE_HISTORY_DIMENSIONS,
  STAGE_HISTORY_SOURCES,
  canLifecycleWriterOverride,
  canLifecycleWriterSetStage,
} from "../lifecycle";

const CRM = "supabase/migrations/20261020090200_hub_schema_crm_lifecycle.sql";

/** Zapis kanoniczny: jedna spacja, bez spacji przy nawiasach i przecinkach. */
const kanon = (sql: string) =>
  sql
    .replace(/\s+/g, " ")
    .replace(/\s*([(),])\s*/g, "$1")
    .trim();

function migracja(): string {
  expect(existsSync(CRM), `brak migracji toru A: ${CRM}`).toBe(true);
  return kanon(stripSqlComments(readFileSync(CRM, "utf8")));
}

const lista = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(",");

describe("parytet z migracją 090200", () => {
  it.each([
    [
      "crm_leads.lifecycle_stage - kolumna i wartość domyślna",
      `lifecycle_stage text NOT NULL DEFAULT '${LIFECYCLE_STAGE_DEFAULT}'`,
    ],
    [
      "crm_leads.lifecycle_stage - 9 etapów w kolejności lejka",
      `CHECK (lifecycle_stage IN (${lista(LIFECYCLE_STAGES)}))`,
    ],
    [
      "crm_lead_stage_history.dimension",
      `CHECK (dimension IN (${lista(STAGE_HISTORY_DIMENSIONS)}))`,
    ],
    [
      "crm_lead_stage_history.source (z `backfill`)",
      `CHECK (source IN (${lista(STAGE_HISTORY_SOURCES)}))`,
    ],
    [
      "crm_tasks.source - kolumna, wartość domyślna i lista",
      `source text NOT NULL DEFAULT '${CRM_TASK_SOURCE_DEFAULT}' CHECK (source IN (${lista(CRM_TASK_SOURCES)}))`,
    ],
    ["crm_tasks.origin_ref", `CHECK (char_length(origin_ref) <= ${CRM_TASK_ORIGIN_REF_MAX})`],
  ])("%s", (_opis, fragment) => {
    expect(migracja()).toContain(kanon(fragment));
  });
});

describe("kontrakt etapów (D-01)", () => {
  it("dokładnie 9 etapów, od subskrybenta do byłego klienta", () => {
    expect(LIFECYCLE_STAGES).toEqual([
      "subscriber",
      "lead",
      "registered",
      "mql",
      "sql",
      "opportunity",
      "customer",
      "former_customer",
      "other",
    ]);
    expect(STAGE_HISTORY_SOURCES).toContain("backfill");
  });

  it("każdy pisarz cyklu życia jest też źródłem historii i źródłem zadania", () => {
    for (const writer of LIFECYCLE_WRITERS) {
      expect(STAGE_HISTORY_SOURCES).toContain(writer);
      expect(CRM_TASK_SOURCES).toContain(writer);
    }
  });
});

describe("pierwszeństwo pisarzy: billing > manual > journey = workflow > system", () => {
  it("ranking", () => {
    const P = LIFECYCLE_WRITER_PRECEDENCE;
    expect(P.billing).toBeGreaterThan(P.manual);
    expect(P.manual).toBeGreaterThan(P.journey);
    expect(P.journey).toBe(P.workflow);
    expect(P.workflow).toBeGreaterThan(P.system);
  });

  it("automat nie cofa etapu ustawionego przez billing ani przez człowieka", () => {
    expect(canLifecycleWriterOverride("journey", "billing")).toBe(false);
    expect(canLifecycleWriterOverride("workflow", "manual")).toBe(false);
    expect(canLifecycleWriterOverride("system", "journey")).toBe(false);
    expect(canLifecycleWriterOverride("manual", "billing")).toBe(false);
  });

  it("równe i wyższe nadpisują; brak poprzedniego pisarza nadpisuje każdy", () => {
    expect(canLifecycleWriterOverride("journey", "workflow")).toBe(true);
    expect(canLifecycleWriterOverride("workflow", "journey")).toBe(true);
    expect(canLifecycleWriterOverride("billing", "manual")).toBe(true);
    expect(canLifecycleWriterOverride("manual", "manual")).toBe(true);
    for (const writer of LIFECYCLE_WRITERS) {
      expect(canLifecycleWriterOverride(writer, null)).toBe(true);
    }
  });

  it("etapy klienta ustawia wyłącznie billing", () => {
    for (const stage of BILLING_OWNED_LIFECYCLE_STAGES) {
      expect(canLifecycleWriterSetStage("billing", stage)).toBe(true);
      for (const writer of LIFECYCLE_WRITERS.filter((w) => w !== "billing")) {
        expect(canLifecycleWriterSetStage(writer, stage), `${writer} → ${stage}`).toBe(false);
      }
    }
    expect(canLifecycleWriterSetStage("journey", "mql")).toBe(true);
  });
});
