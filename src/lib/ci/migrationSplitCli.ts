// Wykonawca `scripts/split-migration.ts`: argumenty, odczyt plikow, zapis planu.
// Dysk, zegar identyfikatorow i wyjscie sa WSTRZYKIWANE, wiec cala sciezka CLI
// ma test jednostkowy na pamieciowym systemie plikow - skrypt w scripts/ tylko
// podpina `node:fs` i `crypto.randomUUID`.
import type { DeployedMigrations } from "./migrationDeployed";
import type { LaneEntry } from "./migrationLaneParity";
import { MigrationLexError, MigrationSplitError } from "./migrationSplit";
import {
  DRIZZLE_JOURNAL,
  DRIZZLE_MIGRATIONS_DIR,
  LANE_REGISTRY,
  SUPABASE_MIGRATIONS_DIR,
  planMigrationSplit,
  type DrizzleJournal,
  type DrizzleSnapshot,
  type DrizzleTwinInput,
  type SplitPlan,
} from "./migrationSplitPlan";

export const SPLIT_USAGE = [
  "Uzycie: bun run scripts/split-migration.ts <supabase/migrations/PLIK.sql> [opcje]",
  "  --dry-run            pokaz plan, nic nie zapisuj",
  "  --max-kb <n>         limit czesci w KiB (domyslnie 45)",
  "  --drizzle <tag>      blizniak drizzle, gdy rejestr wskazuje kilka",
  "  --allow-interleave   zgoda na czesci drizzle za pozniejszymi wpisami dziennika",
].join("\n");

export interface SplitArgs {
  readonly file: string;
  readonly dryRun: boolean;
  readonly allowInterleave: boolean;
  readonly maxBytes?: number;
  readonly drizzleTag?: string;
}

export function parseSplitArgs(argv: readonly string[]): SplitArgs | { readonly error: string } {
  const files: string[] = [];
  let dryRun = false;
  let allowInterleave = false;
  let maxBytes: number | undefined;
  let drizzleTag: string | undefined;
  for (let k = 0; k < argv.length; k += 1) {
    const arg = argv[k]!;
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--allow-interleave") allowInterleave = true;
    else if (arg === "--max-kb") {
      const kb = Number(argv[(k += 1)]);
      if (!Number.isFinite(kb) || kb <= 0) return { error: "--max-kb wymaga liczby > 0." };
      maxBytes = Math.floor(kb * 1024);
    } else if (arg === "--drizzle") {
      const tag = argv[(k += 1)];
      if (tag === undefined || tag.startsWith("--")) return { error: "--drizzle wymaga tagu." };
      drizzleTag = tag.replace(/\.sql$/, "").replace(/^.*\//, "");
    } else if (arg.startsWith("--")) return { error: `Nieznana opcja ${arg}.` };
    else files.push(arg);
  }
  if (files.length !== 1) return { error: "Podaj dokladnie jeden plik migracji supabase." };
  return { file: files[0]!.replace(/^.*\//, ""), dryRun, allowInterleave, maxBytes, drizzleTag };
}

/** Dysk widziany przez CLI - sciezki wzgledem katalogu repozytorium. */
export interface CliFs {
  readonly read: (path: string) => string | null;
  readonly write: (path: string, content: string) => void;
  /** Nazwy plikow katalogu (bez rekurencji); pusty, gdy katalogu nie ma. */
  readonly list: (dir: string) => string[];
  /** Sciezki wszystkich plikow pod katalogiem (rekurencyjnie, wzgledem repo). */
  readonly walk: (dir: string) => string[];
}

export interface CliDeps {
  readonly fs: CliFs;
  readonly log: (line: string) => void;
  readonly newId: () => string;
  readonly lanes: readonly LaneEntry[];
  /** Co jest juz na produkcji (`DEPLOYED_MIGRATIONS`) - wdrozonej migracji plan nie tnie. */
  readonly deployed: DeployedMigrations;
}

/** Katalogi i rozszerzenia plikow, ktore moga czytac migracje po nazwie. */
const REFERENCE_ROOTS = ["src", "scripts", "supabase/tests"];
const REFERENCE_EXT = /\.(?:ts|tsx|mjs|sh|sql)$/;
/**
 * Pliki samego narzedzia (rejestr pasow, bramka rozmiaru, lista wdrozonych,
 * splitter i ich testy): wymieniaja migracje w opisach i przykladach, a nie
 * czytaja ich po nazwie - ostrzezenie o nich tylko zagluszalo prawdziwe.
 */
const TOOL_FILES =
  /^src\/lib\/ci\/(?:__tests__\/)?migration(?:LaneParity|Size|Split|Deployed)[\w.]*\.ts$/;

/**
 * Bramki, ktore po zapisie podzialu zapalaja sie, dopoki ich nie uruchomisz
 * (albo nie przegenerujesz ich wyniku) - zmierzone na pocieciu migracji
 * funkcji organizatora. Kolejnosc = kolejnosc wykonania.
 */
export const SPLIT_NEXT_STEPS: readonly string[] = [
  "bun run generate:authz-snapshot  (snapshot liczy pliki migracji; inaczej check:authz-snapshot i authzSnapshotParity.test sa czerwone)",
  "bunx vitest run src/lib/ci/__tests__/migrationLaneParity.test.ts src/lib/ci/__tests__/migrationSize.gate.test.ts",
  "bun run check:sql-migration-replay && bun run check:rpc-contract && bun run check:sql-tenant-scope && bun run check:ownership",
  "testy z ostrzezen UWAGA wyzej (czytaja migracje po nazwie): przejdz na readLogicalMigration() z src/lib/ci/migrationSize.ts dla OBU pasow",
  "harnessy, ktore wybieraja te migracje (np. bash scripts/events-harness/run.sh) - pelny przebieg, nie --only",
];

function readJson<T>(fs: CliFs, path: string): T {
  const raw = fs.read(path);
  if (raw === null) throw new MigrationSplitError(`Brak pliku ${path}.`);
  return JSON.parse(raw) as T;
}

function drizzleTwin(args: SplitArgs, deps: CliDeps): DrizzleTwinInput | undefined {
  const candidates =
    args.drizzleTag !== undefined
      ? [args.drizzleTag]
      : deps.lanes.filter((e) => "twin" in e && e.twin === args.file).map((e) => e.tag);
  if (candidates.length === 0) return undefined;
  if (candidates.length > 1) {
    throw new MigrationSplitError(
      `Kilka plikow drizzle wskazuje ${args.file} jako blizniaka (${candidates.join(", ")}) - wybierz jeden: --drizzle <tag>.`,
    );
  }
  const tag = candidates[0]!;
  const sql = deps.fs.read(`${DRIZZLE_MIGRATIONS_DIR}/${tag}.sql`);
  if (sql === null)
    throw new MigrationSplitError(`Brak pliku ${DRIZZLE_MIGRATIONS_DIR}/${tag}.sql.`);
  const journal = readJson<DrizzleJournal>(deps.fs, DRIZZLE_JOURNAL);
  const last = Math.max(...journal.entries.map((e) => e.idx));
  // Snapshot jest potrzebny tylko blizniakowi z dziennika - plan sam odmowi,
  // gdy go wtedy zabraknie.
  const raw = deps.fs.read(
    `${DRIZZLE_MIGRATIONS_DIR}/meta/${String(last).padStart(4, "0")}_snapshot.json`,
  );
  const lastSnapshot = raw === null ? undefined : (JSON.parse(raw) as DrizzleSnapshot);
  return { tag, sql, journal, lastSnapshot };
}

/** Istniejace pliki obu pasow i snapshotow - plan nie nadpisze zadnego z nich. */
function existingPaths(fs: CliFs): string[] {
  return [
    SUPABASE_MIGRATIONS_DIR,
    DRIZZLE_MIGRATIONS_DIR,
    `${DRIZZLE_MIGRATIONS_DIR}/meta`,
  ].flatMap((dir) => fs.list(dir).map((name) => `${dir}/${name}`));
}

/** Uruchamia podzial; zwraca kod wyjscia (0 - ok, 1 - odmowa planu, 2 - bledne uzycie). */
export function runSplitCli(argv: readonly string[], deps: CliDeps): number {
  const args = parseSplitArgs(argv);
  if ("error" in args) {
    deps.log(args.error);
    deps.log(SPLIT_USAGE);
    return 2;
  }
  const path = `${SUPABASE_MIGRATIONS_DIR}/${args.file}`;
  const sql = deps.fs.read(path);
  if (sql === null) {
    deps.log(`Brak pliku ${path}.`);
    return 2;
  }

  let plan: SplitPlan;
  try {
    const references = REFERENCE_ROOTS.flatMap((root) => deps.fs.walk(root))
      .filter((p) => REFERENCE_EXT.test(p) && p !== LANE_REGISTRY && !TOOL_FILES.test(p))
      .map((p) => ({ path: p, content: deps.fs.read(p) ?? "" }));
    plan = planMigrationSplit({
      supabaseFile: args.file,
      supabaseSql: sql,
      deployed: deps.deployed,
      supabaseFiles: deps.fs.list(SUPABASE_MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")),
      drizzle: drizzleTwin(args, deps),
      maxBytes: args.maxBytes,
      newId: deps.newId,
      registrySource: deps.fs.read(LANE_REGISTRY) ?? undefined,
      references,
      allowInterleave: args.allowInterleave,
      existingPaths: existingPaths(deps.fs),
    });
  } catch (error) {
    if (error instanceof MigrationSplitError || error instanceof MigrationLexError) {
      deps.log(`ODMOWA: ${error.message}`);
      return 1;
    }
    throw error;
  }

  deps.log(`${path}: ${plan.parts} czesci.`);
  for (const size of plan.sizes) deps.log(`  ${size.path} (${size.bytes} B)`);
  for (const warning of plan.warnings) deps.log(`UWAGA: ${warning}`);
  if (plan.laneEntries.length > 0) {
    deps.log(
      plan.registryEdited
        ? `Wpisy MIGRATION_LANES dopisane w ${LANE_REGISTRY}:`
        : `Wpisy MIGRATION_LANES do dopisania RECZNIE w ${LANE_REGISTRY}:`,
    );
    for (const e of plan.laneEntries) deps.log(`  { tag: "${e.tag}", twin: "${e.twin}" },`);
  }
  if (plan.writes.length === 0) return 0;
  if (args.dryRun) {
    deps.log(`--dry-run: nic nie zapisano (${plan.writes.length} plikow w planie).`);
    return 0;
  }
  for (const write of plan.writes) deps.fs.write(write.path, write.content);
  deps.log(`Zapisano ${plan.writes.length} plikow. Dalej, po kolei:`);
  SPLIT_NEXT_STEPS.forEach((step, k) => deps.log(`  ${k + 1}. ${step}`));
  deps.log(
    `Dowod na PostgreSQL (oryginal z HEAD vs czesci): bash scripts/split-migration-proof.sh ${path}`,
  );
  return 0;
}
