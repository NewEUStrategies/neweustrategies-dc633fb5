/**
 * Bramka: polityka RLS nie może zgubić wiązania z najemcą, które już miała.
 *
 * Cienki runner - inwariant, uzasadnienie i cała analiza żyją w
 * `src/lib/ci/policyTenantRegression.ts`, tak jak `check-sql-owner-tenant-scope.ts`
 * trzyma swoją logikę w `src/lib/ci/ownerTenantScope.ts`. Dzięki temu bramka ma
 * test jednostkowy (`src/lib/ci/__tests__/policyTenantRegression.test.ts`),
 * a nie tylko przebieg w CI.
 *
 * Parser polityk jest WSPÓLNY z bramkami anonimowego INSERT-u i zakresu
 * właściciela (`src/lib/ci/rlsPolicies.ts`), więc trzy bramki rozumieją SQL
 * dokładnie tak samo - poprawka w parserze wzmacnia wszystkie trzy naraz.
 *
 * Usage: bun run check:sql-policy-tenant-regression
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  analyzePolicyTenantRegressions,
  policyTenantRegressionFailed,
  renderPolicyTenantRegressionReport,
  type PolicyTenantGaps,
} from "../src/lib/ci/policyTenantRegression";
import { extractLatestPolicies, extractPolicyHistory } from "../src/lib/ci/rlsPolicies";
import type { MigrationFile } from "../src/lib/ci/dbContract";
import { MIGRATIONS_DIR, stripSqlComments } from "./lib/sqlMigrations";

/**
 * DŁUG ZASTANY: pusty od 2026-08-14.
 *
 * Osiem polityk na sześciu tabelach ŁĄCZĄCYCH (`event_speakers`,
 * `expert_expertise_areas`, `post_authors`, `post_programs`, `post_regions`,
 * `program_members`) straciło wiązanie z najemcą w `20260714130000_expert_hub.sql`
 * (przepisane na `USING (true)`). Migracja
 * `20260814210824_d3be420f-ff21-4f4f-b269-14e4377af29e.sql` przywróciła predykaty
 * po RODZICU: publiczny odczyt po `public_tenant_id()` (plus status/aktywność),
 * a zapis stafowy związany z `current_tenant_id()`, np.:
 *
 *     EXISTS (SELECT 1 FROM public.posts p
 *              WHERE p.id = post_authors.post_id
 *                AND p.tenant_id = public_tenant_id()
 *                AND p.status = 'published')
 *
 * Lista może tylko maleć - każde NOWE cofnięcie oblewa CI natychmiast.
 */
const KNOWN_OPEN_GAPS: PolicyTenantGaps = {};


function readMigrations(): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({
      file,
      sql: stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8")),
    }));
}

function main(): void {
  const files = readMigrations();
  const report = analyzePolicyTenantRegressions(
    extractPolicyHistory(files),
    extractLatestPolicies(files),
    KNOWN_OPEN_GAPS,
  );
  const rendered = renderPolicyTenantRegressionReport(report, KNOWN_OPEN_GAPS);

  if (policyTenantRegressionFailed(report)) {
    console.error(rendered);
    process.exit(1);
  }
  console.log(rendered);
}

main();
