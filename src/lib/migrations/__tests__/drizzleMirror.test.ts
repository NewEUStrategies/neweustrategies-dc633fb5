// Generator lustra drizzle (drizzleMirror.ts): reguły planu na pamięciowym
// repozytorium, zgodność plików z migratorem drizzle-orm (`readMigrationFiles`)
// i z `prepareMigrationFolder` drizzle-kit (narzędzie migracji Lovable) oraz
// samotest na prawdziwym repozytorium - lustro nigdy nie wysyła starego pliku.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { describe, expect, it, vi } from "vitest";
import {
  DEPLOY_TRIGGER_SQL,
  JOURNAL_FREEZE_IDX,
  MIGRATION_LANES,
  analyzeMigrationLanes,
  executableSql,
  readFileOrNull,
  type ReadFile,
} from "@/lib/ci/migrationLaneParity";
import { DEFAULT_MAX_BYTES, utf8Length } from "@/lib/ci/migrationSplit";
import {
  DRIZZLE_JOURNAL,
  DRIZZLE_MIGRATIONS_DIR,
  SUPABASE_MIGRATIONS_DIR,
  type DrizzleJournal,
  type JournalEntry,
} from "@/lib/ci/migrationSplitPlan";
import {
  SUPABASE_LANE_GAPS,
  analyzeSupabaseCoverage,
  supabaseMigrationVersion,
} from "@/lib/ci/supabaseLaneCoverage";
import {
  DRIZZLE_BREAKPOINT,
  DRIZZLE_META_DIR,
  DRY_SNAPSHOT_ID,
  JOURNAL_CONFLICT_FIX,
  MIRROR_LABEL_MAX,
  deployLine,
  journalText,
  lintMirrorSource,
  mirrorFresh,
  mirrorSnapshotId,
  mirrorTag,
  planMirror,
  renderMirrorPlan,
  snapshotText,
  utcVersion,
  versionToMs,
  type MirrorInput,
  type MirrorPlan,
} from "@/lib/migrations/drizzleMirror";
import { loadMirrorInput, type MirrorRepoInput } from "@/lib/migrations/drizzleMirrorCli";
import { mirrorHeader, mirrorSourceOf } from "@/lib/migrations/mirrorHeader";

const S = (name: string): string => `${SUPABASE_MIGRATIONS_DIR}/${name}`;
const D = (tag: string): string => `${DRIZZLE_MIGRATIONS_DIR}/${tag}.sql`;
const M = (idx: number): string =>
  `${DRIZZLE_META_DIR}/${String(idx).padStart(4, "0")}_snapshot.json`;

const EMPTY_BODY = {
  version: "7",
  dialect: "postgresql",
  tables: {},
  enums: {},
  schemas: {},
  views: {},
  sequences: {},
  roles: {},
  policies: {},
  _meta: { columns: {}, schemas: {}, tables: {} },
};
const snap = (id: string, prevId: string, body: object = EMPTY_BODY): string =>
  snapshotText({ id, prevId, ...body });

const SNAP0 = "00000000-0000-4000-8000-000000000001";
const A = "20261001000000_a.sql";
const A_SQL = "-- nagłówek\nREVOKE ALL ON FUNCTION public.a() FROM anon;\n";
const B = "20261002000000_b_fix.sql";
const B_SQL = "-- poprawka\nGRANT EXECUTE ON FUNCTION public.a() TO service_role;\n";
const C = "20261003000000_c.sql";
const C_SQL = "CREATE INDEX c_idx ON public.c (x);\n";
const BASE = { ref: "origin/main", entries: [{ idx: 0, when: 1_000_000, tag: "0000_a" }] };

const entry = (idx: number, when: number, tag: string): JournalEntry => ({
  idx,
  version: "7",
  when,
  tag,
  breakpoints: true,
});
const journal = (...entries: JournalEntry[]): string =>
  journalText({ version: "7", dialect: "postgresql", entries });

type Repo = ReadonlyMap<string, string>;

/** Repo z jednym plikiem supabase i jego starym bliźniakiem (bez nagłówka) jako wpisem 0000. */
function repo(extra: Record<string, string> = {}): Repo {
  return new Map(
    Object.entries({
      [S(A)]: A_SQL,
      [D("0000_a")]: "REVOKE ALL ON FUNCTION public.a() FROM anon;",
      [M(0)]: snap(SNAP0, DRY_SNAPSHOT_ID),
      [DRIZZLE_JOURNAL]: journal(entry(0, 1_000_000, "0000_a")),
      ...extra,
    }),
  );
}

function names(r: Repo, dir: string, pattern: RegExp): string[] {
  return [...r.keys()]
    .filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes("/"))
    .map((p) => p.slice(dir.length + 1))
    .filter((name) => pattern.test(name))
    .sort();
}

function inputOf(r: Repo, extra: Partial<MirrorInput> = {}): MirrorInput {
  return {
    journal: JSON.parse(r.get(DRIZZLE_JOURNAL)!) as DrizzleJournal,
    drizzleSql: names(r, DRIZZLE_MIGRATIONS_DIR, /\.sql$/),
    snapshots: names(r, DRIZZLE_META_DIR, /^[^_]/),
    // Kolejność listy supabase jest dowolna - plan sortuje sam.
    supabaseSql: names(r, SUPABASE_MIGRATIONS_DIR, /\.sql$/).reverse(),
    read: (path) => r.get(path) ?? null,
    gaps: [],
    lanes: [],
    exceptions: new Set(),
    now: 9e12,
    ...extra,
  };
}

const plan = (r: Repo, extra: Partial<MirrorInput> = {}): MirrorPlan =>
  planMirror(inputOf(r, extra));

function apply(r: Repo, p: MirrorPlan): Repo {
  const next = new Map(r);
  for (const path of p.deletions) next.delete(path);
  for (const file of p.files) next.set(file.path, file.content);
  return next;
}

const kinds = (p: MirrorPlan): string[] => p.errors.map((e) => e.kind);
const written = (p: MirrorPlan, path: string): string =>
  p.files.find((f) => f.path === path)!.content;
const snapshotOf = (r: Repo, idx: number): Record<string, unknown> =>
  JSON.parse(r.get(M(idx))!) as Record<string, unknown>;

/** Repo z lustrem B jako wpisem 0001 (wygenerowanym przez plan, jak w gałęzi). */
const mirroredB = (extra: Partial<MirrorInput> = {}): Repo => {
  const r = repo({ [S(B)]: B_SQL });
  return apply(r, plan(r, extra));
};

/**
 * `prepareMigrationFolder` drizzle-kit 0.31.10 (bin.cjs: prepareOutFolder,
 * validateWithReport, preparePrevSnapshot) na plikach meta/: posortowane
 * leksykograficznie pliki bez `_`, grupy po `prevId` (kolizja = grupa > 1,
 * wtedy `generate` kończy się po cichu kodem 0), rodzic następnego wpisu =
 * ostatni plik.
 */
function drizzleKitPrepare(r: Repo): {
  collisions: string[][];
  nonLatest: string[];
  parent: string | undefined;
} {
  const files = names(r, DRIZZLE_META_DIR, /^[^_]/);
  const byPrevId = new Map<string, string[]>();
  const nonLatest: string[] = [];
  for (const name of files) {
    const raw = JSON.parse(r.get(`${DRIZZLE_META_DIR}/${name}`)!) as Record<string, string>;
    if (raw.version !== "7") {
      nonLatest.push(name);
      continue;
    }
    byPrevId.set(raw.prevId!, [...(byPrevId.get(raw.prevId!) ?? []), name]);
  }
  return {
    collisions: [...byPrevId.values()].filter((group) => group.length > 1),
    nonLatest,
    parent: files.at(-1),
  };
}

describe("plan lustra drizzle", () => {
  it("dziennik niosący każdy plik daje pusty plan", () => {
    const p = plan(repo());
    expect(mirrorFresh(p)).toBe(true);
    expect(p).toMatchObject({ entries: [], errors: [], warnings: [], lastCarried: A, deploy: [] });
    expect(renderMirrorPlan(p, "check")).toBe(
      `✓ Lustro drizzle aktualne: każda migracja supabase/migrations od 20260911160000 ma kopię w dzienniku albo decyzję w SUPABASE_LANE_GAPS (ostatnia niesiona: ${A}).`,
    );
  });

  it("nowy plik dostaje wpis za dziennikiem, zapisany jak przez drizzle-kit", () => {
    const p = plan(repo({ [S(B)]: B_SQL }));
    expect(p.errors).toEqual([]);
    expect(p.entries).toEqual([
      {
        idx: 1,
        tag: "0001_b_fix",
        when: 1_060_000,
        source: B,
        bytes: utf8Length(mirrorHeader(B) + B_SQL),
      },
    ]);
    expect(p.files.map((f) => f.path)).toEqual([D("0001_b_fix"), M(1), DRIZZLE_JOURNAL]);
    const text = written(p, DRIZZLE_JOURNAL);
    const parsed = JSON.parse(text) as { entries: JournalEntry[] };
    expect(text).toBe(`${JSON.stringify(parsed, null, 2)}\n`);
    expect(Object.keys(parsed)).toEqual(["version", "dialect", "entries"]);
    expect(parsed.entries).toEqual([
      entry(0, 1_000_000, "0000_a"),
      entry(1, 1_060_000, "0001_b_fix"),
    ]);
    expect(Object.keys(parsed.entries[1]!)).toEqual([
      "idx",
      "version",
      "when",
      "tag",
      "breakpoints",
    ]);
  });

  it("SQL lustra = nagłówek + bajty źródła; migrator drizzle-orm czyta go jako jedno zapytanie", () => {
    const body =
      "-- nagłówek: źródło prawdy\nCREATE FUNCTION public.b() RETURNS text LANGUAGE sql AS $$ SELECT 'x; y' $$;\nREVOKE ALL ON FUNCTION public.b() FROM anon;\n";
    const r = repo({ [S(B)]: body });
    const p = plan(r);
    const content = written(p, D("0001_b_fix"));
    expect(content).toBe(mirrorHeader(B) + body);
    expect(mirrorSourceOf(content)).toBe(B);
    expect(executableSql(content)).toBe(executableSql(body));
    expect(content.includes(DRIZZLE_BREAKPOINT)).toBe(false);

    const dir = mkdtempSync(join(tmpdir(), "drizzle-mirror-"));
    try {
      mkdirSync(join(dir, "meta"));
      for (const [path, text] of apply(r, p)) {
        if (path.startsWith(`${DRIZZLE_MIGRATIONS_DIR}/`))
          writeFileSync(join(dir, path.slice(DRIZZLE_MIGRATIONS_DIR.length + 1)), text);
      }
      const migrations = readMigrationFiles({ migrationsFolder: dir });
      expect(migrations).toHaveLength(2);
      expect(migrations[1]).toEqual({
        sql: [content],
        bps: true,
        folderMillis: 1_060_000,
        hash: createHash("sha256").update(content).digest("hex"),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("kilka plików: kolejność po wersji, idx i when co 60 s", () => {
    const p = plan(repo({ [S(C)]: C_SQL, [S(B)]: B_SQL }));
    expect(p.entries.map((e) => [e.idx, e.tag, e.when, e.source])).toEqual([
      [1, "0001_b_fix", 1_060_000, B],
      [2, "0002_c", 1_120_000, C],
    ]);
  });

  it("when liczy się od MAKSIMUM dziennika, nie od ostatniego wpisu", () => {
    const r = repo({
      [S(B)]: B_SQL,
      [D("0001_x")]: "SELECT 1;",
      [DRIZZLE_JOURNAL]: journal(entry(0, 5_000_000, "0000_a"), entry(1, 4_000_000, "0001_x")),
    });
    expect(plan(r).entries.map((e) => [e.tag, e.when])).toEqual([["0002_b_fix", 5_060_000]]);
  });

  it("snapshoty: deterministyczny UUID v8, łańcuch prevId, treść poprzednika", () => {
    const body = { ...EMPTY_BODY, tables: { "public.t": { name: "t" } } };
    const r = repo({ [S(B)]: B_SQL, [S(C)]: C_SQL, [M(0)]: snap(SNAP0, DRY_SNAPSHOT_ID, body) });
    const p = plan(r);
    expect(plan(r)).toEqual(p);
    const next = apply(r, p);
    const s1 = snapshotOf(next, 1);
    const s2 = snapshotOf(next, 2);
    const uuid8 = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(s1.id).toMatch(uuid8);
    expect(s1.id).toBe(mirrorSnapshotId("0001_b_fix", B));
    expect(s2.id).toBe(mirrorSnapshotId("0002_c", C));
    expect([s1.prevId, s2.prevId]).toEqual([SNAP0, s1.id]);
    const { id: _id, prevId: _prevId, ...rest } = s2;
    expect(rest).toEqual(body);
    expect(Object.keys(s1)).toEqual(Object.keys(snapshotOf(next, 0)));
    expect(mirrorSnapshotId("0001_b_fix", C)).not.toBe(s1.id);
  });

  it("brak snapshotu ostatniego wpisu (jak 0313-0390): łańcuch od ostatniego ISTNIEJĄCEGO", () => {
    const r = repo({
      [S(B)]: B_SQL,
      [D("0001_x")]: "SELECT 1;",
      [DRIZZLE_JOURNAL]: journal(entry(0, 1_000_000, "0000_a"), entry(1, 2_000_000, "0001_x")),
    });
    const next = apply(r, plan(r));
    expect(snapshotOf(next, 2).prevId).toBe(SNAP0);
    expect(drizzleKitPrepare(next)).toEqual({
      collisions: [],
      nonLatest: [],
      parent: "0002_snapshot.json",
    });
  });

  it("pusty dziennik i meta/: wpis 0000 ze snapshotem w układzie 0000_snapshot.json drizzle-kit", () => {
    const r: Repo = new Map([
      [S(B), B_SQL],
      [DRIZZLE_JOURNAL, journal()],
    ]);
    const p = plan(r);
    expect(p.entries.map((e) => [e.idx, e.tag, e.when])).toEqual([[0, "0000_b_fix", 60_000]]);
    expect(p.lastCarried).toBe(B);
    const s0 = snapshotOf(apply(r, p), 0);
    expect(s0).toEqual({
      id: mirrorSnapshotId("0000_b_fix", B),
      prevId: DRY_SNAPSHOT_ID,
      ...EMPTY_BODY,
    });
    expect(Object.keys(s0)).toEqual(Object.keys(snapshotOf(repo(), 0)));
  });

  it("idempotencja: zastosowany plan daje pusty drugi przebieg - z bazą i bez", () => {
    const r = repo({ [S(B)]: B_SQL, [S(C)]: C_SQL });
    const withBase = apply(r, plan(r, { base: BASE }));
    expect(mirrorFresh(plan(withBase, { base: BASE }))).toBe(true);
    expect(mirrorFresh(plan(withBase))).toBe(true);
    const appendOnly = apply(r, plan(r));
    expect(appendOnly).toEqual(withBase);
    expect(mirrorFresh(plan(appendOnly))).toBe(true);
  });

  it("sam format dziennika (bot zapisał go inaczej) nie powoduje zapisu", () => {
    const compact = `${JSON.stringify(JSON.parse(repo().get(DRIZZLE_JOURNAL)!))}`;
    const p = plan(repo({ [DRIZZLE_JOURNAL]: compact }));
    expect(mirrorFresh(p)).toBe(true);
    const withNew = plan(repo({ [DRIZZLE_JOURNAL]: compact, [S(B)]: B_SQL }));
    expect(written(withNew, DRIZZLE_JOURNAL)).toBe(
      journal(entry(0, 1_000_000, "0000_a"), entry(1, 1_060_000, "0001_b_fix")),
    );
  });

  it("plan nie czyta zegara (when i id snapshotów z dziennika, nie z Date.now)", () => {
    const spy = vi.spyOn(Date, "now");
    try {
      plan(repo({ [S(B)]: B_SQL }), { now: undefined });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("SUPABASE_LANE_GAPS (coveredBy, appliedOutOfBand) i pliki sprzed DRIZZLE_LANE_START nie są wysyłane", () => {
    const oob = "20261002000000_out_of_band.sql";
    const bundled = "20261003000000_bundled.sql";
    const r = repo({
      [S("20250101000000_before_lane.sql")]: "DROP TABLE public.old;",
      [S(oob)]: "CREATE TABLE public.oob (id int);",
      // Ten sam SQL co 0000_a: kopię zużył plik A, więc ten ma wpis `coveredBy`.
      [S(bundled)]: "REVOKE ALL ON FUNCTION public.a() FROM anon;",
    });
    const p = plan(r, {
      gaps: [
        { file: oob, appliedOutOfBand: "zastosowany poza dziennikiem" },
        { file: bundled, coveredBy: ["0000_a"], reason: "ta sama instrukcja co 0000_a" },
      ],
      exceptions: new Set([oob]),
    });
    expect(mirrorFresh(p)).toBe(true);
    expect(p.lastCarried).toBe(bundled);
  });

  it("jeden wpis niesie jeden plik: ponowny przebieg tego samego SQL-a pod nową wersją dostaje własny wpis", () => {
    const again = "20261002000000_a_again.sql";
    expect(plan(repo({ [S(again)]: A_SQL })).entries.map((e) => [e.tag, e.source])).toEqual([
      ["0001_a_again", again],
    ]);
  });

  it("wersja nie nowsza niż ostatni niesiony plik: błąd z gotowym git mv, bez zapisu", () => {
    const r = apply(repo({ [S(C)]: C_SQL }), plan(repo({ [S(C)]: C_SQL })));
    const old = "20261002000000_d.sql";
    const same = "20261003000000_e.sql";
    const withOld = { ...Object.fromEntries(r), [S(old)]: "SELECT 2;", [S(same)]: "SELECT 3;" };
    const p = plan(new Map(Object.entries(withOld)), { now: Date.UTC(2026, 9, 25, 12, 0, 0) });
    expect(kinds(p)).toEqual(["wersja-wsteczna", "wersja-wsteczna"]);
    expect(p.files).toEqual([]);
    expect(p.deletions).toEqual([]);
    expect(p.errors.every((e) => e.detail.startsWith(`wersja nie jest późniejsza niż ${C} `))).toBe(
      true,
    );
    expect(p.errors[0]!.detail).toContain(`git mv ${S(old)} ${S("20261025120000_d.sql")}`);
    expect(p.errors[1]!.detail).toContain(`git mv ${S(same)} ${S("20261025120001_e.sql")}`);
    // Bez zegara: tuż za ostatnim niesionym plikiem.
    const early = plan(new Map(Object.entries(withOld)), { now: undefined });
    expect(early.errors[0]!.detail).toContain(`${S("20261003000001_d.sql")}`);
  });

  it("za-duzy mierzy dostarczany plik: nagłówek + źródło", () => {
    const sql = `SELECT '${"x".repeat(200)}';\n`;
    const limit = utf8Length(mirrorHeader(B) + sql);
    expect(plan(repo({ [S(B)]: sql }), { maxBytes: limit }).errors).toEqual([]);
    const p = plan(repo({ [S(B)]: sql }), { maxBytes: limit - 1 });
    expect(kinds(p)).toEqual(["za-duzy"]);
    expect(p.files).toEqual([]);
    expect(p.errors[0]!.detail).toContain(`bun run scripts/split-migration.ts ${S(B)}`);
    expect(utf8Length(sql)).toBeLessThan(limit - 1);
  });

  it("pusty-sql: plik z samych komentarzy nigdy nie byłby rozpoznany jako skopiowany", () => {
    const p = plan(repo({ [S(B)]: "-- tylko opis\n/* i blok */\n" }));
    expect(kinds(p)).toEqual(["pusty-sql"]);
  });

  it("when-w-przyszlosci: wpis nie może wyprzedzić chwili uruchomienia", () => {
    expect(plan(repo({ [S(B)]: B_SQL }), { now: 1_060_000 }).errors).toEqual([]);
    const p = plan(repo({ [S(B)]: B_SQL }), { now: 1_059_999 });
    expect(kinds(p)).toEqual(["when-w-przyszlosci"]);
    expect(p.errors[0]!.detail).toContain("0001_b_fix: when 1060000");
    expect(p.files).toEqual([]);
  });

  it("sieroty: lustro spoza dziennika jest usuwane, plik bez nagłówka (stara sierota panelu) zostaje", () => {
    const p = plan(
      repo({
        [D("0007_stale")]: mirrorHeader(C) + C_SQL,
        [D("0057_event_cfp")]: "CREATE TABLE public.cfp (id int);",
      }),
    );
    expect(p.deletions).toEqual([D("0007_stale")]);
    expect(p.errors).toEqual([]);
    expect(renderMirrorPlan(p, "check")).toContain(
      `  - ${D("0007_stale")} (osierocony plik generatora)`,
    );
  });

  it("snapshot za ostatnim wpisem dziennika jest usuwany", () => {
    const p = plan(repo({ [M(5)]: snap("00000000-0000-4000-8000-000000000005", SNAP0) }));
    expect(p.deletions).toEqual([M(5)]);
    expect(renderMirrorPlan(p, "check")).toContain(
      `  - ${M(5)} (snapshot za ostatnim wpisem dziennika)`,
    );
  });
});

describe("lustra z bazy: forward-only", () => {
  it("zmiana SQL-a wykonywalnego źródła to zrodlo-rozjechane, bez ponownej dostawy; zmiana komentarza nie", () => {
    const r = mirroredB();
    const drift = new Map(r).set(S(B), B_SQL.replace("service_role", "authenticated"));
    const p = plan(drift);
    expect(kinds(p)).toEqual(["zrodlo-rozjechane"]);
    expect(p.entries).toEqual([]);
    expect(p.errors[0]!.detail).toContain("--rewrite 0001_b_fix");
    expect(p.errors[0]!.detail).toContain("--verify --from 1 --to 1");
    expect(mirrorFresh(plan(new Map(r).set(S(B), `-- inny opis\n${B_SQL}`)))).toBe(true);
  });

  it("zrodlo-brak: źródła wysłanego lustra nie przemianowuje się", () => {
    const r = new Map(mirroredB());
    r.delete(S(B));
    r.set(S("20261002000001_b_renamed.sql"), B_SQL);
    expect(kinds(plan(r))).toEqual(["zrodlo-brak"]);
  });

  it("wpis dziennika bez pliku (skasowane lustro): błąd zamiast drugiej dostawy źródła", () => {
    const r = new Map(mirroredB());
    r.delete(D("0001_b_fix"));
    const p = plan(r);
    expect(kinds(p)).toEqual(["brak-pliku-wpisu"]);
    expect(p.files).toEqual([]);
    expect(p.errors[0]!.detail).toContain(`git checkout origin/main -- ${D("0001_b_fix")}`);
  });

  it("lustro lokalne gałęzi ze zmienionym źródłem jest przepisane pod tym samym tagiem; drugi przebieg pusty", () => {
    const r = new Map(mirroredB({ base: BASE }));
    r.set(S(B), B_SQL.replace("service_role", "authenticated"));
    const p = plan(r, { base: BASE });
    expect(p.errors).toEqual([]);
    expect(p.entries.map((e) => [e.tag, e.when])).toEqual([["0001_b_fix", 1_060_000]]);
    expect(p.files.map((f) => f.path)).toEqual([D("0001_b_fix")]);
    expect(p.deploy).toEqual([{ idx: 1, tag: "0001_b_fix" }]);
    expect(mirrorFresh(plan(apply(r, p), { base: BASE }))).toBe(true);
  });

  it("po przejęciu meta z main: lustro gałęzi idzie za wpisem main, stary plik znika", () => {
    const branch = mirroredB({ base: BASE });
    const mainSnap = "00000000-0000-4000-8000-000000000002";
    const trigger = "0001_pr600_deployment_completion";
    const main = {
      ref: "origin/main",
      entries: [...BASE.entries, { idx: 1, when: 2_000_000, tag: trigger }],
    };
    // `git checkout origin/main -- drizzle/migrations/meta` + plik wyzwalacza z main.
    const r = new Map(branch)
      .set(DRIZZLE_JOURNAL, journal(entry(0, 1_000_000, "0000_a"), entry(1, 2_000_000, trigger)))
      .set(M(1), snap(mainSnap, SNAP0))
      .set(D(trigger), DEPLOY_TRIGGER_SQL);
    const p = plan(r, { base: main });
    expect(p.errors).toEqual([]);
    expect(p.deletions).toEqual([D("0001_b_fix")]);
    expect(p.entries.map((e) => [e.idx, e.tag, e.when])).toEqual([[2, "0002_b_fix", 2_060_000]]);
    const next = apply(r, p);
    expect(snapshotOf(next, 2).prevId).toBe(mainSnap);
    expect(drizzleKitPrepare(next).collisions).toEqual([]);
    expect(mirrorFresh(plan(next, { base: main }))).toBe(true);
  });

  it("lustra lokalne muszą stać na końcu dziennika; wpisów bazy nie przenumerowuje się", () => {
    const r = new Map(mirroredB({ base: BASE }))
      .set(D("0002_hand"), "SELECT 1;")
      .set(
        DRIZZLE_JOURNAL,
        journal(
          entry(0, 1_000_000, "0000_a"),
          entry(1, 1_060_000, "0001_b_fix"),
          entry(2, 1_120_000, "0002_hand"),
        ),
      );
    const local = plan(r, { base: BASE });
    expect(kinds(local)).toEqual(["lokalne-nie-na-koncu"]);
    expect(local.errors[0]!.detail).toContain(JOURNAL_CONFLICT_FIX);
    const moved = { ref: "origin/main", entries: [{ idx: 0, when: 999, tag: "0000_a" }] };
    expect(kinds(plan(repo(), { base: moved }))).toEqual(["wpis-bazy-zmieniony"]);
    const renumbered = {
      ref: "origin/main",
      entries: [{ idx: 3, when: 1_000_000, tag: "0000_a" }],
    };
    expect(kinds(plan(repo(), { base: renumbered }))).toEqual(["wpis-bazy-zmieniony"]);
  });
});

describe("--rewrite: jedyny wyjątek od forward-only (runbook §6.3)", () => {
  const changed = B_SQL.replace("service_role", "authenticated");

  it("przepisuje lustro z bazy z bieżącego źródła; dziennik i snapshoty bez zmian", () => {
    const r = new Map(mirroredB()).set(S(B), changed);
    const p = plan(r, { rewrite: new Set(["0001_b_fix"]) });
    expect(p.errors).toEqual([]);
    expect(p.files).toEqual([{ path: D("0001_b_fix"), content: mirrorHeader(B) + changed }]);
    expect(p.rewritten).toEqual([
      { idx: 1, tag: "0001_b_fix", source: B, bytes: utf8Length(mirrorHeader(B) + changed) },
    ]);
    expect(p.entries).toEqual([]);
    expect(p.deploy).toEqual([{ idx: 1, tag: "0001_b_fix" }]);
    const text = renderMirrorPlan(p, "dry-run");
    expect(text).toContain("~ 0001_b_fix <- supabase/migrations/20261002000000_b_fix.sql");
    expect(text).toContain("bun run migrations:deploy-sql -- --verify --from 1 --to 1");
    expect(text).toContain("brak w rejestrze");
    expect(mirrorFresh(plan(apply(r, p)))).toBe(true);
  });

  it("odmawia wpisu bez nagłówka generatora i tagu spoza dziennika", () => {
    const r = new Map(mirroredB()).set(S(B), changed);
    const p = plan(r, { rewrite: new Set(["0000_a", "0009_missing"]) });
    expect(p.errors.map((e) => [e.kind, e.path])).toEqual([
      ["przepisanie-niedozwolone", D("0000_a")],
      ["przepisanie-niedozwolone", D("0009_missing")],
      ["zrodlo-rozjechane", D("0001_b_fix")],
    ]);
    expect(p.files).toEqual([]);
  });

  it("lustro bez zmiany źródła i lustro lokalne: ostrzeżenie, nic do przepisania", () => {
    const same = plan(mirroredB(), { rewrite: new Set(["0001_b_fix"]) });
    expect(mirrorFresh(same)).toBe(true);
    expect(same.warnings.map((w) => w.kind)).toEqual(["przepisanie-zbedne"]);
    const local = plan(mirroredB({ base: BASE }), {
      base: BASE,
      rewrite: new Set(["0001_b_fix"]),
    });
    expect(local.warnings.map((w) => [w.kind, w.detail.includes("lokalne")])).toEqual([
      ["przepisanie-zbedne", true],
    ]);
    expect(local.rewritten).toEqual([]);
  });

  it("przepisana treść przechodzi te same reguły co nowe lustro", () => {
    const r = new Map(mirroredB()).set(S(B), `${changed}-- ${DRIZZLE_BREAKPOINT}\n`);
    expect(kinds(plan(r, { rewrite: new Set(["0001_b_fix"]) }))).toEqual(["znacznik-breakpoint"]);
  });
});

describe("kształt dziennika i snapshotów", () => {
  const broken: [string, unknown][] = [
    [
      "idx różny od pozycji",
      { version: "7", dialect: "postgresql", entries: [entry(1, 1, "0001_a")] },
    ],
    ["tag bez prefiksu idx", { version: "7", dialect: "postgresql", entries: [entry(0, 1, "a")] }],
    [
      "prefiks tagu różny od idx",
      { version: "7", dialect: "postgresql", entries: [entry(0, 1, "0001_a")] },
    ],
    [
      "powtórzony tag",
      {
        version: "7",
        dialect: "postgresql",
        entries: [entry(0, 1, "0000_a"), { ...entry(1, 2, "0000_a") }],
      },
    ],
    ["zła wersja", { version: "6", dialect: "postgresql", entries: [] }],
    ["zły dialekt", { version: "7", dialect: "mysql", entries: [] }],
    [
      "when napisem",
      { version: "7", dialect: "postgresql", entries: [{ ...entry(0, 1, "0000_a"), when: "1" }] },
    ],
    ["entries nie tablicą", { version: "7", dialect: "postgresql", entries: {} }],
    ["null zamiast dziennika", null],
  ];

  it.each(broken)("dziennik-ksztalt: %s - bez zapisu, z przepisem naprawy", (_name, value) => {
    const p = planMirror({ ...inputOf(repo({ [S(B)]: B_SQL })), journal: value as DrizzleJournal });
    expect(kinds(p)).toEqual(["dziennik-ksztalt"]);
    expect(p.files).toEqual([]);
    expect(p.errors[0]!.detail).toContain(JOURNAL_CONFLICT_FIX);
  });

  it("snapshot-kolizja: dwa snapshoty z tym samym prevId albo id (drizzle-kit generate milknie)", () => {
    const two = {
      [D("0001_x")]: "SELECT 1;",
      [DRIZZLE_JOURNAL]: journal(entry(0, 1_000_000, "0000_a"), entry(1, 2_000_000, "0001_x")),
    };
    const samePrev = plan(
      repo({ ...two, [M(1)]: snap("00000000-0000-4000-8000-000000000009", DRY_SNAPSHOT_ID) }),
    );
    expect(samePrev.errors.map((e) => [e.kind, e.detail.split(" mają")[0]])).toEqual([
      ["snapshot-kolizja", "0000_snapshot.json, 0001_snapshot.json"],
    ]);
    expect(
      drizzleKitPrepare(repo({ ...two, [M(1)]: snap("x", DRY_SNAPSHOT_ID) })).collisions,
    ).toEqual([["0000_snapshot.json", "0001_snapshot.json"]]);
    expect(kinds(plan(repo({ ...two, [M(1)]: snap(SNAP0, SNAP0) })))).toEqual(["snapshot-kolizja"]);
  });

  it("snapshot-uszkodzony: nieczytelny albo nie v7 snapshot w meta/", () => {
    expect(kinds(plan(repo({ [M(0)]: "{" })))).toEqual(["snapshot-uszkodzony"]);
    expect(
      kinds(plan(repo({ [M(0)]: snap(SNAP0, DRY_SNAPSHOT_ID, { ...EMPTY_BODY, version: "6" }) }))),
    ).toEqual(["snapshot-uszkodzony"]);
    // Uszkodzony rodzic blokuje też dopisanie wpisu.
    const p = plan(repo({ [S(B)]: B_SQL, [M(0)]: "[]" }));
    expect(kinds(p)).toEqual(["snapshot-uszkodzony"]);
    expect(p.files).toEqual([]);
  });

  it("plik meta/ spoza konwencji NNNN_snapshot.json: drizzle-kit czyta go jako snapshot, więc to błąd (i kolizja, gdy dubluje rodzica)", () => {
    const stray = `${DRIZZLE_META_DIR}/0000a_snapshot.json`;
    const harmless = plan(repo({ [stray]: snap("00000000-0000-4000-8000-00000000000a", SNAP0) }));
    expect(harmless.errors.map((e) => [e.kind, e.path])).toEqual([["snapshot-uszkodzony", stray]]);
    expect(harmless.errors[0]!.detail).toContain("nazwa spoza konwencji NNNN_snapshot.json");
    const colliding = repo({
      [stray]: snap("00000000-0000-4000-8000-00000000000a", DRY_SNAPSHOT_ID),
    });
    expect(kinds(plan(colliding))).toEqual(["snapshot-uszkodzony", "snapshot-kolizja"]);
    expect(drizzleKitPrepare(colliding).collisions).toEqual([
      ["0000_snapshot.json", "0000a_snapshot.json"],
    ]);
  });

  it("zgodność z drizzle-kit: po planie meta/ bez kolizji, a rodzicem następnego wpisu jest ostatnie lustro", () => {
    const r = repo({ [S(B)]: B_SQL, [S(C)]: C_SQL });
    const next = apply(r, plan(r));
    expect(drizzleKitPrepare(next)).toEqual({
      collisions: [],
      nonLatest: [],
      parent: "0002_snapshot.json",
    });
    expect(snapshotOf(next, 2).id).toBe(mirrorSnapshotId("0002_c", C));
  });
});

describe("reguły pliku lustra (lintMirrorSource)", () => {
  const FILE = "20261002000000_x.sql";
  const lint = (sql: string) => lintMirrorSource(FILE, sql, DEFAULT_MAX_BYTES);
  const errorsOf = (sql: string) => lint(sql).errors.map((e) => e.kind);

  it("znacznik breakpoint w komentarzu to błąd (migrator tnie plik zawsze)", () => {
    expect(errorsOf(`-- ${DRIZZLE_BREAKPOINT}\nSELECT 1;`)).toEqual(["znacznik-breakpoint"]);
  });

  it("instrukcje spoza transakcji migratora to błąd z numerem linii", () => {
    const result = lint(
      [
        "BEGIN;",
        "CREATE TABLE public.t (a int);",
        "COMMIT;",
        "CREATE INDEX CONCURRENTLY t_a ON public.t (a);",
        "DROP INDEX CONCURRENTLY IF EXISTS public.t_a;",
        "VACUUM public.t;",
      ].join("\n"),
    );
    expect(result.errors.map((e) => [e.kind, e.detail.slice(0, 9)])).toEqual([
      ["poza-transakcja", "linia 1: "],
      ["poza-transakcja", "linia 3: "],
      ["poza-transakcja", "linia 4: "],
      ["poza-transakcja", "linia 5: "],
      ["poza-transakcja", "linia 6: "],
    ]);
  });

  it("REFRESH MATERIALIZED VIEW CONCURRENTLY działa w transakcji (PostgreSQL 16) - bez zgłoszenia", () => {
    expect(lint("REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv;")).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it("ALTER TYPE ... ADD VALUE to tylko ostrzeżenie", () => {
    const result = lint("ALTER TYPE public.k ADD VALUE 'b';");
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => w.kind)).toEqual(["enum-nowa-wartosc"]);
  });

  it("ustawienie sesji na najwyższym poziomie to ostrzeżenie z oryginalnym tekstem instrukcji", () => {
    const result = lint(
      [
        "SET lock_timeout = '5s';",
        "SET LOCAL statement_timeout = 0;",
        "SET ROLE service_role;",
        "RESET lock_timeout;",
        "SELECT set_config('request.jwt.claims', '{}', true);",
      ].join("\n"),
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => w.kind)).toEqual(Array(5).fill("ustawienie-sesji"));
    expect(result.warnings[0]!.detail).toContain(`linia 1: „SET lock_timeout = '5s';"`);
    expect(result.warnings[0]!.detail).toContain("CAŁEJ partii migratora");
  });

  it("te same słowa w literale, w ciele $$ i jako atrybut funkcji niczego nie zgłaszają", () => {
    const sql = [
      "COMMENT ON TABLE public.t IS 'BEGIN; COMMIT; CREATE INDEX CONCURRENTLY x; SET x = 1; ALTER TYPE k ADD VALUE';",
      "DO $$ BEGIN EXECUTE 'VACUUM'; END $$;",
      "CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql SET search_path = public AS $fn$",
      "BEGIN",
      "  SET LOCAL lock_timeout = '1s';",
      "  COMMIT;",
      "END",
      "$fn$;",
    ].join("\n");
    expect(lint(sql)).toEqual({ errors: [], warnings: [] });
  });

  it("pusty SQL, meta-polecenie psql i nazwa spoza ASCII", () => {
    expect(errorsOf("-- komentarz\n")).toEqual(["pusty-sql"]);
    expect(errorsOf("\\set ON_ERROR_STOP on\nSELECT 1;")).toEqual(["sql-nieczytelny"]);
    expect(
      lintMirrorSource("20261002000000_zła nazwa.sql", "SELECT 1;", DEFAULT_MAX_BYTES).errors.map(
        (e) => e.kind,
      ),
    ).toEqual(["nazwa-zrodla"]);
  });
});

describe("nazwy, wersje i raport", () => {
  it("mirrorTag: ASCII, małe litery, cięcie do MIRROR_LABEL_MAX na podkreślniku", () => {
    expect(mirrorTag(399, "20261101000000_Bardzo-Długa nazwa.sql")).toBe("0399_bardzo_dluga_nazwa");
    const long = mirrorTag(1, `20261101000000_${"abcdefghij_".repeat(8)}x.sql`);
    expect(long).toBe(`0001_${"abcdefghij_".repeat(5).slice(0, -1)}`);
    const solid = mirrorTag(1, `20261101000000_${"a".repeat(70)}.sql`);
    expect(solid).toBe(`0001_${"a".repeat(MIRROR_LABEL_MAX)}`);
    expect(mirrorTag(5, "20261101000000_---.sql")).toBe("0005_migration");
    expect(mirrorTag(10_000, "20261101000000_x.sql")).toBe("10000_x");
    for (const tag of [long, solid]) expect(tag).toMatch(/^\d{4}_[a-z0-9_]{1,64}$/);
  });

  it("utcVersion i versionToMs: wersja migracji = chwila UTC z dokładnością do sekundy", () => {
    expect(utcVersion(1_791_792_195_734)).toBe("20261012080315");
    expect(versionToMs("20261012080315")).toBe(1_791_792_195_000);
    expect(utcVersion(versionToMs("20261231235959"))).toBe("20261231235959");
  });

  it("raport --check nieaktualnego lustra: wpisy, naprawa, bez linii do opisu PR", () => {
    const p = plan(repo({ [S(B)]: B_SQL }));
    const text = renderMirrorPlan(p, "check");
    expect(text.split("\n")).toEqual([
      "✗ Lustro drizzle NIEAKTUALNE (wpisy do wygenerowania: 1, do przepisania: 0, pliki do usunięcia: 0, błędy: 0):",
      `  + 0001_b_fix <- ${S(B)} (when 1060000, ${p.entries[0]!.bytes} B)`,
      "Naprawa: bun run migrations:mirror - i zatwierdź drizzle/ razem z migracją supabase (plików drizzle nie piszesz ręcznie).",
    ]);
  });

  it('raport zapisu: linia „Wpisy dziennika do wdrożenia" do opisu PR, także przy pustym drugim przebiegu z bazą', () => {
    const r = repo({ [S(B)]: B_SQL, [S(C)]: C_SQL });
    const p = plan(r, { base: BASE });
    const line = "Wpisy dziennika do wdrożenia: idx 1-2 (0001_b_fix, 0002_c)";
    expect(deployLine(p.deploy)).toBe(line);
    expect(renderMirrorPlan(p, "write").split("\n").slice(-2)).toEqual([
      'Do sekcji „Wdrożenie bazy" opisu PR:',
      line,
    ]);
    const again = plan(apply(r, p), { base: BASE });
    expect(mirrorFresh(again)).toBe(true);
    // Lustra lokalne są w każdym przebiegu generowane od nowa, a nadal niesione.
    expect(again.lastCarried).toBe(C);
    expect(renderMirrorPlan(again, "dry-run")).toContain(line);
    expect(renderMirrorPlan(again, "check")).not.toContain("Wpisy dziennika do wdrożenia");
    expect(plan(apply(r, p)).deploy).toEqual([]);
  });

  it("raport błędów i ostrzeżeń: rodzaj, ścieżka, szczegół; bez linii do opisu PR", () => {
    const p = plan(repo({ [S(B)]: `SET lock_timeout = '5s';\nVACUUM public.t;\n` }));
    const text = renderMirrorPlan(p, "write");
    expect(text).toMatch(/^✗ Lustro drizzle: plan ma błędy/);
    expect(text).toContain(`  [poza-transakcja] ${S(B)}: linia 2: „VACUUM public.t;"`);
    expect(text).toContain(`UWAGA [ustawienie-sesji] ${S(B)}: linia 1:`);
    expect(text).not.toContain("Wpisy dziennika do wdrożenia");
  });
});

describe("prawdziwe repozytorium", () => {
  function realInput(): MirrorRepoInput {
    const input = loadMirrorInput({
      read: readFileOrNull,
      write: () => {
        throw new Error("samotest niczego nie zapisuje");
      },
      remove: () => {
        throw new Error("samotest niczego nie usuwa");
      },
      list: (dir) => readdirSync(dir),
    });
    if ("error" in input) throw new Error(input.error);
    return input;
  }

  it("od dziennika sprzed zamrożenia lustro wysyła wyłącznie pliki nowsze niż ostatni niesiony - nigdy plik appliedOutOfBand ani 20261007140200", () => {
    const real = realInput();
    const frozen = {
      ...real.journal,
      entries: real.journal.entries.slice(0, JOURNAL_FREEZE_IDX + 1),
    };
    const p = planMirror({ ...real, journal: frozen });
    expect(p.errors).toEqual([]);
    // Najnowszy plik niesiony przez dziennik w chwili zamrożenia (kopia 0397).
    const frozenLast = "20261023090300_consent_measurement_separate_fixes.sql";
    expect(real.supabaseSql).toContain(frozenLast);
    const newer = real.supabaseSql.filter((f) => f > frozenLast);
    const sent = p.entries.map((e) => e.source);
    expect(sent).toEqual(newer);
    expect(p.lastCarried).toBe(newer.at(-1));
    expect(p.entries.map((e) => e.idx)).toEqual(newer.map((_, k) => JOURNAL_FREEZE_IDX + 1 + k));
    expect(sent).toEqual(
      expect.arrayContaining([
        "20261025090000_adopt_event_speaker_panel_bio.sql",
        "20261025090010_adopt_membership_coupon_source_indexes.sql",
      ]),
    );
    const outOfBand = SUPABASE_LANE_GAPS.flatMap((g) => ("appliedOutOfBand" in g ? [g.file] : []));
    expect(outOfBand.length).toBeGreaterThan(0);
    for (const file of [...outOfBand, "20261007140200_release_coupon_server_only.sql"])
      expect(sent).not.toContain(file);
  });

  it("plan bez błędów; po zastosowaniu drugi przebieg pusty, a bramki widzą każde lustro jako zapis wdrożenia swojego źródła", () => {
    const real = realInput();
    const first = planMirror(real);
    expect(first.errors).toEqual([]);
    const overlay = new Map<string, string | null>();
    for (const path of first.deletions) overlay.set(path, null);
    for (const file of first.files) overlay.set(file.path, file.content);
    const read: ReadFile = (path) => {
      const hit = overlay.get(path);
      return hit === undefined ? real.read(path) : hit;
    };
    const listed = (names: readonly string[], dir: string, pattern: RegExp): string[] => {
      const added = [...overlay.keys()]
        .filter((p) => p.startsWith(`${dir}/`))
        .map((p) => p.slice(dir.length + 1))
        .filter((n) => pattern.test(n) && !n.includes("/"));
      return [...new Set([...names, ...added])]
        .filter((n) => overlay.get(`${dir}/${n}`) !== null)
        .sort();
    };
    const after = {
      ...real,
      journal: JSON.parse(read(DRIZZLE_JOURNAL)!) as DrizzleJournal,
      drizzleSql: listed(real.drizzleSql, DRIZZLE_MIGRATIONS_DIR, /\.sql$/),
      snapshots: listed(real.snapshots, DRIZZLE_META_DIR, /^[^_]/),
      read,
    };
    expect(mirrorFresh(planMirror(after))).toBe(true);

    const tags = after.journal.entries.map((e) => e.tag);
    const mirrors = tags.flatMap((tag) => {
      const source = mirrorSourceOf(read(D(tag)));
      return source === null ? [] : [{ tag, twin: source }];
    });
    const lanes = analyzeMigrationLanes(tags, MIGRATION_LANES, read, () => real.supabaseSql);
    expect(lanes.deployRecords).toEqual(expect.arrayContaining(mirrors));
    const mirrorTags = new Set(mirrors.map((m) => m.tag));
    expect(lanes.violations.filter((v) => mirrorTags.has(v.tag))).toEqual([]);
    const coverage = analyzeSupabaseCoverage(tags, { read, listSupabase: () => real.supabaseSql });
    expect(coverage.violations.filter((v) => v.kind === "brak-kopii-drizzle")).toEqual([]);
  });

  it("nagłówek lustra nie zmienia SQL-a wykonywalnego żadnego pliku w zakresie bramki", () => {
    const real = realInput();
    const changed = real.supabaseSql
      .filter((f) => (supabaseMigrationVersion(f) ?? "") >= "20260911160000")
      .filter((f) => {
        const sql = real.read(S(f))!;
        return executableSql(mirrorHeader(f) + sql) !== executableSql(sql);
      });
    expect(changed).toEqual([]);
  });
});
