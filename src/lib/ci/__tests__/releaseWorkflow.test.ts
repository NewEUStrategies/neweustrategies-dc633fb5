// @vitest-environment node
//
// WYDANIE W .github/workflows/ci.yml - niezmienniki, które audyt wydania
// 2026-10 znalazł złamane:
//   1. Produkcja działała na commicie, którego jedyny przebieg CI był czerwony,
//      a opublikowane commity pośrednie nie miały ŻADNEGO przebiegu: wspólna
//      grupa concurrency anulowała przebiegi main pod serią pushy Lovable.
//      Każdy commit main ma dostać własny, dokończony przebieg.
//   2. `post-deploy` był zielony, choć niczego nie sprawdził (brak poświadczeń
//      = ostrzeżenie + success) i jechał także po czerwonym
//      `Required release checks`.
//   3. Budżet bundla jechał tylko na main, więc PR #535 przeszedł zielony,
//      a czerwony był dopiero commit scalenia.
//
// YAML czytamy wcięciami, bez zależności (jak billingWorkflowSecrets.test.ts):
// test ma się zapalić przy zmianie semantyki, nie formatowania.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CI = readFileSync(".github/workflows/ci.yml", "utf8").split(/\r?\n/);

const indentOf = (line: string): number => line.length - line.trimStart().length;
const isContent = (line: string): boolean => line.trim() !== "" && !line.trim().startsWith("#");

/** Linie bloku `key:` na danym wcięciu (bez komentarzy), do następnego klucza tego poziomu. */
function block(lines: readonly string[], key: string, indent: number): string[] {
  const start = lines.findIndex((l) => indentOf(l) === indent && l.trim() === `${key}:`);
  if (start < 0) throw new Error(`test: brak bloku ${key}:`);
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (isContent(line) && indentOf(line) <= indent) break;
    if (isContent(line)) out.push(line);
  }
  return out;
}

const jobs = block(CI, "jobs", 0);
const jobIds = jobs
  .filter((l) => indentOf(l) === 2)
  .map((l) => /^\s*([A-Za-z0-9_-]+):\s*$/.exec(l)?.[1])
  .filter((id): id is string => id !== undefined);
const job = (id: string): string[] => block(jobs, id, 2);
/** Wartość klucza joba (`if`, `needs`, `name`) - pierwsza linia na wcięciu 4. */
const jobKey = (id: string, key: string): string | undefined =>
  job(id)
    .find((l) => indentOf(l) === 4 && l.trimStart().startsWith(`${key}:`))
    ?.trimStart()
    .slice(key.length + 1)
    .trim();
/** Kroki joba jako bloki tekstu (od `- ` do następnego `- `). */
function steps(id: string): string[] {
  const lines = job(id);
  const out: string[] = [];
  for (const line of lines) {
    if (indentOf(line) === 6 && line.trimStart().startsWith("- ")) out.push(line.trim());
    else if (indentOf(line) > 6 && out.length > 0) out[out.length - 1] += `\n${line.trim()}`;
  }
  return out;
}
const step = (id: string, name: string): string => {
  const found = steps(id).find((s) => s.includes(`name: ${name}`));
  if (!found) throw new Error(`test: brak kroku „${name}” w jobie ${id}`);
  return found;
};

describe("concurrency: każdy commit main ma własny, dokończony przebieg", () => {
  const concurrency = block(CI, "concurrency", 0).map((l) => l.trim());

  it("main: grupa = SHA i bez anulowania; inne gałęzie: grupa = ref z anulowaniem", () => {
    expect(concurrency).toEqual([
      "group: ci-${{ github.ref == 'refs/heads/main' && github.sha || github.ref }}",
      "cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}",
    ]);
  });

  it("żaden job nie nadpisuje concurrency workflowu", () => {
    for (const id of jobIds)
      expect(
        job(id).some((l) => indentOf(l) === 4 && l.trim().startsWith("concurrency")),
        id,
      ).toBe(false);
  });
});

describe("Required release checks obejmuje każdy job weryfikujący", () => {
  it("bramka zależy od wszystkich jobów poza sobą i post-deploy", () => {
    expect(jobKey("release-gate", "name")).toBe("Required release checks");
    const needs = /^\[(.*)\]$/.exec(jobKey("release-gate", "needs") ?? "")?.[1]?.split(/,\s*/);
    expect(new Set(needs)).toEqual(
      new Set(jobIds.filter((id) => id !== "release-gate" && id !== "post-deploy")),
    );
  });

  it("bramka jest czerwona przy każdym wyniku innym niż success (także skipped i cancelled)", () => {
    expect(step("release-gate", "Require successful checks")).toContain('check.result!=="success"');
  });

  it("budżety bundla i czystość ścieżki startowej jadą także na PR-ach", () => {
    for (const name of [
      "Bundle size budget",
      "Client boot path free of payment SDKs",
      "Server request graph free of eager server-only SDKs",
    ]) {
      const body = step("build", name);
      expect(body, name).not.toContain("event_name != 'pull_request'");
      expect(body, name).toContain("steps.build.outcome == 'success'");
    }
  });
});

describe("post-deploy: zielony tylko wtedy, gdy naprawdę sprawdził produkcyjną bazę", () => {
  it("jedzie wyłącznie po zielonej bramce: needs release-gate, `if` bez funkcji statusu", () => {
    expect(jobKey("post-deploy", "needs")).toBe("[release-gate]");
    const condition = jobKey("post-deploy", "if") ?? "";
    // Funkcja statusu w `if` (always(), !cancelled(), failure()) wyłączyłaby
    // domyślne success() i job jechałby po czerwonej bramce.
    expect(condition).not.toMatch(/\b(?:always|cancelled|failure|success)\(\)/);
    expect(condition).toContain("github.ref == 'refs/heads/main'");
  });

  it("brak poświadczeń = czerwony job z błędem, nie ostrzeżenie i pominięte kroki", () => {
    const creds = step("post-deploy", "Require Supabase credentials");
    expect(creds).toContain("::error");
    expect(creds).toContain("exit 1");
    expect(creds).not.toContain("::warning");
    expect(job("post-deploy").join("\n")).not.toMatch(/steps\.creds\.outputs|ready=/);
  });

  it("obie kontrole bazy są krokami joba i czytają ZMIENNE repozytorium", () => {
    expect(step("post-deploy", "Database contract (tables / views / RPC / columns)")).toContain(
      "bun run check:db-contract",
    );
    expect(step("post-deploy", "Migration ledger (branch migrations actually applied)")).toContain(
      "bun run check:migration-ledger",
    );
    const env = block(job("post-deploy"), "env", 4).join("\n");
    expect(env).toContain("vars.SUPABASE_URL");
    expect(env).toContain("vars.SUPABASE_PUBLISHABLE_KEY");
  });
});
