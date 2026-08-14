/**
 * Bramka meta: każda bramka `check:*` z package.json jest wpięta w workflow,
 * dokładnie raz na job, i żaden krok nie woła skryptu, którego nie ma.
 *
 * Cienki runner - inwariant i uzasadnienie żyją w `src/lib/ci/gateCoverage.ts`,
 * więc bramka ma test jednostkowy (`src/lib/ci/__tests__/gateCoverage.test.ts`),
 * a nie tylko przebieg w CI.
 *
 * Ta bramka pilnuje SAMEJ SIEBIE: jest w package.json jako `check:*`, więc
 * usunięcie jej kroku z workflow zapali ją w każdym innym przebiegu, w którym
 * jeszcze jest.
 *
 * Usage: bun run check:gate-coverage
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  analyzeGateCoverage,
  gateCoverageFailed,
  renderGateCoverageReport,
  scanGateInvocations,
  type WorkflowSource,
} from "../src/lib/ci/gateCoverage";

const WORKFLOWS_DIR = ".github/workflows";
const PACKAGE_JSON = "package.json";

/** Kształt `package.json` w zakresie, który ta bramka czyta. */
interface PackageManifest {
  readonly scripts?: Readonly<Record<string, string>>;
}

function readScriptNames(): string[] {
  const manifest = JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as PackageManifest;
  return Object.keys(manifest.scripts ?? {});
}

function readWorkflows(): WorkflowSource[] {
  if (!existsSync(WORKFLOWS_DIR)) return [];
  return readdirSync(WORKFLOWS_DIR)
    .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
    .sort()
    .map((file) => ({
      file: `${WORKFLOWS_DIR}/${file}`,
      yaml: readFileSync(join(WORKFLOWS_DIR, file), "utf8"),
    }));
}

function main(): void {
  const report = analyzeGateCoverage(readScriptNames(), scanGateInvocations(readWorkflows()));
  const rendered = renderGateCoverageReport(report);

  if (gateCoverageFailed(report)) {
    console.error(rendered);
    process.exit(1);
  }
  console.log(rendered);
}

main();
