// Testy warstw czystych próbnika PSI (psi-sample.mjs, P0.2 planu PSI 85/95):
// locale=pl w zapytaniu, zamaskowany klucz, cache-buster `utm_source`,
// klasyfikacja HIT/MISS z `server-response-time`, wykrycie przekierowania
// i rozpoznawanie zapisanych raportów (odpowiedź API v5, sam LHR z eksportu
// pagespeed.web.dev, raport HTML). Każda klasyfikacja ma kontrolę negatywną.
//
// Uruchomienie: node --test scripts/performance/psi-sample.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_LOCALE,
  MISS_THRESHOLD_MS,
  cacheBustedTarget,
  cacheCounts,
  classifyCache,
  expandInputs,
  parsePsiInput,
  psiRequestUrl,
  redactKey,
  runInfo,
} from "./psi-sample.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "psi-sample.mjs");

/** Minimalny LHR, który przechodzi przez `extractMetrics`. */
function lhr({
  form = "mobile",
  srt = 300,
  score = 0.53,
  requested = "https://x.test/",
  final = requested,
} = {}) {
  return {
    lighthouseVersion: "13.5.0",
    requestedUrl: requested,
    finalDisplayedUrl: final,
    configSettings: { formFactor: form, locale: "pl" },
    environment: { benchmarkIndex: 1500 },
    categories: { performance: { score } },
    audits: {
      "server-response-time": { numericValue: srt },
      "first-contentful-paint": { numericValue: 3000 },
      "largest-contentful-paint": { numericValue: 6000 },
      "total-blocking-time": { numericValue: 600 },
      "speed-index": { numericValue: 7000 },
      "cumulative-layout-shift": { numericValue: 0 },
    },
  };
}

test("zapytanie PSI ma locale=pl domyślnie, kategorię performance i mierzony URL", () => {
  assert.equal(DEFAULT_LOCALE, "pl");
  const url = new URL(psiRequestUrl("https://x.test/?utm_source=a", "mobile"));
  assert.equal(url.searchParams.get("locale"), "pl");
  assert.equal(url.searchParams.get("strategy"), "mobile");
  assert.equal(url.searchParams.get("category"), "performance");
  assert.equal(url.searchParams.get("url"), "https://x.test/?utm_source=a");
  assert.equal(url.searchParams.has("key"), false);
  // Kontrola negatywna: jawne locale wygrywa z domyślnym.
  assert.equal(
    new URL(psiRequestUrl("https://x.test/", "desktop", { locale: "en" })).searchParams.get(
      "locale",
    ),
    "en",
  );
});

test("klucz API trafia do zapytania, ale nigdy do logu", () => {
  const raw = psiRequestUrl("https://x.test/", "mobile", { key: "SEKRET-123" });
  assert.equal(new URL(raw).searchParams.get("key"), "SEKRET-123");
  const shown = redactKey(raw);
  assert.equal(shown.includes("SEKRET-123"), false);
  assert.equal(new URL(shown).searchParams.get("key"), "***");
  assert.equal(new URL(shown).searchParams.get("locale"), "pl");
});

test("utm_source per przebieg zachowuje ścieżkę i nadpisuje poprzedni znacznik", () => {
  const a = new URL(cacheBustedTarget("https://x.test/blog?utm_source=stary&q=1", "run-1"));
  assert.equal(a.pathname, "/blog");
  assert.equal(a.searchParams.get("utm_source"), "nes-psi-run-1");
  assert.equal(a.searchParams.get("q"), "1");
  assert.notEqual(
    cacheBustedTarget("https://x.test/", "a"),
    cacheBustedTarget("https://x.test/", "b"),
  );
});

test("HIT/MISS: server-response-time > 1000 ms = MISS, granica i brak audytu", () => {
  assert.equal(MISS_THRESHOLD_MS, 1000);
  assert.deepEqual(classifyCache(lhr({ srt: 2752 })), { cache: "MISS", serverResponseMs: 2752 });
  assert.equal(classifyCache(lhr({ srt: 1001 })).cache, "MISS");
  assert.equal(classifyCache(lhr({ srt: 1000 })).cache, "HIT");
  assert.equal(classifyCache(lhr({ srt: 130 })).cache, "HIT");
  const noAudit = lhr();
  delete noAudit.audits["server-response-time"];
  assert.deepEqual(classifyCache(noAudit), { cache: "?", serverResponseMs: null });
  assert.deepEqual(
    cacheCounts([{ cache: "HIT" }, { cache: "MISS" }, { cache: "MISS" }, { cache: "?" }]),
    { HIT: 1, MISS: 2, "?": 1 },
  );
});

test("przekierowanie `/` -> `/en` (PSI z angielskim locale) jest wykrywane", () => {
  const hop = runInfo(lhr({ requested: "https://x.test/", final: "https://x.test/en" }));
  assert.equal(hop.redirected, true);
  assert.equal(hop.finalPath, "/en");
  // Kontrola negatywna: sam cache-buster w zapytaniu nie jest przekierowaniem.
  const same = runInfo(
    lhr({ requested: "https://x.test/?utm_source=a", final: "https://x.test/?utm_source=a" }),
  );
  assert.equal(same.redirected, false);
  assert.equal(same.form, "mobile");
  assert.equal(same.locale, "pl");
});

test("rozpoznaje odpowiedź API v5, sam LHR (eksport pagespeed.web.dev) i raport HTML", () => {
  const report = lhr({ form: "desktop" });
  const api = parsePsiInput(JSON.stringify({ lighthouseResult: report, loadingExperience: {} }));
  assert.equal(api.kind, "psi-api");
  assert.equal(api.lhr.configSettings.formFactor, "desktop");
  assert.ok(api.response.loadingExperience);

  const bare = parsePsiInput(JSON.stringify(report));
  assert.equal(bare.kind, "lhr");
  assert.equal(bare.response, null);

  // Lighthouse koduje `<` w JSON-ie raportu HTML jako < - także w treści audytów.
  report.audits["server-response-time"].displayValue = "</script><b>";
  const json = JSON.stringify(report).replace(/</g, "\\u003c");
  const html = `<!doctype html><html><body><script>window.__LIGHTHOUSE_JSON__ = ${json};</script><script>render()</script></body></html>`;
  const fromHtml = parsePsiInput(html);
  assert.equal(fromHtml.kind, "lhr-html");
  assert.equal(fromHtml.lhr.audits["server-response-time"].displayValue, "</script><b>");
});

test("kontrola negatywna: JSON, który nie jest raportem, daje null", () => {
  assert.equal(parsePsiInput("{nie json"), null);
  assert.equal(parsePsiInput(JSON.stringify({ schema: 1, forms: {} })), null);
  assert.equal(parsePsiInput(JSON.stringify({ lighthouseResult: { audits: {} } })), null);
  const noCategories = lhr();
  delete noCategories.categories;
  assert.equal(parsePsiInput(JSON.stringify(noCategories)), null);
  assert.equal(parsePsiInput("<html><body>bez raportu</body></html>"), null);
});

test("katalog: pomija summary.json i *.field.json, plik jawny zostaje jawny", () => {
  const dir = mkdtempSync(join(tmpdir(), "nes-psi-"));
  for (const name of ["b.lhr.json", "a.json", "summary.json", "a.field.json", "notatki.txt"]) {
    writeFileSync(join(dir, name), "{}");
  }
  const listed = expandInputs([dir]);
  assert.deepEqual(
    listed.map((i) => [i.file.slice(dir.length + 1), i.explicit]),
    [
      ["a.json", false],
      ["b.lhr.json", false],
    ],
  );
  assert.deepEqual(expandInputs([join(dir, "summary.json")]), [
    { file: join(dir, "summary.json"), explicit: true },
  ]);
});

test("--from-file na katalogu: mediana per forma, HIT/MISS i mediana z samych HIT", () => {
  const dir = mkdtempSync(join(tmpdir(), "nes-psi-cli-"));
  const out = join(dir, "out");
  writeFileSync(join(dir, "mobile-1.lhr.json"), JSON.stringify(lhr({ srt: 250, score: 0.6 })));
  writeFileSync(join(dir, "mobile-2.lhr.json"), JSON.stringify(lhr({ srt: 2752, score: 0.5 })));
  writeFileSync(
    join(dir, "mobile-3.json"),
    JSON.stringify({ lighthouseResult: lhr({ srt: 300, score: 0.62 }) }),
  );
  writeFileSync(join(dir, "summary.json"), JSON.stringify({ schema: 1 }));
  const run = spawnSync(process.execPath, [SCRIPT, "--from-file", dir, "--out", out], {
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /mobile-2 .*cache=MISS \(server-response-time=2752ms\)/);
  assert.match(run.stdout, /MEDIAN psi mobile: .*cache HIT=2 MISS=1/);
  assert.match(run.stdout, /MEDIAN psi mobile tylko-HIT: /);
  const summary = JSON.parse(readFileSync(join(out, "summary.json"), "utf8"));
  assert.deepEqual(summary.forms.mobile.cache, { HIT: 2, MISS: 1, "?": 0 });
  assert.equal(summary.forms.mobile.hitOnly.n, 2);
  assert.deepEqual(
    summary.forms.mobile.runs.map((r) => r.cache),
    ["HIT", "MISS", "HIT"],
  );
});

test("kontrola negatywna CLI: jawnie podany plik bez raportu kończy się kodem 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "nes-psi-bad-"));
  const file = join(dir, "summary.json");
  writeFileSync(file, JSON.stringify({ schema: 1 }));
  const run = spawnSync(process.execPath, [SCRIPT, "--from-file", file], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /to nie jest raport Lighthouse'a/);
});
