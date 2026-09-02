// Raport pokrycia per MODUŁ i per FUNKCJONALNOŚĆ z `coverage/coverage-summary.json`.
//
// Wejście: plik reportera `json-summary` (vitest, `coverage.all: true`). Wyjście:
// tabele markdown gotowe do wklejenia do audytu - z licznikiem i mianownikiem,
// nie samym procentem, bo bez mianownika nie da się sprawdzić, czy wiersz
// w ogóle zmierzył to, co obiecuje.
//
// Użycie:
//   node scripts/coverage/report.mjs [--summary <ścieżka>] [--module 16] [--json]
import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyPath, MODULE_NAMES } from "./moduleMap.mjs";
import { FEATURES, FEATURE_NAMES, featureForPath } from "./features.mjs";

const REPO = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function parseArgs(argv) {
  const out = { summary: "coverage/coverage-summary.json", module: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--summary") out.summary = argv[(i += 1)];
    else if (argv[i] === "--module") out.module = Number(argv[(i += 1)]);
    else if (argv[i] === "--json") out.json = true;
  }
  return out;
}

/** Ścieżka repo-względna w formie POSIX (klucze raportu są absolutne). */
function repoPath(key) {
  return relative(REPO, key).split(sep).join("/");
}

const EMPTY = () => ({
  files: 0,
  zero: 0,
  lines: { covered: 0, total: 0 },
  statements: { covered: 0, total: 0 },
  functions: { covered: 0, total: 0 },
  branches: { covered: 0, total: 0 },
});

function add(bucket, entry) {
  bucket.files += 1;
  if (entry.lines.covered === 0) bucket.zero += 1;
  for (const metric of ["lines", "statements", "functions", "branches"]) {
    bucket[metric].covered += entry[metric].covered;
    bucket[metric].total += entry[metric].total;
  }
}

function pct(metric) {
  if (metric.total === 0) return "-";
  return `${((metric.covered / metric.total) * 100).toFixed(2).replace(".", ",")}%`;
}

function cell(metric) {
  return `${pct(metric)} (${metric.covered}/${metric.total})`;
}

export function buildReport(summaryPath) {
  const raw = JSON.parse(readFileSync(summaryPath, "utf8"));
  const modules = new Map();
  const features = new Map();
  const orphans = [];

  for (const [key, entry] of Object.entries(raw)) {
    if (key === "total") continue;
    const path = repoPath(key);
    const { module } = classifyPath(path);
    if (module === null) continue;
    if (!modules.has(module)) modules.set(module, EMPTY());
    add(modules.get(module), entry);
    if (!FEATURES.has(module)) continue;
    const feature = featureForPath(path);
    if (feature === null) {
      orphans.push(path);
      continue;
    }
    if (!features.has(feature)) features.set(feature, EMPTY());
    add(features.get(feature), entry);
  }
  return { modules, features, orphans };
}

function moduleTable(modules) {
  const rows = [...modules.entries()].sort((a, b) => a[0] - b[0]);
  const out = [
    "| #   | Moduł | Plików | Zer | Linie | Gałęzie | Funkcje |",
    "| --- | ----- | -----: | --: | ----: | ------: | ------: |",
  ];
  for (const [id, b] of rows) {
    out.push(
      `| ${id} | ${MODULE_NAMES.get(id) ?? "?"} | ${b.files} | ${b.zero} | ${cell(b.lines)} | ${cell(b.branches)} | ${cell(b.functions)} |`,
    );
  }
  return out.join("\n");
}

function featureTable(features, moduleId) {
  const order = (FEATURES.get(moduleId) ?? []).map((row) => row.key);
  const rows = [...features.entries()].sort(
    (a, b) =>
      a[1].lines.covered / Math.max(1, a[1].lines.total) -
        b[1].lines.covered / Math.max(1, b[1].lines.total) ||
      order.indexOf(a[0]) - order.indexOf(b[0]),
  );
  const out = [
    "| Funkcjonalność | Plików | Zer | Linie | Gałęzie | Funkcje |",
    "| -------------- | -----: | --: | ----: | ------: | ------: |",
  ];
  for (const [key, b] of rows) {
    out.push(
      `| ${FEATURE_NAMES.get(key) ?? key} | ${b.files} | ${b.zero} | ${cell(b.lines)} | ${cell(b.branches)} | ${cell(b.functions)} |`,
    );
  }
  return out.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildReport(resolve(REPO, args.summary));
  if (args.json) {
    const toJson = (map) =>
      Object.fromEntries(
        [...map.entries()].map(([key, value]) => [
          key,
          {
            files: value.files,
            zero: value.zero,
            lines: value.lines,
            statements: value.statements,
            functions: value.functions,
            branches: value.branches,
          },
        ]),
      );
    process.stdout.write(
      `${JSON.stringify({ modules: toJson(report.modules), features: toJson(report.features), orphans: report.orphans }, null, 2)}\n`,
    );
    return;
  }
  if (args.module === null) {
    process.stdout.write(`${moduleTable(report.modules)}\n`);
    return;
  }
  const mod = report.modules.get(args.module);
  process.stdout.write(
    `## MODUŁ ${args.module} - ${MODULE_NAMES.get(args.module)}\n\n` +
      `Plików: ${mod?.files ?? 0} · na zerze: ${mod?.zero ?? 0} · linie ${cell(mod?.lines ?? EMPTY().lines)} · ` +
      `gałęzie ${cell(mod?.branches ?? EMPTY().branches)} · funkcje ${cell(mod?.functions ?? EMPTY().functions)}\n\n` +
      `${featureTable(report.features, args.module)}\n`,
  );
  if (report.orphans.length > 0) {
    process.stdout.write(
      `\nPLIKI POZA TAKSONOMIĄ (${report.orphans.length}):\n${report.orphans.map((p) => `  ${p}`).join("\n")}\n`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
