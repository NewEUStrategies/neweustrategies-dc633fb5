#!/usr/bin/env node
// P0.5: zbiera ARTEFAKTY Lighthouse (ślad + devtoolsLog, tryb -GA) na artefakcie build:smoke,
// z harnessem kanonicznym (artifactServer.ts: fixture, h2 z jednego originu, rozgrzanie UA
// przeglądarki PRZED KAŻDYM przebiegiem, Accept-Language pl). Ustawienia jak lighthouse-local.mjs.
// Użycie: node gather.mjs --root <katalog z .output> --label <nazwa> [--forms mobile,desktop] [--runs 3]
//         [--profiler] (dokłada kategorię śladu disabled-by-default-v8.cpu_profiler - TYLKO do atrybucji)
//         [--cats a,b] dodatkowe kategorie śladu; [--transform plik.mjs] (default export: (html, headers) => html)
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadavg } from "node:os";
const WT = "/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/wt/P0.5";
const SCR = "/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad";
const { DEFAULT_ACCEPT_LANGUAGE, freePort, startArtifact, startFront, warmDocument } = await import(
  `${WT}/scripts/performance/artifactServer.ts`
);
const { values: o } = parseArgs({
  options: {
    root: { type: "string" },
    label: { type: "string" },
    forms: { type: "string", default: "mobile,desktop" },
    runs: { type: "string", default: "3" },
    profiler: { type: "boolean", default: false },
    cats: { type: "string" },
    out: { type: "string", default: `${SCR}/phase2/p05/art` },
    transform: { type: "string" },
    "index-from": { type: "string", default: "1" },
  },
});
const LH = `${SCR}/tools/node_modules/lighthouse/cli/index.js`;
process.env.CHROME_PATH ??= "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-proxy-server"];
const root = resolve(o.root);
const out = resolve(o.out);
mkdirSync(out, { recursive: true });
const up = await freePort();
const artifact = await startArtifact({ root, port: up, fixture: true, logFile: join(out, `${o.label}-server.log`) });
const transformHtml = o.transform ? (await import(resolve(o.transform))).default : undefined;
const front = await startFront({ transport: "h2", upstreamPort: up, listenPort: await freePort(), transformHtml });
const url = `${front.baseUrl}/`;
const runLH = (form, dir, json) =>
  new Promise((done) => {
    const args = [LH, url, `-GA=${dir}`, "--output=json", `--output-path=${json}`, "--only-categories=performance", "--quiet",
      `--chrome-flags=${[...BASE, ...front.chromeFlags].join(" ")}`,
      `--extra-headers=${JSON.stringify({ "Accept-Language": DEFAULT_ACCEPT_LANGUAGE })}`];
    if (form === "desktop") args.push("--preset=desktop");
    const cats = [o.profiler ? "disabled-by-default-v8.cpu_profiler" : "", o.cats ?? ""].filter(Boolean).join(",");
    if (cats) args.push(`--additional-trace-categories=${cats}`);
    // detached: własna grupa procesów, żeby przekroczenie czasu zabiło też Chrome uruchomiony przez Lighthouse.
    const ch = spawn(process.execPath, args, { stdio: ["ignore", "ignore", "pipe"], detached: true });
    let err = "";
    ch.stderr.on("data", (c) => (err = (err + c).slice(-2000)));
    const t = setTimeout(() => { try { process.kill(-ch.pid, "SIGKILL"); } catch { ch.kill("SIGKILL"); } }, 240000);
    ch.on("exit", (code) => { clearTimeout(t); done({ code, err }); });
  });
const summary = [];
try {
  const i0 = Number(o["index-from"]);
  for (let i = i0; i < i0 + Number(o.runs); i++) {
    for (const form of o.forms.split(",")) {
      const name = `${o.label}-${form}-${i}`;
      const dir = join(out, name);
      const doc = await warmDocument(artifact.origin, "/");
      const cache = doc.headers.get("x-nes-cache") ?? "?";
      const l0 = loadavg()[0].toFixed(2);
      const r = await runLH(form, dir, join(out, `${name}.json`));
      let line = `${name} code=${r.code} warm=${doc.status} x-nes-cache=${cache} raw=${doc.body.length} load=${l0}`;
      if (r.code === 0 && existsSync(join(out, `${name}.json`))) {
        const lhr = JSON.parse(readFileSync(join(out, `${name}.json`), "utf8"));
        const a = lhr.audits; const g = (k) => Math.round(a[k]?.numericValue ?? -1);
        line += ` perf=${Math.round((lhr.categories.performance.score ?? 0) * 100)} FCP=${g("first-contentful-paint")} LCP=${g("largest-contentful-paint")} TBT=${g("total-blocking-time")} SI=${g("speed-index")} TTI=${g("interactive")}`;
      } else line += ` ERR ${r.err.slice(-300)}`;
      console.log(line);
      summary.push(line);
    }
  }
} finally {
  appendFileSync(join(out, `${o.label}-summary.txt`), summary.join("\n") + "\n");
  await front.stop().catch(() => {});
  await artifact.stop().catch(() => {});
}
