/**
 * Bramka inwariantu: ŻADEN CAST `as never` NA GRANICY SUPABASE NIE PRZEŻYWA
 * REGENERACJI WYGENEROWANYCH TYPÓW.
 *
 * Cienki runner - cała logika (zasięg skanu, parser wygenerowanych typów,
 * uzasadnienie inwariantu) żyje w `src/lib/ci/staleNeverCasts.ts`, tak jak
 * `check-legacy-payment-refs.ts` trzyma swoją w `src/lib/ci/legacyPaymentRefs.ts`.
 * Dzięki temu inwariant ma test jednostkowy
 * (`src/lib/ci/__tests__/staleNeverCasts.test.ts`), a nie tylko przebieg w CI.
 *
 * Usage: bun run scripts/check-stale-never-casts.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  isScannable,
  readGeneratedTypeNames,
  renderStaleNeverCastsReport,
  scanStaleNeverCasts,
  type ScannedSource,
} from "../src/lib/ci/staleNeverCasts";

const SCAN_ROOT = "src";
const TYPES_FILE = "src/integrations/supabase/types.ts";
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
  const known = readGeneratedTypeNames(readFileSync(TYPES_FILE, "utf8"));
  const sources = collect();
  const hits = scanStaleNeverCasts(sources, known);
  const report = renderStaleNeverCastsReport(hits, sources.length, known);

  if (hits.length > 0) {
    console.error(report);
    process.exit(1);
  }
  console.log(report);
}

main();
