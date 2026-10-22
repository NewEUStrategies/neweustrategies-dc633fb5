// JEDEN LIMIT DŁUGOŚCI TAGU KONTAKTU: TS ⇄ SQL (I9b, Z-S5-02).
//
// Tag kontaktu zapisuje pisarz CRM (`run_workflow_step` - przepisy i kroki
// ścieżek), sprawdza walidator grafu ścieżki (`journey_validate_graph`),
// a w panelu - schematy zod (lead, filtry, widoki, import, edytor przepisów
// i ścieżek). Do I9b było ich trzy (I0 64, pisarz i walidator 40, panel 40):
// tag 41-64 znaków przechodził walidację ścieżki w TS i padał dopiero przy
// wykonaniu kroku w bazie. Kolumna `crm_leads.tags` nie ma CHECK długości,
// więc wygrał kontrakt I0 (decyzja właściciela 2026-10-20). Test czyta
// NAJNOWSZE definicje funkcji z migracji (jak `segmentsParity.test.ts`)
// i sprawdza wartość graniczną: limit przechodzi, limit + 1 jest ODRZUCANY
// (AGENTS: nigdy przycinany).
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { WORKFLOW_ACTION_PARAMS, WORKFLOW_TAG_MAX } from "@/lib/admin/workflows";
import { stripSqlComments } from "@/lib/ci/ownership";
import { workflowsEn, workflowsPl } from "@/lib/i18n-admin-workflows";
import { journeysDictionaries } from "@/lib/i18n-admin-journeys";
import { JOURNEY_TAG_MAX, NODE_PARAMS_SCHEMAS } from "@/lib/journeys/graph";
import { JOURNEY_LIMITS } from "@/lib/journeys/limits";
import { PredicateSchema } from "@/lib/journeys/predicates";
import { LeadListFilterSchema } from "@/lib/crm/leadListSpec";
import { LeadFilterSchema } from "@/lib/crm/leadViews";
import { CRM_TAG_MAX } from "../lifecycle";

const MIGRATIONS = "supabase/migrations";

/** Ciało NAJNOWSZEJ definicji funkcji (bez komentarzy) - stan bazy po migracjach. */
function latestBody(name: string): { file: string; body: string } {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const files = readdirSync(MIGRATIONS)
    .filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .filter((f) => readFileSync(`${MIGRATIONS}/${f}`, "utf8").includes(marker));
  expect(files.length, `brak definicji ${name}`).toBeGreaterThan(0);
  const file = files[files.length - 1];
  const sql = stripSqlComments(readFileSync(`${MIGRATIONS}/${file}`, "utf8"));
  const start = sql.indexOf(marker);
  const open = sql.indexOf("AS $", start);
  const tag = /AS (\$[a-z_]*\$)/.exec(sql.slice(open))?.[1] ?? "$$";
  const bodyStart = sql.indexOf(tag, open) + tag.length;
  return { file, body: sql.slice(bodyStart, sql.indexOf(tag, bodyStart)) };
}

/** Każde sprawdzenie długości tagu w ciele: `char_length(…tag…) NOT BETWEEN 1 AND N`. */
function tagBounds(body: string): number[] {
  return [...body.matchAll(/char_length\(([^;]*?tag[^;]*?)\)\s+NOT BETWEEN 1 AND (\d+)/g)].map(
    (m) => Number(m[2]),
  );
}

const tag = (length: number) => "t".repeat(length);

describe("limit tagu - jedna stała w TS", () => {
  it("CRM_TAG_MAX = kontrakt I0 ścieżek (64), edytor przepisów i ścieżek czytają tę samą", () => {
    expect(CRM_TAG_MAX).toBe(64);
    expect(JOURNEY_LIMITS.tagMax).toBe(CRM_TAG_MAX);
    expect(JOURNEY_TAG_MAX).toBe(CRM_TAG_MAX);
    expect(WORKFLOW_TAG_MAX).toBe(CRM_TAG_MAX);
    for (const action of ["add_tag", "remove_tag"] as const) {
      expect(WORKFLOW_ACTION_PARAMS[action].find((p) => p.key === "tag")?.maxLength).toBe(
        CRM_TAG_MAX,
      );
    }
  });
});

describe("limit tagu - parytet z najnowszymi definicjami SQL", () => {
  it.each(["run_workflow_step", "journey_validate_graph"])(
    "%s: każde sprawdzenie długości tagu = CRM_TAG_MAX",
    (name) => {
      const { file, body } = latestBody(name);
      const bounds = tagBounds(body);
      expect(bounds.length, `${file}: brak sprawdzenia długości tagu`).toBeGreaterThan(0);
      expect(new Set(bounds), file).toEqual(new Set([CRM_TAG_MAX]));
    },
  );

  it("komunikat pisarza mówi ten sam limit", () => {
    const { body } = latestBody("run_workflow_step");
    expect(body).toContain(`tag must have 1-${CRM_TAG_MAX} characters`);
  });
});

describe("limit tagu - wartość graniczna (limit przechodzi, limit + 1 odrzucony)", () => {
  const cases: [string, (value: string) => boolean][] = [
    ["akcja ścieżki add_tag", (v) => NODE_PARAMS_SCHEMAS.add_tag.safeParse({ tag: v }).success],
    [
      "akcja ścieżki remove_tag",
      (v) => NODE_PARAMS_SCHEMAS.remove_tag.safeParse({ tag: v }).success,
    ],
    ["warunek has_tag", (v) => PredicateSchema.safeParse({ kind: "has_tag", tag: v }).success],
    ["filtr listy leadów", (v) => LeadListFilterSchema.safeParse({ tags: [v] }).success],
    ["filtr widoku leadów", (v) => LeadFilterSchema.safeParse({ tags: [v] }).success],
  ];

  it.each(cases)("%s", (_label, accepts) => {
    expect(accepts(tag(CRM_TAG_MAX))).toBe(true);
    expect(accepts(tag(CRM_TAG_MAX + 1))).toBe(false);
    // Odstępy na brzegach nie liczą się do limitu (jak `btrim` w SQL).
    expect(accepts(`  ${tag(CRM_TAG_MAX)}  `)).toBe(true);
  });
});

describe("limit tagu - komunikaty UI (PL/EN)", () => {
  it("błąd grafu `tag_length` i opis akcji add_tag podają CRM_TAG_MAX", () => {
    for (const dict of [journeysDictionaries.pl, journeysDictionaries.en]) {
      expect(dict.adminJourneys.graphIssue.tag_length).toContain(String(CRM_TAG_MAX));
    }
    for (const dict of [workflowsPl, workflowsEn]) {
      expect(JSON.stringify(dict)).not.toMatch(/\b40 (znaków|characters)\b/);
      expect(JSON.stringify(dict)).toMatch(new RegExp(`\\b${CRM_TAG_MAX} (znaków|characters)\\b`));
    }
  });
});
