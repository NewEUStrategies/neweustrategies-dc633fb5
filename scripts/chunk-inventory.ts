/**
 * Raport składu bundla przeglądarki: co NAPRAWDĘ siedzi w danym chunku.
 *
 * Czyta `reports/chunk-inventory.json` zapisany przez wtyczkę pomiarową
 * (`scripts/lib/chunkInventoryPlugin.ts`), więc wymaga builda z włączonym
 * pomiarem:
 *
 *   BUNDLE_INVENTORY=1 bun run build
 *   bun run report:chunk-inventory              # 20 najcięższych chunków
 *   bun run report:chunk-inventory index        # rozbicie chunku po pakietach
 *   bun run report:chunk-inventory index --modules
 *
 * Bajty są sprzed minifikacji CAŁEGO chunku (Rollup zna tylko taki podział), więc
 * służą do porównań WZGLĘDNYCH - bezwzględne kilobajty gzip mierzy `check:bundle`.
 */
import { readFileSync } from "node:fs";
import type { ChunkInventory, ChunkInventoryChunk } from "./lib/chunkInventoryPlugin";

const REPORT_PATH = "reports/chunk-inventory.json";
const TOP_CHUNKS = 20;
const TOP_ROWS = 25;

/** Pakiet npm albo katalog źródeł - jednostka, w której myśli się o wadze. */
function ownerOf(moduleId: string): string {
  const nodeModules = moduleId.lastIndexOf("node_modules/");
  if (nodeModules !== -1) {
    const rest = moduleId.slice(nodeModules + "node_modules/".length).split("/");
    return rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
  }
  const src = moduleId.lastIndexOf("/src/");
  if (src !== -1) {
    const rest = moduleId.slice(src + "/src/".length).split("/");
    return rest.length > 1 ? `src/${rest[0]}/${rest[1]}` : `src/${rest[0]}`;
  }
  return moduleId;
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

function readInventory(): ChunkInventory {
  try {
    return JSON.parse(readFileSync(REPORT_PATH, "utf8")) as ChunkInventory;
  } catch {
    console.error(
      `✗ Brak ${REPORT_PATH}.\n` + "  Zbuduj z pomiarem:  BUNDLE_INVENTORY=1 bun run build",
    );
    process.exit(1);
  }
}

function findChunk(inventory: ChunkInventory, needle: string): ChunkInventoryChunk | undefined {
  return (
    inventory.chunks.find((c) => c.file === needle) ??
    inventory.chunks.find((c) => c.file.includes(needle))
  );
}

function printOverview(inventory: ChunkInventory): void {
  const total = inventory.chunks.reduce((sum, c) => sum + c.bytes, 0);
  console.log(`Bundel klienta: ${inventory.chunks.length} chunkow, ${kb(total)} przed minifikacja`);
  console.log(`(katalog: ${inventory.outDir})\n`);
  console.log(`${TOP_CHUNKS} najciezszych chunkow:`);
  for (const chunk of inventory.chunks.slice(0, TOP_CHUNKS)) {
    const role = chunk.isEntry ? " [entry]" : chunk.isDynamicEntry ? " [lazy]" : "";
    console.log(`  ${kb(chunk.bytes).padStart(10)}  ${chunk.file}${role}`);
  }
  console.log("\nRozbicie pojedynczego chunku:  bun run report:chunk-inventory <fragment-nazwy>");
}

function printChunk(chunk: ChunkInventoryChunk, showModules: boolean): void {
  const role = chunk.isEntry ? "entry" : chunk.isDynamicEntry ? "lazy" : "wspoldzielony";
  console.log(`${chunk.file}  (${role}, ${kb(chunk.bytes)} przed minifikacja)`);
  console.log(
    `  importy statyczne: ${chunk.imports.length}, dynamiczne: ${chunk.dynamicImports.length}\n`,
  );

  if (showModules) {
    console.log(`Najciezsze moduly (top ${TOP_ROWS}):`);
    for (const m of chunk.modules.slice(0, TOP_ROWS)) {
      console.log(`  ${kb(m.bytes).padStart(10)}  ${m.id}`);
    }
    return;
  }

  const byOwner = new Map<string, number>();
  for (const m of chunk.modules) {
    const owner = ownerOf(m.id);
    byOwner.set(owner, (byOwner.get(owner) ?? 0) + m.bytes);
  }
  const rows = [...byOwner].sort((a, b) => b[1] - a[1]);
  console.log(`Waga wg pakietu / katalogu (top ${TOP_ROWS} z ${rows.length}):`);
  for (const [owner, bytes] of rows.slice(0, TOP_ROWS)) {
    const share = ((bytes / chunk.bytes) * 100).toFixed(1).padStart(5);
    console.log(`  ${kb(bytes).padStart(10)}  ${share}%  ${owner}`);
  }
  console.log("\nPelna lista modulow:  ... <fragment-nazwy> --modules");
}

function main(): void {
  const inventory = readInventory();
  const args = process.argv.slice(2);
  const needle = args.find((a) => !a.startsWith("--"));

  if (!needle) {
    printOverview(inventory);
    return;
  }

  const chunk = findChunk(inventory, needle);
  if (!chunk) {
    console.error(`✗ Nie znaleziono chunku pasujacego do "${needle}".`);
    process.exit(1);
  }
  printChunk(chunk, args.includes("--modules"));
}

main();
