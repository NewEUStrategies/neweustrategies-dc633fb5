// Wykonawca `bun run migrations:mirror`: argumenty, odczyt repozytorium, zapis
// planu. Dysk, git (dziennik bazy) i zegar są WSTRZYKIWANE, więc cała ścieżka
// CLI ma test jednostkowy na pamięciowym systemie plików - skrypt w scripts/
// tylko podpina `node:fs`, `git show` i `Date.now` (scripts/lib/drizzleMirrorDisk.ts).
import {
  DRIZZLE_JOURNAL,
  DRIZZLE_MIGRATIONS_DIR,
  SUPABASE_MIGRATIONS_DIR,
} from "../ci/migrationSplitPlan";
import {
  DRIZZLE_META_DIR,
  JOURNAL_CONFLICT_FIX,
  MIRROR_NEXT_STEPS,
  mirrorFresh,
  planMirror,
  renderMirrorPlan,
  type MirrorBase,
  type MirrorInput,
  type MirrorMode,
} from "./drizzleMirror";

export const MIRROR_USAGE = [
  "Użycie: bun run migrations:mirror [--check | --dry-run] [--base <ref> | --no-base] [--rewrite <tag>]...",
  "  (domyślnie)      zapis: dopisuje do dziennika drizzle lustra nowych migracji supabase",
  "  --check          CI: kod 1, gdy zapis cokolwiek by zmienił albo plan ma błędy (bez bazy, chyba że --base)",
  "  --dry-run        pokaż plan, nic nie zapisuj",
  "  --base <ref>     dziennik bazy dla luster lokalnych gałęzi (domyślnie origin/main, potem main)",
  "  --no-base        bez bazy: tylko dopisywanie",
  "  --rewrite <tag>  przepisz lustro z bazy z bieżącego źródła (idx, when i snapshot bez zmian) -",
  "                   WYŁĄCZNIE wpis, którego produkcja nie zapisała (docs/RUNBOOK_MIGRACJE_LOVABLE.md §6.3)",
].join("\n");

export interface MirrorArgs {
  readonly mode: MirrorMode;
  /** Ref bazy: `null` - domyślny (origin/main, potem main), `false` - `--no-base`. */
  readonly base: string | null | false;
  readonly rewrite: readonly string[];
}

const REWRITE_TAG_RE = /^\d{4,}_[a-z0-9_]+$/;

/** Wartość opcji (następny argument); `null`, gdy jej nie ma albo jest kolejną opcją. */
function optionValue(argv: readonly string[], at: number): string | null {
  const value = argv[at];
  return value === undefined || value.startsWith("--") ? null : value;
}

export function parseMirrorArgs(argv: readonly string[]): MirrorArgs | { readonly error: string } {
  let mode: MirrorMode = "write";
  let base: string | null | false = null;
  let baseGiven = false;
  const rewrite: string[] = [];
  for (let k = 0; k < argv.length; k += 1) {
    const arg = argv[k]!;
    if (arg === "--check" || arg === "--dry-run") {
      if (mode !== "write") return { error: "--check i --dry-run wykluczają się." };
      mode = arg === "--check" ? "check" : "dry-run";
    } else if (arg === "--base" || arg === "--no-base") {
      if (baseGiven) return { error: "Bazę podaj raz: --base <ref> albo --no-base." };
      baseGiven = true;
      if (arg === "--no-base") base = false;
      else {
        base = optionValue(argv, (k += 1));
        if (base === null) return { error: "--base wymaga refu gita (np. origin/main)." };
      }
    } else if (arg === "--rewrite") {
      const raw = optionValue(argv, (k += 1));
      if (raw === null) return { error: "--rewrite wymaga tagu wpisu dziennika." };
      const tag = raw.replace(/^.*\//, "").replace(/\.sql$/, "");
      if (!REWRITE_TAG_RE.test(tag))
        return { error: `--rewrite ${raw}: tag spoza konwencji <idx>_<nazwa>.` };
      rewrite.push(tag);
    } else {
      return {
        error: arg.startsWith("--") ? `Nieznana opcja ${arg}.` : `Nieoczekiwany argument ${arg}.`,
      };
    }
  }
  if (mode === "check" && rewrite.length > 0)
    return {
      error: "--rewrite nie łączy się z --check (CI sprawdza lustro, niczego nie przepisuje).",
    };
  return { mode, base, rewrite };
}

/** Dysk widziany przez CLI - ścieżki względem katalogu repozytorium. */
export interface MirrorCliFs {
  readonly read: (path: string) => string | null;
  readonly write: (path: string, content: string) => void;
  readonly remove: (path: string) => void;
  /** Nazwy plików katalogu (bez rekurencji); pusta lista, gdy katalogu nie ma. */
  readonly list: (dir: string) => string[];
}

export interface MirrorCliDeps {
  readonly fs: MirrorCliFs;
  readonly log: (line: string) => void;
  readonly now: () => number;
  /** Dziennik bazy z gita (`null` ref = domyślny); `null`, gdy nie da się go odczytać. */
  readonly baseJournal: (ref: string | null) => MirrorBase | null;
}

export type MirrorRepoInput = Omit<MirrorInput, "base" | "now" | "rewrite">;

/** Sparsowany tekst ma kształt dziennika na tyle, żeby plan sprawdził resztę (`dziennik-ksztalt`). */
function parseJournal(raw: string): MirrorInput["journal"] | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  return typeof value === "object" &&
    value !== null &&
    "entries" in value &&
    Array.isArray(value.entries)
    ? (value as MirrorInput["journal"])
    : null;
}

/**
 * Wejście planu z repozytorium. Dziennik ze znacznikami konfliktu albo
 * nieczytelny kończy się błędem z przepisem naprawy (konflikt dwóch gałęzi,
 * które dopisały wpis o tym samym idx).
 */
export function loadMirrorInput(fs: MirrorCliFs): MirrorRepoInput | { readonly error: string } {
  const raw = fs.read(DRIZZLE_JOURNAL);
  if (raw === null) return { error: `Brak ${DRIZZLE_JOURNAL}.` };
  const conflict = /^(?:<<<<<<<|=======|>>>>>>>)/m.test(raw);
  const journal = conflict ? null : parseJournal(raw);
  if (journal === null) {
    return {
      error: [
        `${DRIZZLE_JOURNAL} ${conflict ? "ma znaczniki konfliktu gita" : "nie jest dziennikiem drizzle (JSON z tablicą entries)"}.`,
        "Konflikt dziennika (dwie gałęzie dopisały wpis o tym samym idx) rozwiązuje się tak:",
        `  ${JOURNAL_CONFLICT_FIX}`,
        "  git add drizzle && git commit",
        "Generator usuwa osierocone lustra gałęzi i generuje je od nowa za wpisami main. Dzienników nie łączy się ręcznie ani przez merge=union: podwójny idx albo when mniejsze od main migrator pominie po cichu.",
      ].join("\n"),
    };
  }
  return {
    journal,
    drizzleSql: fs
      .list(DRIZZLE_MIGRATIONS_DIR)
      .filter((name) => name.endsWith(".sql"))
      .sort(),
    // Jak `prepareOutFolder` drizzle-kit: każdy plik meta/ bez `_` to snapshot.
    snapshots: fs
      .list(DRIZZLE_META_DIR)
      .filter((name) => !name.startsWith("_"))
      .sort(),
    supabaseSql: fs
      .list(SUPABASE_MIGRATIONS_DIR)
      .filter((name) => name.endsWith(".sql"))
      .sort(),
    read: fs.read,
  };
}

/**
 * Baza luster lokalnych. `--check` (CI) jej nie używa, chyba że podano
 * `--base`: wynik ma zależeć wyłącznie od drzewa. Zapis i podgląd biorą
 * origin/main (potem main); bez nich zostaje dopisywanie z ostrzeżeniem.
 */
function resolveBase(
  args: MirrorArgs,
  deps: MirrorCliDeps,
): { readonly base: MirrorBase | null } | { readonly error: string } {
  if (args.base === false || (args.mode === "check" && args.base === null)) return { base: null };
  const base = deps.baseJournal(args.base);
  if (base !== null) {
    deps.log(`Baza luster lokalnych: ${base.ref} (wpisy dziennika: ${base.entries.length}).`);
    return { base };
  }
  if (args.base !== null)
    return { error: `Nie da się odczytać ${DRIZZLE_JOURNAL} z ${args.base} (git show).` };
  deps.log(
    "UWAGA: bez bazy (ani origin/main, ani main) - tylko dopisywanie; zmienione źródło lustra lokalnego da błąd zamiast przepisania.",
  );
  return { base: null };
}

/** Uruchamia generator; kod wyjścia: 0 - ok, 1 - plan z błędami albo nieaktualny (`--check`), 2 - złe wywołanie. */
export function runMirrorCli(argv: readonly string[], deps: MirrorCliDeps): number {
  const args = parseMirrorArgs(argv);
  if ("error" in args) {
    deps.log(args.error);
    deps.log(MIRROR_USAGE);
    return 2;
  }
  const input = loadMirrorInput(deps.fs);
  if ("error" in input) {
    deps.log(`✗ ${input.error}`);
    return 1;
  }
  const resolved = resolveBase(args, deps);
  if ("error" in resolved) {
    deps.log(resolved.error);
    return 2;
  }
  const plan = planMirror({
    ...input,
    base: resolved.base,
    now: deps.now(),
    rewrite: new Set(args.rewrite),
  });
  deps.log(renderMirrorPlan(plan, args.mode));
  if (args.mode === "check") return mirrorFresh(plan) ? 0 : 1;
  if (plan.errors.length > 0) return 1;
  if (mirrorFresh(plan)) return 0;
  if (args.mode === "dry-run") {
    deps.log("--dry-run: nic nie zapisano.");
    return 0;
  }
  for (const path of plan.deletions) deps.fs.remove(path);
  for (const file of plan.files) deps.fs.write(file.path, file.content);
  deps.log(
    `Zapisane pliki: ${plan.files.length}, usunięte: ${plan.deletions.length}. Dalej, po kolei:`,
  );
  MIRROR_NEXT_STEPS.forEach((step, k) => deps.log(`  ${k + 1}. ${step}`));
  return 0;
}
