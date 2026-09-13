/**
 * Bramka: każdy `dangerouslySetInnerHTML` w `src/` dochodzi do DOM-u przez
 * zaufany sanitizer.
 *
 * Cienki runner - inwariant, lista zaufanych sanitizerów i uzasadnienie żyją
 * w `src/lib/ci/dangerousHtml.ts` (konwencja jak `check-content-layering.ts`),
 * a imienne zwolnienia w `scripts/lib/dangerousHtmlAllowlist.ts`. Dzięki temu
 * inwariant ma test jednostkowy, a nie tylko przebieg w CI.
 *
 * Usage: bun run check:dangerous-html
 *        bun run scripts/check-dangerous-html.ts --print-allowlist
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  dangerousHtmlFailed,
  isScannable,
  renderDangerousHtmlReport,
  scanDangerousHtml,
  sinkSymbol,
  type ScannedSource,
} from "../src/lib/ci/dangerousHtml";
import { DANGEROUS_HTML_ALLOWLIST } from "./lib/dangerousHtmlAllowlist";

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
  const report = scanDangerousHtml(collect(), DANGEROUS_HTML_ALLOWLIST);

  // Podpowiedź przy pierwszym wpięciu i po refaktorze: gotowe wpisy do
  // wklejenia (wzorem check-i18n-hardcoded.ts --print-baseline). Powód pisze
  // człowiek - bramka nie umie uzasadnić, dlaczego coś jest bezpieczne.
  if (process.argv.includes("--print-allowlist")) {
    console.log(
      report.violations
        .map((v) =>
          [
            "  {",
            `    file: "${v.file}",`,
            `    sink: "${v.sink}",`,
            `    symbol: "${sinkSymbol(v.expression)}",`,
            `    reason: "TODO (${v.line}): ${v.expression.replaceAll('"', "'")}",`,
            "  },",
          ].join("\n"),
        )
        .join("\n"),
    );
    return;
  }

  const rendered = renderDangerousHtmlReport(report);
  if (dangerousHtmlFailed(report)) {
    console.error(rendered);
    process.exit(1);
  }
  console.log(rendered);
}

main();
