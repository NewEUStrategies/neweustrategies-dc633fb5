#!/usr/bin/env node
// PRÓBKOWANIE PAGESPEED INSIGHTS (API v5) - pomiar TEJ SAMEJ liczby, którą widzi właściciel.
//
// Lokalny harness (lighthouse-local.mjs) mierzy artefakt na fixture; ten skrypt
// mierzy WDROŻONY URL na hostach Google (to jest „PSI 53 / 70" ze zlecenia),
// N razy na formę, i liczy mediany tym samym kodem (lighthouseReport.ts), więc
// linie MEDIAN/DELTA są porównywalne 1:1 z harnessem lokalnym. Drukuje też dane
// polowe CrUX (`loadingExperience`), jeśli Google je ma dla URL-a/originu.
//
// Klucz: PSI_API_KEY (bez klucza limit jest wspólny i szybko daje 429).
// Każdy przebieg dostaje parametr `utm_source=nes-psi-<znacznik>`: PSI nie poda
// wyniku z własnego cache, a cache dokumentu aplikacji zdejmuje `utm_*` z klucza
// (src/lib/http/documentCache.ts TRACKING_PARAM_PREFIXES), więc mierzymy ten sam
// wpis brzegu co czytelnik.
//
// Użycie:
//   PSI_API_KEY=... node scripts/performance/psi-sample.mjs [--url https://neweuropeanstrategies.com/]
//        [--strategy mobile,desktop] [--runs 5] [--gap 15] [--out katalog]
//        [--baseline plik.json] [--save-baseline plik.json]
//   node scripts/performance/psi-sample.mjs --from-file odpowiedz-psi.json   (analiza offline)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { HARNESS_ROOT } from "./artifactServer.ts";
import {
  aggregate,
  deltaLine,
  dumpAudits,
  extractMetrics,
  formatMedian,
  formatRun,
} from "./lighthouseReport.ts";

const { values: opts } = parseArgs({
  options: {
    url: { type: "string", default: "https://neweuropeanstrategies.com/" },
    strategy: { type: "string", default: "mobile,desktop" },
    runs: { type: "string", default: "5" },
    gap: { type: "string", default: "15" },
    out: { type: "string" },
    baseline: { type: "string" },
    "save-baseline": { type: "string" },
    "from-file": { type: "string" },
  },
});

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

function fieldData(response) {
  const lines = [];
  for (const [label, block] of [
    ["URL", response.loadingExperience],
    ["origin", response.originLoadingExperience],
  ]) {
    const metrics = block?.metrics;
    if (!metrics) continue;
    const parts = Object.entries(metrics).map(
      ([k, v]) => `${k.replace(/_MS$|_SCORE$/, "")}=p75 ${v.percentile} (${v.category})`,
    );
    lines.push(`  CrUX ${label} [${block.overall_category ?? "?"}]: ${parts.join(", ")}`);
  }
  return lines;
}

function lhrOf(response) {
  // Odpowiedź API ma LHR w `lighthouseResult`; zapisany raport CLI to sam LHR.
  return response.lighthouseResult ?? response;
}

async function callPsi(url, strategy, key) {
  const params = new URLSearchParams({ url, strategy, category: "performance" });
  if (key) params.set("key", key);
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`${ENDPOINT}?${params}`);
    if (res.ok) return res.json();
    const text = await res.text();
    if (res.status !== 429 && res.status < 500)
      throw new Error(`PSI HTTP ${res.status}: ${text.slice(0, 300)}`);
    const wait = 30_000 * attempt;
    console.log(`  PSI HTTP ${res.status} - ponowienie za ${wait / 1000} s`);
    await new Promise((r) => setTimeout(r, wait));
  }
  throw new Error("PSI: wyczerpane ponowienia (limit/429)");
}

async function main() {
  if (opts["from-file"]) {
    const response = JSON.parse(readFileSync(resolve(opts["from-file"]), "utf8"));
    const lhr = lhrOf(response);
    console.log(formatRun(lhr.configSettings?.formFactor ?? "?", extractMetrics(lhr)));
    for (const line of fieldData(response)) console.log(line);
    console.log(dumpAudits(lhr, 25));
    return;
  }
  const key = process.env.PSI_API_KEY;
  if (!key) console.log("UWAGA: brak PSI_API_KEY - wspólny limit anonimowy, spodziewaj się 429");
  const runs = Math.max(1, Number.parseInt(opts.runs, 10) || 5);
  const gapMs = Math.max(0, Number.parseFloat(opts.gap) || 0) * 1000;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = resolve(opts.out ?? join(HARNESS_ROOT, "reports/psi", stamp));
  mkdirSync(outDir, { recursive: true });
  const forms = {};
  for (const strategy of opts.strategy.split(",").map((s) => s.trim())) {
    const list = [];
    for (let n = 1; n <= runs; n++) {
      const target = new URL(opts.url);
      target.searchParams.set("utm_source", `nes-psi-${stamp}-${strategy}-${n}`);
      try {
        const response = await callPsi(target.href, strategy, key);
        writeFileSync(join(outDir, `${strategy}-${n}.json`), JSON.stringify(response));
        const lhr = lhrOf(response);
        const metrics = extractMetrics(lhr);
        list.push(metrics);
        console.log(formatRun(`${strategy}-${n}`, metrics));
        if (n === 1) {
          for (const line of fieldData(response)) console.log(line);
          writeFileSync(join(outDir, `${strategy}-1.audits.txt`), `${dumpAudits(lhr, 40)}\n`);
        }
      } catch (error) {
        console.log(`  ${strategy}-${n}: ${error instanceof Error ? error.message : error}`);
      }
      if (n < runs) await new Promise((r) => setTimeout(r, gapMs));
    }
    if (!list.length) continue;
    const agg = aggregate(list);
    forms[strategy] = {
      n: agg.n,
      median: agg.median,
      min: agg.min,
      max: agg.max,
      lcpElement: agg.lcpElement,
      finalPath: agg.finalPath,
    };
    console.log(formatMedian(`psi ${strategy}`, agg));
  }
  const baselineFile = opts.baseline && resolve(opts.baseline);
  if (baselineFile && existsSync(baselineFile)) {
    const base = JSON.parse(readFileSync(baselineFile, "utf8"));
    for (const [strategy, f] of Object.entries(forms)) {
      if (base.forms?.[strategy])
        console.log(
          deltaLine(`psi vs baseline ${strategy}`, base.forms[strategy].median, f.median),
        );
    }
  }
  const data = {
    schema: 1,
    source: "psi",
    url: opts.url,
    savedAt: new Date().toISOString(),
    transport: "psi",
    forms,
  };
  writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(data, null, 2)}\n`);
  if (opts["save-baseline"])
    writeFileSync(resolve(opts["save-baseline"]), `${JSON.stringify(data, null, 2)}\n`);
  console.log(`wyniki: ${outDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
