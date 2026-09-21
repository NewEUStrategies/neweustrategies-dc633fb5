/**
 * Bramka czystości grafu serwera: `stripe` i inne ciężkie zależności
 * server-only mają być w artefakcie Workera osiągalne wyłącznie przez
 * `import()`, a zamrożone statyczne importy parsera HTML nie mają się rozlewać.
 *
 * Cienki runner - inwariant i uzasadnienie żyją w
 * `src/lib/ci/serverEntryPurity.ts`, więc bramka ma test jednostkowy
 * (`src/lib/ci/__tests__/serverEntryPurity.test.ts`), a nie tylko przebieg w CI.
 *
 * Usage: bun run check:server-entry-purity   (po `bun run build`)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { bezKomentarzy } from "../src/lib/ci/sourceScan";
import {
  analyzeServerEntryPurity,
  renderServerEntryPurityReport,
  serverEntryPurityFailed,
  FROZEN_STATIC_IMPORTERS,
  LAZY_ONLY_PACKAGES,
  type ServerChunk,
  type SourceFile,
} from "../src/lib/ci/serverEntryPurity";

/** Ten sam zestaw katalogów, co w `scripts/check-entry-purity.ts`. */
const SERVER_DIRS = [".output/server", "dist/server"] as const;
const SOURCE_DIR = "src";

function walk(dir: string, keep: (file: string) => boolean): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // `node_modules` w artefakcie to kopia zależności runtime'u Nitro, nie
      // nasze chunki - skanowanie jej dokładałoby minuty i zero sygnału.
      if (entry === "node_modules") continue;
      out.push(...walk(full, keep));
      continue;
    }
    if (keep(entry)) out.push(full);
  }
  return out;
}

function readServerChunks(): { root: string; chunks: ServerChunk[] } {
  for (const dir of SERVER_DIRS) {
    const files = walk(dir, (file) => file.endsWith(".mjs") || file.endsWith(".js"));
    if (files.length === 0) continue;
    return {
      root: dir,
      chunks: files.map((file) => ({
        path: relative(dir, file),
        source: readFileSync(file, "utf8"),
      })),
    };
  }
  return { root: SERVER_DIRS[0], chunks: [] };
}

function readSources(): SourceFile[] {
  return walk(SOURCE_DIR, (file) => file.endsWith(".ts") || file.endsWith(".tsx")).map((file) => ({
    path: file,
    // Komentarze w tym repozytorium CYTUJĄ importy, których bramka zakazuje -
    // bez maskowania bramka przewracałaby się na własnej dokumentacji.
    source: bezKomentarzy(readFileSync(file, "utf8")),
  }));
}

function main(): void {
  const { root, chunks } = readServerChunks();
  const report = analyzeServerEntryPurity({
    chunks,
    sources: readSources(),
    lazyOnlyPackages: LAZY_ONLY_PACKAGES,
    frozenRules: FROZEN_STATIC_IMPORTERS,
  });

  const rendered = renderServerEntryPurityReport(report);
  if (serverEntryPurityFailed(report)) {
    console.error(`Artefakt serwera: ${root}`);
    console.error(rendered);
    process.exit(1);
  }
  console.log(`Artefakt serwera: ${root}`);
  console.log(rendered);
  console.log(
    `  leniwe wyłącznie: ${LAZY_ONLY_PACKAGES.map((p) => p.chunk).join(", ")}\n` +
      `  zamrożony dług:   ${FROZEN_STATIC_IMPORTERS.map((r) => `${r.pkg} (${r.allowed.length})`).join(", ")}`,
  );
}

main();
