// Kontrakt bramki „każda zmienna eksportowana przez workflow ma odbiorcę"
// + jej self-test na REALNYM repozytorium.
//
// Klasa błędu: workflow eksportuje `A_API_KEY`, skrypt czyta `B_API_KEY`. Obie
// strony są składniowo poprawne, obie mają legalną obsługę braku wartości, więc
// złożenie kończy się przebiegiem, który nic nie sprawdza i świeci na zielono.
// Dokładnie to zjadło nocną sondę rozliczeń: 40 minut runnera dziennie za zero
// wykonanych żądań do operatora płatności.
//
// Testy są celowo VENDOR-NEUTRALNE - bramka nie zna nazw dostawców, zna tylko
// relację „deklaracja ⇄ odczyt".
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type SourceFile,
  type WorkflowFile,
  analyzeWorkflowEnvContract,
  collectConsumedKeys,
  extractEnvDeclarations,
  renderWorkflowEnvContractReport,
  usedInWorkflow,
  workflowEnvContractFailed,
} from "@/lib/ci/workflowEnvContract";

const WORKFLOWS_DIR = ".github/workflows";
const SOURCE_ROOTS = ["src", "scripts", "e2e", "e2e-ab", "e2e-performance"];
const SOURCE_SUFFIXES = [".ts", ".tsx", ".js", ".mjs", ".cjs"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".output", "coverage", "reports"]);

const WORKFLOW = [
  "name: Przykład",
  "on:",
  "  workflow_dispatch:",
  "jobs:",
  "  probe:",
  "    runs-on: ubuntu-latest",
  "    env:",
  "      READ_BY_SCRIPT: ${{ secrets.READ_BY_SCRIPT }}",
  "      # komentarz w środku mapy nie zamyka bloku",
  "      ORPHANED_API_KEY: ${{ secrets.ORPHANED_API_KEY }}",
  "    steps:",
  "      - uses: actions/checkout@v4",
  "        with:",
  "          fetch-depth: 0",
  "      - name: Uruchom",
  "        run: bun scripts/probe.ts",
].join("\n");

describe("wyciąganie deklaracji env z YAML", () => {
  it("bierze wpisy z bloku `env:` i nic poza nim", () => {
    const declarations = extractEnvDeclarations("w.yml", WORKFLOW);
    expect(declarations.map((entry) => entry.key)).toEqual(["READ_BY_SCRIPT", "ORPHANED_API_KEY"]);
  });

  it("nie łapie kluczy z `with:`, `jobs:` ani `on:`", () => {
    const keys = extractEnvDeclarations("w.yml", WORKFLOW).map((entry) => entry.key);
    expect(keys).not.toContain("fetch-depth");
    expect(keys).not.toContain("probe");
    expect(keys).not.toContain("runs-on");
  });

  it("zamyka blok na pierwszym wpisie o wcięciu nie większym niż `env:`", () => {
    const declarations = extractEnvDeclarations(
      "w.yml",
      ["    env:", "      A: 1", "    steps:", "      - run: echo B_NOT_ENV"].join("\n"),
    );
    expect(declarations.map((entry) => entry.key)).toEqual(["A"]);
  });

  it("nie bierze `klucz: wartość` z wnętrza skalara blokowego za deklarację", () => {
    const declarations = extractEnvDeclarations(
      "w.yml",
      ["    env:", "      SCRIPT: |", "        foo: bar", "      REAL_KEY: 1"].join("\n"),
    );
    expect(declarations.map((entry) => entry.key)).toEqual(["SCRIPT", "REAL_KEY"]);
  });

  it("podaje numer wiersza deklaracji", () => {
    const [first] = extractEnvDeclarations("w.yml", WORKFLOW);
    expect(first.line).toBe(8);
  });
});

describe("wykrywanie odbiorców", () => {
  it("rozpoznaje wszystkie formy odczytu w kodzie", () => {
    const keys = collectConsumedKeys([
      { file: "a.ts", source: "process.env.ALPHA" },
      { file: "b.ts", source: 'process.env["BETA"]' },
      { file: "c.ts", source: "import.meta.env.GAMMA" },
      { file: "d.ts", source: 'getEnv("DELTA")' },
      { file: "e.ts", source: 'vi.stubEnv("EPSILON", "x")' },
    ]);
    expect([...keys].sort()).toEqual(["ALPHA", "BETA", "DELTA", "EPSILON", "GAMMA"]);
  });

  it("rozpoznaje odczyt przez alias `const env = process.env`", () => {
    // Tak czyta KOMPLET swoich zmiennych scripts/scheduler-tick.mjs. Detektor
    // bez tego zgłosiłby siedem fałszywych alarmów naraz - a bramka, która
    // krzyczy bez powodu, przestaje być czytana.
    const keys = collectConsumedKeys([
      {
        file: "scripts/tick.mjs",
        source: [
          "const env = process.env;",
          'const JOB = (env.SCHEDULER_JOB ?? "all").trim();',
          "const TICKS = clampInt(env.SCHEDULER_TICKS, 1, 1, 10);",
        ].join("\n"),
      },
    ]);
    expect(keys.has("SCHEDULER_JOB")).toBe(true);
    expect(keys.has("SCHEDULER_TICKS")).toBe(true);
  });

  it("rozpoznaje destrukturyzację `const { A } = process.env`", () => {
    const keys = collectConsumedKeys([
      { file: "a.ts", source: "const { ALPHA, BETA } = process.env;" },
    ]);
    expect([...keys].sort()).toEqual(["ALPHA", "BETA"]);
  });

  it("rozpoznaje użycie w samym workflow (shell i wyrażenie)", () => {
    expect(usedInWorkflow('run: echo "$TOKEN"', "TOKEN")).toBe(true);
    expect(usedInWorkflow("run: echo ${TOKEN}", "TOKEN")).toBe(true);
    expect(usedInWorkflow("if: env.TOKEN != ''", "TOKEN")).toBe(true);
    expect(usedInWorkflow("run: echo nic", "TOKEN")).toBe(false);
  });
});

describe("analiza kontraktu", () => {
  const workflows: WorkflowFile[] = [{ file: "w.yml", yaml: WORKFLOW }];

  it("zgłasza eksport bez odbiorcy i wskazuje wiersz", () => {
    const sources: SourceFile[] = [
      { file: "scripts/probe.ts", source: "process.env.READ_BY_SCRIPT" },
    ];
    const report = analyzeWorkflowEnvContract(workflows, sources);
    expect(workflowEnvContractFailed(report)).toBe(true);
    expect(report.orphaned).toHaveLength(1);
    expect(report.orphaned[0]).toMatchObject({ key: "ORPHANED_API_KEY", line: 10 });
  });

  it("przechodzi, gdy skrypt czyta obie nazwy", () => {
    const sources: SourceFile[] = [
      {
        file: "scripts/probe.ts",
        source: "process.env.READ_BY_SCRIPT + process.env.ORPHANED_API_KEY",
      },
    ];
    expect(workflowEnvContractFailed(analyzeWorkflowEnvContract(workflows, sources))).toBe(false);
  });

  it("odtwarza pierwotną usterkę: literówka w nazwie zostaje złapana", () => {
    const yaml = [
      "jobs:",
      "  x:",
      "    env:",
      "      LEGACY_SANDBOX_API_KEY: ${{ secrets.X }}",
    ].join("\n");
    const report = analyzeWorkflowEnvContract(
      [{ file: "billing-nightly.yml", yaml }],
      [{ file: "scripts/probe.ts", source: "process.env.STRIPE_SANDBOX_API_KEY" }],
    );
    expect(report.orphaned.map((entry) => entry.key)).toEqual(["LEGACY_SANDBOX_API_KEY"]);
  });

  it("przepuszcza zmienne narzędzi i te wstrzykiwane przez GitHub", () => {
    const yaml = [
      "jobs:",
      "  x:",
      "    env:",
      "      npm_config_registry: https://registry.npmjs.org",
      "      NODE_OPTIONS: --max-old-space-size=8192",
      "      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}",
    ].join("\n");
    const report = analyzeWorkflowEnvContract([{ file: "w.yml", yaml }], []);
    expect(report.orphaned).toEqual([]);
    expect(report.declared).toHaveLength(3);
  });

  it("przepuszcza zmienną konsumowaną przez shell w tym samym workflow", () => {
    const yaml = [
      "jobs:",
      "  x:",
      "    env:",
      "      PG_URL: postgres://x",
      "    steps:",
      '      - run: psql "$PG_URL"',
    ].join("\n");
    expect(analyzeWorkflowEnvContract([{ file: "w.yml", yaml }], []).orphaned).toEqual([]);
  });

  it("raport sukcesu liczy deklaracje, raport błędu tłumaczy oba scenariusze", () => {
    const ok = renderWorkflowEnvContractReport({ declared: [], orphaned: [], consumedKeys: 42 });
    expect(ok).toContain("42");
    const failure = renderWorkflowEnvContractReport({
      declared: [],
      orphaned: [{ file: "w.yml", line: 3, key: "DEAD_KEY" }],
      consumedKeys: 0,
    });
    expect(failure).toContain("w.yml:3");
    expect(failure).toContain("TOOL_CONSUMED");
  });
});

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) out.push(full);
  }
  return out;
}

describe("self-test na realnym repozytorium", () => {
  // Skan całego repo (workflowy + wszystkie źródła) jest z natury I/O-bound:
  // przy pełnym przebiegu workery rywalizują o dysk i domyślne 5 s bywa za
  // mało. Limit jest jawny, żeby nie mylić wolnego I/O z regresją kontraktu.
  it("żaden workflow w repo nie eksportuje zmiennej bez odbiorcy", { timeout: 60_000 }, () => {
    const workflows: WorkflowFile[] = readdirSync(WORKFLOWS_DIR)
      .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
      .map((file) => ({
        file: `${WORKFLOWS_DIR}/${file}`,
        yaml: readFileSync(join(WORKFLOWS_DIR, file), "utf8"),
      }));
    const sourceFiles = [
      ...SOURCE_ROOTS.flatMap((root) => walk(root, [])),
      ...readdirSync(".").filter((file) => /\.config\.[cm]?[jt]s$/.test(file)),
    ];
    const sources: SourceFile[] = sourceFiles.map((file) => ({
      file,
      source: readFileSync(file, "utf8"),
    }));

    const report = analyzeWorkflowEnvContract(workflows, sources);
    expect(renderWorkflowEnvContractReport(report)).toContain("✓");
    expect(report.orphaned).toEqual([]);
  });
});
