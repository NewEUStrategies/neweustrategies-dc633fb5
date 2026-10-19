/**
 * Strażnik wycinka huba „Przychód i lejek" - uruchamiany przed KAŻDYM pushem
 * gałęzi wycinka (SPEC §8.1).
 *
 * Po co: osiem wycinków (S1-S8) pracuje równolegle, a ich zbiory plików mają
 * być parami rozłączne. Kolizja (dwa wycinki w jednym pliku, plik współdzielony
 * zmieniony poza I0/I9, migracja z wersją z cudzego bloku) nie wychodzi
 * w żadnym teście pojedynczej gałęzi - dopiero przy scaleniu, gdzie ręczne
 * rozwiązanie konfliktu gubi czyjś wpis, a migracja z późniejszą WERSJĄ po
 * cichu nadpisuje funkcję innego wycinka na produkcji.
 *
 * Diff wycinka = zmiany od punktu rozgałęzienia z bazą
 * (`git diff <merge-base>..HEAD`) + wszystko niezatwierdzone (indeks, drzewo
 * robocze, nowe pliki). Niezatwierdzone liczą się, bo strażnik ma złapać błąd
 * PRZED commitem, a nie dopiero w CI.
 *
 * Cienki runner: manifesty, pliki współdzielone, bloki wersji i analiza
 * migracji żyją w `src/lib/ci/hubDelivery.ts` (test:
 * `src/lib/ci/__tests__/hubDelivery.gate.test.ts`), więc reguły mają test
 * jednostkowy, a nie tylko przebieg skryptu. Typy wyłącznie `node`
 * (`tsconfig.scripts.json`) - bez `Bun.*`.
 *
 * Usage: bun run scripts/hub-slice-guard.ts <I0|S1..S8|I9> [--base <ref>]
 *   --base  gałąź, do której wycinek się scala; domyślnie pierwsza istniejąca
 *           z: hub/integration, origin/hub/integration, origin/main, main.
 * Kod wyjścia: 0 - zielono; 1 - plik spoza manifestu, plik współdzielony
 * w wycinku S, migracja poza blokiem albo naruszenie bramki dostawy;
 * 2 - błędne wywołanie albo błąd gita.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  HUB_SLICE_IDS,
  analyzeHubDelivery,
  checkSliceDiff,
  hubDeliveryFailed,
  renderHubDeliveryReport,
  renderSliceDiff,
  sliceDiffFailed,
  type HubDeliveryReport,
  type HubMigrationFile,
  type HubSliceId,
} from "../src/lib/ci/hubDelivery";

// Wycinki S scalają się do `hub/integration` (baza = main + cennik + I0).
// Fallback na `main` jest bezpieczny w złą stronę: bez I0 w bazie pliki I0
// wypadają poza manifest wycinka - czerwień, a nie fałszywa zieleń.
const DEFAULT_BASES = ["hub/integration", "origin/hub/integration", "origin/main", "main"];
const MIGRATIONS_DIR = "supabase/migrations";
const MIGRATION_PATH = /^supabase\/migrations\/([^/]+\.sql)$/;

class UsageError extends Error {}

interface GuardArgs {
  readonly slice: HubSliceId;
  readonly base: string | null;
}

function isSliceId(raw: string): raw is HubSliceId {
  return (HUB_SLICE_IDS as readonly string[]).includes(raw);
}

function parseArgs(argv: readonly string[]): GuardArgs {
  let slice: HubSliceId | null = null;
  let base: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new UsageError("--base wymaga ref");
      base = value;
      i += 1;
    } else if (arg.startsWith("--base=")) {
      base = arg.slice("--base=".length);
    } else if (slice === null && isSliceId(arg)) {
      slice = arg;
    } else {
      throw new UsageError(`nieznany argument: ${arg}`);
    }
  }
  if (slice === null) throw new UsageError(`brak wycinka (${HUB_SLICE_IDS.join(", ")})`);
  return { slice, base };
}

function git(root: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function refExists(root: string, ref: string): boolean {
  try {
    git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function resolveBase(root: string, requested: string | null): string {
  if (requested !== null) {
    if (!refExists(root, requested)) throw new UsageError(`ref bazy nie istnieje: ${requested}`);
    return requested;
  }
  const found = DEFAULT_BASES.find((ref) => refExists(root, ref));
  if (found === undefined) throw new UsageError("brak gałęzi bazowej - podaj --base <ref>");
  return found;
}

/**
 * Zmiany zatwierdzone od rozgałęzienia. `--no-renames`: zmiana nazwy pliku
 * to usunięcie starej ścieżki i dodanie nowej - obie muszą należeć do
 * wycinka (przeniesienie pliku współdzielonego też jest jego zmianą).
 */
function committedPaths(root: string, mergeBase: string): string[] {
  const out = git(root, [
    "diff",
    "--name-only",
    "--no-renames",
    "--diff-filter=ACMRD",
    "-z",
    `${mergeBase}..HEAD`,
  ]);
  return out.split("\0").filter((p) => p !== "");
}

/**
 * Zmiany niezatwierdzone (`XY ścieżka`, w formacie `-z` zmiana nazwy niesie
 * jeszcze ścieżkę źródłową w następnym polu). `--untracked-files=all`, bo
 * domyślny tryb pokazuje nowy KATALOG zamiast plików - katalog nie pasuje do
 * żadnego globu manifestu.
 */
function uncommittedPaths(root: string): string[] {
  const fields = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0");
  const paths: string[] = [];
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i];
    if (field.length < 4) continue;
    const xy = field.slice(0, 2);
    paths.push(field.slice(3));
    if (xy.includes("R") || xy.includes("C")) {
      const source = fields[i + 1];
      i += 1;
      // Kopia zostawia źródło nietknięte; zmiana nazwy je usuwa.
      if (xy.includes("R") && source) paths.push(source);
    }
  }
  return paths;
}

/**
 * Analiza dostawy na CAŁYM katalogu migracji (pliki sprzed huba mówią, które
 * funkcje już istniały - redefinicja bez CIALO-Z jest naruszeniem), ale
 * raport zawężony do migracji zmienionych przez wycinek: cudze, już scalone
 * pliki ocenia ich własny strażnik.
 */
function analyzeChangedMigrations(root: string, changed: ReadonlySet<string>): HubDeliveryReport {
  const dir = join(root, MIGRATIONS_DIR);
  const migrations: HubMigrationFile[] = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
  const full = analyzeHubDelivery(migrations, { verifyCialoZRegistry: true });
  const changedFunctions = new Set(
    full.functions.filter((f) => changed.has(f.file)).map((f) => f.name),
  );
  const touchesChange = (file: string, detail: string): boolean =>
    changed.has(file) ||
    [...changed].some((name) => detail.includes(name)) ||
    // Rejestr CIALO-Z jest globalny - liczy się tylko dla funkcji, które
    // wycinek właśnie redefiniuje.
    [...changedFunctions].some((fn) => detail.startsWith(`HUB_CIALO_Z.${fn} `));
  return {
    files: full.files.filter((name) => changed.has(name)),
    functions: full.functions.filter((f) => changed.has(f.file)),
    violations: full.violations.filter((v) => touchesChange(v.file, v.detail)),
  };
}

function main(): number {
  let args: GuardArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`✗ hub-slice-guard: ${(error as Error).message}`);
    console.error("  Użycie: bun run scripts/hub-slice-guard.ts <I0|S1..S8|I9> [--base <ref>]");
    return 2;
  }

  let root: string;
  let base: string;
  let mergeBase: string;
  let paths: string[];
  try {
    root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
    base = resolveBase(root, args.base);
    mergeBase = git(root, ["merge-base", base, "HEAD"]).trim();
    paths = [...new Set([...committedPaths(root, mergeBase), ...uncommittedPaths(root)])].sort();
  } catch (error) {
    const message = error instanceof UsageError ? error.message : String(error);
    console.error(`✗ hub-slice-guard: ${message}`);
    return 2;
  }

  console.log(
    `Wycinek ${args.slice}: baza ${base} (merge-base ${mergeBase.slice(0, 8)}), ${paths.length} zmienionych plików.`,
  );

  const diff = checkSliceDiff(args.slice, paths);
  const changedMigrations = new Set(
    paths
      .map((p) => MIGRATION_PATH.exec(p)?.[1])
      .filter((name): name is string => name !== undefined)
      .filter((name) => existsSync(join(root, MIGRATIONS_DIR, name))),
  );
  const delivery = analyzeChangedMigrations(root, changedMigrations);

  const diffFailed = sliceDiffFailed(diff);
  const deliveryFailed = hubDeliveryFailed(delivery);
  (diffFailed ? console.error : console.log)(renderSliceDiff(diff));
  (deliveryFailed ? console.error : console.log)(renderHubDeliveryReport(delivery));

  if (diffFailed || deliveryFailed) {
    console.error(
      "Plik współdzielony albo spoza manifestu: zgłoś zmianę w sekcji „Do integracji” opisu PR (SPEC §8.1).",
    );
    return 1;
  }
  return 0;
}

process.exit(main());
