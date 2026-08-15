/**
 * Bramka: kto woła klucz z nakładki i18n, ten musi tę nakładkę zaimportować.
 *
 * Cienki runner - inwariant, uzasadnienie i wzorce żyją w
 * `src/lib/ci/i18nOverlayImports.ts` (konwencja jak `check-unknown-casts.ts`).
 *
 * Usage: bun run check:i18n-overlay-imports
 *        bun run check:i18n-overlay-imports --print-baseline   (po sprzątaniu)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  collectOverlays,
  compareWithRatchet,
  countsByFile,
  findMissingImports,
  isScannable,
  ratchetFailed,
  renderRatchetReport,
  type ScannedSource,
} from "../src/lib/ci/i18nOverlayImports";
import { I18N_OVERLAY_IMPORT_BASELINE } from "./lib/i18nOverlayImportBaseline";
import { flattenKeys } from "../src/lib/ci/i18nParity";
import { pl as corePl } from "../src/lib/locale/pl";

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
  const sources = collect();
  const overlays = collectOverlays(sources);
  // Klucze rdzenia wnosi `src/lib/i18n.ts` razem z samym `useTranslation()`,
  // więc nie giną z brakującym importem nakładki i są poza bramką.
  const coreKeys = new Set(flattenKeys(corePl));
  const missing = findMissingImports({ sources, overlays, coreKeys });

  if (process.argv.includes("--print-baseline")) {
    const counts = [...countsByFile(missing)].sort((a, b) => a[0].localeCompare(b[0]));
    console.log(counts.map(([file, count]) => `  ["${file}", ${count}],`).join("\n"));
    return;
  }

  const baseline = new Map(I18N_OVERLAY_IMPORT_BASELINE);
  const report = compareWithRatchet(missing, baseline);
  const rendered = renderRatchetReport(report, missing, baseline.size);
  if (ratchetFailed(report)) {
    console.error(rendered);
    process.exit(1);
  }
  console.log(rendered);
}

main();
