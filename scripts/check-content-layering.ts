/**
 * Bramka inwariantu: SILNIKI TREŚCI MAJĄ JEDEN KIERUNEK ZALEŻNOŚCI.
 *
 *   content-model  ->  nie zna żadnego silnika ani tras
 *   bloki          ->  nie importuje z buildera (zero wyjątków)
 *   builder        ->  MOŻE importować z bloków (realnie je hostuje)
 *
 * Cienki runner - inwariant, uzasadnienie i wzorce warstw żyją w
 * `src/lib/ci/contentLayering.ts` (konwencja jak `check-stale-never-casts.ts`).
 * Dzięki temu inwariant ma test jednostkowy
 * (`src/lib/ci/__tests__/contentLayering.test.ts`), a nie tylko przebieg w CI.
 *
 * Usage: bun run check:content-layering
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  isScannable,
  renderContentLayeringReport,
  scanContentLayering,
  type ScannedSource,
} from "../src/lib/ci/contentLayering";

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
  const report = scanContentLayering(collect());
  const rendered = renderContentLayeringReport(report);

  if (report.violations.length > 0) {
    console.error(rendered);
    process.exit(1);
  }
  console.log(rendered);
}

main();
