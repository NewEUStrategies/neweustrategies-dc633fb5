/**
 * Bramka: rzutowanie `as unknown as` może tylko znikać.
 *
 * Cienki runner - inwariant, uzasadnienie i wzorce żyją w
 * `src/lib/ci/unknownCasts.ts` (konwencja jak `check-i18n-hardcoded.ts`).
 *
 * Usage: bun run check:unknown-casts
 *        bun run check:unknown-casts --print-baseline   (po ścięciu długu)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  compareWithRatchet,
  countsByFile,
  isScannable,
  ratchetFailed,
  renderRatchetReport,
  scanUnknownCasts,
  type ScannedSource,
} from "../src/lib/ci/unknownCasts";
import { UNKNOWN_CAST_BASELINE } from "./lib/unknownCastBaseline";

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
  const hits = scanUnknownCasts(collect());

  if (process.argv.includes("--print-baseline")) {
    const counts = [...countsByFile(hits)].sort((a, b) => a[0].localeCompare(b[0]));
    console.log(counts.map(([file, count]) => `  ["${file}", ${count}],`).join("\n"));
    return;
  }

  const baseline = new Map(UNKNOWN_CAST_BASELINE);
  const report = compareWithRatchet(hits, baseline);
  const rendered = renderRatchetReport(report, baseline.size);
  if (ratchetFailed(report)) {
    console.error(rendered);
    process.exit(1);
  }
  console.log(rendered);
}

main();
