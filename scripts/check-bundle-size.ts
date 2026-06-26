/**
 * Dependency-free client bundle-size budget. Gzips every JS asset in the built
 * client output and fails (exit 1) if the largest single chunk or the total
 * exceeds the budget - a CI gate that catches dependency creep / lost code
 * splitting before it ships.
 *
 * Budgets are floored just above the current footprint (same philosophy as the
 * coverage gate): they guard against regressions without being brittle. Tune via
 * env (MAX_CHUNK_KB / MAX_TOTAL_KB) or edit the defaults below.
 *
 * Usage: bun run scripts/check-bundle-size.ts   (run after `bun run build`)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CLIENT_DIR = process.env.CLIENT_DIR ?? "dist/client";
const MAX_CHUNK_KB = Number(process.env.MAX_CHUNK_KB ?? 250); // largest single gzipped JS chunk (post vendor-split: ~169KB)
const MAX_TOTAL_KB = Number(process.env.MAX_TOTAL_KB ?? 1000); // total gzipped JS

function walkJs(dir: string): string[] {
  let out: string[] = [];
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walkJs(p));
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

function gzipKb(file: string): number {
  return Bun.gzipSync(readFileSync(file)).length / 1024;
}

const files = walkJs(CLIENT_DIR);
if (files.length === 0) {
  console.error(`✗ No client JS found in ${CLIENT_DIR}. Run \`bun run build\` first.`);
  process.exit(1);
}

let total = 0;
let max = 0;
let maxFile = "";
for (const f of files) {
  const kb = gzipKb(f);
  total += kb;
  if (kb > max) {
    max = kb;
    maxFile = f;
  }
}

console.log(`Client JS: ${files.length} files, ${total.toFixed(1)} KB gzip total`);
console.log(`Largest chunk: ${max.toFixed(1)} KB gzip (${maxFile})`);
console.log(`Budgets: chunk ≤ ${MAX_CHUNK_KB} KB, total ≤ ${MAX_TOTAL_KB} KB`);

const errors: string[] = [];
if (max > MAX_CHUNK_KB) errors.push(`largest chunk ${max.toFixed(1)} KB > ${MAX_CHUNK_KB} KB`);
if (total > MAX_TOTAL_KB) errors.push(`total ${total.toFixed(1)} KB > ${MAX_TOTAL_KB} KB`);

if (errors.length) {
  console.error(`✗ Bundle budget exceeded: ${errors.join("; ")}`);
  process.exit(1);
}
console.log("✓ Bundle within budget.");
