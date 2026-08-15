import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regresja: skala rozmiarów z Admin → Opcje motywu → Rozmiary musi realnie
 * sterować typografią kluczowych widoków (landing, /club, /profile, hub
 * administracyjny) oraz obu builderów (Elementor-like + Gutenberg-like).
 * Test pilnuje dwóch rzeczy naraz: mapowania utility → tokeny `--fs-*`/`--lh-*`
 * w CSS oraz obecności zasięgu `data-theme-typography` w tych widokach.
 */

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const styles = read("src/styles.css");

const scopeStart = styles.indexOf("Globalna skala typografii");
const scope = styles.slice(scopeStart);

describe("zasięg typografii motywu (CSS)", () => {
  it("obsługuje atrybut globalny i historyczny alias klubów", () => {
    expect(scopeStart).toBeGreaterThan(-1);
    expect(scope).toContain("[data-theme-typography]");
    expect(scope).toContain("[data-club-typography]");
  });

  const sizeMap: ReadonlyArray<readonly [string, string, string]> = [
    [".text-xs", "--tt-fs-xs", "--lh-small"],
    [".text-sm", "--tt-fs-sm", "--lh-small"],
    [".text-base", "--tt-fs-base", "--lh-body"],
    [".text-lg", "--tt-fs-lg", "--lh-lead"],
    [".text-xl", "--tt-fs-xl", "--lh-h5"],
    [".text-2xl", "--tt-fs-2xl", "--lh-h4"],
    [".text-3xl", "--tt-fs-3xl", "--lh-h3"],
  ];

  it.each(sizeMap)("utility %s mapuje się na %s + %s", (utility, fsToken, lhToken) => {
    const idx = scope.indexOf(`\n  ${utility} {`);
    expect(idx, `brak reguły dla ${utility}`).toBeGreaterThan(-1);
    const block = scope.slice(idx, scope.indexOf("}", idx));
    expect(block).toContain(`font-size: var(${fsToken})`);
    expect(block).toContain(`line-height: var(${lhToken}`);
  });

  const headingMap: ReadonlyArray<readonly [string, string, string]> = [
    ["h1", "--fs-h1", "--lh-h1"],
    ["h2", "--fs-h2", "--lh-h2"],
    ["h3", "--fs-h3", "--lh-h3"],
    ["h4", "--fs-h4", "--lh-h4"],
    ["h5", "--fs-h5", "--lh-h5"],
    ["h6", "--fs-h6", "--lh-h6"],
  ];

  it.each(headingMap)("nagłówek %s czyta %s / %s", (tag, fsToken, lhToken) => {
    const idx = scope.indexOf(`  ${tag}:not([class*="text-"]) {`);
    expect(idx, `brak reguły dla ${tag}`).toBeGreaterThan(-1);
    const block = scope.slice(idx, scope.indexOf("}", idx));
    expect(block).toContain(`--tt-heading-fs: var(${fsToken}`);
    expect(block).toContain(`--tt-heading-lh: var(${lhToken}`);
  });

  it("aliasy --club-fs-* nadal wskazują na tokeny motywu", () => {
    expect(scope).toContain("--club-fs-base: var(--tt-fs-base)");
    expect(scope).toContain("--tt-fs-base: var(--fs-body");
  });
});

describe("zasięg typografii w kluczowych widokach", () => {
  const surfaces: ReadonlyArray<readonly [string, string, string]> = [
    ["landing (/)", "src/routes/index.tsx", "data-theme-typography"],
    ["profil (/profile)", "src/routes/profile.tsx", "data-theme-typography"],
    ["hub admina (/admin)", "src/routes/admin.index.tsx", "data-theme-typography"],
    ["kluby (/club)", "src/routes/club.tsx", "data-club-typography"],
    [
      "builder Elementor",
      "src/components/builder/organisms/BuilderRenderer.tsx",
      "data-theme-typography",
    ],
    ["builder Gutenberg", "src/components/admin/blocks/BlockCanvas.tsx", "data-theme-typography"],
  ];

  it.each(surfaces)("%s deklaruje zasięg typografii", (_label, file, attr) => {
    expect(read(file)).toContain(attr);
  });
});
