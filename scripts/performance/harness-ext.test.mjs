// Testy rozszerzeń harnessu P0.1 (2026-10-04): ważność przebiegu (STALE/MISS,
// SSR w trakcie), ponowne rozgrzanie, powtórki `excluded`, pary A/A i MDE,
// kalibracja k, formy desktop4x/desktop5x, wstrzyknięcie do <head> bez
// buforowania, backend klienta PostgREST, atrapa gtag i księga Lantern per
// zadanie (warstwa czysta). Każda reguła ma kontrolę negatywną.
// P0.1-FIX: wariant dokumentu (B1, D7), tryb FCP (I1), bramka obciążenia (I2),
// wynik serii i rozgrzewka spoza cache (I3, D8), MDE z t(df) (I4), BYPASS (D1),
// sonda portu 4199 (D2), zapisy bez ścieżek maszyny (D3), synchronizacja
// pułapu świeżości (D4), LCP głównej ramki (D5), linia K bez flag (D6).
//
// Uruchomienie: node --test scripts/performance/harness-ext.test.mjs
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createPlainServer } from "node:http";
import { tmpdir } from "node:os";
import { brotliCompressSync } from "node:zlib";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DOCUMENT_FRESH_WINDOW_S,
  RewarmAbort,
  createHeadInjector,
  freePort,
  hostResolverFlag,
  logCursor,
  rewarmDocument,
  startArtifact,
  startFront,
} from "./artifactServer.ts";
import {
  POSTGREST_EXPOSE_HEADERS,
  diffClientBackendStats,
  handleClientBackendRequest,
  isPortListening,
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
  LCP_CANDIDATE,
  LCP_INVALIDATE,
  blockingInWindow,
  classifyTask,
  diffLedgers,
  fcpModeOf,
  formatFcpMode,
  lanternWindows,
  ledgerRows,
  lighthouseLabel,
  observedFcpTs,
  observedLcpTs,
  scriptBytesEndedBefore,
  seriesPairs,
  shortScriptName,
  unionDuration,
} from "./lanternTasks.ts";
import {
  CALIBRATION_FLAGS,
  FORMS,
  NO_FLAGS,
  PSI_REFERENCE_2026_10_03,
  calibrationK,
  classifyRun,
  compactServerTiming,
  comparabilityWarnings,
  defaultMaxLoad,
  documentFromDevtoolsLog,
  documentVariant,
  entryFreshS,
  flagsLabel,
  formatAaCheck,
  formatCalibration,
  formatCalibrationLine,
  formatModePairs,
  formatPairedStats,
  formatValidity,
  formatVariant,
  isFullFreshness,
  isServerRender,
  mdeMultiplier,
  observeDocument,
  pairedStats,
  pairsByFcpMode,
  parseForms,
  parsePsiReference,
  parseServerLogDocs,
  resolveMinValid,
  runWithRepeats,
  seriesOutcome,
  summarizeValidity,
  uncachedReason,
  validMetricsByFcpMode,
  validPairs,
  variantMismatch,
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

test("σΔ i MDE(t) = (t₀,₉₇₅ + t₀,₈)(df = n-1)·σΔ/√n; n = 5 daje mnożnik 3,72, nie 2,8 (I4)", () => {
  const deltas = [10, -10, 20, -20, 0];
  const pairs = deltas.map((d) => [metrics({ tbt: 300 }), metrics({ tbt: 300 + d })]);
  const [tbt] = pairedStats(pairs, ["tbt"]);
  const sd = Math.sqrt((100 + 100 + 400 + 400 + 0) / 4);
  assert.equal(tbt.n, 5);
  assert.equal(tbt.meanDelta, 0);
  assert.ok(Math.abs(tbt.sdDelta - sd) < 1e-9);
  assert.equal(tbt.tMultiplier.toFixed(2), "3.72");
  assert.ok(Math.abs(tbt.mde - (3.717 * sd) / Math.sqrt(5)) < 1e-9);
  // MDE(z) zostaje do porównania; kontrola negatywna: MDE(t) jest o 33 % większe
  assert.ok(Math.abs(tbt.mdeZ - (2.8 * sd) / Math.sqrt(5)) < 1e-9);
  assert.ok(tbt.mde / tbt.mdeZ > 1.3);
  // tablica: n = 3 -> 5,36 (recenzja), df > 30 -> 2,8, df < 1 -> NaN
  assert.equal(mdeMultiplier(2).toFixed(2), "5.36");
  assert.equal(mdeMultiplier(30).toFixed(3), "2.896");
  assert.equal(mdeMultiplier(31), 2.8);
  assert.ok(Number.isNaN(mdeMultiplier(0)));
  // jedna para nie daje odchylenia
  assert.ok(Number.isNaN(pairedStats(pairs.slice(0, 1), ["tbt"])[0].mde));
  const line = formatPairedStats("aa mobile", pairedStats(pairs, ["tbt"]));
  assert.match(line, /\(n=5, t\(df=4\)=3\.72\)/);
  assert.match(line, /MDE\(t\)=\d+ms MDE\(z\)=\d+ms/);
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

// ── P0.1-FIX: wariant dokumentu (B1, D7) ────────────────────────────────────

const FULL_CC = "public, max-age=60, s-maxage=900, stale-while-revalidate=86400";
const DEGRADED_CC = "public, max-age=0, s-maxage=30, stale-while-revalidate=300";
const hitDoc = (cacheControl, bytes, age = 5) =>
  observeDocument(
    "front",
    200,
    { "x-nes-cache": "HIT", "x-nes-cache-age": String(age), "cache-control": cacheControl },
    bytes,
  );

test("observeDocument: świeżość wpisu = min(s-maxage, 180 s), długość body z wołającego", () => {
  const full = hitDoc(FULL_CC, 391_040);
  assert.equal(full.freshS, 180);
  assert.equal(full.bytes, 391_040);
  assert.equal(full.cacheControl, FULL_CC);
  assert.equal(hitDoc(DEGRADED_CC, 1).freshS, 30);
  assert.equal(observeDocument("warm", 200, {}).freshS, null);
  assert.equal(observeDocument("warm", 200, {}).bytes, null);
  assert.equal(isFullFreshness(full), true);
  // kontrola negatywna: wpis ze zdegradowanym chrome'em nie jest wzorcem pełnego renderu
  assert.equal(isFullFreshness(hitDoc(DEGRADED_CC, 1)), false);
});

test("dwa HIT-y o różnym cache-control: inny wariant niż wzorzec = excluded, ten sam przechodzi (B1)", () => {
  const reference = documentVariant(hitDoc(FULL_CC, 391_040));
  const degraded = hitDoc(DEGRADED_CC, 391_231);
  const verdict = classifyRun({ document: degraded, serverDocs: [], referenceVariant: reference });
  assert.equal(verdict.excluded, true);
  assert.deepEqual(verdict.reasons, [
    "wariant dokumentu (s-maxage=30, 391231 B; wzorzec s-maxage=900, 391040 B)",
  ]);
  // kontrola negatywna: ten sam wariant (kolejność dyrektyw bez znaczenia) jest ważny
  const same = hitDoc("public, s-maxage=900, max-age=60, stale-while-revalidate=86400", 391_040);
  assert.equal(
    classifyRun({ document: same, serverDocs: [], referenceVariant: reference }).excluded,
    false,
  );
  // devtoolsLog nie zna bajtów, ale polityka wpisu też rozstrzyga
  const dev = observeDocument("devtools", 200, {
    "x-nes-cache": "HIT",
    "cache-control": DEGRADED_CC,
  });
  const viaDev = classifyRun({
    document: { ...same, cacheControl: null },
    serverDocs: [],
    devtools: dev,
    referenceVariant: reference,
  });
  assert.match(viaDev.reasons.join(" "), /devtoolsLog: wariant dokumentu \(s-maxage=30;/);
  // wariant per przebieg w podsumowaniu (summary.json, linia VALID)
  const summary = summarizeValidity([
    { n: 1, valid: true, variant: reference },
    { n: 2, valid: false, reasons: verdict.reasons, variant: documentVariant(degraded) },
    { n: 2, valid: true, variant: reference },
  ]);
  assert.deepEqual(summary.variants, { "s-maxage=900, 391040 B": 2 });
  assert.deepEqual(summary.reasons, { "wariant dokumentu": 1 });
  assert.match(formatValidity("aa A mobile", summary), /wariant: s-maxage=900, 391040 B x2/);
});

test("wariant bota (ta sama polityka, ~9 KB mniej) różni się od przeglądarkowego; drobne różnice nie (D7)", () => {
  const bot = documentVariant(hitDoc(FULL_CC, 382_468));
  const browser = documentVariant(hitDoc(FULL_CC, 391_114));
  assert.match(variantMismatch(bot, browser) ?? "", /391114 B; wzorzec s-maxage=900, 382468 B/);
  // kontrola negatywna: różnica w tolerancji (liczba w danych) nie zmienia wariantu
  assert.equal(variantMismatch(bot, { ...bot, bytes: 382_468 + 20 }), null);
  // nieznana długość (strumień bez końca) nie rozstrzyga, polityka tak
  assert.equal(variantMismatch(bot, { cacheControl: FULL_CC, bytes: null }), null);
  assert.equal(
    formatVariant({ cacheControl: "private, no-store", bytes: null }),
    "private, no-store",
  );
});

/** Atrapa dokumentu dla rozgrzewki: kolejka odpowiedzi z polityką i długością body. */
function scriptedDocs(initial) {
  let queue = [...initial];
  const calls = [];
  return {
    calls,
    replace(next) {
      queue = [...next];
    },
    fetchDocument: async (origin, path, lang, ua) => {
      calls.push({ origin, path, lang, ua });
      const next = queue.length > 1 ? queue.shift() : queue[0];
      const headers = new Headers();
      if (next.cache) headers.set("x-nes-cache", next.cache);
      if (next.age !== undefined) headers.set("x-nes-cache-age", String(next.age));
      if (next.cc) headers.set("cache-control", next.cc);
      return { status: next.status ?? 200, headers, body: new Uint8Array(next.bytes ?? 0) };
    },
  };
}

test("rozgrzewka: wpis s-maxage=30 w wieku 23 s czeka na STALE, nie oddaje sterowania (B1)", async () => {
  const slept = [];
  const fake = scriptedDocs([
    { cache: "HIT", age: 23, cc: DEGRADED_CC, bytes: 391_231 },
    { cache: "STALE", age: 31, cc: DEGRADED_CC, bytes: 391_231 },
    { cache: "HIT", age: 0, cc: DEGRADED_CC, bytes: 391_231 },
  ]);
  const result = await rewarmDocument("http://up", "/", {
    minFreshS: 30,
    fetchDocument: fake.fetchDocument,
    sleep: async (ms) => void slept.push(ms),
  });
  // zapas liczony od świeżości TEGO wpisu (30 s), nie od 180 s: 30 - 23 + 0,5
  assert.equal(slept[0], 7_500);
  assert.equal(result.waitedForStaleS, 7.5);
  assert.equal(result.attempts.length, 3);
  assert.equal(result.ok, true);
  assert.equal(result.final.ageS, 0);
  // kontrola negatywna: pełny wpis w tym samym wieku oddaje sterowanie od razu
  const full = await rewarmDocument("http://up", "/", {
    fetchDocument: scriptedDocs([{ cache: "HIT", age: 23, cc: FULL_CC }]).fetchDocument,
    sleep: async () => assert.fail("nie powinno czekać"),
  });
  assert.equal(full.ok, true);
});

test("rozgrzewka z wzorcem: inny wariant albo brak zapasu -> restart serwera i HIT wzorca (B1)", async () => {
  const reference = { cacheControl: FULL_CC, bytes: 390_950 };
  const degraded = { cache: "HIT", age: 0, cc: DEGRADED_CC, bytes: 391_141 };
  const fullFresh = { cache: "HIT", age: 1, cc: FULL_CC, bytes: 390_950 };
  for (const before of [
    degraded,
    { ...fullFresh, age: 160 },
    { ...fullFresh, cache: "STALE", age: 181 },
  ]) {
    const fake = scriptedDocs([before]);
    let restores = 0;
    const result = await rewarmDocument("http://up", "/", {
      referenceVariant: reference,
      fetchDocument: fake.fetchDocument,
      sleep: async () => assert.fail("z restore nie czekamy na STALE"),
      restore: async () => {
        restores += 1;
        fake.replace([fullFresh]);
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.restores, 1);
    assert.equal(restores, 1);
    assert.equal(formatVariant(documentVariant(result.final)), "s-maxage=900, 390950 B");
  }
  // kontrola negatywna: restart, który nie przywraca wzorca, kończy się ok=false z powodem
  const stubborn = await rewarmDocument("http://up", "/", {
    referenceVariant: reference,
    fetchDocument: scriptedDocs([degraded]).fetchDocument,
    restore: async () => undefined,
  });
  assert.equal(stubborn.ok, false);
  assert.equal(stubborn.restores, 2);
  assert.match(stubborn.failure ?? "", /wariant dokumentu \(s-maxage=30, 391141 B/);
  assert.equal(
    classifyRun({ document: null, serverDocs: [], rewarmOk: stubborn.ok }).reasons.at(-1),
    "rozgrzewka bez świeżego HIT wariantu wzorcowego",
  );
});

test("restart serwera artefaktu: nowy proces na tym samym porcie, log dopisywany (kursory zostają ważne)", async () => {
  const root = mkdtempSync(join(tmpdir(), "nes-restart-"));
  mkdirSync(join(root, ".output/server"), { recursive: true });
  writeFileSync(
    join(root, ".output/server/index.mjs"),
    [
      'import { createServer } from "node:http";',
      'createServer((req, res) => res.end(String(process.pid))).listen(Number(process.env.PORT), "127.0.0.1",',
      "  () => console.log(`start ${process.pid}`));",
    ].join("\n"),
  );
  const logFile = join(root, "server.log");
  const artifact = await startArtifact({ root, port: await freePort(), fixture: false, logFile });
  try {
    const pid = async () => (await fetch(`${artifact.origin}/x`)).text();
    const first = await pid();
    const cursor = logCursor(logFile);
    const mark = cursor.mark();
    await artifact.restart();
    const second = await pid();
    assert.notEqual(first, second);
    assert.equal(String(artifact.child.pid), second);
    assert.equal(cursor.since(mark).trim(), `start ${second}`);
    assert.match(readFileSync(logFile, "utf8"), new RegExp(`start ${first}\\nstart ${second}`));
  } finally {
    await artifact.stop();
  }
});

test("front liczy bajty dokumentu z upstreamu (przed kompresją i wstrzyknięciem) i czyta politykę wpisu", async () => {
  const html = `<!doctype html><html><head><title>x</title></head><body>${"a".repeat(5000)}</body></html>`;
  const upstream = createPlainServer((req, res) => {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "x-nes-cache": "HIT",
      "x-nes-cache-age": "4",
      "cache-control": DEGRADED_CC,
    });
    res.end(html);
  });
  const upstreamPort = await freePort();
  await new Promise((done) => upstream.listen(upstreamPort, "127.0.0.1", done));
  const front = await startFront({
    transport: "h1",
    upstreamPort,
    listenPort: await freePort(),
    injectHead: GA_ANY_HOST_SNIPPET,
  });
  try {
    const res = await get(httpRequest, `${front.baseUrl}/`, { "accept-encoding": "br" });
    assert.equal(res.headers["content-encoding"], "br");
    const [doc] = front.documents();
    assert.equal(doc.bytes, Buffer.byteLength(html));
    assert.equal(doc.freshS, 30);
    assert.equal(doc.cacheControl, DEGRADED_CC);
  } finally {
    await front.stop();
    await new Promise((done) => upstream.close(done));
  }
});

// ── P0.1-FIX: tryb FCP (I1) ──────────────────────────────────────────────────

test("tryb FCP z udziału bajtów grafu FCP: 118 KB i 506 KB to różne tryby (I1)", () => {
  const startup = 520 * 1024;
  const partial = fcpModeOf(17, 118.1 * 1024, startup);
  const full = fcpModeOf(25, 506.2 * 1024, startup);
  assert.equal(partial.mode, "częściowy");
  assert.equal(full.mode, "pełny");
  // kontrola negatywna: dawny próg „> 50 KB = js" oznaczał oba tak samo
  const oldMode = (bytes) => (bytes > 50 * 1024 ? "js" : "bez-js");
  assert.equal(oldMode(118.1 * 1024), oldMode(506.2 * 1024));
  assert.notEqual(partial.mode, full.mode);
  assert.equal(fcpModeOf(20, 0.7 * startup, startup).mode, "pośredni");
  assert.equal(fcpModeOf(0, 0, startup).mode, "bez-js");
  assert.equal(fcpModeOf(3, 1000, 0).mode, "?");
  assert.equal(formatFcpMode(full), "pełny (25 skr. / 506,2 KB = 97 % z 520,0 KB)");
});

test("pary i AA warstwowane po trybie FCP, pary mieszane liczone osobno (I1)", () => {
  const rec = (n, fcpMode, fcp) => ({ n, valid: true, fcpMode, metrics: metrics({ fcp }) });
  const a = [
    rec(1, "pełny", 4200),
    rec(2, "pełny", 4210),
    rec(3, "częściowy", 2150),
    rec(4, "pełny", 4190),
    rec(5, null, 4200),
  ];
  const b = [
    rec(1, "pełny", 4205),
    rec(2, "częściowy", 2140),
    rec(3, "częściowy", 2160),
    rec(4, "pełny", 4200),
    rec(5, "pełny", 4210),
  ];
  const split = pairsByFcpMode(a, b);
  assert.equal(split.total, 5);
  assert.equal(split.mixed, 1);
  assert.equal(split.unknown, 1);
  assert.equal(split.byMode.get("pełny").length, 2);
  assert.equal(split.byMode.get("częściowy").length, 1);
  assert.equal(
    formatModePairs("aa mobile", split),
    "PAIRS aa mobile tryb FCP: pełny 2, częściowy 1; pary mieszane 1/5; bez trybu 1/5",
  );
  // kontrola negatywna: para mieszana rozwala σΔ wszystkich par, warstwa jej nie widzi
  const [allFcp] = pairedStats(validPairs(a, b), ["fcp"]);
  const [fullFcp] = pairedStats(split.byMode.get("pełny"), ["fcp"]);
  assert.ok(allFcp.sdDelta > 900);
  assert.ok(fullFcp.sdDelta < 20);
  assert.deepEqual([...validMetricsByFcpMode(a).keys()], ["pełny", "częściowy"]);
  assert.match(
    formatAaCheck(
      "mobile",
      metrics({ fcp: 4200 }),
      metrics({ fcp: 2900 }),
      "A pełny x3 | B częściowy x2",
    ),
    /PONAD PRÓG 0,02 s \(tryby FCP: A pełny x3 \| B częściowy x2\)/,
  );
  assert.match(
    formatAaCheck("mobile", metrics({}), metrics({ fcp: 2900 })),
    /tryb FCP nieznany - uruchom z --save-artifacts/,
  );
});

// ── P0.1-FIX: obciążenie (I2), BYPASS (D1) ──────────────────────────────────

test("przebieg przy loadavg powyżej --max-load jest excluded; domyślny próg 0,6 x CPU (I2)", () => {
  const hit = observeDocument("front", 200, { "x-nes-cache": "HIT" });
  const loaded = classifyRun({ document: hit, serverDocs: [], load: 5.2, maxLoad: 2.5 });
  assert.equal(loaded.excluded, true);
  assert.deepEqual(loaded.reasons, ["obciążenie (5,2 > 2,5)"]);
  assert.deepEqual(summarizeValidity([{ n: 1, valid: false, reasons: loaded.reasons }]).reasons, {
    obciążenie: 1,
  });
  // kontrola negatywna: load poniżej progu i brak progu nie wykluczają
  assert.equal(
    classifyRun({ document: hit, serverDocs: [], load: 2.0, maxLoad: 2.5 }).excluded,
    false,
  );
  assert.equal(classifyRun({ document: hit, serverDocs: [], load: 39 }).excluded, false);
  assert.equal(defaultMaxLoad(4), 2.4);
  assert.equal(defaultMaxLoad(16), 9.6);
});

test("BYPASS w logu serwera to render SSR i wyklucza przebieg (D1)", () => {
  const [bypass, stale, hit] = parseServerLogDocs(
    [docLine({ cache: "BYPASS" }), docLine({ cache: "STALE" }), docLine({ cache: "HIT" })].join(
      "\n",
    ),
  );
  assert.equal(isServerRender(bypass), true);
  assert.equal(isServerRender(stale), false);
  assert.equal(isServerRender(hit), false);
  const doc = observeDocument("front", 200, { "x-nes-cache": "HIT" });
  assert.match(
    classifyRun({ document: doc, serverDocs: [bypass] }).reasons.join(" "),
    /SSR w trakcie przebiegu: 1x \(BYPASS\)/,
  );
});

// ── P0.1-FIX: wynik serii, ścieżki spoza cache (I3, D8) ──────────────────────

test("zero ważnych przebiegów: kod 1 i odmowa zapisu baseline'u (I3, D8)", () => {
  const zero = seriesOutcome([{ tag: "", form: "mobile", validity: { nValid: 0, rounds: 3 } }], {
    minValid: 3,
    baselineTag: "",
  });
  assert.equal(zero.exitCode, 1);
  assert.deepEqual(zero.failures, ["FAIL mobile: n_valid=0/3 < --min-valid 3"]);
  assert.deepEqual(zero.baselineForms, []);
  assert.deepEqual(zero.refusedBaselineForms, ["mobile"]);
  // jedna forma poniżej progu: kod 1, baseline tylko z formy, która przeszła
  const mixed = seriesOutcome(
    [
      { tag: "", form: "mobile", validity: { nValid: 5, rounds: 5 } },
      { tag: "", form: "desktop4x", validity: { nValid: 2, rounds: 5 } },
    ],
    { minValid: 5, baselineTag: "" },
  );
  assert.equal(mixed.exitCode, 1);
  assert.deepEqual(mixed.baselineForms, ["mobile"]);
  assert.deepEqual(mixed.refusedBaselineForms, ["desktop4x"]);
  // A/B: porażka strony B to kod 1, baseline (strona A) zostaje
  const ab = seriesOutcome(
    [
      { tag: "A", form: "mobile", validity: { nValid: 5, rounds: 5 } },
      { tag: "B", form: "mobile", validity: { nValid: 4, rounds: 5 } },
    ],
    { minValid: 5, baselineTag: "A" },
  );
  assert.deepEqual([ab.exitCode, ab.baselineForms, ab.failures.length], [1, ["mobile"], 1]);
  // kontrola negatywna: komplet ważnych = kod 0
  assert.equal(
    seriesOutcome([{ tag: "", form: "mobile", validity: { nValid: 3, rounds: 3 } }], {
      minValid: 3,
      baselineTag: "",
    }).exitCode,
    0,
  );
});

test("--min-valid: domyślnie runs, nie mniej niż min(3, runs), więcej niż runs = błąd (I3)", () => {
  assert.equal(resolveMinValid(undefined, 5), 5);
  assert.equal(resolveMinValid(1, 5), 3);
  assert.equal(resolveMinValid(4, 5), 4);
  assert.equal(resolveMinValid(undefined, 1), 1);
  assert.equal(resolveMinValid(Number.NaN, 2), 2);
  assert.throws(() => resolveMinValid(6, 5), /nieosiągalny/);
});

test("rozgrzewka: dwie odpowiedzi spoza cache przerywają serię, --allow-uncached mierzy (I3)", async () => {
  assert.equal(uncachedReason({ status: 302, cache: null }), "status 302");
  assert.equal(uncachedReason({ status: 200, cache: null }), "brak x-nes-cache");
  assert.equal(uncachedReason({ status: 200, cache: "BYPASS" }), "BYPASS");
  assert.equal(uncachedReason({ status: 200, cache: "MISS" }), null);
  for (const response of [{ status: 302 }, { cache: "BYPASS" }, { status: 500 }]) {
    const fake = scriptedDocs([response]);
    await assert.rejects(
      rewarmDocument("http://up", "/en-redirect", {
        fetchDocument: fake.fetchDocument,
        sleep: async () => undefined,
      }),
      (error) =>
        error instanceof RewarmAbort && /2 odpowiedzi dokumentu spoza cache/.test(error.message),
    );
    assert.equal(fake.calls.length, 2);
  }
  const uncached = await rewarmDocument("http://up", "/", {
    allowUncached: true,
    fetchDocument: scriptedDocs([{ status: 302 }]).fetchDocument,
    sleep: async () => assert.fail("bez czekania"),
  });
  assert.deepEqual([uncached.ok, uncached.uncached, uncached.attempts.length], [true, true, 1]);
  // kontrola negatywna: jedna odpowiedź spoza cache (np. chwilowy błąd) nie przerywa
  const blip = await rewarmDocument("http://up", "/", {
    fetchDocument: scriptedDocs([{ status: 503 }, { cache: "HIT", age: 0, cc: FULL_CC }])
      .fetchDocument,
    sleep: async () => undefined,
  });
  assert.equal(blip.ok, true);
});

test("--allow-uncached: render samego dokumentu LH jest dozwolony, każdy inny wyklucza (I3)", () => {
  const miss = observeDocument("front", 200, { "x-nes-cache": "BYPASS" });
  const own = parseServerLogDocs(docLine({ cache: "BYPASS" }));
  const input = { document: miss, serverDocs: own, allowUncached: true, runDocuments: [miss] };
  assert.deepEqual(classifyRun(input), { excluded: false, reasons: [] });
  // kontrola negatywna: drugi render albo rewalidacja w tle nadal wykluczają
  const extra = parseServerLogDocs(
    [docLine({ cache: "BYPASS" }), docLine({ cache: "MISS", revalidation: true })].join("\n"),
  );
  assert.match(
    classifyRun({ ...input, serverDocs: extra }).reasons.join(" "),
    /SSR w trakcie przebiegu: 1x \(rewalidacja\)/,
  );
  // bez flagi ten sam przebieg jest excluded (dokument BYPASS + render)
  assert.equal(classifyRun({ document: miss, serverDocs: own }).reasons.length, 2);
});

// ── P0.1-FIX: drobne (D2-D6) ─────────────────────────────────────────────────

test("sonda portu backendu klienta: słuchający port = true, wolny = false (D2)", async () => {
  const port = await freePort();
  assert.equal(await isPortListening(port), false);
  const server = createPlainServer((req, res) => res.end());
  await new Promise((done) => server.listen(port, "127.0.0.1", done));
  try {
    assert.equal(await isPortListening(port), true);
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test("zapisy bez ścieżek maszyny: wersja Lighthouse'a z package.json, artefakty względem wyników (D3)", () => {
  const dir = mkdtempSync(join(tmpdir(), "nes-lh-"));
  mkdirSync(join(dir, "lighthouse/cli"), { recursive: true });
  writeFileSync(
    join(dir, "lighthouse/package.json"),
    JSON.stringify({ name: "lighthouse", version: "13.5.0" }),
  );
  const label = lighthouseLabel(join(dir, "lighthouse/cli/index.js"));
  assert.equal(label, "lighthouse 13.5.0");
  assert.ok(!label.includes(dir));
  assert.equal(lighthouseLabel(undefined), "npx lighthouse@13");
  assert.ok(!lighthouseLabel(join(dir, "brak/cli/index.js")).includes(dir));
  // summary.json z artefaktami względnymi (nowy zapis) i bezwzględnymi (stary)
  const results = join(dir, "wyniki");
  mkdirSync(results);
  writeFileSync(
    join(results, "summary.json"),
    JSON.stringify({
      forms: {
        "A:mobile": {
          records: [
            { n: 1, valid: true, artifacts: "A-mobile-1.artifacts" },
            { n: 2, valid: true, artifacts: "/stary/A-mobile-2.artifacts" },
          ],
        },
        "B:mobile": {
          records: [
            { n: 1, valid: true, artifacts: "B-mobile-1.artifacts" },
            { n: 2, valid: true, artifacts: "/stary/B-mobile-2.artifacts" },
          ],
        },
      },
    }),
  );
  assert.deepEqual(seriesPairs(results, "mobile"), [
    [join(results, "A-mobile-1.artifacts"), join(results, "B-mobile-1.artifacts")],
    ["/stary/A-mobile-2.artifacts", "/stary/B-mobile-2.artifacts"],
  ]);
});

test("pułap świeżości harnessu = DOCUMENT_CACHE_MAX_FRESH_MS z src/lib/http/documentCache.ts (D4)", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../src/lib/http/documentCache.ts", import.meta.url)),
    "utf8",
  );
  const match = /export const DOCUMENT_CACHE_MAX_FRESH_MS = ([\d_]+);/.exec(source);
  assert.ok(match, "brak DOCUMENT_CACHE_MAX_FRESH_MS w documentCache.ts");
  assert.equal(Number(match[1].replaceAll("_", "")) / 1000, DOCUMENT_FRESH_WINDOW_S);
  // stała jest wyłącznie górnym limitem: krótszy s-maxage wygrywa
  assert.equal(entryFreshS("public, s-maxage=900"), DOCUMENT_FRESH_WINDOW_S);
  assert.equal(entryFreshS("public, s-maxage=30"), 30);
});

test("obserwowane LCP/FCP: główna ramka nawigacji, ts ≥ t0, Invalidate kasuje LCP (D5)", () => {
  const ev = (name, ts, frame) => ({ name, ts, args: { frame } });
  const events = [
    ev(LCP_CANDIDATE, 900, "F"), // przed nawigacją
    ev("firstContentfulPaint", 1500, "G"), // ramka podrzędna
    ev("firstContentfulPaint", 2000, "F"),
    ev(LCP_CANDIDATE, 3000, "F"),
    ev(LCP_CANDIDATE, 4000, "F"),
    ev(LCP_CANDIDATE, 5000, "G"), // iframe po LCP strony
  ];
  assert.equal(observedLcpTs(events, 1000, "F"), 4000);
  assert.equal(observedFcpTs(events, 1000, "F"), 2000);
  // kontrola negatywna: dawne „ostatnie Candidate w całym śladzie" brało iframe
  const old = events.filter((e) => e.name === LCP_CANDIDATE).at(-1).ts;
  assert.equal(old, 5000);
  // Invalidate po ostatnim kandydacie = brak LCP; nowy kandydat po nim znów jest LCP
  assert.equal(observedLcpTs([...events, ev(LCP_INVALIDATE, 4500, "F")], 1000, "F"), undefined);
  assert.equal(
    observedLcpTs(
      [...events, ev(LCP_INVALIDATE, 4500, "F"), ev(LCP_CANDIDATE, 4600, "F")],
      1000,
      "F",
    ),
    4600,
  );
  // ślad bez ramek: tylko filtr czasu
  assert.equal(
    observedLcpTs([ev(LCP_CANDIDATE, 500), ev(LCP_CANDIDATE, 1200)], 1000, undefined),
    1200,
  );
});

test("linia K bez pełnych flag: dopisek „nie kalibruje” i bez wskazówki przeliczenia (D6)", () => {
  const median = metrics({ tbt: 800 });
  const none = formatCalibrationLine("mobile", median, PSI_REFERENCE_2026_10_03, NO_FLAGS);
  assert.match(none, /\{client-backend=none,third-party=none\} \(bez flag, nie kalibruje\)$/);
  assert.doesNotMatch(none, /przelicz/);
  const partial = formatCalibrationLine(
    "mobile",
    median,
    PSI_REFERENCE_2026_10_03,
    flagsLabel("fixture", "none"),
  );
  assert.match(partial, /\(niepełne flagi, nie kalibruje\)$/);
  // kontrola negatywna: z pełnymi flagami k kalibruje i |k-1| > 0,2 każe przeliczyć cele
  const flagged = formatCalibrationLine(
    "mobile",
    median,
    PSI_REFERENCE_2026_10_03,
    CALIBRATION_FLAGS,
  );
  assert.equal(
    flagged,
    `${formatCalibration("mobile", median, PSI_REFERENCE_2026_10_03)} {${CALIBRATION_FLAGS}}`,
  );
  assert.match(flagged, /przelicz cele fixture/);
});
