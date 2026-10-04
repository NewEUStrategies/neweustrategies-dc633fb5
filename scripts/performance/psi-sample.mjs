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
// LOCALE = pl (domyślnie; `--locale`). PSI ustawia Accept-Language przeglądarki
// pomiarowej z parametru `locale` (w UI: `hl`). Bez niego API mierzy z `en`,
// a `homepageLangMiddleware` (src/start.ts) odpowiada na `/` z Accept-Language
// en i bez cookie przekierowaniem 302 na `/en` - próbnik mierzył więc INNĄ
// stronę (wersję EN po dodatkowym przeskoku) niż właściciel z `hl=pl`.
// Przebieg, w którym ścieżka końcowa różni się od żądanej, jest oznaczany.
//
// HIT/MISS. PSI nie zwraca nagłówków odpowiedzi, więc stanu cache dokumentu na
// brzegu (`x-nes-cache`) nie da się odczytać wprost - zgadujemy go z audytu
// `server-response-time`: HIT na produkcji to 0,13-0,5 s, MISS 1,8-3,3 s
// (EVIDENCE §2), próg 1 000 ms dzieli obie grupy z zapasem. STALE (odpowiedź
// z cache + rewalidacja w tle) jest szybki jak HIT i tak jest liczony. MISS
// kosztuje wyłącznie SI (Lantern nie symuluje TTFB dla FCP/LCP), ale to
// -3,4 pkt mobile / -4,8 desktop na przebieg - mediana z mieszanki HIT/MISS
// jest inną liczbą niż mediana z samych HIT, więc przy mieszance drukujemy obie.
//
// ZAPIS przebiegu: `<forma>-<n>.lhr.json` = PEŁNY `lighthouseResult` (otwiera go
// Lighthouse Viewer, `--from-file` i analizy JSON-ów z D13) oraz
// `<forma>-<n>.field.json` = reszta odpowiedzi API (dane polowe CrUX, znaczniki
// czasu) bez drugiej kopii LHR. `summary.json` = mediany, klasy cache per
// przebieg i URL zapytania (klucz zamaskowany).
//
// `--from-file` (wielokrotnie; plik albo katalog) przyjmuje:
//   - odpowiedź API v5 (`{ lighthouseResult, loadingExperience, ... }`),
//   - sam LHR - tak zapisuje „Save as JSON" w raporcie na pagespeed.web.dev
//     (ręczne eksporty z `hl=pl`, decyzja D13) i Lighthouse CLI,
//   - raport HTML Lighthouse'a („Save as HTML": LHR w `window.__LIGHTHOUSE_JSON__`).
// W katalogu pliki, które nie są raportem (`summary.json`, `*.field.json`),
// są pomijane; jawnie podany plik, który nie jest raportem, kończy się błędem.
//
// Użycie:
//   PSI_API_KEY=... node scripts/performance/psi-sample.mjs [--url https://neweuropeanstrategies.com/]
//        [--strategy mobile,desktop] [--runs 5] [--gap 15] [--locale pl] [--out katalog]
//        [--baseline plik.json] [--save-baseline plik.json]
//   node scripts/performance/psi-sample.mjs --from-file eksport.json [--from-file katalog/] ...
//        [--baseline plik.json] [--save-baseline plik.json] [--out katalog]   (analiza offline)
//
// Kod wyjścia 1, gdy którakolwiek z żądanych form nie ma ANI JEDNEGO udanego
// przebiegu - nocny workflow `psi.yml` ma wtedy być czerwony, a nie zielony
// z pustym `summary.json`.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
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

export const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
/** Język pomiaru = język strony z kontraktu (`hl=pl`); patrz nagłówek pliku. */
export const DEFAULT_LOCALE = "pl";
/** `server-response-time` powyżej progu = dokument renderowany na brzegu (MISS). */
export const MISS_THRESHOLD_MS = 1000;
/** Pojedyncze wywołanie PSI trwa 20-60 s; dłużej = zawieszone połączenie. */
const PSI_TIMEOUT_MS = 150_000;
const PSI_ATTEMPTS = 4;

/** URL zapytania PSI API v5 dla jednego przebiegu. */
export function psiRequestUrl(target, strategy, { key, locale = DEFAULT_LOCALE } = {}) {
  const params = new URLSearchParams({ url: target, strategy, category: "performance", locale });
  if (key) params.set("key", key);
  return `${PSI_ENDPOINT}?${params}`;
}

/** URL zapytania do logu i `summary.json` - bez klucza API. */
export function redactKey(requestUrl) {
  const url = new URL(requestUrl);
  if (url.searchParams.has("key")) url.searchParams.set("key", "***");
  return url.href;
}

/** Mierzony URL z unikalnym `utm_source` (omija cache wyników PSI, nie cache dokumentu). */
export function cacheBustedTarget(url, tag) {
  const target = new URL(url);
  target.searchParams.set("utm_source", `nes-psi-${tag}`);
  return target.href;
}

/** HIT/MISS dokumentu z `server-response-time`; `?`, gdy audytu nie ma w LHR. */
export function classifyCache(lhr, thresholdMs = MISS_THRESHOLD_MS) {
  const value = lhr?.audits?.["server-response-time"]?.numericValue;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { cache: "?", serverResponseMs: null };
  }
  return { cache: value > thresholdMs ? "MISS" : "HIT", serverResponseMs: value };
}

function pathOf(url) {
  if (typeof url !== "string" || url === "") return "";
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/** Forma, locale, przekierowanie i klasa cache jednego przebiegu. */
export function runInfo(lhr) {
  const requestedPath = pathOf(lhr?.requestedUrl);
  const finalPath = pathOf(lhr?.finalDisplayedUrl ?? lhr?.finalUrl);
  return {
    form: lhr?.configSettings?.formFactor ?? "?",
    locale: lhr?.configSettings?.locale ?? "?",
    requestedPath,
    finalPath,
    redirected: requestedPath !== "" && finalPath !== "" && requestedPath !== finalPath,
    ...classifyCache(lhr),
  };
}

export function cacheCounts(infos) {
  const counts = { HIT: 0, MISS: 0, "?": 0 };
  for (const info of infos) counts[info.cache] += 1;
  return counts;
}

/**
 * Minimum, którego potrzebuje `extractMetrics`: wersja, audyty i kategorie
 * (wynik `performance`). Bez `categories` agregacja padłaby na TypeError
 * zamiast czytelnego „to nie jest raport".
 */
function isLhr(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.lighthouseVersion === "string" &&
    typeof value.audits === "object" &&
    value.audits !== null &&
    typeof value.categories === "object" &&
    value.categories !== null
  );
}

// Lighthouse wstawia LHR do raportu HTML jako `window.__LIGHTHOUSE_JSON__ = {...};</script>`
// i koduje każde `<` w JSON-ie jako `\u003c`, więc wewnątrz LHR nie ma `</script>`
// i pierwsze `};</script>` po znaczniku kończy JSON.
const LHR_IN_HTML_RE = /window\.__LIGHTHOUSE_JSON__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/;

/**
 * Rozpoznaje zapisany raport: odpowiedź API v5, sam LHR albo raport HTML.
 * `null` = to nie jest raport Lighthouse'a.
 */
export function parsePsiInput(text) {
  if (text.trimStart().startsWith("<")) {
    const match = LHR_IN_HTML_RE.exec(text);
    if (!match) return null;
    try {
      const lhr = JSON.parse(match[1]);
      return isLhr(lhr) ? { kind: "lhr-html", lhr, response: null } : null;
    } catch {
      return null;
    }
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (isLhr(data?.lighthouseResult)) {
    return { kind: "psi-api", lhr: data.lighthouseResult, response: data };
  }
  if (isLhr(data)) return { kind: "lhr", lhr: data, response: null };
  return null;
}

/** Ścieżki z `--from-file`: plik wprost albo raporty z katalogu (posortowane). */
export function expandInputs(paths) {
  const out = [];
  for (const path of paths) {
    const full = resolve(path);
    if (!statSync(full).isDirectory()) {
      out.push({ file: full, explicit: true });
      continue;
    }
    for (const name of readdirSync(full).sort()) {
      if (!/\.(json|html?)$/i.test(name)) continue;
      if (name === "summary.json" || name.endsWith(".field.json")) continue;
      out.push({ file: join(full, name), explicit: false });
    }
  }
  return out;
}

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

function describe(info) {
  const srt = info.serverResponseMs === null ? "?" : `${Math.round(info.serverResponseMs)}ms`;
  const redirect = info.redirected
    ? ` PRZEKIEROWANIE ${info.requestedPath} -> ${info.finalPath}`
    : "";
  return `cache=${info.cache} (server-response-time=${srt}) locale=${info.locale}${redirect}`;
}

/** Linia przebiegu + dane do agregacji. */
function measureRun(label, lhr) {
  const info = runInfo(lhr);
  const metrics = extractMetrics(lhr);
  console.log(`${formatRun(label, metrics)} ${describe(info)}`);
  return { label, metrics, info };
}

/** Mediany per forma, liczniki HIT/MISS i (przy mieszance) mediana z samych HIT. */
function reportForms(byForm, { minRunsForMedian }) {
  const forms = {};
  for (const [form, runs] of Object.entries(byForm)) {
    if (!runs.length) continue;
    const agg = aggregate(runs.map((r) => r.metrics));
    const counts = cacheCounts(runs.map((r) => r.info));
    const hits = runs.filter((r) => r.info.cache === "HIT");
    const hitAgg =
      hits.length && hits.length < runs.length ? aggregate(hits.map((r) => r.metrics)) : null;
    if (runs.length >= minRunsForMedian) {
      const unknown = counts["?"] ? ` ?=${counts["?"]}` : "";
      console.log(
        `${formatMedian(`psi ${form}`, agg)} cache HIT=${counts.HIT} MISS=${counts.MISS}${unknown}`,
      );
      if (hitAgg) console.log(formatMedian(`psi ${form} tylko-HIT`, hitAgg));
    }
    if (counts.MISS === runs.length) {
      console.log(
        `  UWAGA ${form}: wszystkie przebiegi MISS (server-response-time > ${MISS_THRESHOLD_MS} ms) - mediana mierzy zimny brzeg, SI zawyżone`,
      );
    }
    const redirected = runs.filter((r) => r.info.redirected);
    if (redirected.length) {
      const hops = [
        ...new Set(redirected.map((r) => `${r.info.requestedPath} -> ${r.info.finalPath}`)),
      ];
      console.log(
        `  UWAGA ${form}: ${redirected.length}/${runs.length} przebiegów przekierowanych (${hops.join(", ")}) - PSI zmierzył inną stronę niż żądana; sprawdź locale (hl=pl)`,
      );
    }
    forms[form] = {
      n: agg.n,
      median: agg.median,
      min: agg.min,
      max: agg.max,
      lcpElement: agg.lcpElement,
      finalPath: agg.finalPath,
      cache: counts,
      ...(hitAgg ? { hitOnly: { n: hitAgg.n, median: hitAgg.median } } : {}),
      runs: runs.map((r) => ({
        label: r.label,
        cache: r.info.cache,
        serverResponseMs: r.info.serverResponseMs,
        locale: r.info.locale,
        finalPath: r.info.finalPath,
      })),
    };
  }
  return forms;
}

function printBaselineDelta(baselineOpt, forms) {
  const baselineFile = baselineOpt && resolve(baselineOpt);
  if (!baselineFile || !existsSync(baselineFile)) return;
  const base = JSON.parse(readFileSync(baselineFile, "utf8"));
  for (const [form, f] of Object.entries(forms)) {
    if (base.forms?.[form]) {
      console.log(deltaLine(`psi vs baseline ${form}`, base.forms[form].median, f.median));
    }
  }
}

function writeSummary(data, { outDir, saveBaseline }) {
  const text = `${JSON.stringify(data, null, 2)}\n`;
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "summary.json"), text);
  }
  if (saveBaseline) writeFileSync(resolve(saveBaseline), text);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callPsi(requestUrl) {
  let lastError = "";
  for (let attempt = 1; attempt <= PSI_ATTEMPTS; attempt++) {
    let res = null;
    try {
      res = await fetch(requestUrl, { signal: AbortSignal.timeout(PSI_TIMEOUT_MS) });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (res?.ok) return res.json();
    if (res) {
      const text = await res.text();
      if (res.status !== 429 && res.status < 500) {
        throw new Error(`PSI HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      lastError = `HTTP ${res.status}`;
    }
    if (attempt === PSI_ATTEMPTS) break;
    const wait = 30_000 * attempt;
    console.log(`  PSI ${lastError} - ponowienie za ${wait / 1000} s`);
    await sleep(wait);
  }
  throw new Error(`PSI: wyczerpane ponowienia (${lastError})`);
}

async function sampleLive(opts) {
  const key = process.env.PSI_API_KEY;
  if (!key) console.log("UWAGA: brak PSI_API_KEY - wspólny limit anonimowy, spodziewaj się 429");
  const runs = Math.max(1, Number.parseInt(opts.runs, 10) || 5);
  const gapMs = Math.max(0, Number.parseFloat(opts.gap) || 0) * 1000;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = resolve(opts.out ?? join(HARNESS_ROOT, "reports/psi", stamp));
  mkdirSync(outDir, { recursive: true });
  const strategies = opts.strategy
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const byForm = {};
  const requests = {};
  for (const strategy of strategies) {
    const list = (byForm[strategy] = []);
    for (let n = 1; n <= runs; n++) {
      const label = `${strategy}-${n}`;
      const target = cacheBustedTarget(opts.url, `${stamp}-${label}`);
      const requestUrl = psiRequestUrl(target, strategy, { key, locale: opts.locale });
      if (n === 1) {
        requests[strategy] = redactKey(requestUrl);
        console.log(`zapytanie PSI ${strategy}: ${requests[strategy]}`);
      }
      try {
        const response = await callPsi(requestUrl);
        const { lighthouseResult: lhr, ...field } = response;
        if (!isLhr(lhr)) throw new Error("odpowiedź PSI bez lighthouseResult");
        writeFileSync(join(outDir, `${label}.lhr.json`), JSON.stringify(lhr));
        writeFileSync(join(outDir, `${label}.field.json`), `${JSON.stringify(field, null, 2)}\n`);
        list.push(measureRun(label, lhr));
        if (n === 1) {
          for (const line of fieldData(response)) console.log(line);
          writeFileSync(join(outDir, `${label}.audits.txt`), `${dumpAudits(lhr, 40)}\n`);
        }
      } catch (error) {
        console.log(`  ${label}: ${error instanceof Error ? error.message : error}`);
      }
      if (n < runs) await sleep(gapMs);
    }
  }
  const forms = reportForms(byForm, { minRunsForMedian: 1 });
  printBaselineDelta(opts.baseline, forms);
  writeSummary(
    {
      schema: 1,
      source: "psi",
      url: opts.url,
      locale: opts.locale,
      missThresholdMs: MISS_THRESHOLD_MS,
      requests,
      savedAt: new Date().toISOString(),
      transport: "psi",
      forms,
    },
    { outDir, saveBaseline: opts["save-baseline"] },
  );
  console.log(`wyniki: ${outDir}`);
  const empty = strategies.filter((s) => !forms[s]);
  if (empty.length) {
    console.error(`✗ PSI: zero udanych przebiegów dla: ${empty.join(", ")}`);
    process.exitCode = 1;
  }
}

function analyzeFiles(opts) {
  const inputs = expandInputs(opts["from-file"]);
  const single = inputs.length === 1;
  const byForm = {};
  const fieldShown = new Set();
  for (const { file, explicit } of inputs) {
    const parsed = parsePsiInput(readFileSync(file, "utf8"));
    if (!parsed) {
      if (explicit) {
        throw new Error(
          `${file}: to nie jest raport Lighthouse'a (LHR, odpowiedź PSI API ani raport HTML)`,
        );
      }
      console.log(`  pominięty (to nie raport Lighthouse'a): ${basename(file)}`);
      continue;
    }
    const label = basename(file).replace(/(\.lhr)?\.(json|html?)$/i, "");
    const run = measureRun(label, parsed.lhr);
    (byForm[run.info.form] ??= []).push(run);
    if (parsed.response && !fieldShown.has(run.info.form)) {
      fieldShown.add(run.info.form);
      for (const line of fieldData(parsed.response)) console.log(line);
    }
    if (single) console.log(dumpAudits(parsed.lhr, 25));
  }
  const forms = reportForms(byForm, { minRunsForMedian: 2 });
  if (!Object.keys(forms).length) {
    console.error("✗ --from-file: żaden plik nie jest raportem Lighthouse'a");
    process.exitCode = 1;
    return;
  }
  printBaselineDelta(opts.baseline, forms);
  writeSummary(
    {
      schema: 1,
      source: "psi-files",
      files: inputs.map((i) => i.file),
      missThresholdMs: MISS_THRESHOLD_MS,
      savedAt: new Date().toISOString(),
      transport: "psi",
      forms,
    },
    { outDir: opts.out && resolve(opts.out), saveBaseline: opts["save-baseline"] },
  );
}

async function main() {
  const { values: opts } = parseArgs({
    options: {
      url: { type: "string", default: "https://neweuropeanstrategies.com/" },
      strategy: { type: "string", default: "mobile,desktop" },
      runs: { type: "string", default: "5" },
      gap: { type: "string", default: "15" },
      locale: { type: "string", default: DEFAULT_LOCALE },
      out: { type: "string" },
      baseline: { type: "string" },
      "save-baseline": { type: "string" },
      "from-file": { type: "string", multiple: true },
    },
  });
  if (opts["from-file"]?.length) analyzeFiles(opts);
  else await sampleLive(opts);
}

/** Moduł bywa importowany przez testy - wtedy NIE odpala próbkowania. */
function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
