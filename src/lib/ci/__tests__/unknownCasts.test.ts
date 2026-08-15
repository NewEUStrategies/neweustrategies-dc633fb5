import { describe, expect, it } from "vitest";
import {
  compareWithRatchet,
  countsByFile,
  isScannable,
  ratchetFailed,
  renderRatchetReport,
  scanUnknownCasts,
} from "../unknownCasts";

const scan = (source: string, file = "src/x.ts") => scanUnknownCasts([{ file, source }]);

describe("skan", () => {
  it("łapie rzutowanie i zapamiętuje typ docelowy", () => {
    const [hit] = scan("const a = x as unknown as Widget;");
    expect(hit.target).toBe("Widget");
    expect(hit.line).toBe(1);
  });

  it("łapie typ generyczny i literał obiektu", () => {
    expect(scan("x as unknown as Promise<number>")[0].target).toBe("Promise<number>");
    expect(scan("x as unknown as { id: string }")[0].target).toBe("{");
  });

  it("łapie TYP FUNKCYJNY - ta postać wypadała z ratchetu", () => {
    // `supabase.rpc as unknown as (fn: string, args: …) => PromiseLike<…>`
    // realnie występuje w `lib/experts/materials.ts`; bez tego przypadku
    // dokładanie takich rzutowań nie podnosiło progu (review PR #235).
    const [hit] = scan("const r = supabase.rpc as unknown as (fn: string) => Promise<void>;");
    expect(hit).toBeDefined();
    expect(hit.target).toBe("(");
  });

  it("znosi dowolne białe znaki między słowami kluczowymi", () => {
    expect(scan("x as\n  unknown as\n  Widget")).toHaveLength(1);
  });

  it("NIE liczy własnej dokumentacji - komentarze są maskowane", () => {
    expect(scan("// tu stało `x as unknown as Widget`")).toHaveLength(0);
    expect(scan("/* x as unknown as Widget */")).toHaveLength(0);
  });

  it("nie myli `as unknown` bez drugiego `as`", () => {
    expect(scan("const a = x as unknown;")).toHaveLength(0);
  });

  it("numeruje linie od jedynki", () => {
    expect(scan("const a = 1;\nconst b = x as unknown as T;")[0].line).toBe(2);
  });

  it("pomija testy, bierze produkcję", () => {
    expect(isScannable("src/lib/x.ts")).toBe(true);
    expect(isScannable("src/lib/__tests__/x.test.ts")).toBe(false);
    expect(isScannable("src/lib/x.test.tsx")).toBe(false);
    expect(isScannable("src/lib/x.css")).toBe(false);
  });
});

describe("ratchet", () => {
  const hits = (spec: Record<string, number>) =>
    Object.entries(spec).flatMap(([file, n]) =>
      Array.from({ length: n }, (_, i) => ({ file, line: i + 1, target: "T" })),
    );

  it("nowy plik z długiem oblewa - nowy kod nie może zacząć z długiem", () => {
    const report = compareWithRatchet(hits({ "src/new.ts": 1 }), new Map());
    expect(report.fresh).toHaveLength(1);
    expect(ratchetFailed(report)).toBe(true);
  });

  it("wzrost w znanym pliku oblewa", () => {
    const report = compareWithRatchet(hits({ "src/a.ts": 3 }), new Map([["src/a.ts", 2]]));
    expect(report.grown).toEqual([{ file: "src/a.ts", was: 2, now: 3 }]);
    expect(ratchetFailed(report)).toBe(true);
  });

  it("spadek NIE oblewa - drobne porządki nie wymagają edycji baseline'u", () => {
    const report = compareWithRatchet(hits({ "src/a.ts": 1 }), new Map([["src/a.ts", 2]]));
    expect(ratchetFailed(report)).toBe(false);
    expect(report.improved).toEqual([{ file: "src/a.ts", was: 2, now: 1 }]);
  });

  it("plik wyczyszczony do zera liczy się jako poprawa", () => {
    const report = compareWithRatchet([], new Map([["src/a.ts", 2]]));
    expect(report.improved).toEqual([{ file: "src/a.ts", was: 2, now: 0 }]);
    expect(ratchetFailed(report)).toBe(false);
  });

  it("stan bez zmian przechodzi cicho", () => {
    const report = compareWithRatchet(hits({ "src/a.ts": 2 }), new Map([["src/a.ts", 2]]));
    expect(ratchetFailed(report)).toBe(false);
    expect(renderRatchetReport(report, 1)).toContain("OK");
  });

  it("raport nowego długu podaje trzy znane przyczyny, nie samą liczbę", () => {
    const report = compareWithRatchet(hits({ "src/new.ts": 1 }), new Map());
    const rendered = renderRatchetReport(report, 0);
    expect(rendered).toContain("looseQuery");
    expect(rendered).toContain("toJson()");
    expect(rendered).toContain("strażnik");
  });

  it("liczy wystąpienia per plik", () => {
    expect(countsByFile(hits({ "src/a.ts": 2, "src/b.ts": 1 }))).toEqual(
      new Map([
        ["src/a.ts", 2],
        ["src/b.ts", 1],
      ]),
    );
  });
});
