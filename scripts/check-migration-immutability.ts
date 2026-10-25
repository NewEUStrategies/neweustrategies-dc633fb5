/**
 * Bramka niezmienności migracji: plik `supabase/migrations/*.sql`,
 * `drizzle/migrations/*.sql` albo snapshot drizzle, który istnieje w bazie
 * porównania, nie znika i nie zmienia treści w HEAD, a `_journal.json` rośnie
 * wyłącznie przez dopisanie wpisów na końcu. Wyjątek = wpis
 * MIGRATION_EDIT_ALLOWLIST z SHA bloba po zmianie (np. jedyny wyjątek
 * forward-only: `bun run migrations:mirror --rewrite <tag>` dla wpisu, którego
 * `--verify` nie znajduje w rejestrze produkcji).
 *
 * Baza porównania: `MIGRATION_IMMUTABILITY_BASE` (CI: SHA bazy PR albo
 * `github.event.before` przy pushu na main), a bez niej
 * `git merge-base HEAD origin/main`. Brak commitu bazy w klonie (płytki klon,
 * pierwszy push bez origin/main) = ostrzeżenie i kod 0. Liczą się commity -
 * zmiany niezatwierdzone bramka pomija.
 *
 * Cienki runner: parser diffu, reguły, rejestr, wybór bazy i raport żyją
 * w `src/lib/ci/migrationImmutability.ts` (test:
 * `src/lib/ci/__tests__/migrationImmutability.test.ts`). Git wyłącznie przez
 * tablice argumentów, bez powłoki. Typy wyłącznie `node`
 * (`tsconfig.scripts.json`) - bez `Bun.*`.
 *
 * Usage: bun run check:migration-immutability
 *        MIGRATION_IMMUTABILITY_BASE=<sha|ref> bun run check:migration-immutability
 * Kod wyjścia: 0 - zielono albo baza niedostępna (ostrzeżenie); 1 - usunięty
 * albo zmieniony plik migracji, wpis dziennika poza dopisaniem albo błędny
 * wpis rejestru; 2 - błąd gita.
 */
import { execFileSync } from "node:child_process";
import {
  IMMUTABILITY_BASE_ENV,
  IMMUTABILITY_FALLBACK_REF,
  analyzeMigrationImmutability,
  immutabilityFailed,
  parseRawDiff,
  renderImmutabilityReport,
  renderImmutabilitySkipped,
  resolveImmutabilityBase,
} from "../src/lib/ci/migrationImmutability";
import { DRIZZLE_DIR, SUPABASE_DIR } from "../src/lib/ci/migrationLaneParity";

function git(root: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Wynik polecenia gita albo `null`, gdy git zwrócił błąd (brak refa, płytki klon). */
function gitOrNull(root: string, args: readonly string[]): string | null {
  try {
    return git(root, args).trim();
  } catch {
    return null;
  }
}

/**
 * Adnotacja workflow - wyłącznie na stdout (wpisana do podsumowania
 * renderuje się jako surowy tekst), żeby pominięta bramka była widoczna w PR.
 */
function annotateWarning(message: string): void {
  if (process.env.GITHUB_ACTIONS !== "true") return;
  const clean = message.replaceAll("\n", " ").replaceAll("::", ":");
  console.log(`::warning title=Niezmienność migracji pominięta::${clean}`);
}

function main(): number {
  try {
    const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
    const head = git(root, ["rev-parse", "HEAD"]).trim();
    const base = resolveImmutabilityBase(process.env[IMMUTABILITY_BASE_ENV], {
      resolveCommit: (ref) =>
        gitOrNull(root, [
          "rev-parse",
          "--verify",
          "--quiet",
          "--end-of-options",
          `${ref}^{commit}`,
        ]),
      mergeBaseWithMain: () => gitOrNull(root, ["merge-base", "HEAD", IMMUTABILITY_FALLBACK_REF]),
    });
    if (base.kind === "unavailable") {
      console.warn(renderImmutabilitySkipped(base.reason));
      annotateWarning(base.reason);
      return 0;
    }
    const raw = git(root, [
      "diff",
      "--raw",
      "-z",
      "--no-renames",
      "--no-abbrev",
      base.sha,
      head,
      "--",
      SUPABASE_DIR,
      DRIZZLE_DIR,
    ]);
    const report = analyzeMigrationImmutability(parseRawDiff(raw), (sha) =>
      git(root, ["cat-file", "blob", sha]),
    );
    const text = renderImmutabilityReport(report, { base: base.sha, source: base.source, head });
    if (immutabilityFailed(report)) {
      console.error(text);
      return 1;
    }
    console.log(text);
    return 0;
  } catch (error) {
    console.error(`✗ check-migration-immutability: ${(error as Error).message}`);
    return 2;
  }
}

process.exit(main());
