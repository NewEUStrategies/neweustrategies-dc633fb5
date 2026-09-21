/**
 * Bramka: test z literałem daty NIE MOŻE czytać prawdziwego zegara.
 *
 * Cienki runner - inwariant, uzasadnienie i detektor żyją w
 * `src/lib/ci/clockFreeze.ts` (konwencja jak `check-unknown-casts.ts`).
 *
 * Usage: bun run check:clock-freeze
 *        bun run check:clock-freeze --print-baseline   (po rozbrojeniu długu)
 *        bun run check:clock-freeze --hot [dni]        (triage: strefa gorąca)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  compareWithRatchet,
  isScannable,
  isTestFile,
  ratchetFailed,
  renderReport,
  scanClockFreeze,
  type SourceFile,
} from "../src/lib/ci/clockFreeze";
import { CLOCK_FREEZE_BASELINE } from "./lib/clockFreezeBaseline";

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

function collect(): SourceFile[] {
  return walk(SCAN_ROOT, [])
    .map((path) => relative(process.cwd(), path).replaceAll("\\", "/"))
    .filter(isScannable)
    .map((file) => ({ file, source: readFileSync(file, "utf8") }));
}

/** `2026-09-02T08:30` -> ms. Literał bez godziny liczymy od północy UTC. */
function literalMs(literal: string): number {
  const iso =
    literal.length === 10
      ? `${literal}T00:00:00`
      : literal.length === 16
        ? `${literal}:00`
        : literal;
  return Date.parse(`${iso}Z`);
}

function main(): void {
  const scan = scanClockFreeze(collect());

  if (process.argv.includes("--print-baseline")) {
    console.log(scan.bombs.map((b) => `  ["${b.file}", ${b.literals}],`).join("\n"));
    return;
  }

  if (process.argv.includes("--hot")) {
    const argIndex = process.argv.indexOf("--hot");
    const days = Number(process.argv[argIndex + 1] ?? "30") || 30;
    const now = Date.now();
    const hot = scan.bombs
      .map((b) => ({
        ...b,
        ageDays: b.newestLiteral === null ? null : (now - literalMs(b.newestLiteral)) / 86_400_000,
      }))
      .filter(
        (b): b is typeof b & { ageDays: number } => b.ageDays !== null && !Number.isNaN(b.ageDays),
      )
      .filter((b) => b.ageDays >= 0 && b.ageDays <= days)
      .sort((a, b) => a.ageDays - b.ageDays);
    console.log(
      `[clock-freeze] strefa gorąca: ${hot.length} plików z najnowszym literałem w ostatnich ${days} dniach`,
    );
    console.log(`[clock-freeze] wszystkich bomb: ${scan.bombs.length}`);
    for (const b of hot) {
      console.log(
        `  ${b.ageDays.toFixed(2).padStart(7)}d  ${(b.newestLiteral ?? "").padEnd(20)} ${b.file}  (${b.literals})`,
      );
    }
    return;
  }

  const baseline = new Map(CLOCK_FREEZE_BASELINE);
  const knownTestFiles = new Set(
    collect()
      .map((f) => f.file)
      .filter(isTestFile),
  );
  const report = compareWithRatchet(scan, baseline, knownTestFiles);
  const rendered = renderReport(report, baseline.size);
  if (ratchetFailed(report)) {
    console.error(rendered);
    process.exit(1);
  }
  console.log(rendered);
}

main();
