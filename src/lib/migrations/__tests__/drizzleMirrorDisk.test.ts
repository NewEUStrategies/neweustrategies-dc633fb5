// @vitest-environment node
//
// Git bazy luster (`scripts/lib/drizzleMirrorDisk.ts`) na prawdziwych
// repozytoriach w katalogu tymczasowym: to, czy baza jest „scalona", i to,
// który ref generator czyta po `git fetch`, rozstrzyga git, a nie logika
// czysta - pomyłka daje plan z błędnym zakresem wdrożenia albo pomija
// strażnika „weź nasze" (runbook §3.3).
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_BASE_FETCH,
  batchFetchEnv,
  gitBaseJournal,
} from "../../../../scripts/lib/drizzleMirrorDisk";

const JOURNAL = "drizzle/migrations/meta/_journal.json";
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
  GIT_TERMINAL_PROMPT: "0",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function journalText(tags: readonly string[]): string {
  return JSON.stringify({
    version: "7",
    dialect: "postgresql",
    entries: tags.map((tag, idx) => ({
      idx,
      version: "7",
      when: 1000 + idx,
      tag,
      breakpoints: true,
    })),
  });
}

/** Repozytorium „origin": main z dziennikiem `0000_a`, potem gałąź `feature`. */
function upstream(): { readonly root: string; readonly origin: string; readonly m0: string } {
  const root = mkdtempSync(join(tmpdir(), "mirror-disk-"));
  roots.push(root);
  const origin = join(root, "origin");
  mkdirSync(join(origin, "drizzle/migrations/meta"), { recursive: true });
  git(root, "init", "-q", "-b", "main", origin);
  writeFileSync(join(origin, JOURNAL), journalText(["0000_a"]));
  git(origin, "add", "-A");
  git(origin, "commit", "-q", "-m", "m0");
  return { root, origin, m0: git(origin, "rev-parse", "HEAD") };
}

function commitFile(repo: string, file: string, text: string, message: string): string {
  writeFileSync(join(repo, file), text);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

describe("gitBaseJournal - czy baza jest scalona", () => {
  it("w trakcie `git merge origin/main` (przed commitem, runbook §3.3) baza jest scalona - liczy się MERGE_HEAD", () => {
    const { root, origin, m0 } = upstream();
    git(origin, "checkout", "-q", "-b", "feature");
    commitFile(origin, "app.txt", "f", "feature");
    git(origin, "checkout", "-q", "main");
    commitFile(origin, JOURNAL, journalText(["0000_a", "0001_bot"]), "bot");
    const clone = join(root, "clone");
    git(root, "clone", "-q", "-b", "feature", origin, clone);
    git(clone, "merge", "--no-commit", "--no-ff", "origin/main");
    expect(git(clone, "rev-parse", "MERGE_HEAD")).not.toBe(m0);

    const base = gitBaseJournal("origin/main", clone);
    expect(base?.merged).toBe(true);
    expect(base?.entries.map((e) => e.tag)).toEqual(["0000_a", "0001_bot"]);
    expect(base?.shallow).toBeUndefined();
  });

  it("gałąź, która bazy nie scaliła (bez scalania w toku), dostaje merged: false", () => {
    const { root, origin } = upstream();
    git(origin, "checkout", "-q", "-b", "feature");
    commitFile(origin, "app.txt", "f", "feature");
    git(origin, "checkout", "-q", "main");
    commitFile(origin, JOURNAL, journalText(["0000_a", "0001_bot"]), "bot");
    const clone = join(root, "clone");
    git(root, "clone", "-q", "-b", "feature", origin, clone);

    const base = gitBaseJournal("origin/main", clone);
    expect(base?.merged).toBe(false);
    expect(base?.shallow).toBeUndefined();
  });

  it("płytki klon, w którym git nie widzi przodka przez granicę historii: merged false i shallow - ostrzeżenie każe pogłębić, nie scalać", () => {
    const { root, origin } = upstream();
    git(origin, "checkout", "-q", "-b", "feature");
    commitFile(origin, "app.txt", "f", "feature");
    const clone = join(root, "clone");
    git(
      root,
      "clone",
      "-q",
      "--depth",
      "1",
      "--no-single-branch",
      "-b",
      "feature",
      `file://${origin}`,
      clone,
    );
    // origin/main (m0) JEST przodkiem HEAD, ale płytki klon tego nie wie.
    expect(git(clone, "rev-parse", "--is-shallow-repository")).toBe("true");

    const base = gitBaseJournal("origin/main", clone);
    expect(base?.merged).toBe(false);
    expect(base?.shallow).toBe(true);
  });
});

describe("gitBaseJournal - domyślna baza po git fetch", () => {
  it("klon jednej gałęzi: fetch zapisuje refs/remotes/origin/main, więc generator czyta świeżą bazę, nie starą lokalną main", () => {
    const { root, origin, m0 } = upstream();
    git(origin, "checkout", "-q", "-b", "feature");
    commitFile(origin, "app.txt", "f", "feature");
    const clone = join(root, "clone");
    git(root, "clone", "-q", "--single-branch", "-b", "feature", origin, clone);
    git(clone, "branch", "main", m0);
    git(origin, "checkout", "-q", "main");
    const fresh = commitFile(origin, JOURNAL, journalText(["0000_a", "0001_other_pr"]), "main+1");

    const base = gitBaseJournal(null, clone);
    expect(base?.fetch).toBe("ok");
    expect(base?.ref).toBe("origin/main");
    expect(base?.commit?.sha).toBe(fresh);
    expect(base?.entries.map((e) => e.tag)).toEqual(["0000_a", "0001_other_pr"]);
  });
});

describe("git fetch bazy w trybie wsadowym", () => {
  it("pobiera jawnie do refs/remotes/origin/main i przerywa wolny transfer HTTP przed limitem czasu", () => {
    expect(DEFAULT_BASE_FETCH).toContain("+refs/heads/main:refs/remotes/origin/main");
    expect(DEFAULT_BASE_FETCH.join(" ")).toMatch(/http\.lowSpeedLimit=1 .*http\.lowSpeedTime=20/);
  });

  it("nie pyta o hasło na terminalu; własnego polecenia ssh użytkownika nie nadpisuje", () => {
    const bare = batchFetchEnv({ PATH: "/bin" }, false);
    expect(bare.GIT_TERMINAL_PROMPT).toBe("0");
    expect(bare.GIT_SSH_COMMAND).toMatch(/BatchMode=yes/);
    expect(bare.PATH).toBe("/bin");
    const own = batchFetchEnv({ GIT_SSH_COMMAND: "ssh -i klucz" }, false);
    expect(own.GIT_SSH_COMMAND).toBe("ssh -i klucz");
    expect(batchFetchEnv({}, true).GIT_SSH_COMMAND).toBeUndefined();
  });
});
