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
//   5. uruchamia Lighthouse mobile i desktop N razy z ustawieniami PSI
//      (domyślny profil mobile = Moto G Power, 4x CPU, 150 ms RTT, 1,6 Mb/s;
//      `--preset=desktop`), tylko kategoria performance,
//   6. drukuje przebiegi, MEDIANY, DELTA wobec baseline'u (albo B-A w trybie A/B)
//      i zrzuca audyty diagnostyczne pierwszego przebiegu każdej formy.
//
// Lighthouse NIE jest zależnością repo: LIGHTHOUSE_CLI=<ścieżka do cli/index.js>
// albo `npx --yes lighthouse@13`. Chrome z CHROME_PATH (chrome-launcher).
//
// Użycie:
//   node scripts/performance/lighthouse-local.mjs [--root .] [--runs 3] [--path /]
//        [--forms mobile,desktop] [--transport h2|h1] [--label nazwa] [--out katalog]
//        [--baseline plik.json] [--save-baseline] [--baseline-out plik.json] [--build] [--no-dump]
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
// zmiany = linia `DELTA <label> B-A`, nie absolutny wynik.

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
  HARNESS_ROOT,
  freePort,
  startArtifact,
  startFront,
  warmDocument,
} from "./artifactServer.ts";
import {
  aggregate,
  comparabilityWarnings,
  deltaLine,
  dumpAudits,
  extractMetrics,
  formatMedian,
  formatRun,
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
const forms = opts.forms.split(",").map((f) => f.trim());
for (const f of forms) {
  if (f !== "mobile" && f !== "desktop") throw new Error(`Nieznana forma: ${f}`);
}
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
// Obciążenie maszyny: przed każdym przebiegiem czekamy (do --idle-wait s), aż
// loadavg(1 min) spadnie poniżej --max-load (domyślnie liczba CPU). TBT na
// przeciążonym hoście rośnie wielokrotnie (zmierzone: 330 ms -> 5 s przy load 8 na 4 CPU).
const maxLoad = Number.parseFloat(opts["max-load"] ?? String(cpus().length));
const idleWaitMs = Math.max(0, Number.parseFloat(opts["idle-wait"]) || 0) * 1000;

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

/** Przebieg z jedną powtórką po błędzie wykonania (NO_NAVSTART, PROTOCOL_TIMEOUT pod obciążeniem). */
async function runLighthouseWithRetry(url, form, chromeFlags, outputPath) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const load = await waitForIdle();
    const lhr = await runLighthouse(url, form, chromeFlags, outputPath);
    if (lhr) return { lhr, load };
    if (attempt === 1) console.log("    powtórka przebiegu");
  }
  return { lhr: null, load: loadavg()[0] };
}

/** Jeden przebieg Lighthouse'a; zwraca LHR albo null (błąd wykonania nie przerywa serii). */
function runLighthouse(url, form, chromeFlags, outputPath) {
  const args = [
    ...lh.prefix,
    url,
    "--output=json",
    `--output-path=${outputPath}`,
    "--only-categories=performance",
    "--quiet",
    `--chrome-flags=${[...BASE_CHROME_FLAGS, ...chromeFlags].join(" ")}`,
    `--extra-headers=${JSON.stringify({ "Accept-Language": acceptLanguage })}`,
  ];
  if (form === "desktop") args.push("--preset=desktop");
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

async function main() {
  if (opts.build) for (const r of roots) await withBuildLock(() => build(r.root));
  const transformA = await loadTransform(opts["html-transform"]);
  const transformB = opts["html-transform-b"]
    ? await loadTransform(opts["html-transform-b"])
    : transformA;

  const targets = [];
  for (const r of roots) {
    const tagSuffix = r.tag ? `-${r.tag}` : "";
    const upstreamPort = await freePort();
    const artifact = await startArtifact({
      root: r.root,
      port: upstreamPort,
      fixture,
      logFile: join(outDir, `server${tagSuffix}.log`),
    });
    children.push(artifact);
    const ownTransport = r.tag === "B" ? transportB : transport;
    const front = await startFront({
      transport: ownTransport,
      transformHtml: r.tag === "B" ? transformB : transformA,
      upstreamPort,
      listenPort: await freePort(),
    });
    children.push(front);
    const doc = await warmDocument(
      artifact.origin,
      opts.path,
      acceptLanguage,
      warmUa === "bot" ? BOT_USER_AGENT : undefined,
    );
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
    targets.push({ ...r, front, commit, tagSuffix, doc });
  }

  const results = new Map();
  const loads = [];
  const key = (tag, form) => `${tag}|${form}`;
  for (const form of forms) {
    for (let n = 1; n <= runs; n++) {
      const order = n % 2 === 1 ? targets : [...targets].reverse();
      for (const t of order) {
        const file = join(outDir, `${t.tag ? `${t.tag}-` : ""}${form}-${n}.json`);
        const { lhr, load } = await runLighthouseWithRetry(
          `${t.front.baseUrl}${opts.path}`,
          form,
          t.front.chromeFlags,
          file,
        );
        if (!lhr) continue;
        const metrics = extractMetrics(lhr);
        console.log(
          `${formatRun(`${t.tag ? `${t.tag} ` : ""}${form}-${n}`, metrics)} load=${load.toFixed(1)}`,
        );
        loads.push(load);
        const list = results.get(key(t.tag, form)) ?? [];
        list.push(metrics);
        results.set(key(t.tag, form), list);
        if (list.length === 1) {
          const dumpFile = file.replace(/\.json$/, ".audits.txt");
          writeFileSync(dumpFile, `${dumpAudits(lhr, 40)}\n`);
          if (!opts["no-dump"]) console.log(`    audyty: ${dumpFile}`);
        }
      }
    }
  }

  const summary = {
    schema: 1,
    label,
    savedAt: new Date().toISOString(),
    transport,
    path: opts.path,
    fixture,
    acceptLanguage,
    warmUa,
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
  };
  for (const t of targets) {
    for (const form of forms) {
      const list = results.get(key(t.tag, form)) ?? [];
      if (!list.length) continue;
      const agg = aggregate(list);
      console.log(formatMedian(`${label}${t.tag ? ` ${t.tag}` : ""} ${form}`, agg));
      summary.forms[`${t.tag || "single"}:${form}`] = { aggregate: agg, runs: list };
    }
  }

  if (opts.compare) {
    for (const form of forms) {
      const a = results.get(key("A", form));
      const b = results.get(key("B", form));
      if (!a?.length || !b?.length) continue;
      const aggA = aggregate(a);
      const aggB = aggregate(b);
      console.log(deltaLine(`${label} B-A ${form}`, aggA.median, aggB.median));
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
        const list = results.get(key("", form));
        if (!base || !list?.length) continue;
        const agg = aggregate(list);
        console.log(deltaLine(`${label} vs baseline ${form}`, base.median, agg.median));
        for (const w of comparabilityWarnings(
          {
            transport: baseline.data.transport,
            finalPath: base.finalPath,
            lcpElement: base.lcpElement,
            benchmarkIndex: base.median.benchmarkIndex,
          },
          {
            transport,
            finalPath: agg.finalPath,
            lcpElement: agg.lcpElement,
            benchmarkIndex: agg.median.benchmarkIndex,
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
      schema: 1,
      label,
      savedAt: summary.savedAt,
      commit: targets[0].commit,
      root: targets[0].root,
      transport,
      path: opts.path,
      fixture,
      acceptLanguage,
      warmUa,
      loadavgAtRuns: loads,
      forms: {},
    };
    for (const form of forms) {
      const list = results.get(key(baseTag, form));
      if (!list?.length) continue;
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
