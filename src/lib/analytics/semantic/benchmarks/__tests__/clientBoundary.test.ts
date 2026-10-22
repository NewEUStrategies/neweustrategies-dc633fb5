// @vitest-environment node
// BRAMKA GRANICY KLIENT/SERWER treści benchmarków (SPEC §5.5, N13, AD-09).
//
// Treść grup (`groups/*.server.ts`, oba języki) i rejestr źródeł z cytatami
// (`sources.ts`) mają żyć WYŁĄCZNIE na serwerze: klient dostaje jedną grupę
// w jednym języku przez `getBenchmarkGroup`. Jeden statyczny import treści
// z komponentu albo z modułu klienta (indeks, adapter, ewaluator) wciągnąłby
// setki KB do chunku panelu - bez błędu kompilacji i bez czerwonego testu
// zachowania. Dlatego granica jest sprawdzana na ŹRÓDLE: poza
// `benchmarks.functions.ts` (import dynamiczny w handlerze), samymi plikami
// treści i testami nikt nie importuje `benchmarks/sources` ani `benchmarks/groups`.
//
// Skan pomija komentarze (`bezKomentarzy`) - komentarz cytujący zakazany
// import nie jest importem i nie może wywracać bramki.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bezKomentarzy } from "@/lib/ci/sourceScan";

const ROOT = path.resolve(".");
const BENCH_DIR = "src/lib/analytics/semantic/benchmarks";
const SOURCES_MODULE = `${BENCH_DIR}/sources`;
const GROUPS_DIR = `${BENCH_DIR}/groups/`;

/** Specyfikatory importów statycznych, re-eksportów i `import()` w kodzie bez komentarzy. */
function importSpecifiers(code: string): { spec: string; dynamic: boolean }[] {
  const out: { spec: string; dynamic: boolean }[] = [];
  const staticRe = /\b(?:import|export)\b[^'"`;]*?\bfrom\s*(['"])([^'"]+)\1/g;
  const sideEffectRe = /\bimport\s*(['"])([^'"]+)\1/g;
  const dynamicRe = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  for (const m of code.matchAll(staticRe)) out.push({ spec: m[2], dynamic: false });
  for (const m of code.matchAll(sideEffectRe)) out.push({ spec: m[2], dynamic: false });
  for (const m of code.matchAll(dynamicRe)) out.push({ spec: m[2], dynamic: true });
  return out;
}

/** Specyfikator → ścieżka względem korzenia repo bez rozszerzenia (`@/` = `src/`). */
function resolveSpec(fromFile: string, spec: string): string | null {
  let target: string;
  if (spec.startsWith("@/")) target = path.join("src", spec.slice(2));
  else if (spec.startsWith(".")) target = path.join(path.dirname(fromFile), spec);
  else return null;
  return target
    .split(path.sep)
    .join("/")
    .replace(/\.(tsx?|jsx?)$/, "");
}

function isContent(resolved: string): boolean {
  return resolved === SOURCES_MODULE || resolved.startsWith(GROUPS_DIR);
}

function isTest(file: string): boolean {
  return /(^|\/)__tests__\//.test(file) || /\.(test|spec)\.tsx?$/.test(file);
}

/** Wolno: server fn, same pliki treści (wzajemne typy), testy. Importer leży w `scripts/`. */
function mayImportContent(file: string): boolean {
  return (
    file === `${BENCH_DIR}/benchmarks.functions.ts` ||
    file === `${SOURCES_MODULE}.ts` ||
    file.startsWith(GROUPS_DIR) ||
    isTest(file)
  );
}

/**
 * Inne server fn z prawem WYŁĄCZNIE do rejestru źródeł (bez treści grup)
 * i WYŁĄCZNIE importem dynamicznym w handlerze: diagnostyka S7 liczy wiek
 * źródeł benchmarków (`data_quality.benchmarkSources`) z dat publikacji.
 * Import w handlerze kompilator wycina z chunku klienta, jak w
 * `benchmarks.functions.ts` - statyczny import nadal czerwieni bramkę.
 */
const SOURCES_READERS: readonly string[] = ["src/lib/revenue/diagnostics/diagnostics.functions.ts"];

function sourceFiles(): string[] {
  return readdirSync(path.join(ROOT, "src"), { recursive: true, encoding: "utf8" })
    .filter((rel) => /\.(ts|tsx)$/.test(rel) && !rel.endsWith(".d.ts"))
    .map((rel) => `src/${rel.split(path.sep).join("/")}`);
}

describe("granica treści benchmarków", () => {
  const files = sourceFiles();

  it("skan widzi moduły klienta benchmarków (bramka nie jest pusta)", () => {
    expect(files).toContain(`${BENCH_DIR}/adapter.ts`);
    expect(files).toContain(`${BENCH_DIR}/evaluate.ts`);
    expect(files).toContain("src/lib/analytics/semantic/metricHelp.ts");
  });

  it("poza server fn, plikami treści i testami nikt nie importuje sources.ts ani groups/**", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (mayImportContent(file)) continue;
      const code = bezKomentarzy(readFileSync(path.join(ROOT, file), "utf8"));
      for (const { spec, dynamic } of importSpecifiers(code)) {
        const resolved = resolveSpec(file, spec);
        if (!resolved || !isContent(resolved)) continue;
        const sourcesReader =
          SOURCES_READERS.includes(file) && dynamic && resolved === SOURCES_MODULE;
        if (!sourcesReader) offenders.push(`${file} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("czytelnicy rejestru źródeł istnieją i sięgają po niego wyłącznie dynamicznie", () => {
    for (const file of SOURCES_READERS) {
      expect(files).toContain(file);
      const code = bezKomentarzy(readFileSync(path.join(ROOT, file), "utf8"));
      const content = importSpecifiers(code).filter(({ spec }) => {
        const resolved = resolveSpec(file, spec);
        return resolved !== null && isContent(resolved);
      });
      expect(content.length).toBeGreaterThan(0);
      expect(content.every((c) => c.dynamic && resolveSpec(file, c.spec) === SOURCES_MODULE)).toBe(
        true,
      );
    }
  });

  it("server fn sięga po treść WYŁĄCZNIE dynamicznie: sześć literalnych grup i rejestr źródeł", () => {
    const file = `${BENCH_DIR}/benchmarks.functions.ts`;
    const code = bezKomentarzy(readFileSync(path.join(ROOT, file), "utf8"));
    const content = importSpecifiers(code).filter(({ spec }) => {
      const resolved = resolveSpec(file, spec);
      return resolved !== null && isContent(resolved);
    });
    expect(content.every((c) => c.dynamic)).toBe(true);
    expect(content.map((c) => c.spec).sort()).toEqual(
      [
        "./groups/community.server",
        "./groups/economics.server",
        "./groups/email.server",
        "./groups/funnel.server",
        "./groups/retention.server",
        "./groups/revenue.server",
        "./sources",
      ].sort(),
    );
  });

  it("pliki w groups/ mają sufiks .server (konwencja modułów tylko-serwerowych)", () => {
    const dir = path.join(ROOT, GROUPS_DIR);
    const entries = existsSync(dir) ? readdirSync(dir) : [];
    for (const name of entries) expect(name).toMatch(/\.server\.ts$/);
  });

  it("detektor łapie import statyczny, re-eksport i import dynamiczny, a pomija komentarz", () => {
    const sample = bezKomentarzy(
      [
        'import { BENCHMARK_SOURCES } from "@/lib/analytics/semantic/benchmarks/sources";',
        'export { REVENUE_BENCHMARKS } from "./groups/revenue.server";',
        'const g = await import("../benchmarks/groups/email.server");',
        '// import { x } from "./sources";',
      ].join("\n"),
    );
    const from = `${BENCH_DIR}/adapter.ts`;
    const resolved = importSpecifiers(sample)
      .map(({ spec }) => resolveSpec(from, spec))
      .filter((r): r is string => r !== null && isContent(r));
    expect(resolved).toEqual([
      SOURCES_MODULE,
      `${GROUPS_DIR}revenue.server`,
      `${GROUPS_DIR}email.server`,
    ]);
  });
});
