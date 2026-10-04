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
//   - tryb A/B: σΔ i MDE = 2,8·σΔ/√n z par ważnych przebiegów (linia PAIRS),
//     przy A = B (A/A) kontrola |ΔFCP|, |ΔLCP| ≤ 0,02 s (linia AA); linie K =
//     kalibracja TBT fixture -> PSI (`--psi-reference plik.json` nadpisuje PSI 2026-10-03).
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
//        [--psi-reference plik.json]
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
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import {
  BOT_USER_AGENT,
  DEFAULT_ACCEPT_LANGUAGE,
  DEFAULT_MIN_FRESH_S,
  HARNESS_ROOT,
  WARM_USER_AGENT,
  freePort,
  hostResolverFlag,
  logCursor,
  rewarmDocument,
  startArtifact,
  startFront,
  warmDocument,
} from "./artifactServer.ts";
import {
  diffClientBackendStats,
  formatClientBackendStats,
  startClientBackend,
} from "./clientBackend.ts";
import {
  GA_ANY_HOST_SNIPPET,
  fakeGoogleScale,
  measureChromeBenchmarkIndex,
  startFakeGoogle,
} from "./fakeGoogle.ts";
import { analyzeArtifacts, formatLedger, resolveLighthouseCore } from "./lanternTasks.ts";
import {
  FORMS,
  MAX_EXCLUDED_REPEATS,
  PSI_REFERENCE_2026_10_03,
  aggregate,
  classifyRun,
  comparabilityWarnings,
  deltaLine,
  documentFromDevtoolsLog,
  dumpAudits,
  extractMetrics,
  flagsLabel,
  formatAaCheck,
  formatCalibration,
  formatMedian,
  formatObservation,
  formatPairedStats,
  formatRun,
  formatValidity,
  isServerRender,
  pairedStats,
  parseForms,
  parsePsiReference,
  parseServerLogDocs,
  runWithRepeats,
  summarizeValidity,
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
// loadavg(1 min) spadnie poniżej --max-load (domyślnie liczba CPU). TBT na
// przeciążonym hoście rośnie wielokrotnie (zmierzone: 330 ms -> 5 s przy load 8 na 4 CPU).
const maxLoad = Number.parseFloat(opts["max-load"] ?? String(cpus().length));
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
  for (let attempt = 1; attempt <= 2; attempt++) {
    const load = await waitForIdle();
    ctx = await prepare();
    const lhr = await runLighthouse(url, form, chromeFlags, outputPath, artifactsDir);
    if (lhr) return { lhr, load, ctx };
    if (attempt === 1) console.log("    powtórka przebiegu (błąd wykonania)");
  }
  return { lhr: null, load: loadavg()[0], ctx };
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

async function main() {
  if (opts.build) for (const r of roots) await withBuildLock(() => build(r.root));
  const transformA = await loadTransform(opts["html-transform"]);
  const transformB = opts["html-transform-b"]
    ? await loadTransform(opts["html-transform-b"])
    : transformA;
  const psiReference = opts["psi-reference"]
    ? parsePsiReference(JSON.parse(readFileSync(resolve(opts["psi-reference"]), "utf8")))
    : PSI_REFERENCE_2026_10_03;

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
    const doc = await warmDocument(artifact.origin, opts.path, acceptLanguage, warmUserAgent);
    writeFileSync(join(outDir, `home${tagSuffix}.html`), doc.body);
    const headerLines = [`status: ${doc.status}`];
    for (const [k, v] of doc.headers) headerLines.push(`${k}: ${v}`);
    writeFileSync(join(outDir, `home${tagSuffix}.headers.txt`), `${headerLines.join("\n")}\n`);
    const commit = gitHead(r.root);
    console.log(
      `${r.tag || "artefakt"}: ${r.root} @ ${commit} upstream :${upstreamPort} front ${front.baseUrl} ` +
        `(${ownTransport}${fixture ? ", fixture" : ", .env"}, rozgrzewka ${warmUa}) HTML ${doc.status} raw ${doc.body.length} B ` +
        `gzip ${gzipSync(doc.body, { level: 6 }).length} B x-nes-cache=${doc.headers.get("x-nes-cache") ?? "-"}`,
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
      chromeFlags,
      log: logCursor(logFile),
    });
  }
  console.log(
    `flagi: ${flags}; przebiegi: ${runs} x ${forms.join(",")}; powtórki excluded: ${repeats}`,
  );

  /** Jedna próba przebiegu: rozgrzanie -> Lighthouse -> ważność. */
  async function attemptRun(t, form, n, attempt) {
    const name = `${t.tag ? `${t.tag}-` : ""}${form}-${n}${attempt ? `r${attempt}` : ""}`;
    const file = join(outDir, `${name}.json`);
    const artifactsDir = saveArtifacts ? join(outDir, `${name}.artifacts`) : null;
    const prepare = async () => ({
      rewarm: await rewarmDocument(t.artifact.origin, opts.path, {
        acceptLanguage,
        userAgent: warmUserAgent,
        minFreshS,
      }),
      docMark: t.front.documents().length,
      logMarks: targets.map((x) => x.log.mark()),
      backendBefore: backend?.stats(),
      googleBefore: fake?.google.stats(),
    });
    const { lhr, load, ctx } = await runLighthouseWithRetry(
      `${t.front.baseUrl}${opts.path}`,
      form,
      t.chromeFlags,
      file,
      artifactsDir,
      prepare,
    );
    const { rewarm, docMark, logMarks, backendBefore, googleBefore } = ctx;
    const serverDocs = targets.flatMap((x, i) => parseServerLogDocs(x.log.since(logMarks[i])));
    const document =
      t.front
        .documents()
        .slice(docMark)
        .find((d) => d.path === measuredPathname) ?? null;
    const devtools = lhr ? devtoolsDocument(artifactsDir) : null;
    const validity = lhr
      ? classifyRun({ document, serverDocs, devtools, rewarmOk: rewarm.ok })
      : { excluded: true, reasons: ["przebieg nieudany"] };
    const backendRun = backend ? diffClientBackendStats(backendBefore, backend.stats()) : null;
    const googleAfter = fake?.google.stats();
    const googleRun = fake
      ? {
          scripts: googleAfter.scripts - googleBefore.scripts,
          pings: googleAfter.pings - googleBefore.pings,
        }
      : null;
    const metrics = lhr ? extractMetrics(lhr) : null;
    if (metrics)
      console.log(
        `${formatRun(`${t.tag ? `${t.tag} ` : ""}${name.replace(/^[AB]-/, "")}`, metrics)} load=${load.toFixed(1)}`,
      );
    const waited = rewarm.waitedForStaleS
      ? `, czekanie na STALE ${rewarm.waitedForStaleS.toFixed(0)} s`
      : "";
    console.log(
      `    cache: rozgrzewka ${formatObservation(rewarm.attempts[0])} -> ${formatObservation(rewarm.final)} ` +
        `(${rewarm.attempts.length} żądań${waited}) | LH ${formatObservation(document)}` +
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
      file,
      artifacts: artifactsDir,
      valid: !validity.excluded,
      reasons: validity.reasons,
      load,
      rewarm: {
        first: rewarm.attempts[0],
        final: rewarm.final,
        requests: rewarm.attempts.length,
        waitedForStaleS: rewarm.waitedForStaleS,
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
            const dumpFile = rec.file.replace(/\.json$/, ".audits.txt");
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

  // Księga Lantern per zadanie z zapisanych artefaktów - PO wszystkich
  // przebiegach, żeby jej CPU nie wpadło do pomiaru.
  const core = saveArtifacts && !opts["no-ledger"] ? resolveLighthouseCore() : null;
  if (saveArtifacts && !opts["no-ledger"] && !core)
    console.log("księga: pominięta (brak LIGHTHOUSE_CLI/LIGHTHOUSE_CORE z modułami core/)");
  if (core) {
    for (const [k, list] of records) {
      for (const rec of list) {
        if (!rec.valid || !rec.artifacts || !rec.metrics) continue;
        try {
          const ledger = await analyzeArtifacts(rec.artifacts, { lighthouseCore: core });
          writeFileSync(
            rec.artifacts.replace(/\.artifacts$/, ".ledger.txt"),
            `${formatLedger(ledger)}\n`,
          );
          const delta = ledger.ledgerSum - rec.metrics.tbt;
          rec.ledger = {
            tbt: ledger.tbt,
            ledgerSum: ledger.ledgerSum,
            audit: rec.metrics.tbt,
            parityOk: Math.abs(delta) <= 1,
            fcpMode: ledger.fcpMode,
            fcpGraphScripts: ledger.fcpGraphScripts,
            googleTasks: ledger.googleTasks,
            googleBlocking: ledger.googleBlocking,
            scriptBytesEndedBeforeObsLcp: ledger.scriptBytesEndedBeforeObsLcp,
          };
          const sb = ledger.scriptBytesEndedBeforeObsLcp;
          console.log(
            `LEDGER ${k.replace("|", " ")} ${rec.name}: księga=${ledger.ledgerSum.toFixed(1)} audyt=${rec.metrics.tbt.toFixed(1)} ` +
              `${rec.ledger.parityOk ? "OK" : "NIEZGODNOŚĆ"} trybFCP=${ledger.fcpMode} google=${ledger.googleTasks} zadań/${ledger.googleBlocking.toFixed(0)} ms ` +
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

  const summary = {
    schema: 2,
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
    loadavgAtRuns: loads,
    cpus: cpus().length,
    lighthouse: process.env.LIGHTHOUSE_CLI ?? "npx lighthouse@13",
    targets: targets.map((t) => ({
      tag: t.tag || "single",
      root: t.root,
      commit: t.commit,
      transport: t.front.transport,
    })),
    forms: {},
    pairs: {},
    calibration: {},
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

  // Kalibracja fixture -> PSI ze strony A (albo jedynego artefaktu).
  const calTag = opts.compare ? "A" : "";
  for (const form of forms) {
    const list = validMetrics(calTag, form);
    if (!list.length) continue;
    const agg = aggregate(list);
    const line = formatCalibration(form, agg.median, psiReference);
    console.log(`${line} {${flags}}`);
    summary.calibration[form] = { line, fixtureTbt: agg.median.tbt, flags };
  }

  if (opts.compare) {
    for (const form of forms) {
      const a = validMetrics("A", form);
      const b = validMetrics("B", form);
      if (!a.length || !b.length) continue;
      const aggA = aggregate(a);
      const aggB = aggregate(b);
      console.log(deltaLine(`${label} B-A ${form}`, aggA.median, aggB.median));
      const pairs = validPairs(
        records.get(key("A", form)) ?? [],
        records.get(key("B", form)) ?? [],
      );
      if (pairs.length) {
        const stats = pairedStats(pairs);
        console.log(formatPairedStats(`${label} ${form}`, stats));
        summary.pairs[form] = stats;
      }
      if (isAa) console.log(formatAaCheck(form, aggA.median, aggB.median));
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

  // Baseline = pojedynczy artefakt albo strona A w trybie A/B (ten sam kontrakt pliku).
  const baseTag = opts.compare ? "A" : "";
  if (opts["save-baseline"]) {
    const file = resolve(opts["baseline-out"] ?? BASELINE_DEFAULT);
    const data = {
      schema: 2,
      label,
      savedAt: summary.savedAt,
      commit: targets[0].commit,
      root: targets[0].root,
      transport,
      path: opts.path,
      fixture,
      acceptLanguage,
      warmUa,
      flags,
      loadavgAtRuns: loads,
      forms: {},
    };
    for (const form of forms) {
      const list = validMetrics(baseTag, form);
      if (!list.length) continue;
      const agg = aggregate(list);
      data.forms[form] = {
        n: agg.n,
        median: agg.median,
        min: agg.min,
        max: agg.max,
        lcpElement: agg.lcpElement,
        finalPath: agg.finalPath,
      };
    }
    mkdirSync(resolve(file, ".."), { recursive: true });
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`baseline zapisany: ${file}`);
  }

  writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`wyniki: ${outDir}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(() => stopAll());
