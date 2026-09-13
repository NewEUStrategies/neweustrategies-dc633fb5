/**
 * Bramka: każde `dangerouslySetInnerHTML` ma wpis z pisanym uzasadnieniem.
 *
 * Cienki runner - inwariant, uzasadnienie i wzorce żyją w
 * `src/lib/ci/rawHtmlSinks.ts` (konwencja jak `check-unknown-casts.ts`).
 *
 * Usage: bun run check:raw-html-sinks
 *        bun run check:raw-html-sinks --print-baseline   (po zmianie inwentarza)
 *
 * `--print-baseline` PRZENOSI uzasadnienia, które już są w
 * `scripts/lib/rawHtmlSinkBaseline.ts`, i wypisuje puste `why` tylko dla plików
 * nowych - dzięki temu odświeżenie listy nigdy nie kasuje po cichu powodu,
 * a nowy plik ląduje z pustym uzasadnieniem, które bramka i tak odrzuci.
 * Wyjście wkleja się do pliku listy i przepuszcza przez `bun run format`
 * (Prettier sam zawija długie `why`).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  compareWithAllowlist,
  countsByFile,
  isScannable,
  rawHtmlFailed,
  renderRawHtmlSinkReport,
  scanRawHtmlSinks,
  type ScannedSource,
} from "../src/lib/ci/rawHtmlSinks";
import { RAW_HTML_SINK_BASELINE } from "./lib/rawHtmlSinkBaseline";

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
  const hits = scanRawHtmlSinks(collect());

  if (process.argv.includes("--print-baseline")) {
    const counts = [...countsByFile(hits)].sort((a, b) => a[0].localeCompare(b[0]));
    console.log(
      counts
        .map(([file, sites]) => {
          const why = RAW_HTML_SINK_BASELINE[file]?.why ?? "";
          return `  ${JSON.stringify(file)}: { sites: ${sites}, why: ${JSON.stringify(why)} },`;
        })
        .join("\n"),
    );
    return;
  }

  const allowlist = new Map(Object.entries(RAW_HTML_SINK_BASELINE));
  const report = compareWithAllowlist(hits, allowlist);
  const rendered = renderRawHtmlSinkReport(report, allowlist.size);
  if (rawHtmlFailed(report)) {
    console.error(rendered);
    process.exit(1);
  }
  console.log(rendered);
}

main();
