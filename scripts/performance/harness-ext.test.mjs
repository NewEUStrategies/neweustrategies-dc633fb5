// Testy rozszerzeń harnessu P0.1 (2026-10-04): ważność przebiegu (STALE/MISS,
// SSR w trakcie), ponowne rozgrzanie, powtórki `excluded`, pary A/A i MDE,
// kalibracja k, formy desktop4x/desktop5x, wstrzyknięcie do <head> bez
// buforowania, backend klienta PostgREST, atrapa gtag i księga Lantern per
// zadanie (warstwa czysta). Każda reguła ma kontrolę negatywną.
//
// Uruchomienie: node --test scripts/performance/harness-ext.test.mjs
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { brotliCompressSync } from "node:zlib";
import { join } from "node:path";
import { test } from "node:test";
import {
  createHeadInjector,
  freePort,
  hostResolverFlag,
  logCursor,
  rewarmDocument,
} from "./artifactServer.ts";
import {
  POSTGREST_EXPOSE_HEADERS,
  diffClientBackendStats,
  handleClientBackendRequest,
  startClientBackend,
} from "./clientBackend.ts";
import {
  BENCHMARK_PAGE,
  GA_ANY_HOST_SNIPPET,
  PRODUCTION_GTAG_BYTES,
  fakeGoogleScale,
  fakeGtagScript,
  parseBenchmarkDump,
} from "./fakeGoogle.ts";
import { fixtureResponse } from "./homeFixture.ts";
import {
  DEFAULT_EXCLUDE_SCRIPTS,
  blockingInWindow,
  classifyTask,
  diffLedgers,
  lanternWindows,
  ledgerRows,
  scriptBytesEndedBefore,
  shortScriptName,
  unionDuration,
} from "./lanternTasks.ts";
import {
  FORMS,
  NO_FLAGS,
  calibrationK,
  classifyRun,
  compactServerTiming,
  comparabilityWarnings,
  documentFromDevtoolsLog,
  flagsLabel,
  formatAaCheck,
  formatCalibration,
  observeDocument,
  pairedStats,
  parseForms,
  parsePsiReference,
  parseServerLogDocs,
  runWithRepeats,
  summarizeValidity,
  validPairs,
} from "./lighthouseReport.ts";

const docLine = (fields) => JSON.stringify({ kind: "doc", path: "/", status: 200, ...fields });

// ── ważność przebiegu ────────────────────────────────────────────────────────

test("dokument STALE w odpowiedzi dla Lighthouse'a = przebieg excluded", () => {
  const stale = observeDocument("front", 200, { "x-nes-cache": "STALE", "x-nes-cache-age": "185" });
  const verdict = classifyRun({ document: stale, serverDocs: [] });
  assert.equal(verdict.excluded, true);
  assert.match(verdict.reasons[0], /dokument STALE/);
  // kontrola negatywna: HIT bez renderów jest ważny
  const hit = observeDocument("front", 200, { "x-nes-cache": "HIT", "x-nes-cache-age": "12" });
  assert.deepEqual(classifyRun({ document: hit, serverDocs: [] }), {
    excluded: false,
    reasons: [],
  });
});

test("MISS, brak nagłówka i brak dokumentu w logu frontu też wykluczają przebieg", () => {
  for (const headers of [{ "x-nes-cache": "MISS" }, {}]) {
    const verdict = classifyRun({
      document: observeDocument("front", 200, headers),
      serverDocs: [],
    });
    assert.equal(verdict.excluded, true);
  }
  assert.equal(classifyRun({ document: null, serverDocs: [] }).excluded, true);
});

test("render SSR w trakcie przebiegu (rewalidacja w tle) wyklucza przebieg mimo dokumentu HIT", () => {
  const hit = observeDocument("front", 200, { "x-nes-cache": "HIT" });
  const log = [
    docLine({ cache: "HIT", revalidation: false, appMs: 1 }),
    "zwykła linia logu",
    docLine({ cache: "MISS", revalidation: true, appMs: 840 }),
    '{"kind":"doc","path":"/","sta', // linia obcięta na granicy odczytu
  ].join("\n");
  const serverDocs = parseServerLogDocs(log);
  assert.equal(serverDocs.length, 2);
  const verdict = classifyRun({ document: hit, serverDocs });
  assert.equal(verdict.excluded, true);
  assert.match(verdict.reasons.join(" "), /SSR w trakcie przebiegu: 1x \(rewalidacja\)/);
  // kontrola negatywna: sam HIT w logu serwera nie jest renderem
  assert.equal(classifyRun({ document: hit, serverDocs: serverDocs.slice(0, 1) }).excluded, false);
});

test("devtoolsLog jest kontrolą krzyżową logu frontu, a nieudana rozgrzewka wyklucza", () => {
  const log = [
    { method: "Network.requestWillBeSent", params: {} },
    {
      method: "Network.responseReceived",
      params: {
        type: "Document",
        response: { status: 200, headers: { "x-nes-cache": "STALE", "x-nes-cache-age": "200" } },
      },
    },
  ];
  const dev = documentFromDevtoolsLog(log);
  assert.equal(dev?.cache, "STALE");
  assert.equal(dev?.ageS, 200);
  const hit = observeDocument("front", 200, { "x-nes-cache": "HIT" });
  assert.equal(classifyRun({ document: hit, serverDocs: [], devtools: dev }).excluded, true);
  assert.equal(classifyRun({ document: hit, serverDocs: [], rewarmOk: false }).excluded, true);
  assert.equal(documentFromDevtoolsLog("nie log"), null);
});

test("observeDocument czyta Headers z fetch i rekord node:http tak samo", () => {
  const a = observeDocument(
    "warm",
    200,
    new Headers({ "x-nes-cache": "hit", "x-nes-cache-age": "7", "server-timing": "app;dur=3" }),
  );
  const b = observeDocument("front", 200, {
    "X-Nes-Cache": "HIT",
    "x-nes-cache-age": ["7"],
    "server-timing": "app;dur=3",
  });
  assert.equal(a.cache, "HIT");
  assert.equal(b.cache, "HIT");
  assert.equal(a.ageS, 7);
  assert.equal(b.ageS, 7);
  assert.equal(b.serverTiming, "app;dur=3");
  assert.equal(
    compactServerTiming('nes-edge;desc="HIT", nes-age;dur=1173, server-init;dur=0, app;dur=1'),
    "nes-edge=HIT,nes-age=1173,server-init=0,app=1",
  );
  assert.equal(compactServerTiming(null), "-");
});

// ── ponowne rozgrzanie ───────────────────────────────────────────────────────

function scripted(responses) {
  const queue = [...responses];
  const calls = [];
  return {
    calls,
    fetchDocument: async (origin, path, lang, ua) => {
      calls.push({ origin, path, lang, ua });
      // ostatnia odpowiedź powtarza się do końca (np. wiecznie MISS)
      const next = queue.length > 1 ? queue.shift() : queue[0];
      const headers = new Headers({
        "x-nes-cache": next.cache,
        "x-nes-cache-age": String(next.age),
      });
      return { status: 200, headers };
    },
  };
}

test("rozgrzewka czeka na HIT po STALE (rewalidacja) i podaje UA wariantu", async () => {
  const slept = [];
  const fake = scripted([
    { cache: "STALE", age: 190 },
    { cache: "STALE", age: 190 },
    { cache: "HIT", age: 0 },
  ]);
  const result = await rewarmDocument("http://up", "/", {
    userAgent: "curl/8.5.0",
    fetchDocument: fake.fetchDocument,
    sleep: async (ms) => void slept.push(ms),
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts.length, 3);
  assert.equal(result.final.cache, "HIT");
  assert.ok(fake.calls.every((c) => c.ua === "curl/8.5.0"));
  assert.deepEqual(slept, [500, 250]);
});

test("HIT bez zapasu świeżości: rozgrzewka czeka na STALE i odświeża wpis", async () => {
  const slept = [];
  const fake = scripted([
    { cache: "HIT", age: 170 },
    { cache: "STALE", age: 181 },
    { cache: "HIT", age: 0 },
  ]);
  const result = await rewarmDocument("http://up", "/", {
    minFreshS: 30,
    freshWindowS: 180,
    fetchDocument: fake.fetchDocument,
    sleep: async (ms) => void slept.push(ms),
  });
  assert.equal(result.ok, true);
  assert.equal(slept[0], 10_500);
  assert.equal(result.waitedForStaleS, 10.5);
  // kontrola negatywna: HIT z zapasem nie czeka wcale
  const fresh = await rewarmDocument("http://up", "/", {
    fetchDocument: scripted([{ cache: "HIT", age: 149 }]).fetchDocument,
    sleep: async () => assert.fail("nie powinno czekać"),
  });
  assert.equal(fresh.ok, true);
  assert.equal(fresh.attempts.length, 1);
});

test("rozgrzewka po limicie czasu zwraca ok=false (przebieg będzie excluded)", async () => {
  const result = await rewarmDocument("http://up", "/", {
    timeoutMs: 0,
    fetchDocument: scripted([{ cache: "MISS", age: 0 }]).fetchDocument,
    sleep: async () => undefined,
  });
  assert.equal(result.ok, false);
  assert.equal(result.final.cache, "MISS");
});

test("kursor logu zwraca wyłącznie linie dopisane po znaczniku", () => {
  const dir = mkdtempSync(join(tmpdir(), "nes-log-"));
  const file = join(dir, "server.log");
  writeFileSync(file, `${docLine({ cache: "MISS" })}\n`);
  const cursor = logCursor(file);
  const mark = cursor.mark();
  assert.equal(cursor.since(mark), "");
  appendFileSync(file, `${docLine({ cache: "HIT" })}\n`);
  const docs = parseServerLogDocs(cursor.since(mark));
  assert.deepEqual(
    docs.map((d) => d.cache),
    ["HIT"],
  );
  assert.equal(logCursor(join(dir, "brak.log")).since(0), "");
});

// ── powtórki, n_valid, pary, MDE ─────────────────────────────────────────────

test("przebieg excluded jest powtarzany najwyżej 2 razy, ważny kończy serię prób", async () => {
  let calls = 0;
  const twice = await runWithRepeats(async (i) => ({ valid: ++calls === 2, i }), 2);
  assert.deepEqual(
    twice.map((r) => r.valid),
    [false, true],
  );
  const never = await runWithRepeats(async (i) => ({ valid: false, i }), 2);
  assert.equal(never.length, 3);
});

const metrics = (overrides) => ({
  score: 70,
  fcp: 4000,
  lcp: 4800,
  tbt: 300,
  si: 4000,
  cls: 0,
  ttfb: 10,
  tti: 6000,
  ...overrides,
});

test("n_valid liczy rundy z ważnym przebiegiem; pary biorą tylko rundy ważne po obu stronach", () => {
  const a = [
    { n: 1, valid: true, metrics: metrics({ tbt: 300 }) },
    { n: 2, valid: false, reasons: ["dokument STALE (status 200)"], metrics: metrics({}) },
    { n: 2, valid: true, metrics: metrics({ tbt: 320 }) },
    { n: 3, valid: true, metrics: metrics({ tbt: 280 }) },
  ];
  const b = [
    { n: 1, valid: true, metrics: metrics({ tbt: 310 }) },
    { n: 2, valid: true, metrics: metrics({ tbt: 300 }) },
    { n: 3, valid: false, reasons: ["SSR w trakcie przebiegu: 1x (rewalidacja)"] },
  ];
  const sa = summarizeValidity(a);
  assert.equal(sa.nValid, 3);
  assert.equal(sa.rounds, 3);
  assert.equal(sa.excludedAttempts, 1);
  assert.deepEqual(sa.reasons, { "dokument STALE": 1 });
  assert.equal(summarizeValidity(b).nValid, 2);
  const pairs = validPairs(a, b);
  assert.deepEqual(
    pairs.map(([x, y]) => [x.tbt, y.tbt]),
    [
      [300, 310],
      [320, 300],
    ],
  );
});

test("σΔ i MDE = 2,8·σΔ/√n z różnic par (B - A)", () => {
  const deltas = [10, -10, 20, -20, 0];
  const pairs = deltas.map((d) => [metrics({ tbt: 300 }), metrics({ tbt: 300 + d })]);
  const [tbt] = pairedStats(pairs, ["tbt"]);
  const sd = Math.sqrt((100 + 100 + 400 + 400 + 0) / 4);
  assert.equal(tbt.n, 5);
  assert.equal(tbt.meanDelta, 0);
  assert.ok(Math.abs(tbt.sdDelta - sd) < 1e-9);
  assert.ok(Math.abs(tbt.mde - (2.8 * sd) / Math.sqrt(5)) < 1e-9);
  // kontrola negatywna: jedna para nie daje odchylenia
  assert.ok(Number.isNaN(pairedStats(pairs.slice(0, 1), ["tbt"])[0].mde));
});

test("A/A: |ΔFCP| i |ΔLCP| ≤ 0,02 s przechodzi, większe nie", () => {
  assert.match(formatAaCheck("mobile", metrics({}), metrics({ fcp: 4015, lcp: 4790 })), /OK/);
  assert.match(formatAaCheck("mobile", metrics({}), metrics({ fcp: 2900 })), /PONAD PRÓG/);
});

// ── kalibracja k, formy, flagi ───────────────────────────────────────────────

test("k = TBT_PSI / TBT_fixture; |k-1| > 0,2 każe przeliczyć cele", () => {
  assert.equal(calibrationK(600, 300), 2);
  assert.ok(Number.isNaN(calibrationK(600, 0)));
  const far = formatCalibration("mobile", metrics({ tbt: 800 }));
  assert.match(far, /k=0\.75 \(\|k-1\| > 0,2/);
  assert.doesNotMatch(formatCalibration("desktop4x", metrics({ tbt: 700 })), /przelicz/);
  assert.match(formatCalibration("desktop5x", metrics({ tbt: 700 })), /PSI\(desktop\)=740ms/);
});

test("psi-reference: walidacja kształtu (bez TBT = błąd)", () => {
  const ref = parsePsiReference({
    label: "D13",
    forms: { mobile: { tbt: 610, fcp: 3000 }, desktop: { tbt: 700, junk: "x" } },
  });
  assert.equal(ref.forms.mobile.tbt, 610);
  assert.equal(ref.forms.desktop.junk, undefined);
  assert.throws(() => parsePsiReference({ forms: { mobile: {}, desktop: { tbt: 1 } } }), /tbt/);
  assert.throws(() => parsePsiReference([]), /obiekt/);
});

test("formy desktop4x/desktop5x = preset desktopowy z mnożnikiem CPU; literówka to błąd", () => {
  assert.deepEqual(parseForms("mobile, desktop4x,desktop4x,desktop5x"), [
    "mobile",
    "desktop4x",
    "desktop5x",
  ]);
  assert.deepEqual(FORMS.desktop4x.args, [
    "--preset=desktop",
    "--throttling.cpuSlowdownMultiplier=4",
  ]);
  assert.ok(FORMS.desktop5x.args.includes("--throttling.cpuSlowdownMultiplier=5"));
  assert.deepEqual(FORMS.mobile.args, []);
  assert.throws(() => parseForms("mobile,desktop3x"), /Nieznana forma/);
  assert.throws(() => parseForms(" , "), /Pusta/);
});

test("różne flagi harnessu po obu stronach porównania = ostrzeżenie", () => {
  const flagged = flagsLabel("fixture", "fake-gtag");
  assert.equal(flagsLabel("none", "none"), NO_FLAGS);
  assert.match(
    comparabilityWarnings({ flags: undefined }, { flags: flagged }).join(" "),
    /flagi harnessu/,
  );
  assert.deepEqual(comparabilityWarnings({ flags: flagged }, { flags: flagged }), []);
  assert.deepEqual(comparabilityWarnings({}, { flags: NO_FLAGS }), []);
});

// ── front: wstrzyknięcie do <head> i reguły hostów ──────────────────────────

test("wstrzyknięcie do <head> działa przy znaczniku rozciętym między kawałkami strumienia", () => {
  const inject = createHeadInjector(GA_ANY_HOST_SNIPPET);
  const parts = ["<!doctype html><html lang=pl><he", 'ad data-x="1">', "<title>x</title></head>"];
  const out = Buffer.concat([...parts.map((p) => inject.push(Buffer.from(p))), inject.flush()]);
  assert.equal(
    out.toString(),
    `<!doctype html><html lang=pl><head data-x="1">${GA_ANY_HOST_SNIPPET}<title>x</title></head>`,
  );
  // po wstrzyknięciu kolejne kawałki przechodzą bez zmian (bez buforowania)
  const tail = Buffer.from("<body>…</body>");
  assert.equal(inject.push(tail), tail);
});

test("dokument bez <head> przechodzi bez zmian, a <header> nie jest <head>", () => {
  const inject = createHeadInjector("<script>x</script>");
  const out = Buffer.concat([inject.push(Buffer.from("<header>a</header>")), inject.flush()]);
  assert.equal(out.toString(), "<header>a</header>");
});

test("jedna flaga --host-resolver-rules z reguł frontu i atrapy Google", () => {
  assert.deepEqual(hostResolverFlag([]), []);
  assert.deepEqual(hostResolverFlag(["MAP a 127.0.0.1:1", "MAP b 127.0.0.1:2"]), [
    "--host-resolver-rules='MAP a 127.0.0.1:1, MAP b 127.0.0.1:2'",
  ]);
});

// ── backend klienta ──────────────────────────────────────────────────────────

test("preflight PostgREST: 200, echo nagłówków i origin z żądania", async () => {
  const { response, kind } = await handleClientBackendRequest(
    new Request("http://127.0.0.1:4199/rest/v1/site_design_tokens", {
      method: "OPTIONS",
      headers: {
        origin: "https://fixture.invalid",
        "access-control-request-headers": "apikey,authorization,x-client-info",
      },
    }),
  );
  assert.equal(kind, "preflight");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://fixture.invalid");
  assert.equal(
    response.headers.get("access-control-allow-headers"),
    "apikey,authorization,x-client-info",
  );
  assert.equal(response.headers.get("access-control-expose-headers"), POSTGREST_EXPOSE_HEADERS);
});

test("GET site_design_tokens zwraca font_scale = {} jak domyślna kolumna i Content-Range", async () => {
  const { response, kind } = await handleClientBackendRequest(
    new Request("http://127.0.0.1:4199/rest/v1/site_design_tokens?select=font_scale", {
      headers: { origin: "https://fixture.invalid", accept: "application/vnd.pgrst.object+json" },
    }),
  );
  assert.equal(kind, "ok");
  const body = await response.json();
  assert.deepEqual(body.font_scale, {});
  assert.equal(response.headers.get("content-range"), "0-0/*");
  // SSR (replayFetch) widzi ten sam kształt wiersza
  const ssr = await (
    await fixtureResponse(new Request("http://127.0.0.1:4199/rest/v1/site_design_tokens"))
  ).json();
  assert.ok(ssr.every((row) => JSON.stringify(row.font_scale) === "{}"));
});

test("tabela spoza fixture = 404 PGRST205 (licznik unrecorded), nie wywrotka serwera", async () => {
  const { response, kind } = await handleClientBackendRequest(
    new Request("http://127.0.0.1:4199/rest/v1/nie_ma_takiej"),
  );
  assert.equal(kind, "unrecorded");
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, "PGRST205");
  const write = await handleClientBackendRequest(
    new Request("http://127.0.0.1:4199/rest/v1/posts", { method: "POST", body: "{}" }),
  );
  assert.equal(write.kind, "unrecorded");
});

function get(mod, url, headers = {}) {
  return new Promise((done, reject) => {
    const req = mod(url, { headers, rejectUnauthorized: false }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => done({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("serwer backendu mówi HTTP i HTTPS na jednym porcie i liczy żądania per przebieg", async () => {
  const port = await freePort();
  const backend = await startClientBackend({ port, delayMs: 0 });
  try {
    const before = backend.stats();
    const plain = await get(httpRequest, `http://127.0.0.1:${port}/rest/v1/menus?select=*`, {
      origin: "https://fixture.invalid",
    });
    const tls = await get(httpsRequest, `https://127.0.0.1:${port}/rest/v1/pages?select=*`);
    assert.equal(plain.status, 200);
    assert.equal(tls.status, 200);
    assert.ok(Array.isArray(JSON.parse(plain.body)));
    const run = diffClientBackendStats(before, backend.stats());
    assert.equal(run.requests, 2);
    assert.equal(run.ok, 2);
    assert.deepEqual(run.byPath, { "GET /rest/v1/menus": 1, "GET /rest/v1/pages": 1 });
    // zajęty port = jasny błąd, nie cichy pomiar bez backendu
    await assert.rejects(startClientBackend({ port }), /zajęty/);
  } finally {
    await backend.stop();
  }
});

// ── atrapa gtag ──────────────────────────────────────────────────────────────

test("atrapa gtag ma transfer produkcji, a czas zadań skaluje się benchmarkIndex", () => {
  const g = fakeGtagScript("G-EN05JH34VP", 2);
  const aw = fakeGtagScript("AW-17612160320", 2);
  const transfer = (src) => brotliCompressSync(Buffer.from(src)).length;
  for (const [src, prod] of [
    [g, PRODUCTION_GTAG_BYTES.g.transfer],
    [aw, PRODUCTION_GTAG_BYTES.aw.transfer],
  ])
    assert.ok(Math.abs(transfer(src) - prod) / prod < 0.03, `transfer ${transfer(src)} vs ${prod}`);
  // raw bez wypełniacza: tylko tyle bajtów do kompilacji, ile wymaga transfer
  assert.ok(g.length < PRODUCTION_GTAG_BYTES.g.raw * 0.6);
  // zadania 17,2 + 12,7 ms (G) i 45,7 ms (AW) na M3, x skala; pierwsze liczone
  // od responseEnd z odjęciem najwyżej 60 % celu (kompilacja jest częścią zadania)
  assert.match(g, /__t0-20\.6\):__t0;var __e=__b\+34\.4;/);
  assert.match(g, /var __e=__t0\+25\.4;/);
  assert.match(aw, /__t0-54\.8\):__t0;var __e=__b\+91\.4;/);
  // G dociąga AW tylko z `config AW-…` w warstwie danych (TP-2 to zmieni)
  assert.match(g, /indexOf\('AW-'\)===0/);
  // ładunek w komentarzu: parsowanie nie dokłada pętli (eksperyment fazy 1 dawał 2,2x)
  assert.doesNotThrow(() => new Function(g));
  assert.match(g, /\n\/\*[A-Za-z0-9+/]+\*\/\n$/);
});

test("skala atrapy = 3702,5 / benchmarkIndex hosta, przycięta do [0,25; 8]", () => {
  assert.ok(Math.abs(fakeGoogleScale(2085) - 3702.5 / 2085) < 1e-9);
  assert.equal(fakeGoogleScale(100), 8);
  assert.equal(fakeGoogleScale(1e6), 0.25);
  assert.equal(fakeGoogleScale(Number.NaN), 1);
  assert.equal(parseBenchmarkDump("<body>NES_BENCHMARK=2128.5</body>"), 2128.5);
  assert.ok(Number.isNaN(parseBenchmarkDump("<body></body>")));
  assert.match(BENCHMARK_PAGE, /computeBenchmarkIndex\(\)/);
});

// ── księga Lantern per zadanie (warstwa czysta) ─────────────────────────────

test("blokowanie zadania w oknie = max(0, część w oknie - 50 ms) jak calculateTbtImpactForEvent", () => {
  const task = { start: 1000, end: 1200, duration: 200 };
  assert.equal(blockingInWindow(task, 0, 5000), 150);
  assert.equal(blockingInWindow(task, 1100, 5000), 50);
  assert.equal(blockingInWindow(task, 1160, 5000), 0);
  assert.equal(blockingInWindow({ start: 0, end: 49, duration: 49 }, 0, 5000), 0);
  assert.equal(blockingInWindow(task, 3000, 2000), 0);
});

test("okna Lantern: optymistyczne [FCP_pes, TTI_opt], pesymistyczne [FCP_opt, TTI_pes]", () => {
  assert.deepEqual(
    lanternWindows(
      { optimistic: 1000, pessimistic: 1500 },
      { optimistic: 5000, pessimistic: 7000 },
    ),
    { optimistic: [1500, 5000], pessimistic: [1000, 7000] },
  );
});

test("księga: suma 0,5·opt + 0,5·pes; zadanie spoza grafu ma 0", () => {
  const tasks = [
    {
      id: "a",
      obsStart: 600,
      obsDur: 30,
      children: [{ name: "FunctionCall", ts: 0, dur: 30_000 }],
    },
    { id: "b", obsStart: 900, obsDur: 20, children: [{ name: "ParseHTML", ts: 0, dur: 20_000 }] },
  ];
  const opt = new Map([["a", { startTime: 2000, endTime: 2120, duration: 120 }]]);
  const pes = new Map([
    ["a", { startTime: 2500, endTime: 2620, duration: 120 }],
    ["b", { startTime: 2700, endTime: 2780, duration: 80 }],
  ]);
  const rows = ledgerRows(tasks, opt, pes, {
    optimistic: [1800, 2050],
    pessimistic: [1000, 9000],
  });
  assert.deepEqual(
    rows.map((r) => [r.id, r.opt, r.pes, r.blocking, r.cls]),
    [
      ["a", 0, 70, 35, "Script"],
      ["b", 0, 30, 15, "ParseHTML"],
    ],
  );
});

test("klasy zadań: ParseHTML/Timer/ScriptCatchup/kompozytor, chunk bez hasha, flaga Layout", () => {
  const url = "https://fixture.invalid/assets/vendor-react-AbCd1234.js";
  const script = classifyTask(
    [
      { name: "FunctionCall", ts: 0, dur: 30_000, args: { data: { url } } },
      { name: "Layout", ts: 30_000, dur: 5_000 },
    ],
    40_000,
  );
  assert.equal(script.label, "Script:vendor-react");
  assert.equal(script.layout, true);
  const timer = classifyTask(
    [
      { name: "TimerFire", ts: 0, dur: 20_000 },
      { name: "FunctionCall", ts: 0, dur: 19_000, args: { data: { url } } },
    ],
    20_000,
  );
  assert.equal(timer.cls, "Timer");
  assert.equal(classifyTask([{ name: "ParseHTML", ts: 0, dur: 9_000 }], 10_000).cls, "ParseHTML");
  assert.equal(
    classifyTask([{ name: "ScriptCatchup", ts: 0, dur: 1_000 }], 30_000).cls,
    "ScriptCatchup",
  );
  assert.equal(
    classifyTask([{ name: "UpdateLayer", ts: 0, dur: 1_000 }], 30_000).cls,
    "Layerize-UpdateLayer",
  );
  assert.equal(
    shortScriptName("https://www.googletagmanager.com/gtag/js?id=G-EN05JH34VP"),
    "googletagmanager.com/gtag/js?id=G-EN05JH34VP",
  );
  assert.equal(
    unionDuration([
      { name: "a", ts: 0, dur: 10 },
      { name: "b", ts: 5, dur: 10 },
      { name: "c", ts: 30, dur: 5 },
    ]),
    20,
  );
});

test("scriptBytesEndedBeforeObsLcp: tylko skrypty zakończone przed LCP, /~flock.js osobno", () => {
  const out = scriptBytesEndedBefore(
    [
      {
        url: "https://fixture.invalid/assets/index-A.js",
        resourceType: "Script",
        transferSize: 1000,
        networkEndTime: 900,
      },
      {
        url: "https://fixture.invalid/~flock.js",
        resourceType: "Script",
        transferSize: 300,
        networkEndTime: 800,
      },
      {
        url: "https://fixture.invalid/assets/late-B.js",
        resourceType: "Script",
        transferSize: 5000,
        networkEndTime: 1500,
      },
      {
        url: "https://fixture.invalid/a.css",
        resourceType: "Stylesheet",
        transferSize: 700,
        networkEndTime: 100,
      },
    ],
    1000,
    DEFAULT_EXCLUDE_SCRIPTS.map((s) => new RegExp(s)),
  );
  assert.deepEqual(out, {
    bytes: 1000,
    count: 1,
    excludedBytes: 300,
    excludedCount: 1,
    excludedUrls: ["/~flock.js"],
  });
});

test("--diff paruje zadania po klasie i starcie: zniknęło / krótsze / nowe", () => {
  const row = (id, label, obsStart, blocking, simDur = 100) => ({
    id,
    label,
    cls: label.split(":")[0],
    obsStart,
    obsDur: 20,
    simStart: 0,
    simDur,
    opt: blocking,
    pes: blocking,
    blocking,
    url: "",
    layout: false,
    mixins: [],
  });
  const a = [row("1", "Script:vendor-react", 680, 70), row("2", "Timer:index", 529, 44)];
  const b = [
    row("x", "Script:vendor-react", 700, 20),
    row("y", "Script:googletagmanager.com/gtag/js?id=G-X", 5000, 133),
  ];
  const diff = diffLedgers(a, b);
  const status = Object.fromEntries(diff.map((d) => [(d.a ?? d.b).label, d.status]));
  assert.deepEqual(status, {
    "Timer:index": "zniknęło",
    "Script:vendor-react": "krótsze",
    "Script:googletagmanager.com/gtag/js?id=G-X": "nowe",
  });
});
