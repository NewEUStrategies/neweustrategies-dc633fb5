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
 * DŁUG ZASTANY w chwili wprowadzenia bramki (2026-08-14), zmierzony - nie
 * przepisany. Osiem polityk na sześciu tabelach ŁĄCZĄCYCH straciło wiązanie
 * z najemcą w JEDNEJ migracji: `20260714130000_expert_hub.sql` przepisało je
 * z predykatu „rodzic należy do przeglądanego najemcy" na `USING (true)`.
 *
 * Klasa danych: tabele wiele-do-wielu bez własnej kolumny `tenant_id` - najemca
 * wynika z RODZICA (`posts`, `events`, `programs`, `expertise_areas`), dlatego
 * poprawnym predykatem jest `EXISTS` po rodzicu, dokładnie w kształcie z
 * `20260713201355`, np. dla `post_authors`:
 *
 *     EXISTS (SELECT 1 FROM public.posts p
 *              WHERE p.id = post_authors.post_id
 *                AND p.tenant_id = public_tenant_id()
 *                AND p.status = 'published')
 *
 * CZEGO TO NIE JEST: te wiersze noszą wyłącznie pary UUID, więc nie wyciekają
 * treści (rodzice mają własne, zawężone polityki). Wyciekają GRAF: kto jest
 * autorem którego wpisu i kto prelegentem którego wydarzenia u obcego najemcy.
 *
 * DLACZEGO DŁUG, A NIE NAPRAWA TUTAJ: to regresja o miesiąc starsza od wydania,
 * które ta zmiana odblokowuje, a naprawa dotyka publicznego odczytu wpisów,
 * wydarzeń i programów w sześciu tabelach - należy jej się własna migracja
 * z asercjami pgTAP na izolację, nie doklejenie do commita naprawiającego CI.
 * Lista jest drukowana przy KAŻDYM przebiegu i może tylko maleć; każde NOWE
 * cofnięcie oblewa CI natychmiast.
 */
const KNOWN_OPEN_GAPS: PolicyTenantGaps = {
  "event_speakers::event_speakers public read":
    "poprawny predykat: EXISTS (events e WHERE e.id = event_speakers.event_id AND e.tenant_id = public_tenant_id() AND e.status = 'published') - jak w 20260713201355",
  "event_speakers::event_speakers staff manage":
    "poprawny predykat: rola AND EXISTS (events e WHERE e.id = event_speakers.event_id AND e.tenant_id = current_tenant_id()) - dziś sama rola, więc redaktor najemcy A przypisuje prelegenta do wydarzenia najemcy B",
  "expert_expertise_areas::expert_areas public read":
    "poprawny predykat: EXISTS (expertise_areas ea WHERE ea.id = expert_expertise_areas.area_id AND ea.tenant_id = public_tenant_id()) - jak w 20260713201355",
  "post_authors::post_authors public read":
    "poprawny predykat: EXISTS (posts p WHERE p.id = post_authors.post_id AND p.tenant_id = public_tenant_id() AND p.status = 'published') - jak w 20260713201355",
  "post_programs::post_programs public read":
    "poprawny predykat: EXISTS (posts p WHERE p.id = post_programs.post_id AND p.tenant_id = public_tenant_id() AND p.status = 'published') - jak w 20260713201355",
  "post_regions::post_regions public read":
    "poprawny predykat: EXISTS (posts p WHERE p.id = post_regions.post_id AND p.tenant_id = public_tenant_id() AND p.status = 'published') - jak w 20260713201355",
  "program_members::program_members public read":
    "poprawny predykat: EXISTS (programs pr WHERE pr.id = program_members.program_id AND pr.tenant_id = public_tenant_id()) - jak w 20260713201355",
  "program_members::program_members staff write":
    "poprawny predykat: rola AND EXISTS (programs pr WHERE pr.id = program_members.program_id AND pr.tenant_id = current_tenant_id()) - dziś sama rola, więc redaktor najemcy A edytuje skład programu najemcy B",
};

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
