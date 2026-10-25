/**
 * Dysk i git dla generatora lustra drizzle - wspólne dla
 * `scripts/migrations-mirror.ts` i `scripts/check-migration-lanes.ts`.
 * Logika siedzi w src/lib/migrations/drizzleMirror*.ts (z testami); tu tylko
 * `node:fs` i `git show` dziennika bazy. Ścieżki względem katalogu repozytorium
 * (skrypty startują z niego przez `bun run`).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DRIZZLE_JOURNAL } from "../../src/lib/ci/migrationSplitPlan";
import type { MirrorBase } from "../../src/lib/migrations/drizzleMirror";
import type { MirrorCliFs } from "../../src/lib/migrations/drizzleMirrorCli";

export const nodeMirrorFs: MirrorCliFs = {
  read: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  write: (path, content) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  },
  remove: (path) => rmSync(path, { force: true }),
  list: (dir) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  },
};

/** Bazy luster lokalnych w kolejności prób, gdy nie podano `--base`. */
export const DEFAULT_BASE_REFS: readonly string[] = ["origin/main", "main"];

function git(args: readonly string[]): string {
  return execFileSync("git", [...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function refExists(ref: string): boolean {
  try {
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Dziennik drizzle z refu bazy (`git show <ref>:drizzle/migrations/meta/_journal.json`).
 * `null` ref = pierwszy istniejący z DEFAULT_BASE_REFS. `null` wynik, gdy żaden
 * ref się nie rozwiązuje (płytki klon CI) albo dziennika nie da się odczytać -
 * CLI przechodzi wtedy na samo dopisywanie z ostrzeżeniem.
 */
export function gitBaseJournal(ref: string | null): MirrorBase | null {
  const found = (ref === null ? DEFAULT_BASE_REFS : [ref]).find(refExists);
  if (found === undefined) return null;
  try {
    const journal: unknown = JSON.parse(git(["show", `${found}:${DRIZZLE_JOURNAL}`]));
    if (typeof journal !== "object" || journal === null || !("entries" in journal)) return null;
    return Array.isArray(journal.entries)
      ? { ref: found, entries: journal.entries as MirrorBase["entries"] }
      : null;
  } catch {
    return null;
  }
}
