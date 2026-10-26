// @vitest-environment node
//
// STAN KONFIGURACJI OPERACYJNYCH WORKFLOW - wykonanie prawdziwych skryptów
// kroków (audyt ED14).
//
// JAKIE RYZYKO PILNUJE TEN PLIK.
//   1. `scheduler.yml` bez sekretów kończył KAŻDY przebieg zielono
//      z ostrzeżeniem: repo deklarowało drugą linię doręczeń, której
//      produkcja nie miała. Teraz brak konfiguracji bez jawnej decyzji
//      (`vars.SCHEDULER_BACKUP=off`) jest czerwony raz na dobę, a przebiegi
//      5-minutowe tylko ostrzegają.
//   2. `billing-nightly.yml` padał na dwóch pierwszych kluczach; po ich
//      dodaniu padłby dopiero następnej nocy, na trzech sekretach kroku
//      weryfikacji. Kontrola wstępna wypisuje komplet jednym błędem.
//
// Skrypty `run: |` są wycinane z YAML i uruchamiane bashem tak jak na
// runnerze (`bash --noprofile --norc -eo pipefail`), z plikami
// GITHUB_OUTPUT i GITHUB_STEP_SUMMARY - test łapie zmianę zachowania kroku,
// nie formatowania.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const indentOf = (line: string): number => line.length - line.trimStart().length;

function stepLines(workflow: string, name: string): string[] {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  if (start < 0) throw new Error(`test: brak kroku „${name}"`);
  const base = indentOf(lines[start]!);
  const body = [lines[start]!];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && indentOf(line) <= base) break;
    body.push(line);
  }
  return body;
}

/** Skrypt `run: |` kroku, bez wcięcia YAML. */
function runScript(workflow: string, name: string): string {
  const lines = stepLines(workflow, name);
  const runAt = lines.findIndex((line) => line.trim() === "run: |");
  if (runAt < 0) throw new Error(`test: krok „${name}" bez \`run: |\``);
  const runIndent = indentOf(lines[runAt]!);
  const body: string[] = [];
  for (const line of lines.slice(runAt + 1)) {
    if (line.trim() !== "" && indentOf(line) <= runIndent) break;
    body.push(line);
  }
  const strip = Math.min(...body.filter((line) => line.trim() !== "").map(indentOf));
  return body.map((line) => line.slice(strip)).join("\n");
}

interface StepRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly output: string;
  readonly summary: string;
}

function execute(script: string, env: Record<string, string>): StepRun {
  const dir = mkdtempSync(join(tmpdir(), "wf-step-"));
  const output = join(dir, "output");
  const summary = join(dir, "summary");
  writeFileSync(output, "");
  writeFileSync(summary, "");
  const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
    env: {
      PATH: process.env.PATH ?? "",
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      ...env,
    },
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    output: readFileSync(output, "utf8"),
    summary: readFileSync(summary, "utf8"),
  };
}

describe("scheduler.yml - druga linia doręczeń jawnie skonfigurowana albo jawnie wyłączona", () => {
  const workflow = readFileSync(".github/workflows/scheduler.yml", "utf8");
  const configCheck = runScript(workflow, "Sprawdź konfigurację");
  const audit = runScript(workflow, "Audyt drugiej linii doręczeń");
  const community = {
    EVENT: "schedule",
    ENDPOINT: "/api/public/community-cron",
    BASE_URL: "https://example.test",
    HAS_COMMUNITY_SECRET: "true",
    HAS_BILLING_SECRET: "true",
  };

  it("wpis 5-minutowy omija pełną godzinę, a wpis dobowy jest tym, który rozpoznają plan i audyt", () => {
    const crons = [...workflow.matchAll(/- cron: "([^"]+)"/g)].map((match) => match[1]!);
    expect(crons).toHaveLength(2);
    const minutes = crons[0]!.split(" ")[0]!.split(",").map(Number);
    expect(minutes).toHaveLength(12);
    expect(minutes).not.toContain(0);
    minutes.slice(1).forEach((minute, index) => expect(minute - minutes[index]!).toBe(5));

    const daily = crons[1]!;
    expect(stepLines(workflow, "Ustal zakres ticku").join("\n")).toContain(
      `"$SCHEDULE" = "${daily}"`,
    );
    expect(stepLines(workflow, "Audyt drugiej linii doręczeń").join("\n")).toContain(
      `if: \${{ !cancelled() && github.event.schedule == '${daily}' }}`,
    );
  });

  it("nagłówek nie obiecuje drenażu co 5 minut i dokumentuje wyłącznik", () => {
    const header = workflow
      .split("\n")
      .filter((line) => line.startsWith("#"))
      .join("\n");
    expect(header).toContain("variables.SCHEDULER_BACKUP");
    expect(header).toContain("best-effort");
    expect(header).toContain("NIE jest drenaż co");
  });

  it("przebieg 5-minutowy bez sekretu: pominięte ticki i ostrzeżenie z podpowiedzią decyzji, bez czerwieni", () => {
    const run = execute(configCheck, { ...community, HAS_COMMUNITY_SECRET: "false" });
    expect(run.status).toBe(0);
    expect(run.output).toContain("configured=false");
    expect(run.stdout).toMatch(
      /::warning title=Scheduler nieskonfigurowany::.*COMMUNITY_CRON_SECRET/,
    );
    expect(run.stdout).toContain("vars.SCHEDULER_BACKUP=off");
  });

  it("wyłącznik `off` + przebieg z harmonogramu: ticki pominięte bez ostrzeżenia", () => {
    // Krok dostaje wyzwalacz tą samą zmienną co „Ustal zakres ticku".
    expect(stepLines(workflow, "Sprawdź konfigurację").join("\n")).toContain(
      "EVENT: ${{ github.event_name }}",
    );
    const run = execute(configCheck, {
      ...community,
      HAS_COMMUNITY_SECRET: "false",
      BACKUP_MODE: "off",
    });
    expect(run.status).toBe(0);
    expect(run.output).toContain("configured=false");
    expect(run.stdout).not.toContain("::warning");
  });

  // Ręczne wypchnięcie (RUNBOOK_HUB_PRZYCHOD_LEJEK, WDROZENIE_PLATNOSCI_AUDYT_PAY)
  // to jawne polecenie operatora - wyłącznik go nie wycisza.
  it("wyłącznik `off` + workflow_dispatch z kompletem: ticki biegną", () => {
    const run = execute(configCheck, {
      ...community,
      EVENT: "workflow_dispatch",
      ENDPOINT: "/api/public/billing-cron",
      BACKUP_MODE: "off",
    });
    expect(run.status).toBe(0);
    expect(run.output).toContain("configured=true");
  });

  it("wyłącznik `off` + workflow_dispatch bez sekretu: pominięte ticki i zwykłe ostrzeżenie", () => {
    const run = execute(configCheck, {
      ...community,
      EVENT: "workflow_dispatch",
      HAS_COMMUNITY_SECRET: "false",
      BACKUP_MODE: "off",
    });
    expect(run.status).toBe(0);
    expect(run.output).toContain("configured=false");
    expect(run.stdout).toMatch(
      /::warning title=Scheduler nieskonfigurowany::.*COMMUNITY_CRON_SECRET/,
    );
    // Decyzja jest już zapisana - ostrzeżenie nie każe jej zapisać ponownie.
    expect(run.stdout).not.toContain("vars.SCHEDULER_BACKUP=off");
  });

  it("komplet dla zakresu: ticki biegną", () => {
    const run = execute(configCheck, community);
    expect(run.status).toBe(0);
    expect(run.output).toContain("configured=true");
  });

  it("audyt dobowy: brak konfiguracji bez decyzji = czerwony przebieg z pełną listą braków", () => {
    const run = execute(audit, {
      BASE_URL: "",
      HAS_COMMUNITY_SECRET: "false",
      HAS_BILLING_SECRET: "false",
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(
      /::error title=Druga linia doręczeń nie istnieje::Brak: variables\.APP_BASE_URL secrets\.COMMUNITY_CRON_SECRET secrets\.BILLING_CRON_SECRET\./,
    );
    expect(run.summary).toContain("NIESKONFIGUROWANA");
  });

  it("audyt dobowy: sprawdza KOMPLET - sam brak sekretu rozliczeń też jest czerwony", () => {
    const run = execute(audit, {
      BASE_URL: "https://example.test",
      HAS_COMMUNITY_SECRET: "true",
      HAS_BILLING_SECRET: "false",
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("Brak: secrets.BILLING_CRON_SECRET.");
    expect(run.stdout).not.toContain("COMMUNITY_CRON_SECRET");
  });

  it("audyt dobowy: jawne wyłączenie to adnotacja, nie błąd; komplet to zieleń", () => {
    const off = execute(audit, {
      BACKUP_MODE: "off",
      BASE_URL: "",
      HAS_COMMUNITY_SECRET: "false",
      HAS_BILLING_SECRET: "false",
    });
    expect(off.status).toBe(0);
    expect(off.stdout).toContain("::notice title=Druga linia doręczeń wyłączona::");
    expect(off.summary).toContain("wyłączona decyzją");

    const ok = execute(audit, community);
    expect(ok.status).toBe(0);
    expect(ok.stdout).not.toContain("::error");
    expect(ok.summary).toContain("skonfigurowana");
  });

  it("audyt widzi wyłącznie obecność sekretów, nie ich wartości", () => {
    const step = stepLines(workflow, "Audyt drugiej linii doręczeń").join("\n");
    // Każde odwołanie do `secrets` w `${{ }}` (kropka w dowolnej pisowni,
    // `secrets['X']`, `toJSON(secrets)`) poza kontrolą obecności `!= ''`.
    const values = [...step.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].filter(([, expression]) =>
      [...expression!.matchAll(/\bsecrets\b(?:\s*\.\s*[A-Z0-9_]+\b(\s*!=\s*'')?)?/gi)].some(
        ([, presence]) => presence === undefined,
      ),
    );
    expect(values).toEqual([]);
    expect(step).toContain("HAS_COMMUNITY_SECRET: ${{ secrets.COMMUNITY_CRON_SECRET != '' }}");
    expect(step).toContain("HAS_BILLING_SECRET: ${{ secrets.BILLING_CRON_SECRET != '' }}");
  });
});

// KONTRAKT ENV SKRYPTÓW (następca usuniętej w c3f0c0e72 bramki
// `check:workflow-env-contract`, zawężony do workflow operacyjnych). Incydent
// z nagłówka billing-nightly.yml: workflow eksportował PADDLE_SANDBOX_API_KEY,
// a sonda czytała STRIPE_SANDBOX_API_KEY - 40 minut snu i zielony przebieg.
describe.each([
  { workflow: "scheduler.yml", jobEnv: false },
  { workflow: "billing-nightly.yml", jobEnv: true },
])(
  "$workflow - każda zmienna env kroku ma odbiorcę w uruchamianym skrypcie",
  ({ workflow, jobEnv }) => {
    const source = readFileSync(`.github/workflows/${workflow}`, "utf8");
    const lines = source.split("\n");
    const envKeys = (block: readonly string[]): string[] => {
      const at = block.findIndex((line) => line.trim() === "env:");
      if (at < 0) return [];
      const base = indentOf(block[at]!);
      const keys: string[] = [];
      for (const line of block.slice(at + 1)) {
        if (line.trim() === "" || line.trim().startsWith("#")) continue;
        if (indentOf(line) <= base) break;
        const key = /^\s*([A-Z][A-Z0-9_]*):/.exec(line)?.[1];
        if (key && indentOf(line) === base + 2) keys.push(key);
      }
      return keys;
    };
    // Env joba: blok `env:` na poziomie `steps:` (przed listą kroków).
    const stepsAt = lines.findIndex((line) => line.trim() === "steps:");
    const jobKeys = jobEnv
      ? envKeys(
          lines.slice(0, stepsAt).filter((line) => indentOf(line) >= indentOf(lines[stepsAt]!)),
        )
      : [];
    const scriptSteps = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => /^\s+- name: /.test(line))
      .map(({ line }) => stepLines(source, line.trim().slice("- name: ".length)))
      .map((block) => ({
        block,
        script: /^\s*run: (?:bun|node) (scripts\/[\w./-]+\.(?:ts|mjs))\b/m.exec(
          block.join("\n"),
        )?.[1],
      }))
      .filter((step): step is { block: string[]; script: string } => step.script !== undefined);

    it("workflow uruchamia skrypty z repo", () => {
      expect(scriptSteps.length).toBeGreaterThan(0);
    });

    it.each(scriptSteps.map((step) => [step.block[0]!.trim(), step] as const))(
      "%s",
      (_name, step) => {
        const code = readFileSync(step.script, "utf8");
        const read = new Set(
          [...code.matchAll(/\benv\.([A-Z][A-Z0-9_]*)\b/g)].map((match) => match[1]!),
        );
        for (const key of [...jobKeys, ...envKeys(step.block)]) {
          expect(read, `${step.script} nie czyta ${key}`).toContain(key);
        }
      },
    );

    if (workflow === "billing-nightly.yml") {
      it("sekrety, których sonda WYMAGA (keys, dbKeys), są eksportowane krokom, które ich używają", () => {
        const probe = readFileSync("scripts/billing-renewal-probe.ts", "utf8");
        const required = (fn: string): string[] => {
          const body =
            new RegExp(`function ${fn}\\(\\)[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(probe)?.[1] ?? "";
          return [...body.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]!);
        };
        const operator = required("keys");
        const database = required("dbKeys");
        expect(operator).toEqual(["STRIPE_SANDBOX_API_KEY", "LOVABLE_API_KEY"]);
        expect(database).toEqual([
          "PROBE_SUPABASE_URL",
          "PROBE_SUPABASE_PUBLISHABLE_KEY",
          "BILLING_PROBE_TOKEN",
        ]);
        for (const step of scriptSteps) {
          const exported = new Set(envKeys(step.block));
          for (const key of operator) expect(exported, step.block[0]).toContain(key);
          if (step.block.join("\n").includes("billing-renewal-probe.ts verify")) {
            for (const key of database) expect(exported).toContain(key);
          }
        }
      });
    }
  },
);

describe("billing-nightly.yml - kontrola wstępna wypisuje komplet brakujących sekretów", () => {
  const workflow = readFileSync(".github/workflows/billing-nightly.yml", "utf8");
  const preflight = runScript(workflow, "Sprawdź konfigurację sondy");
  const ALL = [
    "STRIPE_SANDBOX_API_KEY",
    "LOVABLE_API_KEY",
    "PROBE_SUPABASE_URL",
    "PROBE_SUPABASE_PUBLISHABLE_KEY",
    "BILLING_PROBE_TOKEN",
  ] as const;
  const present = (names: readonly string[]): Record<string, string> =>
    Object.fromEntries(ALL.map((name) => [`HAS_${name}`, String(names.includes(name))]));

  it("przebieg z harmonogramu bez sekretów: jeden błąd z PIĘCIOMA nazwami", () => {
    const run = execute(preflight, { PROBE_REQUIRE_CONFIG: "true", ...present([]) });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain(
      `::error title=Sonda rozliczeń nieskonfigurowana::Brak sekretów repozytorium: ${ALL.join(" ")}.`,
    );
    expect(run.stdout).toContain("vars.BILLING_PROBE_DISABLED=1");
  });

  it("dwa klucze operatora dodane: błąd od razu wskazuje trzy sekrety kroku weryfikacji", () => {
    const run = execute(preflight, {
      PROBE_REQUIRE_CONFIG: "true",
      ...present(["STRIPE_SANDBOX_API_KEY", "LOVABLE_API_KEY"]),
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain(
      "Brak sekretów repozytorium: PROBE_SUPABASE_URL PROBE_SUPABASE_PUBLISHABLE_KEY BILLING_PROBE_TOKEN.",
    );
  });

  it("komplet: zielono; przebieg ręczny bez sekretów: ostrzeżenie, nie błąd", () => {
    const complete = execute(preflight, { PROBE_REQUIRE_CONFIG: "true", ...present(ALL) });
    expect(complete.status).toBe(0);
    expect(complete.summary).toContain("konfiguracja kompletna");

    const manual = execute(preflight, { PROBE_REQUIRE_CONFIG: "false", ...present([]) });
    expect(manual.status).toBe(0);
    expect(manual.stdout).toContain("::warning title=Sonda rozliczeń nieskonfigurowana::");
  });
});
