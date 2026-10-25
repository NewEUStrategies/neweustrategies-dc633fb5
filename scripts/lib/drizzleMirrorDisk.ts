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

/** Najdłużej czekamy na `git fetch` bazy (sieć sandboxa bywa zablokowana). */
const FETCH_TIMEOUT_MS = 30_000;

/**
 * `git fetch` domyślnej bazy. Refspec jawnie do `refs/remotes/origin/main`: klon
 * jednej gałęzi (`--single-branch`, `--depth N -b <gałąź>`) nie mapuje `main`,
 * więc samo `git fetch origin main` zapisałoby tylko FETCH_HEAD, a generator
 * czytałby starą lokalną `main`. Wolny transfer HTTP git przerywa sam po 20 s -
 * przed limitem czasu niżej, który zabija wyłącznie proces gita, nie jego
 * pomocnika transportu (zostałby sierotą).
 */
export const DEFAULT_BASE_FETCH: readonly string[] = [
  "-c",
  "http.lowSpeedLimit=1",
  "-c",
  "http.lowSpeedTime=20",
  "fetch",
  "--quiet",
  "--no-tags",
  "origin",
  "+refs/heads/main:refs/remotes/origin/main",
];

/**
 * Środowisko fetcha bez pytań na terminalu: generator pobiera bazę w tle, a
 * pytanie o hasło (HTTPS bez pomocnika poświadczeń) albo o klucz hosta SSH
 * wisiałoby do limitu czasu. Własnego polecenia ssh użytkownika
 * (`GIT_SSH_COMMAND`, `GIT_SSH`, `core.sshCommand`) nie nadpisujemy.
 */
export function batchFetchEnv(
  env: NodeJS.ProcessEnv,
  sshCommandConfigured: boolean,
): NodeJS.ProcessEnv {
  const ownSsh =
    sshCommandConfigured || env.GIT_SSH_COMMAND !== undefined || env.GIT_SSH !== undefined;
  return {
    ...env,
    GIT_TERMINAL_PROMPT: "0",
    ...(ownSsh ? {} : { GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=20" }),
  };
}

function git(
  args: readonly string[],
  cwd: string | undefined,
  options: { readonly timeout?: number; readonly env?: NodeJS.ProcessEnv } = {},
): string {
  return execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeout,
    env: options.env,
  });
}

/** Wynik gita albo `null`, gdy zwrócił błąd (np. brak klucza konfiguracji). */
function gitOrNull(args: readonly string[], cwd: string | undefined): string | null {
  try {
    return git(args, cwd).trim();
  } catch {
    return null;
  }
}

/** `git fetch` przed odczytem domyślnej bazy - stara baza przenumerowałaby cudze lustra. */
function fetchDefaultBase(cwd: string | undefined): "ok" | "failed" {
  const sshConfigured = gitOrNull(["config", "--get", "core.sshCommand"], cwd) !== null;
  try {
    git(DEFAULT_BASE_FETCH, cwd, {
      timeout: FETCH_TIMEOUT_MS,
      env: batchFetchEnv(process.env, sshConfigured),
    });
    return "ok";
  } catch {
    return "failed";
  }
}

/** Czy `ref` jest przodkiem `of`; `undefined`, gdy git nie odpowiedział. */
function isAncestor(ref: string, of: string, cwd: string | undefined): boolean | undefined {
  try {
    git(["merge-base", "--is-ancestor", ref, of], cwd);
    return true;
  } catch (error) {
    return (error as { status?: number }).status === 1 ? false : undefined;
  }
}

/**
 * Czy baza jest scalona: przodek HEAD albo - w trakcie `git merge` - przodek
 * MERGE_HEAD. Runbook (docs/RUNBOOK_MIGRACJE_LOVABLE.md §3.3) każe uruchomić
 * generator po rozwiązaniu konfliktu, a przed `git commit`, gdy HEAD to jeszcze
 * commit sprzed scalenia; bez MERGE_HEAD strażnik „weź nasze" byłby wtedy
 * pominięty. `undefined`, gdy git nie odpowiedział (traktowane jak scalona).
 */
function mergedIntoHead(ref: string, cwd: string | undefined): boolean | undefined {
  const head = isAncestor(ref, "HEAD", cwd);
  if (head !== false) return head;
  return refExists("MERGE_HEAD", cwd) && isAncestor(ref, "MERGE_HEAD", cwd) === true;
}

function refExists(ref: string, cwd: string | undefined): boolean {
  try {
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Dziennik drizzle z refu bazy (`git show <ref>:drizzle/migrations/meta/_journal.json`).
 * `null` ref = pierwszy istniejący z DEFAULT_BASE_REFS, po próbie `git fetch`
 * (DEFAULT_BASE_FETCH; wynik w `fetch`). Do tego: czy baza jest scalona
 * (`merged`; w płytkim klonie „nie" bywa granicą historii - `shallow`) oraz SHA
 * i data jej commitu. `null` wynik, gdy żaden ref się nie rozwiązuje (płytki klon
 * CI) albo dziennika nie da się odczytać - CLI przechodzi wtedy na samo
 * dopisywanie z ostrzeżeniem. `cwd` - katalog repozytorium (domyślnie bieżący).
 */
export function gitBaseJournal(ref: string | null, cwd?: string): MirrorBase | null {
  const fetch = ref === null ? fetchDefaultBase(cwd) : undefined;
  const found = (ref === null ? DEFAULT_BASE_REFS : [ref]).find((r) => refExists(r, cwd));
  if (found === undefined) return null;
  try {
    const journal: unknown = JSON.parse(git(["show", `${found}:${DRIZZLE_JOURNAL}`], cwd));
    if (typeof journal !== "object" || journal === null || !("entries" in journal)) return null;
    if (!Array.isArray(journal.entries)) return null;
    const [sha = "", date = ""] = git(["show", "-s", "--format=%H%n%cI", found], cwd)
      .trim()
      .split("\n");
    const merged = mergedIntoHead(found, cwd);
    const shallow =
      merged === false && gitOrNull(["rev-parse", "--is-shallow-repository"], cwd) === "true";
    return {
      ref: found,
      entries: journal.entries as MirrorBase["entries"],
      commit: { sha, date },
      ...(merged === undefined ? {} : { merged }),
      ...(shallow ? { shallow } : {}),
      ...(fetch === undefined ? {} : { fetch }),
    };
  } catch {
    return null;
  }
}
