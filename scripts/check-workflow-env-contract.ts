/**
 * Bramka inwariantu: KAŻDA ZMIENNA ŚRODOWISKOWA EKSPORTOWANA PRZEZ WORKFLOW
 * MUSI MIEĆ ODBIORCĘ.
 *
 * Cienki runner - cała logika i jej uzasadnienie (martwy `PADDLE_SANDBOX_API_KEY`
 * kontra czytany `STRIPE_SANDBOX_API_KEY`, przez który nocna sonda rozliczeń
 * co dobę spała 40 minut i kończyła na zielono, nie sprawdzając niczego) żyją
 * w `src/lib/ci/workflowEnvContract.ts`, gdzie mają test jednostkowy.
 *
 * Usage: bun run scripts/check-workflow-env-contract.ts
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  type SourceFile,
  type WorkflowFile,
  analyzeWorkflowEnvContract,
  renderWorkflowEnvContractReport,
  workflowEnvContractFailed,
} from "../src/lib/ci/workflowEnvContract";

const WORKFLOWS_DIR = ".github/workflows";
const SOURCE_ROOTS = ["src", "scripts", "e2e", "e2e-ab", "e2e-performance"];
// Alternate production configs consume environment too; scanning only the
// default Playwright config falsely classified their inputs as dead exports.
const SOURCE_FILES = readdirSync(".").filter((file) => /\.config\.[cm]?[jt]s$/.test(file));
const SOURCE_SUFFIXES = [".ts", ".tsx", ".js", ".mjs", ".cjs"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".output", "coverage", "reports"]);

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE_SUFFIXES.some((suffix) => entry.endsWith(suffix))) out.push(full);
  }
  return out;
}

function read(paths: readonly string[]): { file: string; source: string }[] {
  return paths.map((path) => ({
    file: relative(process.cwd(), path).replaceAll("\\", "/"),
    source: readFileSync(path, "utf8"),
  }));
}

function main(): void {
  if (!existsSync(WORKFLOWS_DIR)) {
    console.log(
      "✓ Kontrakt env workflow ⇄ kod: brak katalogu .github/workflows - nic do sprawdzenia.",
    );
    return;
  }

  const workflows: WorkflowFile[] = read(
    readdirSync(WORKFLOWS_DIR)
      .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
      .map((file) => join(WORKFLOWS_DIR, file)),
  ).map(({ file, source }) => ({ file, yaml: source }));

  const sources: SourceFile[] = read([
    ...SOURCE_ROOTS.filter((root) => existsSync(root)).flatMap((root) => walk(root, [])),
    ...SOURCE_FILES.filter((file) => existsSync(file)),
  ]);

  const report = analyzeWorkflowEnvContract(workflows, sources);
  const rendered = renderWorkflowEnvContractReport(report);

  if (workflowEnvContractFailed(report)) {
    console.error(rendered);
    process.exit(1);
  }
  console.log(rendered);
}

main();
