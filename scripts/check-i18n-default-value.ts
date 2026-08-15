/**
 * Bramka: `t()` NIE NOSI ZAPASOWEGO TEKSTU.
 *
 * Cienki runner - inwariant, uzasadnienie i wzorce żyją w
 * `src/lib/ci/i18nDefaultValue.ts` (konwencja jak `check-i18n-hardcoded.ts`).
 *
 * Usage: bun run check:i18n-default-value
 *        bun run codemod:i18n-default-value   (naprawa mechaniczna)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  classifyDefaultValues,
  defaultValueGateFailed,
  isScannable,
  renderDefaultValueReport,
  reportDefaultValues,
  type ScannedSource,
} from "../src/lib/ci/i18nDefaultValue";
import { loadDictionaries } from "./lib/i18nDictionaries";

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

export function collectSources(): ScannedSource[] {
  return walk(SCAN_ROOT, [])
    .map((path) => relative(process.cwd(), path).replaceAll("\\", "/"))
    .filter(isScannable)
    .map((file) => ({ file, source: readFileSync(file, "utf8") }));
}

async function main(): Promise<void> {
  const trees = await loadDictionaries();
  const sources = collectSources();
  const report = reportDefaultValues(classifyDefaultValues(sources, trees));
  const rendered = renderDefaultValueReport(report, sources.length);

  if (defaultValueGateFailed(report)) {
    console.error(rendered);
    process.exit(1);
  }
  console.log(rendered);
}

// Runner odpala się TYLKO uruchomiony wprost. `codemod-i18n-default-value.ts`
// importuje stąd `collectSources()`, żeby obie ścieżki widziały dokładnie ten
// sam zbiór plików - bez tej bramki import samego skanera kończyłby proces
// codemodu kodem 1, zanim ten zdążyłby cokolwiek naprawić.
if (import.meta.main) await main();
