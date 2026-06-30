/**
 * Dependency-free client bundle-size budget. Gzips every JS asset in the built
 * client output and fails (exit 1) if a budget is exceeded - a CI gate that
 * catches dependency creep / lost code splitting before it ships. Deterministic:
 * no browser or server required (unlike the Lighthouse job).
 *
 * Three budgets, because a single "total app JS" number conflates two very
 * different costs:
 *
 *   PUBLIC  - every chunk a public visitor can ever download (first load plus
 *             in-session navigation across public routes). THIS is the
 *             performance-meaningful budget: it is what real readers pay for.
 *   OVERALL - every chunk, INCLUDING admin/editor-only code (the visual builder,
 *             block editor, theme panes, /admin routes, builder drag-and-drop).
 *             A coarser backstop so the CMS surface can't balloon unnoticed even
 *             though readers never download it: that code is split behind the
 *             auth-gated /admin routes and is unreachable from any public URL.
 *   CHUNK   - the largest single chunk, to catch a lost code-split or a giant
 *             dependency landing in one file.
 *
 * Counting admin-only chunks against the PUBLIC budget would penalise shipping a
 * richer CMS that has zero user-facing cost, so they are billed to OVERALL only.
 *
 * Budgets are floored just above the current footprint (same philosophy as the
 * coverage gate): they guard against regressions without being brittle. Tune via
 * env (MAX_PUBLIC_KB / MAX_TOTAL_KB / MAX_CHUNK_KB) or edit the defaults below.
 *
 * Usage: bun run scripts/check-bundle-size.ts   (run after `bun run build`)
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

// The client build dir differs by adapter (Nitro/TanStack Start -> .output/public,
// plain Vite SSR -> dist/client). Auto-detect the first candidate that actually
// contains JS so the gate works regardless of target; override with CLIENT_DIR.
const CLIENT_DIR =
  process.env.CLIENT_DIR ??
  [".output/public", "dist/client", "dist"].find((d) => walkJs(d).length > 0) ??
  ".output/public";
const MAX_CHUNK_KB = Number(process.env.MAX_CHUNK_KB ?? 250); // largest single gzipped JS chunk (today: ~181KB, the client entry)
const MAX_PUBLIC_KB = Number(process.env.MAX_PUBLIC_KB ?? 1000); // gzipped JS a public visitor can load (today: ~930KB)
const MAX_TOTAL_KB = Number(process.env.MAX_TOTAL_KB ?? 1300); // gzipped JS incl. admin/editor-only chunks (today: ~1201KB)

// Chunks reachable ONLY from the auth-gated /admin (CMS) routes - never from a
// public URL, so they never count against the public-perf budget. Matched on the
// emitted chunk basename: route chunks are named by route ("admin.*"); the
// builder/editor organisms and admin-only drag-and-drop by component
// ("Builder-", "PostBlockEditor", "ThemeOptionsPane", "AdminShell", "sidebar",
// "vendor-dnd"). Keep this in sync with the manualChunks split in vite.config.ts.
const ADMIN_ONLY = /^(admin\.|Builder-|PostBlockEditor|ThemeOptionsPane|AdminShell|sidebar|vendor-dnd-)/;
function isAdminOnly(file: string): boolean {
  return ADMIN_ONLY.test(basename(file));
}

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
let publicTotal = 0;
let max = 0;
let maxFile = "";
for (const f of files) {
  const kb = gzipKb(f);
  total += kb;
  if (!isAdminOnly(f)) publicTotal += kb;
  if (kb > max) {
    max = kb;
    maxFile = f;
  }
}
const adminTotal = total - publicTotal;

console.log(`Client JS: ${files.length} files, ${total.toFixed(1)} KB gzip total`);
console.log(`  public:      ${publicTotal.toFixed(1)} KB  (budget ≤ ${MAX_PUBLIC_KB} KB)`);
console.log(`  admin-only:  ${adminTotal.toFixed(1)} KB  (billed to OVERALL only)`);
console.log(`  overall:     ${total.toFixed(1)} KB  (budget ≤ ${MAX_TOTAL_KB} KB)`);
console.log(`Largest chunk: ${max.toFixed(1)} KB gzip (${maxFile})  (budget ≤ ${MAX_CHUNK_KB} KB)`);

const errors: string[] = [];
if (max > MAX_CHUNK_KB) errors.push(`largest chunk ${max.toFixed(1)} KB > ${MAX_CHUNK_KB} KB`);
if (publicTotal > MAX_PUBLIC_KB) errors.push(`public total ${publicTotal.toFixed(1)} KB > ${MAX_PUBLIC_KB} KB`);
if (total > MAX_TOTAL_KB) errors.push(`overall total ${total.toFixed(1)} KB > ${MAX_TOTAL_KB} KB`);

if (errors.length) {
  console.error(`✗ Bundle budget exceeded: ${errors.join("; ")}`);
  process.exit(1);
}
console.log("✓ Bundle within budget.");
