/**
 * Bramka: tekst dla użytkownika nie rozgałęzia się po języku w kodzie.
 *
 * Cienki runner - inwariant, uzasadnienie i wzorce żyją w
 * `src/lib/ci/hardcodedLanguage.ts` (konwencja jak `check-stale-never-casts.ts`).
 *
 * Usage: bun run check:i18n-hardcoded
 *        bun run check:i18n-hardcoded --print-baseline   (po konwersji plików)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  compareWithRatchet,
  countsByFile,
  isScannable,
  ratchetFailed,
  renderRatchetReport,
  scanHardcodedLanguage,
  type ScannedSource,
} from "../src/lib/ci/hardcodedLanguage";
import { HARDCODED_LANGUAGE_BASELINE } from "./lib/i18nHardcodedBaseline";

const SCAN_ROOT = "src";
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage"]);

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function collect(): ScannedSource[] {
  return walk(SCAN_ROOT, [])
    .map((path) => relative(process.cwd(), path).replaceAll("\\", "/"))
    .filter(isScannable)
    .map((file) => ({ file, source: readFileSync(file, "utf8") }));
}

function main(): void {
  const hits = scanHardcodedLanguage(collect());

  if (process.argv.includes("--print-baseline")) {
    const counts = [...countsByFile(hits)].sort((a, b) => a[0].localeCompare(b[0]));
    console.log(counts.map(([file, count]) => `  ["${file}", ${count}],`).join("\n"));
    return;
  }

  const baseline = new Map(HARDCODED_LANGUAGE_BASELINE);
  const report = compareWithRatchet(hits, baseline);
  const rendered = renderRatchetReport(report, baseline.size);
  if (ratchetFailed(report)) {
    console.error(rendered);
    process.exit(1);
  }
  console.log(rendered);
}

main();
