#!/usr/bin/env bun
// Repair botched import insertions from the previous migration script
// where `import { useBlocksI18n } ...` was inserted at byte-offset 0
// instead of after the first import block, splitting other tokens.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "src/components/admin/blocks/edit";
const NEEDLE = `import { useBlocksI18n } from "@/lib/blocks/i18n";`;

let fixed = 0;
for (const file of readdirSync(DIR).filter(f => f.endsWith(".tsx"))) {
  const path = join(DIR, file);
  let src = readFileSync(path, "utf8");
  // Find all occurrences; if the needle was injected mid-token (not at start of a line),
  // remove it and re-insert after the first contiguous import block.
  const idx = src.indexOf(NEEDLE);
  if (idx < 0) continue;
  // Check if it's on its own line.
  const before = src[idx - 1];
  if (before === "\n" || before === undefined) continue; // already clean
  // Splice it out (also strip a trailing newline if present)
  src = src.slice(0, idx) + src.slice(idx + NEEDLE.length);
  // Re-insert after first import block.
  const m = src.match(/^(import[^\n]*\n)+/m);
  if (m && m.index !== undefined) {
    const at = m.index + m[0].length;
    src = src.slice(0, at) + NEEDLE + "\n" + src.slice(at);
  } else {
    src = NEEDLE + "\n" + src;
  }
  writeFileSync(path, src);
  fixed++;
}
console.log(`Repaired ${fixed} files.`);
