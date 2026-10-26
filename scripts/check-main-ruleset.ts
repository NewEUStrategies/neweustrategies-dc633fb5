/**
 * Bramka: ruleset gałęzi main (governance/release/main-ruleset.json).
 *
 *   bun run check:main-ruleset            # statycznie: plik zgodny z kanałem
 *                                          # wdrożenia, workflowami i CODEOWNERS
 *   bun run check:main-ruleset -- --live  # + reguły, które GitHub NAPRAWDĘ
 *                                          # stosuje do main (sieć; GH_TOKEN opcjonalny)
 *
 * Tryb `--live` jedzie w workflow `release-governance.yml` (codziennie i po
 * zmianie pliku): zadeklarowany, a niezastosowany ruleset jest czerwonym
 * przebiegiem, nie cichą fikcją. Nałożenie: `bun run governance:apply-ruleset`
 * (governance/release/README.md).
 *
 * Logika jest czysta i otestowana w src/lib/ci/__tests__/mainRuleset.test.ts -
 * ten skrypt tylko czyta pliki, pyta API i ustawia kod wyjścia.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RULESET_BRANCH,
  RULESET_PATH,
  defaultCodeOwners,
  parseRuleset,
  rulesetDrift,
  rulesetIssues,
  workflowChecks,
  type LiveRule,
} from "../src/lib/ci/mainRuleset";
import { githubApi, githubRepository } from "./lib/githubApi";

const WORKFLOWS_DIR = join(".github", "workflows");

function fail(lines: readonly string[]): never {
  console.error(lines.join("\n"));
  process.exit(1);
}

const ruleset = parseRuleset(readFileSync(RULESET_PATH, "utf8"));
if ("error" in ruleset) fail([`✗ ${ruleset.error}`]);

const workflows = readdirSync(WORKFLOWS_DIR)
  .filter((name) => /\.ya?ml$/.test(name))
  .sort()
  .map((name) => workflowChecks(name, readFileSync(join(WORKFLOWS_DIR, name), "utf8")));
const issues = rulesetIssues(ruleset, {
  workflows,
  defaultCodeOwners: defaultCodeOwners(readFileSync(join(".github", "CODEOWNERS"), "utf8")),
});
if (issues.length > 0)
  fail([
    `✗ ${RULESET_PATH}: ruleset nie da się nałożyć bez szkody:`,
    ...issues.map((i) => `  - ${i}`),
  ]);
console.log(`✓ ${RULESET_PATH}: zgodny z kanałem wdrożenia, workflowami i CODEOWNERS.`);

if (process.argv.includes("--live")) {
  const repo = githubRepository();
  const live = await githubApi<LiveRule[]>(`/repos/${repo}/rules/branches/${RULESET_BRANCH}`);
  const drift = rulesetDrift(ruleset, live);
  if (drift.length > 0)
    fail([
      `✗ ${repo}: reguły ${RULESET_BRANCH} na GitHubie różnią się od ${RULESET_PATH}:`,
      ...drift.map((line) => `  - ${line}`),
      "  Nałóż plik kontem administratora: GH_TOKEN=<token z uprawnieniem Administration: write> bun run governance:apply-ruleset",
      "  (governance/release/README.md). Zmiana zasad = zmiana pliku w przeglądanym PR, nie ręczna edycja w ustawieniach.",
    ]);
  console.log(`✓ ${repo}: każda reguła z ${RULESET_PATH} działa na ${RULESET_BRANCH}.`);
}
