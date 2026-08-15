/**
 * Codemod: usuwa ZBĘDNE zapasowe teksty z wywołań `t()`.
 *
 * Usuwa WYŁĄCZNIE wystąpienia z werdyktem `redundant`, czyli takie, których
 * klucz ma liść tekstowy w PL I W EN - wtedy i18next nigdy po zapas nie sięga
 * i wycięcie linii nie może zmienić ani jednego wyrenderowanego znaku.
 * Uzasadnienie w `src/lib/ci/i18nDefaultValue.ts`.
 *
 * Miejsca `load-bearing` (realny brak w słowniku) i `dynamic` zostają NIETKNIĘTE
 * i są wypisywane - to robota do ręki, nie do codemodu.
 *
 * Usage: bun run codemod:i18n-default-value          (przepisuje pliki)
 *        bun run codemod:i18n-default-value --dry     (tylko raport)
 */
import { writeFileSync } from "node:fs";
import {
  classifyDefaultValues,
  removeDefaultValues,
  reportDefaultValues,
  type DefaultValueSite,
} from "../src/lib/ci/i18nDefaultValue";
import { loadDictionaries } from "./lib/i18nDictionaries";
import { collectSources } from "./check-i18n-default-value";

function groupByFile(sites: readonly DefaultValueSite[]): Map<string, DefaultValueSite[]> {
  const out = new Map<string, DefaultValueSite[]>();
  for (const site of sites) {
    const bucket = out.get(site.file);
    if (bucket === undefined) out.set(site.file, [site]);
    else bucket.push(site);
  }
  return out;
}

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");
  const trees = await loadDictionaries();
  const sources = collectSources();
  const sites = classifyDefaultValues(sources, trees);
  const report = reportDefaultValues(sites);

  const byFile = groupByFile(report.redundant);
  const byPath = new Map(sources.map((s) => [s.file, s.source]));

  let touched = 0;
  let removed = 0;
  for (const [file, fileSites] of byFile) {
    const source = byPath.get(file);
    if (source === undefined) continue;
    const result = removeDefaultValues(source, fileSites);
    if (result.removed === 0) continue;
    if (!dry) writeFileSync(file, result.source, "utf8");
    touched += 1;
    removed += result.removed;
  }

  console.log(
    `[codemod:i18n-default-value] ${dry ? "SUCHY BIEG - " : ""}usunięto ${removed} zapasowych` +
      ` tekstów w ${touched} plikach (skan: ${sources.length} plików, ${trees.overlays} nakładek).`,
  );

  if (report.loadBearing.length > 0) {
    console.log(
      `\n[!] ${report.loadBearing.length} wystąpień NOŚNYCH - klucza brakuje w słowniku,` +
        " tekst z kodu JEST renderowany. Nietknięte:",
    );
    for (const site of report.loadBearing) {
      console.log(`  - ${site.file}:${site.line}  ${site.key}  "${site.text.slice(0, 70)}"`);
    }
  }
  if (report.dynamic.length > 0) {
    console.log(`\n[!] ${report.dynamic.length} wystąpień z kluczem DYNAMICZNYM. Nietknięte:`);
    for (const site of report.dynamic) {
      console.log(`  - ${site.file}:${site.line}  ${site.key}`);
    }
  }
  const interpolated = report.redundant.filter((s) => s.interpolated);
  if (interpolated.length > 0) {
    console.log(
      `\n[i] ${interpolated.length} usuniętych zapasów było template'ami z interpolacją.` +
        " Wartość w słowniku musi nieść `{{zmienną}}`, a wywołanie ją przekazać - sprawdź:",
    );
    for (const site of interpolated) {
      console.log(`  - ${site.file}:${site.line}  ${site.key}`);
    }
  }
}

await main();
