// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW
//
// Test wlasnosci na KAZDEJ migracji z repozytorium, a nie na kilku
// wymyslonych przykladach: ponad tysiac plikow pisanych recznie, przez panel
// Lovable i przez agentow - z E'...', cialami $tag$, blokami DO, polityka po
// polityce. Ciecie przy malym limicie (8 KiB) wymusza setki granic na plik,
// wiec kazdy blad leksera (granica w srodku literalu albo ciala funkcji)
// wychodzi tu jako rozjazd SQL-a wykonywalnego czesci wobec oryginalu.
// Czesc ponad limitem wolno zostawic TYLKO wtedy, gdy w jej srodku nie ma ani
// jednej dozwolonej granicy (pojedyncza instrukcja albo grupa nierozlaczna).
// Na koniec: kazda migracja da sie pociac przy limicie domyslnym, a kazda para
// blizniakow z MIGRATION_LANES tnie sie w tych samych miejscach.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MIGRATION_LANES, executableSql } from "../migrationLaneParity";
import {
  boundaryLocks,
  lexStatements,
  splitAligned,
  type LaneSource,
  type SplitResult,
} from "../migrationSplit";
import { partHeader, partTrailer } from "../migrationSplitPlan";

const SUPABASE = "supabase/migrations";
const DRIZZLE = "drizzle/migrations";
const SMALL = 8 * 1024;

const files = readdirSync(SUPABASE)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const read = (path: string): string => readFileSync(path, "utf8");

const lane = (sql: string, original: string): LaneSource => {
  const ctx = {
    original,
    partName: (k: number) => `${original}#${k}`,
    markers: ["events-harness: include"],
    maxBytes: SMALL,
  };
  return { sql, header: (k, n) => partHeader(ctx, k, n), trailer: (n) => partTrailer(ctx, n) };
};

/** Czesc ponad limitem musi byc nierozcinalna: kazda jej wewnetrzna granica zablokowana. */
function oversizeIsAtomic(result: SplitResult): boolean {
  return result.oversize.every((k) => {
    const part = result.lanes[0]![k]!;
    const body = part.text.slice(part.head, part.text.length - part.tail);
    return boundaryLocks(lexStatements(body))
      .slice(1)
      .every((lock) => lock !== null);
  });
}

describe("wlasnosc: kazda migracja z supabase/migrations", () => {
  it("lekser sklada kazdy plik z powrotem bajt w bajt, a SQL wykonywalny instrukcji == pliku", () => {
    for (const file of files) {
      const sql = read(`${SUPABASE}/${file}`);
      const segs = lexStatements(sql);
      expect(segs.map((s) => s.text).join(""), file).toBe(sql);
      expect(
        segs
          .map((s) => executableSql(s.text))
          .filter((s) => s !== "")
          .join(" "),
        file,
      ).toBe(executableSql(sql));
    }
    expect(files.length).toBeGreaterThan(500);
  });

  it("przy 8 KiB: SQL czesci == SQL oryginalu, czesci <= limit poza nierozcinalnymi grupami", () => {
    let split = 0;
    for (const file of files) {
      const sql = read(`${SUPABASE}/${file}`);
      const result = splitAligned([lane(sql, file)], { maxBytes: SMALL, onOversize: "isolate" });
      const parts = result.lanes[0]!;
      if (parts.length > 1) split += 1;
      expect(parts.map((p) => executableSql(p.text)).join(" "), file).toBe(executableSql(sql));
      parts.forEach((p, k) => {
        if (!result.oversize.includes(k))
          expect(p.bytes, `${file} czesc ${k + 1}`).toBeLessThanOrEqual(SMALL);
      });
      expect(oversizeIsAtomic(result), file).toBe(true);
    }
    // Pusty skan nie moze byc zielony: przy 8 KiB tnie sie kilkaset plikow.
    expect(split).toBeGreaterThan(300);
  });

  it("przy limicie domyslnym (45 KiB) KAZDA migracja tnie sie bez bledu i bez czesci ponad limitem", () => {
    for (const file of files) {
      const sql = read(`${SUPABASE}/${file}`);
      const result = splitAligned([lane(sql, file)]);
      expect(result.oversize, file).toEqual([]);
      for (const p of result.lanes[0]!) expect(p.bytes, file).toBeLessThanOrEqual(46080);
    }
  });
});

describe("wlasnosc: kazda para blizniakow z MIGRATION_LANES", () => {
  it("pas drizzle tnie sie w tych samych miejscach, czesc k == czesc k drugiego pasa", () => {
    let pairs = 0;
    for (const entry of MIGRATION_LANES) {
      if (!("twin" in entry)) continue;
      pairs += 1;
      const supabase = read(`${SUPABASE}/${entry.twin}`);
      const drizzle = read(`${DRIZZLE}/${entry.tag}.sql`);
      const result = splitAligned([lane(supabase, entry.twin), lane(drizzle, `${entry.tag}.sql`)], {
        maxBytes: SMALL,
        onOversize: "isolate",
      });
      const [s, d] = result.lanes;
      expect(d!.length, entry.tag).toBe(s!.length);
      s!.forEach((p, k) =>
        expect(executableSql(d![k]!.text), `${entry.tag} czesc ${k + 1}`).toBe(
          executableSql(p.text),
        ),
      );
      expect(oversizeIsAtomic(result), entry.tag).toBe(true);
    }
    expect(pairs).toBeGreaterThan(40);
  });
});
