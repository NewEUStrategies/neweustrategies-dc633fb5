/**
 * Czytnik zrzutu `reports/bundle-modules.json` - odpowiada na pytanie, którego
 * bramka `check:bundle` nie umie zadać: PRZEZ CO chunk waży tyle, ile waży.
 *
 * Użycie:
 *   BUNDLE_STATS=1 bun run build
 *   bun run analyze:bundle                # 20 najcięższych chunków + skład entry
 *   bun run analyze:bundle vendor-radix   # skład wskazanego chunku
 *   bun run analyze:bundle --package echarts   # gdzie wylądował dany pakiet
 *
 * i18n: brak treści dla użytkownika - narzędzie deweloperskie.
 */
import { readFileSync } from "node:fs";
import { BUNDLE_STATS_PATH, type BundleStats } from "./lib/bundleStatsPlugin";

const KB = 1024;
const fmt = (bytes: number) => `${(bytes / KB).toFixed(1)} KB`;

let stats: BundleStats;
try {
  stats = JSON.parse(readFileSync(BUNDLE_STATS_PATH, "utf8")) as BundleStats;
} catch {
  console.error(`✗ Brak ${BUNDLE_STATS_PATH}. Najpierw: BUNDLE_STATS=1 bun run build`);
  process.exit(1);
}

const args = process.argv.slice(2);
const packageIdx = args.indexOf("--package");

if (packageIdx !== -1) {
  const needle = args[packageIdx + 1];
  if (!needle) {
    console.error("✗ --package wymaga nazwy (np. --package echarts)");
    process.exit(1);
  }
  console.log(`Moduły pasujące do "${needle}":\n`);
  let total = 0;
  for (const chunk of stats.chunks) {
    const hits = chunk.modules.filter((m) => m.id.includes(needle));
    if (hits.length === 0) continue;
    const sum = hits.reduce((acc, m) => acc + m.renderedLength, 0);
    total += sum;
    console.log(`  ${chunk.fileName}  ${fmt(sum)}  (${hits.length} modułów)`);
  }
  console.log(`\nRazem: ${fmt(total)} (surowo, przed gzipem)`);
  process.exit(0);
}

/** Grupuje moduły chunku po pakiecie npm / katalogu źródłowym pierwszego rzędu. */
function groupKey(id: string): string {
  if (id.startsWith("node_modules/")) {
    const parts = id.split("/");
    return parts[1]?.startsWith("@") ? `${parts[1]}/${parts[2]}` : (parts[1] ?? id);
  }
  const parts = id.split("/");
  return parts.slice(0, Math.min(3, parts.length - 1)).join("/") || id;
}

function printChunk(fileName: string) {
  const chunk = stats.chunks.find((c) => c.fileName.includes(fileName));
  if (!chunk) {
    console.error(`✗ Nie znaleziono chunku pasującego do "${fileName}".`);
    process.exit(1);
  }
  console.log(
    `\n${chunk.fileName}  ${fmt(chunk.rawLength)} surowo` +
      `${chunk.isEntry ? "  [entry]" : chunk.isDynamicEntry ? "  [dynamic entry]" : ""}`,
  );
  console.log(
    `  statyczne importy: ${chunk.imports.length}, dynamiczne: ${chunk.dynamicImports.length}`,
  );
  const grouped = new Map<string, number>();
  for (const mod of chunk.modules) {
    const key = groupKey(mod.id);
    grouped.set(key, (grouped.get(key) ?? 0) + mod.renderedLength);
  }
  const rows = [...grouped].sort((a, b) => b[1] - a[1]).slice(0, 30);
  console.log("\n  Największe grupy (pakiet / katalog):");
  for (const [key, size] of rows) console.log(`    ${fmt(size).padStart(10)}  ${key}`);
  console.log("\n  Największe pojedyncze moduły:");
  for (const mod of chunk.modules.slice(0, 20)) {
    console.log(`    ${fmt(mod.renderedLength).padStart(10)}  ${mod.id}`);
  }
}

if (args[0]) {
  printChunk(args[0]);
} else {
  console.log("Najcięższe chunki klienta (surowo, przed gzipem):\n");
  for (const chunk of stats.chunks.slice(0, 20)) {
    const tag = chunk.isEntry ? " [entry]" : chunk.isDynamicEntry ? " [dyn]" : "";
    console.log(`  ${fmt(chunk.rawLength).padStart(10)}  ${chunk.fileName}${tag}`);
  }
  const entry = stats.chunks.find((c) => c.isEntry);
  if (entry) printChunk(entry.fileName);
}
