#!/usr/bin/env node
// LOKALNY LIGHTHOUSE NA ARTEFAKCIE `build:smoke` Z USTAWIENIAMI PSI.
//
// Produktyzacja harnessu z pakietu dowodowego 2026-10-03
// (docs/performance/2026-10-03-pagespeed-85-95/narzedzia/measure-*.sh):
//   1. opcjonalnie buduje artefakt (`--build`: BUNDLE_INVENTORY=1 bun run build:smoke),
//   2. uruchamia `.output/server/index.mjs` z backendem fixture jak
//      `playwright.performance.config.ts` (albo z `.env`, gdy NES_PERFORMANCE_FIXTURE=0),
//   3. stawia front kompresujący (brotli/gzip) - domyślnie HTTPS + HTTP/2 na jednym
//      originie `https://fixture.invalid` razem z obrazami fixture (parytet z produkcją:
//      dokument, JS i obraz LCP z jednego originu po h2; uzasadnienie w artifactServer.ts),
//   4. rozgrzewa cache dokumentu (HIT) UA przeglądarki z Accept-Language pl,
//   5. uruchamia Lighthouse N razy na formę z ustawieniami PSI (mobile = Moto G
//      Power, 4x CPU, 150 ms RTT, 1,6 Mb/s; desktop = `--preset=desktop`;
//      desktop4x/desktop5x = preset desktopowy z mnożnikiem CPU x4/x5, bo desktop
//      x1 na tym hoście daje TBT 0, a PSI desktop mierzy 740 ms), tylko performance,
//   6. drukuje przebiegi, MEDIANY, DELTA wobec baseline'u (albo B-A w trybie A/B)
//      i zrzuca audyty diagnostyczne pierwszego przebiegu każdej formy.
//
// P0.1 (2026-10-04) - wierność pomiaru i ocena szumu:
//   - PONOWNE ROZGRZANIE PRZED KAŻDYM PRZEBIEGIEM (werdykt M1 #1): wpis cache
//     żyje świeżo 3 min, więc bez tego część przebiegów dostawała STALE i serwer
//     renderował SSR w trakcie pomiaru. Każdy przebieg loguje `x-nes-cache`,
//     `x-nes-cache-age`, `server-timing` rozgrzewki i dokumentu, który dostał
//     Lighthouse (log frontu; z `--save-artifacts` także devtoolsLog), oraz
//     render SSR w logach serwerów W TRAKCIE przebiegu. Przebieg z dokumentem
//     innym niż HIT albo z SSR w trakcie jest `excluded` i powtarzany (maks. 2x);
//     mediany, pary i k liczą się wyłącznie z przebiegów ważnych (`n_valid`).
//   - `--client-backend fixture`: żywy PostgREST klienta na 127.0.0.1:4199
//     (clientBackend.ts) - refetch i przepisanie `style[data-brand-tokens]`
//     zachodzą jak na produkcji (domyślnie WYŁĄCZONE: porównywalność z baseline'em).
//   - `--third-party fake-gtag`: atrapa tagu Google (fakeGoogle.ts) przez
//     `--host-resolver-rules` + flaga `__NES_GA_ANY_HOST__` wstrzykiwana do <head>;
//     koszt zadań = produkcja przeliczona przez benchmarkIndex hosta.
//   - `--save-artifacts`: ślad + devtoolsLog każdego przebiegu (`-GA`), na końcu
//     księga Lantern per zadanie (lanternTasks.ts) z kontrolą zgodności z audytem.
//   - tryb A/B: σΔ i MDE z par ważnych przebiegów (linia PAIRS),
//     przy A = B (A/A) kontrola |ΔFCP|, |ΔLCP| ≤ 0,02 s (linia AA); linie K =
//     kalibracja TBT fixture -> PSI (`--psi-reference plik.json` nadpisuje PSI 2026-10-03).
//
// P0.1-FIX (2026-10-04, recenzja scalonego P0.1):
//   - WARIANT DOKUMENTU (B1, D7): wzorcem serii jest wariant z rozgrzewki
//     początkowej (pełny render: `s-maxage=900`; odcisk = `cache-control` wpisu
//     + długość body). Rewalidacja w tle daje na tym artefakcie wariant ze
//     zdegradowanym chrome'em (`s-maxage=30`, diagnoza w P0.1-FIX.md), więc
//     rozgrzewka przed przebiegiem, gdy wpis ma inny wariant, za mało świeżości
//     albo jest STALE, RESTARTUJE serwer artefaktu (pusty magazyn) i rozgrzewa
//     go od nowa. Przebieg z innym wariantem niż wzorzec jest `excluded`.
//     Wariant i tryb FCP każdego przebiegu trafiają do summary.json.
//   - `--max-load` (I2): domyślnie 0,6 x CPU; przebieg przy wyższym loadavg
//     jest `excluded` (dawniej czekanie kończyło się i przebieg szedł dalej).
//   - `--min-valid` (I3, D8): domyślnie `--runs` (nie mniej niż min(3, runs));
//     forma poniżej progu = kod wyjścia 1 i odmowa zapisu baseline'u tej formy.
//     Dwie odpowiedzi rozgrzewki spoza cache (3xx-5xx, bez `x-nes-cache`,
//     BYPASS) przerywają serię; `--allow-uncached` mierzy taką ścieżkę świadomie
//     (ważny przebieg = żadnego renderu poza samym dokumentem Lighthouse'a).
//   - MDE (I4): mnożnik t(df = n-1) zamiast 2,8; linia PAIRS podaje MDE(t)
//     i MDE(z). Pary i AA warstwowane po trybie FCP z księgi (I1) z licznikiem
//     par mieszanych.
//   - `--client-backend none` sprawdza, że nikt nie słucha na 127.0.0.1:4199 (D2);
//     zapisy bez ścieżek maszyny (D3); linia K bez pełnych flag ma dopisek
//     „nie kalibruje" (D6).
//
// P0.1-FIX runda 2 (2026-10-04, weryfikacja poprawki):
//   - wzorzec (`warmReferenceVariant`): jeden restart odróżnia przegrany wyścig
//     chrome'u od własnej polityki trasy (`/live`: s-maxage=30); wzorzec
//     o świeżości ≤ --min-fresh przerywa serię z podpowiedzią niższego zapasu;
//   - restart serwera rozgrzewa też zasoby statyczne nowego procesu, VALID
//     podaje liczbę ważnych przebiegów po restarcie, a bramka obciążenia bierze
//     większy z pomiarów przed i po rozgrzewce (`classifyAttempt`);
//   - w środku serii ścieżka spoza cache wyklucza przebieg zamiast przerywać
//     serię, a wyjątek w trakcie przebiegów zostawia summary.json z ukończonymi
//     przebiegami (kod 1, bez baseline'u);
//   - nieliczbowe --min-valid jest błędem; korzeń poza repo zapisuje się jako
//     `poza-repo:<nazwa>`; tryb FCP liczy tylko skrypty originu dokumentu.
//
// Lighthouse NIE jest zależnością repo: LIGHTHOUSE_CLI=<ścieżka do cli/index.js>
// albo `npx --yes lighthouse@13`. Chrome z CHROME_PATH (chrome-launcher).
//
// Użycie:
//   node scripts/performance/lighthouse-local.mjs [--root .] [--runs 3] [--path /]
//        [--forms mobile,desktop,desktop4x,desktop5x] [--transport h2|h1] [--label nazwa]
//        [--out katalog] [--baseline plik.json] [--save-baseline] [--baseline-out plik.json]
//        [--build] [--no-dump]
//        [--client-backend none|fixture] [--third-party none|fake-gtag] [--fake-gtag-scale N]
//        [--save-artifacts] [--no-ledger] [--repeats 2] [--min-fresh 30]
//        [--psi-reference plik.json] [--min-valid N] [--allow-uncached]
//   node scripts/performance/lighthouse-local.mjs --compare <root-A> <root-B> [--runs 3] ...
//        [--transport-b h1|h2]   (tylko A/B: inny transport dla B, eksperyment parytetu)
//        [--html-transform plik.mjs] [--html-transform-b plik.mjs]
//        (eksperyment „co-jeśli" bez builda: `export default (html, headers) => html`
//        przekształca dokument w proxy; w A/B zwykle tylko B dostaje transformację)
//        [--warm-ua browser|bot] [--max-load N] [--idle-wait s]
//   Env: LIGHTHOUSE_CLI, CHROME_PATH, NES_PERFORMANCE_FIXTURE=0 (środowisko z .env),
//        ACCEPT_LANGUAGE, NES_BUILD_LOCK=<katalog mutexu builda dla --build>
//
// Tryb A/B: oba artefakty działają jednocześnie, przebiegi idą z przeplotem
// (A,B / B,A / A,B ...), więc obciążenie maszyny rozkłada się po równo. Ocena
// zmiany = linia `DELTA <label> B-A` (i księga per zadanie), nie absolutny wynik.
// Obie strony mają ZAWSZE te same flagi (backend, tag, rozgrzanie).

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import {
  BOT_USER_AGENT,
  DEFAULT_ACCEPT_LANGUAGE,
  DEFAULT_MIN_FRESH_S,
  HARNESS_ROOT,
  RewarmAbort,
  WARM_USER_AGENT,
  freePort,
  hostResolverFlag,
  logCursor,
  rewarmDocument,
  startArtifact,
  startFront,
  warmAssets,
  warmDocument,
  warmReferenceVariant,
} from "./artifactServer.ts";
import {
  CLIENT_BACKEND_PORT,
  diffClientBackendStats,
  formatClientBackendStats,
  isPortListening,
  startClientBackend,
} from "./clientBackend.ts";
import {
  GA_ANY_HOST_SNIPPET,
  fakeGoogleScale,
  measureChromeBenchmarkIndex,
  startFakeGoogle,
} from "./fakeGoogle.ts";
import {
  analyzeArtifacts,
  formatFcpMode,
  formatLedger,
  lighthouseLabel,
  resolveLighthouseCore,
} from "./lanternTasks.ts";
import {
  CALIBRATION_FLAGS,
  FORMS,
  MAX_EXCLUDED_REPEATS,
  PSI_REFERENCE_2026_10_03,
  aggregate,
  classifyAttempt,
  comparabilityWarnings,
  defaultMaxLoad,
  deltaLine,
  documentFromDevtoolsLog,
  documentVariant,
  dumpAudits,
  extractMetrics,
  flagsLabel,
  formatAaCheck,
  formatCalibrationLine,
  formatCounts,
  formatMedian,
  formatModePairs,
  formatObservation,
  formatPairedStats,
  formatRun,
  formatValidity,
  formatVariant,
  isServerRender,
  pairedStats,
  pairsByFcpMode,
  parseForms,
  parsePsiReference,
  parseServerLogDocs,
  portableRoot,
  resolveMinValid,
  runWithRepeats,
  scrubPaths,
  seriesOutcome,
  summarizeValidity,
  validMetricsByFcpMode,
  validPairs,
} from "./lighthouseReport.ts";

const BASELINE_DEFAULT = join(HARNESS_ROOT, "reports/lighthouse-local-baseline.json");
const BASELINE_TRACKED = join(
  HARNESS_ROOT,
  "docs/performance/2026-10-03-pagespeed-85-95/lighthouse-local-baseline.json",
);
/** Flagi Chrome wymagane w kontenerach CI/sandboxa (jak w lighthouserc.json + --headless=new). */
const BASE_CHROME_FLAGS = [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  // Sandbox eksportuje HTTPS_PROXY; Chrome wysłałby tam każde żądanie spoza
  // 127.0.0.1 (403). Bez proxy w środowisku ta flaga niczego nie zmienia.
  "--no-proxy-server",
];
const RUN_TIMEOUT_MS = 240_000;

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: "string" },
    compare: { type: "boolean", default: false },
    runs: { type: "string", default: "3" },
    path: { type: "string", default: "/" },
    forms: { type: "string", default: "mobile,desktop" },
    transport: { type: "string", default: "h2" },
    "transport-b": { type: "string" },
    label: { type: "string" },
    out: { type: "string" },
    baseline: { type: "string" },
    "save-baseline": { type: "boolean", default: false },
    "baseline-out": { type: "string" },
    build: { type: "boolean", default: false },
    "no-dump": { type: "boolean", default: false },
    "warm-ua": { type: "string", default: "browser" },
    "html-transform": { type: "string" },
    "html-transform-b": { type: "string" },
    "max-load": { type: "string" },
    "idle-wait": { type: "string", default: "180" },
    "client-backend": { type: "string", default: "none" },
    "third-party": { type: "string", default: "none" },
    "fake-gtag-scale": { type: "string" },
    "save-artifacts": { type: "boolean", default: false },
    "no-ledger": { type: "boolean", default: false },
    repeats: { type: "string", default: String(MAX_EXCLUDED_REPEATS) },
    "min-fresh": { type: "string", default: String(DEFAULT_MIN_FRESH_S) },
    "psi-reference": { type: "string" },
    "min-valid": { type: "string" },
    "allow-uncached": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (opts.help) {
  const lines = readFileSync(new URL(import.meta.url), "utf8")
    .split("\n")
    .slice(1);
  const header = lines.slice(
    0,
    lines.findIndex((l) => !l.startsWith("//")),
  );
  console.log(header.map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(0);
}

const runs = Math.max(1, Number.parseInt(opts.runs, 10) || 3);
const forms = parseForms(opts.forms);
const transport = opts.transport === "h1" ? "h1" : "h2";
// Tylko A/B: inny transport dla B - eksperyment parytetu harnessu (h1 vs h2 na tym samym artefakcie).
const transportB =
  opts["transport-b"] === undefined ? transport : opts["transport-b"] === "h1" ? "h1" : "h2";
const fixture = process.env.NES_PERFORMANCE_FIXTURE !== "0";
const acceptLanguage = process.env.ACCEPT_LANGUAGE ?? DEFAULT_ACCEPT_LANGUAGE;
// UA rozgrzewki = wariant dokumentu w cache (klucz `host::ścieżka` NIE rozróżnia botów):
// `browser` - strumieniowy (to, co dostaje przeglądarka po MISS przeglądarki),
// `bot` - buforowany `allReady` (to, co zostaje w cache po MISS bota / gołego curl;
// zmierzone 2026-10-03: fixture 382 KB / 14 skryptów zamiast 391 KB / 22).
const warmUa = opts["warm-ua"] === "bot" ? "bot" : "browser";
const warmUserAgent = warmUa === "bot" ? BOT_USER_AGENT : WARM_USER_AGENT;
// Obciążenie maszyny: przed każdym przebiegiem czekamy (do --idle-wait s), aż
// loadavg(1 min) spadnie poniżej --max-load (domyślnie 0,6 x CPU, protokół P0.5),
// a przebieg zaczęty przy wyższym jest `excluded` (I2). TBT na przeciążonym
// hoście rośnie wielokrotnie (zmierzone: 330 ms -> 5 s przy load 8 na 4 CPU).
const maxLoad = Number.parseFloat(opts["max-load"] ?? String(defaultMaxLoad(cpus().length)));
if (!Number.isFinite(maxLoad) || maxLoad <= 0)
  throw new Error(`--max-load ${opts["max-load"]}: oczekiwana liczba > 0`);
const idleWaitMs = Math.max(0, Number.parseFloat(opts["idle-wait"]) || 0) * 1000;

function oneOf(name, value, allowed) {
  if (!allowed.includes(value))
    throw new Error(`--${name} ${value}: dozwolone ${allowed.join(" | ")}`);
  return value;
}
const clientBackendMode = oneOf("client-backend", opts["client-backend"], ["none", "fixture"]);
const thirdPartyMode = oneOf("third-party", opts["third-party"], ["none", "fake-gtag"]);
const flags = flagsLabel(clientBackendMode, thirdPartyMode);
const repeats = Math.max(0, Number.parseInt(opts.repeats, 10) || 0);
const minFreshS = Math.max(0, Number.parseFloat(opts["min-fresh"]) || 0);
// Tekst z CLI wprost: nieliczbowe `--min-valid` jest błędem wywołania (runda 2).
const minValid = resolveMinValid(opts["min-valid"], runs);
const allowUncached = opts["allow-uncached"];
const saveArtifacts = opts["save-artifacts"];
const measuredPathname = new URL(opts.path, "https://fixture.invalid").pathname;

let roots;
if (opts.compare) {
  if (positionals.length !== 2) throw new Error("--compare wymaga dwóch katalogów: <A> <B>");
  roots = [
    { tag: "A", root: resolve(positionals[0]) },
    { tag: "B", root: resolve(positionals[1]) },
  ];
} else {
  roots = [{ tag: "", root: resolve(opts.root ?? positionals[0] ?? process.cwd()) }];
}
const isAa = opts.compare && roots[0].root === roots[1].root;
const label =
  opts.label ??
  `${opts.compare ? "ab" : "local"}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const outDir = resolve(opts.out ?? join(HARNESS_ROOT, "reports/lighthouse-local", label));
mkdirSync(outDir, { recursive: true });

function gitHead(root) {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "?";
  }
}

function lighthouseCommand() {
  const cli = process.env.LIGHTHOUSE_CLI;
  if (cli) {
    if (!existsSync(cli)) throw new Error(`LIGHTHOUSE_CLI=${cli} nie istnieje`);
    return { cmd: process.execPath, prefix: [cli] };
  }
  return { cmd: "npx", prefix: ["--yes", "lighthouse@13"] };
}

const lh = lighthouseCommand();
/** `lighthouseVersion` z pierwszego LHR serii (do summary.json i baseline'u). */
let seenLighthouseVersion = null;

/** Plik serii do zapisu: względny wobec katalogu wyników `base` (D3), `.` dla samego `base`. */
const relPath = (path, base) => relative(base, path) || ".";
const children = [];
let stopping = false;
async function stopAll() {
  if (stopping) return;
  stopping = true;
  await Promise.all(children.map((c) => c.stop().catch(() => undefined)));
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopAll().finally(() => process.exit(130));
  });
}

/**
 * Build ma 8 GB sterty i minuty CPU - na współdzielonej maszynie najwyżej jeden naraz.
 * NES_BUILD_LOCK=<katalog> włącza mutex `mkdir` (czekamy, dopóki katalog istnieje).
 */
async function withBuildLock(fn) {
  const lock = process.env.NES_BUILD_LOCK;
  if (!lock) return fn();
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      console.log(`  czekam na mutex builda ${lock}`);
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

function build(root) {
  console.log(`BUILD ${root}: BUNDLE_INVENTORY=1 bun run build:smoke`);
  const result = spawnSync("bun", ["run", "build:smoke"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, BUNDLE_INVENTORY: "1" },
  });
  if (result.status !== 0)
    throw new Error(`build:smoke w ${root} zakończony kodem ${result.status}`);
}

async function waitForIdle() {
  const deadline = Date.now() + idleWaitMs;
  while (loadavg()[0] > maxLoad && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
  }
  return loadavg()[0];
}

/**
 * Przebieg z jedną powtórką po błędzie wykonania (NO_NAVSTART, PROTOCOL_TIMEOUT
 * pod obciążeniem). `prepare` (rozgrzanie dokumentu + znaczniki logów) biegnie
 * PO czekaniu na bezczynność, tuż przed startem Lighthouse'a - inaczej czekanie
 * na loadavg zjadało zapas świeżości wpisu cache (zmierzone: 43 s przerwy).
 */
async function runLighthouseWithRetry(url, form, chromeFlags, outputPath, artifactsDir, prepare) {
  let ctx = null;
  let loadBefore = Number.NaN;
  let loadAfter = Number.NaN;
  for (let attempt = 1; attempt <= 2; attempt++) {
    loadBefore = await waitForIdle();
    ctx = await prepare();
    // Drugi pomiar PO rozgrzewce: restart serwera i render MISS też obciążają
    // maszynę tuż przed Lighthouse'em (bramka bierze większy, runda 2).
    loadAfter = loadavg()[0];
    const lhr = await runLighthouse(url, form, chromeFlags, outputPath, artifactsDir);
    if (lhr) return { lhr, loadBefore, loadAfter, ctx };
    if (attempt === 1) console.log("    powtórka przebiegu (błąd wykonania)");
  }
  return { lhr: null, loadBefore, loadAfter, ctx };
}

/** Jeden przebieg Lighthouse'a; zwraca LHR albo null (błąd wykonania nie przerywa serii). */
function runLighthouse(url, form, chromeFlags, outputPath, artifactsDir) {
  const args = [
    ...lh.prefix,
    url,
    "--output=json",
    `--output-path=${outputPath}`,
    "--only-categories=performance",
    "--quiet",
    `--chrome-flags=${[...BASE_CHROME_FLAGS, ...chromeFlags].join(" ")}`,
    `--extra-headers=${JSON.stringify({ "Accept-Language": acceptLanguage })}`,
    ...FORMS[form].args,
  ];
  // Tryb gather+audit (`lighthouse -GA=<katalog>`): artefakty (ślad, devtoolsLog,
  // ustawienia) zostają na dysku - księga Lantern per zadanie liczy się z nich.
  if (artifactsDir) args.push(`-GA=${artifactsDir}`);
  return new Promise((done) => {
    const child = spawn(lh.cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c) => {
      stderr = (stderr + c.toString()).slice(-4000);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), RUN_TIMEOUT_MS);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0 || !existsSync(outputPath)) {
        console.log(
          `  przebieg ${outputPath} NIEUDANY (kod ${code}): ${stderr.trim().slice(-400)}`,
        );
        return done(null);
      }
      try {
        const lhr = JSON.parse(readFileSync(outputPath, "utf8"));
        if (lhr.runtimeError) {
          console.log(`  przebieg ${outputPath}: runtimeError ${lhr.runtimeError.code}`);
          return done(null);
        }
        done(lhr);
      } catch (error) {
        console.log(`  przebieg ${outputPath}: nieczytelny JSON (${error})`);
        done(null);
      }
    });
  });
}

function loadBaseline() {
  const file =
    opts.baseline ?? (existsSync(BASELINE_DEFAULT) ? BASELINE_DEFAULT : BASELINE_TRACKED);
  if (!existsSync(file)) return null;
  try {
    return { file, data: JSON.parse(readFileSync(file, "utf8")) };
  } catch {
    return null;
  }
}

/** Moduł z `export default (html, headers) => html` (eksperyment „co-jeśli" w proxy). */
async function loadTransform(file) {
  if (!file) return undefined;
  const mod = await import(pathToFileURL(resolve(file)).href);
  if (typeof mod.default !== "function")
    throw new Error(`${file}: brak export default (html, headers) => html`);
  return mod.default;
}

/** Dokument głównej ramki z devtoolsLog zapisanych artefaktów (kontrola krzyżowa logu frontu). */
function devtoolsDocument(artifactsDir) {
  if (!artifactsDir) return null;
  for (const name of ["devtoolslog.json", "defaultPass.devtoolslog.json"]) {
    const file = join(artifactsDir, name);
    if (!existsSync(file)) continue;
    try {
      return documentFromDevtoolsLog(JSON.parse(readFileSync(file, "utf8")));
    } catch {
      return null;
    }
  }
  return null;
}

/** Atrapa Google: skala z benchmarkIndex zmierzonego w Chrome (albo jawna `--fake-gtag-scale`). */
async function startFakeGoogleForSeries() {
  let benchmark = null;
  let scale;
  if (opts["fake-gtag-scale"] !== undefined) {
    scale = Number.parseFloat(opts["fake-gtag-scale"]);
    if (!Number.isFinite(scale) || scale <= 0)
      throw new Error(`--fake-gtag-scale ${opts["fake-gtag-scale"]}: oczekiwana liczba > 0`);
  } else {
    await waitForIdle();
    benchmark = await measureChromeBenchmarkIndex({ flags: BASE_CHROME_FLAGS });
    if (!benchmark)
      throw new Error(
        "--third-party fake-gtag: nie udało się zmierzyć benchmarkIndex w Chrome " +
          "(ustaw CHROME_PATH albo podaj --fake-gtag-scale)",
      );
    scale = fakeGoogleScale(benchmark.median);
  }
  const google = await startFakeGoogle({ scale });
  console.log(
    `fałszywy gtag: port ${google.port}, skala x${scale.toFixed(2)}` +
      (benchmark
        ? ` (benchmarkIndex Chrome ${benchmark.median} z [${benchmark.samples.join(", ")}])`
        : " (--fake-gtag-scale)"),
  );
  return { google, benchmark, scale };
}

/**
 * Rozgrzewka początkowa = WZORZEC wariantu serii (B1): `warmReferenceVariant`
 * (artifactServer.ts, testowane). Jeden restart odróżnia przegrany wyścig
 * chrome'u od własnej polityki trasy; dokument spoza cache albo wzorzec
 * o świeżości ≤ --min-fresh przerywa serię tutaj, zanim cokolwiek zmierzymy.
 */
async function warmReference(artifact) {
  const result = await warmReferenceVariant(artifact, opts.path, {
    acceptLanguage,
    userAgent: warmUserAgent,
    minFreshS,
    allowUncached,
  });
  if (result.note) console.log(`  wzorzec: ${result.note}`);
  return result;
}

async function main() {
  if (opts.build) for (const r of roots) await withBuildLock(() => build(r.root));
  const transformA = await loadTransform(opts["html-transform"]);
  const transformB = opts["html-transform-b"]
    ? await loadTransform(opts["html-transform-b"])
    : transformA;
  const psiReference = opts["psi-reference"]
    ? parsePsiReference(JSON.parse(readFileSync(resolve(opts["psi-reference"]), "utf8")))
    : PSI_REFERENCE_2026_10_03;

  // D2: tryb `none` = martwy backend klienta. Proces słuchający na 4199 dałby
  // przeglądarce żywe odpowiedzi przy etykiecie `client-backend=none`.
  if (clientBackendMode === "none" && (await isPortListening(CLIENT_BACKEND_PORT)))
    throw new Error(
      `--client-backend none, ale coś słucha na 127.0.0.1:${CLIENT_BACKEND_PORT} - ` +
        "przeglądarka dostałaby żywy backend klienta, niezgodny z etykietą flag. " +
        "Zatrzymaj ten proces albo mierz z --client-backend fixture.",
    );
  const backend = clientBackendMode === "fixture" ? await startClientBackend() : null;
  if (backend) {
    children.push(backend);
    console.log(`backend klienta: PostgREST fixture na 127.0.0.1:${backend.port}`);
  }
  const fake = thirdPartyMode === "fake-gtag" ? await startFakeGoogleForSeries() : null;
  if (fake) children.push(fake.google);

  const targets = [];
  for (const r of roots) {
    const tagSuffix = r.tag ? `-${r.tag}` : "";
    const upstreamPort = await freePort();
    const logFile = join(outDir, `server${tagSuffix}.log`);
    const artifact = await startArtifact({ root: r.root, port: upstreamPort, fixture, logFile });
    children.push(artifact);
    const ownTransport = r.tag === "B" ? transportB : transport;
    const front = await startFront({
      transport: ownTransport,
      transformHtml: r.tag === "B" ? transformB : transformA,
      upstreamPort,
      listenPort: await freePort(),
      injectHead: fake ? GA_ANY_HOST_SNIPPET : undefined,
    });
    children.push(front);
    const { doc, reference } = await warmReference(artifact);
    writeFileSync(join(outDir, `home${tagSuffix}.html`), doc.body);
    const headerLines = [`status: ${doc.status}`];
    for (const [k, v] of doc.headers) headerLines.push(`${k}: ${v}`);
    writeFileSync(join(outDir, `home${tagSuffix}.headers.txt`), `${headerLines.join("\n")}\n`);
    const commit = gitHead(r.root);
    console.log(
      `${r.tag || "artefakt"}: ${r.root} @ ${commit} upstream :${upstreamPort} front ${front.baseUrl} ` +
        `(${ownTransport}${fixture ? ", fixture" : ", .env"}, rozgrzewka ${warmUa}) HTML ${doc.status} raw ${doc.body.length} B ` +
        `gzip ${gzipSync(doc.body, { level: 6 }).length} B x-nes-cache=${doc.headers.get("x-nes-cache") ?? "-"} ` +
        `wariant wzorcowy: ${reference ? formatVariant(reference) : "brak (--allow-uncached)"}`,
    );
    const chromeFlags = [
      ...front.chromeFlags,
      ...hostResolverFlag([...front.hostResolverRules, ...(fake?.google.hostResolverRules ?? [])]),
    ];
    targets.push({
      ...r,
      artifact,
      front,
      commit,
      tagSuffix,
      doc,
      reference,
      chromeFlags,
      log: logCursor(logFile),
    });
  }
  console.log(
    `flagi: ${flags}; przebiegi: ${runs} x ${forms.join(",")}; powtórki excluded: ${repeats}; ` +
      `min-valid: ${minValid}; max-load: ${maxLoad}${allowUncached ? "; --allow-uncached" : ""}`,
  );

  /** Jedna próba przebiegu: rozgrzanie -> Lighthouse -> ważność. */
  async function attemptRun(t, form, n, attempt) {
    const name = `${t.tag ? `${t.tag}-` : ""}${form}-${n}${attempt ? `r${attempt}` : ""}`;
    const file = join(outDir, `${name}.json`);
    const artifactsDir = saveArtifacts ? join(outDir, `${name}.artifacts`) : null;
    const prepare = async () => {
      let assets = null;
      const rewarm = await rewarmDocument(t.artifact.origin, opts.path, {
        acceptLanguage,
        userAgent: warmUserAgent,
        minFreshS,
        referenceVariant: t.reference,
        allowUncached,
        // W środku serii ścieżka spoza cache NIE przerywa serii (zgubiłaby
        // ukończone przebiegi): przebieg jest excluded i powtarzany. Ścieżkę
        // sprawdza raz rozgrzewka początkowa (`warmReference`).
        abortOnUncached: false,
        // Wzorca nie przywraca rewalidacja (daje wariant ze zdegradowanym
        // chrome'em), tylko pusty magazyn: restart serwera + rozgrzewka
        // dokumentu i zasobów statycznych nowego procesu.
        restore: async () => {
          await t.artifact.restart();
          const doc = await warmDocument(
            t.artifact.origin,
            opts.path,
            acceptLanguage,
            warmUserAgent,
          );
          assets = await warmAssets(t.artifact.origin, doc.body.toString("utf8"));
        },
      });
      return {
        rewarm,
        assets,
        docMark: t.front.documents().length,
        logMarks: targets.map((x) => x.log.mark()),
        backendBefore: backend?.stats(),
        googleBefore: fake?.google.stats(),
      };
    };
    const { lhr, loadBefore, loadAfter, ctx } = await runLighthouseWithRetry(
      `${t.front.baseUrl}${opts.path}`,
      form,
      t.chromeFlags,
      file,
      artifactsDir,
      prepare,
    );
    const { rewarm, assets, docMark, logMarks, backendBefore, googleBefore } = ctx;
    const serverDocs = targets.flatMap((x, i) => parseServerLogDocs(x.log.since(logMarks[i])));
    const runDocuments = t.front.documents().slice(docMark);
    const document = runDocuments.find((d) => d.path === measuredPathname) ?? null;
    const devtools = lhr ? devtoolsDocument(artifactsDir) : null;
    // Całe wejście ważności w jednej czystej funkcji (test w harness-ext.test.mjs).
    const validity = classifyAttempt({
      lhrOk: Boolean(lhr),
      document,
      serverDocs,
      devtools,
      rewarmOk: rewarm.ok,
      referenceVariant: t.reference,
      loadBefore,
      loadAfter,
      maxLoad,
      allowUncached,
      runDocuments,
    });
    const load = validity.load;
    const backendRun = backend ? diffClientBackendStats(backendBefore, backend.stats()) : null;
    const googleAfter = fake?.google.stats();
    const googleRun = fake
      ? {
          scripts: googleAfter.scripts - googleBefore.scripts,
          pings: googleAfter.pings - googleBefore.pings,
        }
      : null;
    if (lhr?.lighthouseVersion) seenLighthouseVersion ??= lhr.lighthouseVersion;
    const metrics = lhr ? extractMetrics(lhr) : null;
    if (metrics)
      console.log(
        `${formatRun(`${t.tag ? `${t.tag} ` : ""}${name.replace(/^[AB]-/, "")}`, metrics)} load=${load.toFixed(1)} ` +
          `(${loadBefore.toFixed(1)} -> ${loadAfter.toFixed(1)} po rozgrzewce)`,
      );
    const waited = rewarm.waitedForStaleS
      ? `, czekanie na STALE ${rewarm.waitedForStaleS.toFixed(0)} s`
      : "";
    const restarted = rewarm.restores
      ? `, restart serwera x${rewarm.restores}` +
        (assets
          ? `, zasoby ${assets.count}${assets.failed ? ` (błędy ${assets.failed})` : ""}`
          : "")
      : "";
    console.log(
      `    cache: rozgrzewka ${formatObservation(rewarm.attempts[0])} -> ${formatObservation(rewarm.final)} ` +
        `(${rewarm.attempts.length} żądań${waited}${restarted}${rewarm.failure ? `; ${rewarm.failure}` : ""}) ` +
        `| LH ${formatObservation(document)} [${document ? formatVariant(documentVariant(document)) : "-"}]` +
        (devtools ? ` | devtools ${formatObservation(devtools)}` : "") +
        ` | SSR w trakcie: ${serverDocs.filter(isServerRender).length}`,
    );
    if (backendRun) console.log(`    ${formatClientBackendStats(backendRun)}`);
    if (googleRun)
      console.log(`    gtag: ${googleRun.scripts} skryptów, ${googleRun.pings} pingów`);
    if (validity.excluded) console.log(`    EXCLUDED: ${validity.reasons.join("; ")}`);
    return {
      n,
      attempt,
      name,
      // D3: ścieżki względne wobec katalogu wyników (summary.json leży obok).
      file: relPath(file, outDir),
      artifacts: artifactsDir ? relPath(artifactsDir, outDir) : null,
      valid: !validity.excluded,
      reasons: validity.reasons,
      // Bramka obciążenia = większy z pomiarów przed i po rozgrzewce.
      load,
      loadBefore,
      loadAfter,
      // B1: wariant dokumentu, który dostał Lighthouse; tryb FCP dopisuje księga.
      variant: document ? documentVariant(document) : null,
      fcpMode: null,
      rewarm: {
        first: rewarm.attempts[0],
        final: rewarm.final,
        requests: rewarm.attempts.length,
        waitedForStaleS: rewarm.waitedForStaleS,
        restores: rewarm.restores,
        assets,
        failure: rewarm.failure,
        uncached: rewarm.uncached,
        ms: rewarm.ms,
      },
      document,
      devtools,
      serverDocs,
      backend: backendRun,
      gtag: googleRun,
      metrics,
      lhr,
    };
  }

  const records = new Map();
  const loads = [];
  const key = (tag, form) => `${tag}|${form}`;
  // Wyjątek w trakcie serii (np. serwer nie wstał po restarcie) kończy
  // przebiegi, ale NIE gubi ukończonych: podsumowanie, linie VALID/PAIRS/AA
  // i summary.json liczą się z nich, a wynik serii to kod 1 bez baseline'u
  // (runda 2; dawniej main() odrzucał obietnicę przed summary.json).
  let aborted = null;
  try {
    for (const form of forms) {
      for (let n = 1; n <= runs; n++) {
        const order = n % 2 === 1 ? targets : [...targets].reverse();
        for (const t of order) {
          const attempts = await runWithRepeats(async (i) => {
            const rec = await attemptRun(t, form, n, i);
            if (!rec.valid && i < repeats) console.log(`    powtórka excluded ${i + 1}/${repeats}`);
            return rec;
          }, repeats);
          const list = records.get(key(t.tag, form)) ?? [];
          for (const rec of attempts) {
            if (rec.metrics) loads.push(rec.load);
            const firstValid = rec.valid && !list.some((x) => x.valid);
            if (firstValid) {
              const dumpFile = join(outDir, rec.file).replace(/\.json$/, ".audits.txt");
              writeFileSync(dumpFile, `${dumpAudits(rec.lhr, 40)}\n`);
              if (!opts["no-dump"]) console.log(`    audyty: ${dumpFile}`);
            }
            delete rec.lhr;
            list.push(rec);
          }
          records.set(key(t.tag, form), list);
        }
      }
    }
  } catch (error) {
    // D3: komunikat trafia do summary.json - bez ścieżek maszyny.
    aborted = scrubPaths(error instanceof Error ? error.message : String(error), [
      [outDir, "<wyniki>"],
      [HARNESS_ROOT, "."],
      ...roots.map((r) => [r.root, portableRoot(r.root, HARNESS_ROOT)]),
    ]);
    console.error(
      `PRZERWANE w trakcie serii: ${error instanceof RewarmAbort || !(error instanceof Error) ? aborted : error.stack}`,
    );
  }

  // Księga Lantern per zadanie z zapisanych artefaktów - PO wszystkich
  // przebiegach, żeby jej CPU nie wpadło do pomiaru.
  const core = saveArtifacts && !opts["no-ledger"] ? resolveLighthouseCore() : null;
  if (saveArtifacts && !opts["no-ledger"] && !core)
    console.log("księga: pominięta (brak LIGHTHOUSE_CLI/LIGHTHOUSE_CORE z modułami core/)");
  if (core) {
    for (const [k, list] of records) {
      for (const rec of list) {
        if (!rec.valid || !rec.artifacts || !rec.metrics) continue;
        const artifactsDir = join(outDir, rec.artifacts);
        try {
          const ledger = await analyzeArtifacts(artifactsDir, { lighthouseCore: core });
          // D3: nagłówek księgi z katalogiem względnym, nie ścieżką maszyny.
          writeFileSync(
            artifactsDir.replace(/\.artifacts$/, ".ledger.txt"),
            `${formatLedger({ ...ledger, dir: rec.artifacts })}\n`,
          );
          const delta = ledger.ledgerSum - rec.metrics.tbt;
          rec.fcpMode = ledger.fcpMode;
          rec.ledger = {
            tbt: ledger.tbt,
            ledgerSum: ledger.ledgerSum,
            audit: rec.metrics.tbt,
            parityOk: Math.abs(delta) <= 1,
            fcpMode: ledger.fcpMode,
            fcpModeInfo: ledger.fcpModeInfo,
            fcpGraphScripts: ledger.fcpGraphScripts,
            googleTasks: ledger.googleTasks,
            googleBlocking: ledger.googleBlocking,
            scriptBytesEndedBeforeObsLcp: ledger.scriptBytesEndedBeforeObsLcp,
          };
          const sb = ledger.scriptBytesEndedBeforeObsLcp;
          console.log(
            `LEDGER ${k.replace("|", " ")} ${rec.name}: księga=${ledger.ledgerSum.toFixed(1)} audyt=${rec.metrics.tbt.toFixed(1)} ` +
              `${rec.ledger.parityOk ? "OK" : "NIEZGODNOŚĆ"} trybFCP=${formatFcpMode(ledger.fcpModeInfo)} google=${ledger.googleTasks} zadań/${ledger.googleBlocking.toFixed(0)} ms ` +
              `skrypty<obsLCP=${(sb.bytes / 1024).toFixed(1)} KB (+wykluczone ${(sb.excludedBytes / 1024).toFixed(1)} KB)`,
          );
        } catch (error) {
          console.log(`LEDGER ${rec.name}: błąd ${error instanceof Error ? error.message : error}`);
        }
      }
    }
  }

  const validMetrics = (tag, form) =>
    (records.get(key(tag, form)) ?? []).filter((r) => r.valid && r.metrics).map((r) => r.metrics);

  // Baseline = pojedynczy artefakt albo strona A w trybie A/B (ten sam kontrakt pliku).
  const baseTag = opts.compare ? "A" : "";
  const summary = {
    schema: 3,
    label,
    savedAt: new Date().toISOString(),
    transport,
    path: opts.path,
    fixture,
    acceptLanguage,
    warmUa,
    flags,
    clientBackend: clientBackendMode,
    thirdParty: thirdPartyMode,
    fakeGtag: fake ? { scale: fake.scale, benchmark: fake.benchmark } : null,
    minFreshS,
    repeats,
    minValid,
    maxLoad,
    allowUncached,
    loadavgAtRuns: loads,
    cpus: cpus().length,
    // D3: nazwa wersji, nie ścieżka LIGHTHOUSE_CLI; `lighthouseVersion` z LHR.
    lighthouse: lighthouseLabel(),
    lighthouseVersion: seenLighthouseVersion,
    targets: targets.map((t) => ({
      tag: t.tag || "single",
      // D3: względna wewnątrz repo harnessu, `poza-repo:<nazwa>` poza nim.
      root: portableRoot(t.root, HARNESS_ROOT),
      commit: t.commit,
      transport: t.front.transport,
      referenceVariant: t.reference,
    })),
    forms: {},
    pairs: {},
    calibration: {},
    aborted,
    outcome: null,
  };
  for (const t of targets) {
    for (const form of forms) {
      const recs = records.get(key(t.tag, form)) ?? [];
      const validity = summarizeValidity(recs);
      console.log(formatValidity(`${label}${t.tag ? ` ${t.tag}` : ""} ${form}`, validity));
      const list = validMetrics(t.tag, form);
      const entry = { validity, records: recs };
      if (list.length) {
        const agg = aggregate(list);
        console.log(formatMedian(`${label}${t.tag ? ` ${t.tag}` : ""} ${form}`, agg));
        Object.assign(entry, { aggregate: agg, runs: list });
      }
      summary.forms[`${t.tag || "single"}:${form}`] = entry;
    }
  }

  // I3/D8: forma poniżej --min-valid = porażka serii (kod 1) i bez baseline'u.
  const outcome = seriesOutcome(
    targets.flatMap((t) =>
      forms.map((form) => ({
        tag: t.tag,
        form,
        validity: summary.forms[`${t.tag || "single"}:${form}`].validity,
      })),
    ),
    { minValid, baselineTag: baseTag, aborted },
  );
  summary.outcome = outcome;
  for (const line of outcome.failures) console.log(line);
  if (outcome.exitCode) process.exitCode = outcome.exitCode;

  // Kalibracja fixture -> PSI ze strony A (albo jedynego artefaktu). k ma sens
  // wyłącznie z pełnymi flagami (D6) - linia bez nich mówi „nie kalibruje".
  const calTag = opts.compare ? "A" : "";
  for (const form of forms) {
    const list = validMetrics(calTag, form);
    if (!list.length) continue;
    const agg = aggregate(list);
    const line = formatCalibrationLine(form, agg.median, psiReference, flags);
    console.log(line);
    summary.calibration[form] = {
      line,
      fixtureTbt: agg.median.tbt,
      flags,
      calibrates: flags === CALIBRATION_FLAGS,
    };
  }

  if (opts.compare) {
    for (const form of forms) {
      const a = validMetrics("A", form);
      const b = validMetrics("B", form);
      if (!a.length || !b.length) continue;
      const aggA = aggregate(a);
      const aggB = aggregate(b);
      const recA = records.get(key("A", form)) ?? [];
      const recB = records.get(key("B", form)) ?? [];
      console.log(deltaLine(`${label} B-A ${form}`, aggA.median, aggB.median));
      const pairs = validPairs(recA, recB);
      if (pairs.length) {
        const stats = pairedStats(pairs);
        console.log(formatPairedStats(`${label} ${form}`, stats));
        // I1: pary tylko w tym samym trybie FCP + licznik par mieszanych.
        const split = pairsByFcpMode(recA, recB);
        console.log(formatModePairs(`${label} ${form}`, split));
        const byMode = {};
        for (const [mode, list] of split.byMode) {
          byMode[mode] = pairedStats(list);
          if (list.length > 1)
            console.log(formatPairedStats(`${label} ${form} [trybFCP=${mode}]`, byMode[mode]));
        }
        summary.pairs[form] = {
          all: stats,
          byMode,
          mixed: split.mixed,
          unknown: split.unknown,
          total: split.total,
        };
      }
      if (isAa) {
        const modesA = summarizeValidity(recA).fcpModes;
        const modesB = summarizeValidity(recB).fcpModes;
        const modes =
          Object.keys(modesA).length || Object.keys(modesB).length
            ? `A ${formatCounts(modesA) || "-"} | B ${formatCounts(modesB) || "-"}`
            : undefined;
        console.log(formatAaCheck(form, aggA.median, aggB.median, modes));
        const layersB = validMetricsByFcpMode(recB);
        for (const [mode, listA] of validMetricsByFcpMode(recA)) {
          const listB = layersB.get(mode);
          if (!listB) continue;
          console.log(
            formatAaCheck(
              `${form} [trybFCP=${mode}, nA=${listA.length}, nB=${listB.length}]`,
              aggregate(listA).median,
              aggregate(listB).median,
              modes,
            ),
          );
        }
      }
      for (const w of comparabilityWarnings(
        { transport, finalPath: aggA.finalPath, lcpElement: aggA.lcpElement },
        { transport: transportB, finalPath: aggB.finalPath, lcpElement: aggB.lcpElement },
      ))
        console.log(`  UWAGA ${form}: ${w}`);
    }
  } else {
    const baseline = loadBaseline();
    if (baseline) {
      for (const form of forms) {
        const base = baseline.data.forms?.[form];
        const list = validMetrics("", form);
        if (!base || !list.length) continue;
        const agg = aggregate(list);
        console.log(deltaLine(`${label} vs baseline ${form}`, base.median, agg.median));
        for (const w of comparabilityWarnings(
          {
            transport: baseline.data.transport,
            finalPath: base.finalPath,
            lcpElement: base.lcpElement,
            benchmarkIndex: base.median.benchmarkIndex,
            flags: baseline.data.flags,
          },
          {
            transport,
            finalPath: agg.finalPath,
            lcpElement: agg.lcpElement,
            benchmarkIndex: agg.median.benchmarkIndex,
            flags,
          },
        ))
          console.log(`  UWAGA ${form}: ${w}`);
      }
      console.log(
        `baseline: ${baseline.file} (${baseline.data.label ?? "?"}, ${baseline.data.savedAt ?? "?"})`,
      );
    } else {
      console.log("baseline: brak (zapisz: --save-baseline)");
    }
  }

  if (opts["save-baseline"]) {
    const file = resolve(opts["baseline-out"] ?? BASELINE_DEFAULT);
    if (!outcome.baselineForms.length) {
      console.log(
        outcome.aborted
          ? `baseline NIE zapisany: seria przerwana (${outcome.aborted}); ${file} bez zmian`
          : `baseline NIE zapisany: żadna forma nie ma n_valid ≥ ${minValid} ` +
              `(${outcome.refusedBaselineForms.join(", ")}); ${file} bez zmian`,
      );
    } else {
      const reference = targets.find((t) => t.tag === baseTag)?.reference ?? null;
      const data = {
        schema: 3,
        label,
        savedAt: summary.savedAt,
        commit: targets[0].commit,
        // D3: ścieżka względna wobec repo harnessu, `poza-repo:<nazwa>` poza nim.
        root: portableRoot(targets[0].root, HARNESS_ROOT),
        transport,
        path: opts.path,
        fixture,
        acceptLanguage,
        warmUa,
        flags,
        lighthouse: lighthouseLabel(),
        lighthouseVersion: seenLighthouseVersion,
        referenceVariant: reference,
        minValid,
        maxLoad,
        loadavgAtRuns: loads,
        forms: {},
      };
      for (const form of outcome.baselineForms) {
        const list = validMetrics(baseTag, form);
        const agg = aggregate(list);
        const validity = summary.forms[`${baseTag || "single"}:${form}`].validity;
        data.forms[form] = {
          n: agg.n,
          median: agg.median,
          min: agg.min,
          max: agg.max,
          lcpElement: agg.lcpElement,
          finalPath: agg.finalPath,
          variants: validity.variants,
          fcpModes: validity.fcpModes,
        };
      }
      mkdirSync(resolve(file, ".."), { recursive: true });
      writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
      console.log(
        `baseline zapisany: ${file} (formy: ${outcome.baselineForms.join(", ")}` +
          (outcome.refusedBaselineForms.length
            ? `; odrzucone poniżej --min-valid: ${outcome.refusedBaselineForms.join(", ")}`
            : "") +
          ")",
      );
    }
  }

  writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`wyniki: ${outDir}`);
}

main()
  .catch((error) => {
    // RewarmAbort = ścieżka bez HIT-u: komunikat wystarczy, stos nic nie wnosi.
    console.error(
      error instanceof RewarmAbort
        ? `PRZERWANE: ${error.message}`
        : error instanceof Error
          ? error.stack
          : error,
    );
    process.exitCode = 1;
  })
  .finally(() => stopAll());
