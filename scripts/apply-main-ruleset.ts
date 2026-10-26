/**
 * Nakłada governance/release/main-ruleset.json na repozytorium (tworzy ruleset
 * albo aktualizuje istniejący o tej samej nazwie).
 *
 *   GH_TOKEN=<token administratora> bun run governance:apply-ruleset
 *   bun run governance:apply-ruleset -- --dry-run   # tylko payload, bez zapisu
 *
 * Token musi mieć uprawnienie „Administration: write" do repozytorium (np.
 * `gh auth token` właściciela). `GITHUB_TOKEN` z Actions go NIE ma - dlatego
 * nakłada człowiek, a workflow `release-governance.yml` tylko sprawdza rozjazd.
 *
 * Najpierw ta sama walidacja co `bun run check:main-ruleset`: plik, którego nie
 * da się nałożyć bez zatrzymania kanału Lovable, nie trafia na GitHuba.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  RULESET_PATH,
  parseRuleset,
  rulesetPayload,
  type Ruleset,
} from "../src/lib/ci/mainRuleset";
import { githubApi, githubRepository } from "./lib/githubApi";

const dryRun = process.argv.includes("--dry-run");

const parsed = parseRuleset(readFileSync(RULESET_PATH, "utf8"));
if ("error" in parsed) {
  console.error(`✗ ${parsed.error}`);
  process.exit(1);
}
const ruleset: Ruleset = parsed;

const check = spawnSync("bun", ["run", "scripts/check-main-ruleset.ts"], { stdio: "inherit" });
if (check.status !== 0) process.exit(1);

const slugs = [...new Set(ruleset.bypass_actors.flatMap((a) => (a.app_slug ? [a.app_slug] : [])))];
const appIds = new Map<string, number>();
for (const slug of slugs) {
  const app = await githubApi<{ id: number; slug: string }>(`/apps/${slug}`);
  appIds.set(slug, app.id);
  console.log(`  aplikacja ${slug}: id ${app.id}`);
}
const payload = rulesetPayload(ruleset, appIds);

if (dryRun) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}
if (!process.env["GH_TOKEN"] && !process.env["GITHUB_TOKEN"]) {
  console.error("✗ Brak GH_TOKEN - nałożenie rulesetu wymaga tokena administratora repozytorium.");
  process.exit(1);
}

const repo = githubRepository();
const existing = await githubApi<{ id: number; name: string }[]>(
  `/repos/${repo}/rulesets?includes_parents=false`,
);
const same = existing.find((r) => r.name === ruleset.name);
const saved = same
  ? await githubApi<{ id: number }>(`/repos/${repo}/rulesets/${same.id}`, {
      method: "PUT",
      body: payload,
    })
  : await githubApi<{ id: number }>(`/repos/${repo}/rulesets`, { method: "POST", body: payload });
console.log(
  `✓ ${repo}: ruleset „${ruleset.name}" ${same ? "zaktualizowany" : "utworzony"} (id ${saved.id}). Sprawdź: bun run check:main-ruleset -- --live`,
);
