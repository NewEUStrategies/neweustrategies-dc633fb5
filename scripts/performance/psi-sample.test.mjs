// Testy próbnika PSI (psi-sample.mjs, P0.2 planu PSI 85/95).
//
// Warstwy czyste: locale=pl w zapytaniu, zamaskowany klucz, cache-buster
// `utm_source`, klasyfikacja HIT/MISS z `server-response-time`, wykrycie
// przekierowania, rozpoznawanie zapisanych raportów (odpowiedź API v5, sam LHR
// z eksportu pagespeed.web.dev, raport HTML) i jednoliniowa diagnostyka błędów.
//
// Ścieżka live na LOKALNYM serwerze (PSI_ENDPOINT_URL, PSI_RETRY_BASE_MS):
// zapis `<forma>-<n>.lhr.json` i `.field.json`, exit 1 przy zerze udanych
// przebiegów (na tym stoi czerwony krok `psi.yml`), ponowienie po 5xx, limit
// `--runs` i to, że wartość PSI_API_KEY nie trafia ani do logu, ani do plików.
// Test nie pyta Google.
//
// Styk z harnessem: `summary.json` z `--from-file` przechodzi wprost przez
// `parsePsiReference` (`lighthouse-local.mjs --psi-reference`).
//
// Każda klasyfikacja ma kontrolę negatywną.
//
// Uruchomienie: node --test scripts/performance/psi-sample.test.mjs
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parsePsiReference } from "./lighthouseReport.ts";
import {
  DEFAULT_LOCALE,
  MAX_RUNS,
  MISS_THRESHOLD_MS,
  PSI_ENDPOINT,
  PSI_RETRY_BASE_MS,
  cacheBustedTarget,
  cacheCounts,
  classifyCache,
  expandInputs,
  fetchErrorDetail,
  liveSettings,
  parsePsiInput,
  psiErrorDetail,
  psiRequestUrl,
  redactKey,
  redactSecret,
  runInfo,
} from "./psi-sample.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "psi-sample.mjs");

/** Minimalny LHR, który przechodzi przez `extractMetrics`. */
function lhr({
  form = "mobile",
  srt = 300,
  score = 0.53,
  tbt = 600,
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
      "total-blocking-time": { numericValue: tbt },
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

  // Lighthouse koduje `<` w JSON-ie raportu HTML jako `\u003c` - także w treści audytów.
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

// ── Styk z harnessem: summary.json -> --psi-reference (kalibracja k) ─────────

test("summary.json z --from-file przechodzi przez parsePsiReference (mediany TBT obu form)", () => {
  const dir = mkdtempSync(join(tmpdir(), "nes-psi-ref-"));
  const out = join(dir, "out");
  writeFileSync(join(dir, "m1.lhr.json"), JSON.stringify(lhr({ form: "mobile", tbt: 500 })));
  writeFileSync(join(dir, "m2.lhr.json"), JSON.stringify(lhr({ form: "mobile", tbt: 700 })));
  writeFileSync(join(dir, "d1.lhr.json"), JSON.stringify(lhr({ form: "desktop", tbt: 200 })));
  writeFileSync(join(dir, "d2.lhr.json"), JSON.stringify(lhr({ form: "desktop", tbt: 400 })));
  const run = spawnSync(process.execPath, [SCRIPT, "--from-file", dir, "--out", out], {
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  const summary = JSON.parse(readFileSync(join(out, "summary.json"), "utf8"));
  // Prawdziwy kształt próbnika: liczby w `forms.<forma>.median`, nie na płasko.
  assert.equal(summary.forms.mobile.tbt, undefined);
  assert.equal(summary.forms.mobile.median.tbt, 600);

  const ref = parsePsiReference(summary);
  assert.equal(ref.forms.mobile.tbt, 600);
  assert.equal(ref.forms.desktop.tbt, 300);
  assert.equal(ref.forms.mobile.score, 53);
  assert.equal(ref.forms.mobile.fcp, 3000);

  // Kontrola negatywna: mediana bez TBT nie kalibruje niczego - błąd, nie cisza.
  delete summary.forms.mobile.median.tbt;
  assert.throws(() => parsePsiReference(summary), /forma mobile bez liczby `tbt`/);
});

// ── Diagnostyka błędów i podmiany środowiska ────────────────────────────────

const GOOGLE_400 = `{
  "error": {
    "code": 400,
    "message": "API key not valid. Please pass a valid API key.",
    "errors": [
      {
        "message": "API key not valid. Please pass a valid API key.",
        "domain": "global",
        "reason": "badRequest"
      }
    ],
    "status": "INVALID_ARGUMENT"
  }
}
`;

test("błąd PSI to jedna linia: error.message z JSON-a Google, inaczej spłaszczony tekst", () => {
  assert.equal(psiErrorDetail(GOOGLE_400), "API key not valid. Please pass a valid API key.");
  // Kontrola negatywna: treść, która nie jest błędem Google, nie ginie i nie łamie linii.
  const html = "<html>\n  <body>\n    502 Bad Gateway\n  </body>\n</html>";
  assert.equal(psiErrorDetail(html), "<html> <body> 502 Bad Gateway </body> </html>");
  assert.equal(psiErrorDetail(JSON.stringify({ error: { code: 500 } })), '{"error":{"code":500}}');
  assert.equal(psiErrorDetail("x".repeat(1000)).length, 300);
  assert.equal(psiErrorDetail(" \n "), "(pusta odpowiedź)");
});

test("błąd fetch pokazuje przyczynę z error.cause (kod, potem komunikat)", () => {
  const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9"), {
    code: "ECONNREFUSED",
  });
  assert.equal(
    fetchErrorDetail(new TypeError("fetch failed", { cause: refused })),
    "fetch failed (ECONNREFUSED)",
  );
  assert.equal(
    fetchErrorDetail(new TypeError("fetch failed", { cause: new Error("other side closed") })),
    "fetch failed (other side closed)",
  );
  // Kontrola negatywna: bez przyczyny zostaje sam komunikat.
  assert.equal(fetchErrorDetail(new Error("The operation timed out")), "The operation timed out");
  assert.equal(fetchErrorDetail("napis"), "napis");
});

test("klucz w dowolnym tekście jest maskowany; pusty klucz niczego nie rusza", () => {
  assert.equal(redactSecret("zły klucz K-1 (K-1)", "K-1"), "zły klucz *** (***)");
  assert.equal(redactSecret("bez klucza", undefined), "bez klucza");
  assert.equal(redactSecret("bez klucza", ""), "bez klucza");
});

test("PSI_ENDPOINT_URL i PSI_RETRY_BASE_MS: domyślnie Google i 30 s, podmiana, zła wartość = błąd", () => {
  assert.deepEqual(liveSettings({}), { endpoint: PSI_ENDPOINT, retryBaseMs: PSI_RETRY_BASE_MS });
  assert.equal(PSI_RETRY_BASE_MS, 30_000);
  assert.deepEqual(
    liveSettings({ PSI_ENDPOINT_URL: "http://127.0.0.1:9/psi", PSI_RETRY_BASE_MS: "5" }),
    { endpoint: "http://127.0.0.1:9/psi", retryBaseMs: 5 },
  );
  assert.equal(liveSettings({ PSI_RETRY_BASE_MS: "0" }).retryBaseMs, 0);
  assert.equal(
    new URL(psiRequestUrl("https://x.test/", "mobile", { endpoint: "http://127.0.0.1:9/psi" }))
      .host,
    "127.0.0.1:9",
  );
  // Kontrola negatywna: literówka nie wraca po cichu do 30 s ani do Google.
  assert.throws(() => liveSettings({ PSI_RETRY_BASE_MS: "abc" }), /PSI_RETRY_BASE_MS/);
  assert.throws(() => liveSettings({ PSI_RETRY_BASE_MS: "-1" }), /PSI_RETRY_BASE_MS/);
  assert.throws(() => liveSettings({ PSI_ENDPOINT_URL: "nie url" }), /PSI_ENDPOINT_URL/);
});

// ── Ścieżka live na lokalnym serwerze ───────────────────────────────────────

const KEY = "SEKRET-psi-test-7f3a";

/** Lokalne „PSI": kolejne odpowiedzi z listy, ostatnia powtarzana. */
async function fakePsi(replies) {
  const seen = [];
  const server = createServer((req, res) => {
    const reply = replies[Math.min(seen.length, replies.length - 1)];
    seen.push(new URL(req.url ?? "/", "http://127.0.0.1"));
    const body = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
    res.writeHead(reply.status, { "content-type": "application/json; charset=utf-8" });
    res.end(body);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address();
  return {
    endpoint: `http://127.0.0.1:${port}/pagespeedonline/v5/runPagespeed`,
    seen,
    close: () => new Promise((done) => server.close(done)),
  };
}

/** Próbnik jako osobny proces (asynchronicznie: serwer żyje w tym procesie). */
function sample(endpoint, args) {
  const out = mkdtempSync(join(tmpdir(), "nes-psi-live-"));
  const child = spawn(
    process.execPath,
    [SCRIPT, "--url", "https://x.test/", "--gap", "0", "--out", out, ...args],
    {
      env: {
        ...process.env,
        PSI_API_KEY: KEY,
        PSI_ENDPOINT_URL: endpoint,
        PSI_RETRY_BASE_MS: "5",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  return new Promise((done, fail) => {
    child.on("error", fail);
    child.on("close", (status) => done({ status, stdout, stderr, out }));
  });
}

/**
 * Wartość klucza nie występuje w logu ani w ŻADNYM zapisanym pliku. Sprawdzany
 * jest też sam prefiks: ucięty cytat treści zdradziłby początek klucza.
 */
function assertKeyNowhere(run) {
  for (const secret of [KEY, KEY.slice(0, 6)]) {
    assert.equal(run.stdout.includes(secret), false, `${secret} w stdout`);
    assert.equal(run.stderr.includes(secret), false, `${secret} w stderr`);
    for (const name of readdirSync(run.out)) {
      const text = readFileSync(join(run.out, name), "utf8");
      assert.equal(text.includes(secret), false, `${secret} w ${name}`);
    }
  }
}

function okResponse() {
  return {
    kind: "pagespeedonline#result",
    id: "https://x.test/",
    loadingExperience: {
      overall_category: "AVERAGE",
      metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2900, category: "AVERAGE" } },
    },
    lighthouseResult: lhr({ srt: 250 }),
  };
}

test("live (i): 200 -> exit 0, mobile-1.lhr.json i mobile-1.field.json bez lighthouseResult", async () => {
  const psi = await fakePsi([{ status: 200, body: okResponse() }]);
  try {
    const run = await sample(psi.endpoint, ["--strategy", "mobile", "--runs", "1"]);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(psi.seen.length, 1);
    // Klucz naprawdę poszedł w zapytaniu - inaczej „brak klucza w logu" nic nie dowodzi.
    assert.equal(psi.seen[0].searchParams.get("key"), KEY);
    assert.equal(psi.seen[0].searchParams.get("locale"), "pl");
    const saved = JSON.parse(readFileSync(join(run.out, "mobile-1.lhr.json"), "utf8"));
    assert.equal(saved.lighthouseVersion, "13.5.0");
    const field = JSON.parse(readFileSync(join(run.out, "mobile-1.field.json"), "utf8"));
    assert.equal("lighthouseResult" in field, false);
    assert.equal(field.loadingExperience.overall_category, "AVERAGE");
    const summary = JSON.parse(readFileSync(join(run.out, "summary.json"), "utf8"));
    assert.equal(summary.forms.mobile.n, 1);
    assert.equal(new URL(summary.requests.mobile).searchParams.get("key"), "***");
    assert.match(run.stdout, /CrUX URL \[AVERAGE\]: LARGEST_CONTENTFUL_PAINT=p75 2900/);
    assertKeyNowhere(run);
  } finally {
    await psi.close();
  }
});

test("live (ii): 400 przy każdym wywołaniu -> exit 1, bez ponowień, błąd jedną linią", async () => {
  const psi = await fakePsi([{ status: 400, body: GOOGLE_400 }]);
  try {
    const run = await sample(psi.endpoint, ["--strategy", "mobile", "--runs", "2"]);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /✗ PSI: zero udanych przebiegów dla: mobile/);
    // 400 to błąd klienta: jedno wywołanie na przebieg, żadnego ponowienia.
    assert.equal(psi.seen.length, 2);
    assert.doesNotMatch(run.stdout, /ponowienie/);
    // Linia, którą bierze grep podsumowania joba, niesie powód, a nie `{`.
    assert.match(
      run.stdout,
      /^ {2}mobile-1: PSI HTTP 400: API key not valid\. Please pass a valid API key\.$/m,
    );
    const summary = JSON.parse(readFileSync(join(run.out, "summary.json"), "utf8"));
    assert.deepEqual(summary.forms, {});
    assertKeyNowhere(run);
  } finally {
    await psi.close();
  }
});

test("live: serwer odbijający klucz w treści - klucz zamaskowany w każdej linii błędu", async () => {
  // Trzy ścieżki: 503 -> linia ponowienia, 400 -> błąd przebiegu, 200 z treścią,
  // która nie jest JSON-em -> własny komunikat bez cytatu treści (SyntaxError
  // z `res.json()` cytowałby jej UCIĘTY początek, czyli prefiks klucza).
  const echo = (code) => ({ error: { code, message: `API key ${KEY} not valid` } });
  const psi = await fakePsi([
    { status: 503, body: echo(503) },
    { status: 400, body: echo(400) },
    { status: 200, body: `<html>${KEY}</html>` },
  ]);
  try {
    const run = await sample(psi.endpoint, ["--strategy", "mobile", "--runs", "2"]);
    assert.equal(run.status, 1);
    assert.equal(psi.seen.length, 3);
    assert.match(run.stdout, /PSI HTTP 503: API key \*\*\* not valid - ponowienie/);
    assert.match(run.stdout, /mobile-1: PSI HTTP 400: API key \*\*\* not valid$/m);
    assert.match(run.stdout, /mobile-2: PSI HTTP 200: odpowiedź nie jest JSON-em \(\d+ znaków\)$/m);
    assertKeyNowhere(run);
  } finally {
    await psi.close();
  }
});

test("live (iii): 503, potem 200 -> jedno ponowienie i exit 0", async () => {
  const psi = await fakePsi([
    { status: 503, body: { error: { code: 503, message: "Backend unavailable" } } },
    { status: 200, body: okResponse() },
  ]);
  try {
    const run = await sample(psi.endpoint, ["--strategy", "mobile", "--runs", "1"]);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(psi.seen.length, 2);
    assert.equal(run.stdout.match(/ponowienie za/g)?.length, 1);
    assert.match(run.stdout, /PSI HTTP 503: Backend unavailable - ponowienie za 0\.005 s/);
    assert.ok(readFileSync(join(run.out, "mobile-1.lhr.json"), "utf8").length > 0);
    assertKeyNowhere(run);
  } finally {
    await psi.close();
  }
});

test("live: błąd sieci -> cztery próby, powód z error.cause w logu, exit 1", async () => {
  // Port, który przed chwilą był wolny i jest już zamknięty: ECONNREFUSED.
  const probe = await fakePsi([{ status: 200, body: {} }]);
  await probe.close();
  const run = await sample(probe.endpoint, ["--strategy", "mobile", "--runs", "1"]);
  assert.equal(run.status, 1);
  assert.equal(run.stdout.match(/ponowienie za/g)?.length, 3);
  assert.match(
    run.stdout,
    /mobile-1: PSI: wyczerpane ponowienia \(fetch failed \(ECONNREFUSED\)\)/,
  );
  assert.match(run.stderr, /✗ PSI: zero udanych przebiegów dla: mobile/);
  assertKeyNowhere(run);
});

test("live: błąd fetch cytujący URL zapytania - klucz zamaskowany", async () => {
  // undici odrzuca URL z danymi logowania komunikatem, który cytuje CAŁY URL,
  // razem z `key=`. Serwer nie jest potrzebny: fetch pada przed połączeniem.
  const run = await sample("http://u:p@127.0.0.1:9/psi", ["--strategy", "mobile", "--runs", "1"]);
  assert.equal(run.status, 1);
  assert.match(run.stdout, /mobile-1: PSI: wyczerpane ponowienia \(Request cannot be constructed/);
  assert.match(run.stdout, /key=\*\*\*/);
  assertKeyNowhere(run);
});

test("live: --runs powyżej limitu jest przycinane do MAX_RUNS", async () => {
  assert.equal(MAX_RUNS, 10);
  const psi = await fakePsi([{ status: 200, body: okResponse() }]);
  try {
    const run = await sample(psi.endpoint, ["--strategy", "mobile", "--runs", "12"]);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /UWAGA: --runs 12 przycięte do 10 przebiegów na formę/);
    assert.equal(psi.seen.length, MAX_RUNS);
    // Kontrola negatywna: liczba w limicie nie jest ruszana.
    const within = await sample(psi.endpoint, ["--strategy", "mobile", "--runs", "2"]);
    assert.equal(within.status, 0, within.stderr);
    assert.doesNotMatch(within.stdout, /przycięte/);
    assert.equal(psi.seen.length, MAX_RUNS + 2);
  } finally {
    await psi.close();
  }
});
