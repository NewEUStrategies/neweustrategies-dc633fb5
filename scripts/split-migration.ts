/**
 * Tnie za duza migracje (i jej blizniaka drizzle) na czesci, ktore panel
 * Lovable wdrozy: `supabase/migrations/<wersja>_<nazwa>.sql` zostaje czescia 1,
 * czesci 2..n dostaja kolejne wersje (`<wersja+k-1>_<nazwa>_part<k>.sql`),
 * a pas drizzle - kolejne wolne indeksy dziennika, snapshoty i wpisy
 * MIGRATION_LANES.
 *
 * Cienki runner: lekser, pakowanie i dowod siedza w src/lib/ci/migrationSplit.ts,
 * nazwy i dziennik w src/lib/ci/migrationSplitPlan.ts, argumenty i wypis
 * w src/lib/ci/migrationSplitCli.ts - wszystkie z testami jednostkowymi.
 *
 * Usage:
 *   bun run scripts/split-migration.ts supabase/migrations/<plik>.sql --dry-run
 *   bun run scripts/split-migration.ts supabase/migrations/<plik>.sql [--max-kb 45]
 *     [--drizzle <tag>] [--allow-interleave]
 *   bash scripts/split-migration-proof.sh supabase/migrations/<plik>.sql   # dowod na PostgreSQL
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { MIGRATION_LANES } from "../src/lib/ci/migrationLaneParity";
import { runSplitCli, type CliFs } from "../src/lib/ci/migrationSplitCli";

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function listOrEmpty(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function walk(dir: string): string[] {
  return listOrEmpty(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const fs: CliFs = {
  read: readOrNull,
  write: (path, content) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  },
  list: listOrEmpty,
  walk,
};

process.exit(
  runSplitCli(process.argv.slice(2), {
    fs,
    log: (line) => console.log(line),
    newId: randomUUID,
    lanes: MIGRATION_LANES,
  }),
);
