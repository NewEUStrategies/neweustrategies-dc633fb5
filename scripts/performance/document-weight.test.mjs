// Testy warstw czystych harnessu pomiarowego (2026-10-03): documentWeight.ts
// i lighthouseReport.ts. Każda bramka ma KONTROLĘ NEGATYWNĄ - dowód, że oblewa
// na zepsutym wejściu, a nie tylko przechodzi na dzisiejszym.
//
// Uruchomienie: node --test scripts/performance/document-weight.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SERVER_ONLY_CLIENT_MODULES,
  analyzeDocument,
  checkBudgets,
  imageResourceKey,
  inventoryMatchesBuild,
  medianWeights,
  parseLinkHeader,
  ratchetBudgets,
  serverOnlyModulesInClient,
  staticClosure,
} from "./documentWeight.ts";
import { aggregate, deltaLine, extractMetrics, median } from "./lighthouseReport.ts";

const SRCSET = "https://x.test/a.webp?w=480 480w, https://x.test/a.webp?w=768 768w";

const HTML = `<!doctype html><html><head>
<link rel="stylesheet" href="/assets/styles-A.css"/>
<link rel="modulepreload" href="/assets/index-E.js"/>
<link rel="modulepreload" href="/assets/widget-W.js"/>
<link rel="preload" as="image" imageSrcSet="${SRCSET}" imageSizes="100vw" fetchPriority="high"/>
<link rel="preload" as="image" imageSrcSet="${SRCSET}" imageSizes="50vw"/>
<style>.a{color:red}</style><style data-w-id="x">.b{}</style>
<script type="application/ld+json">{"@type":"Thing"}</script>
<script>window.x=1</script>
</head><body><div><img src="a.webp" fetchpriority="high"><img loading="lazy" src="b.webp"><svg></svg></div>
<script class="$tsr" id="$tsr-stream-barrier">STATE_STATE</script>
<script type="module" async src="/assets/index-E.js"></script>
</body></html>`;

const LINK =
  `</assets/styles-A.css>; rel="preload"; as="style", ` +
  `</assets/index-E.js>; rel="modulepreload", ` +
  `<https://x.test/a.webp>; rel="preload"; as="image"; imagesrcset="${SRCSET}"; imagesizes="100vw"`;

function assets() {
  const dir = mkdtempSync(join(tmpdir(), "nes-dw-"));
  writeFileSync(
    join(dir, "index-E.js"),
    'import"./vendor-V.js";const l=()=>import("./lazy-L.js");',
  );
  writeFileSync(join(dir, "vendor-V.js"), "export const v=1;".repeat(50));
  writeFileSync(join(dir, "lazy-L.js"), "export const l=1;".repeat(500));
  writeFileSync(join(dir, "widget-W.js"), "export const w=1;".repeat(20));
  writeFileSync(join(dir, "styles-A.css"), ".a{color:red}".repeat(100));
  return dir;
}

test("Link: przecinki w imagesrcset (w cudzysłowie) nie rozcinają wpisu", () => {
  const entries = parseLinkHeader(LINK);
  assert.equal(entries.length, 3);
  assert.equal(entries[2].imagesrcset, SRCSET);
  assert.equal(entries[1].rel, "modulepreload");
});

test("analiza dokumentu: inline, stan, preloady, duplikaty, obrazy", () => {
  const w = analyzeDocument({ html: HTML, linkHeader: LINK, assetsDir: assets() });
  assert.equal(w.inlineStyleCount, 2);
  assert.equal(w.inlineStyleBytes, ".a{color:red}".length + ".b{}".length);
  assert.equal(w.dehydratedStateBytes, "STATE_STATE".length);
  // JSON-LD jest inline, ale nie jest wykonywalny.
  assert.equal(w.inlineExecutableScriptBytes, "window.x=1".length + "STATE_STATE".length);
  assert.equal(w.modulepreloadCount, 2);
  // obraz LCP: 2x w head + 1x w Link = 2 duplikaty; index-E: head + Link = 1.
  assert.equal(w.preloadDuplicates, 3);
  assert.equal(w.documentPreloadDuplicates, 1);
  assert.equal(w.imgFetchpriorityHigh, 1);
  assert.equal(w.imgLazy, 1);
  assert.equal(w.inlineSvgCount, 1);
  // Domknięcie bootu: statyczny import vendor-V tak, dynamiczny lazy-L NIE.
  assert.deepEqual(w.bootClosure?.files.map((f) => f.name).sort(), ["index-E.js", "vendor-V.js"]);
  // Pula JS przy starcie = boot ∪ modulepreload (widget-W spoza bootu).
  assert.equal(w.preloadedJsCount, 3);
  assert.deepEqual(
    w.preloadOutsideBoot.map((f) => f.name),
    ["widget-W.js"],
  );
  assert.equal(w.renderBlockingCssCount, 1);
});

test("domknięcie statyczne: brakujący plik jest raportowany, nie połykany", () => {
  const dir = assets();
  const c = staticClosure(dir, ["index-E.js", "nie-ma-mnie.js"]);
  assert.deepEqual(c.missing, ["nie-ma-mnie.js"]);
});

test("bramka: KONTROLA NEGATYWNA - pomiar ponad progiem oblewa, równy przechodzi", () => {
  const w = analyzeDocument({ html: HTML, linkHeader: LINK });
  const atLimit = checkBudgets(w, { htmlRawBytes: { max: w.htmlRawBytes } });
  assert.equal(atLimit[0].ok, true);
  const over = checkBudgets(w, { htmlRawBytes: { max: w.htmlRawBytes - 1 } });
  assert.equal(over[0].ok, false);
  const regressed = analyzeDocument({
    html: HTML.replace("</head>", "<style>.c{}</style></head>"),
  });
  const result = checkBudgets(regressed, { inlineStyleCount: { max: w.inlineStyleCount } });
  assert.equal(result[0].ok, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// ŚCIEŻKA KRYTYCZNA OBRAZU LCP (P1.4: LP-10 + LA-C3). Progi z PRAWDZIWEGO pliku
// repo - kontrola negatywna ma oblać na regule, która naprawdę bramkuje CI.
// ─────────────────────────────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_BUDGETS = JSON.parse(
  readFileSync(join(HERE, "document-weight-budgets.json"), "utf8"),
).budgets;

/** Wynik bramki repo dla jednej metryki. */
function gate(weight, metric) {
  const [result] = checkBudgets(weight, { [metric]: REPO_BUDGETS[metric] });
  assert.ok(result, `brak progu ${metric} w document-weight-budgets.json`);
  return result;
}

const LCP_SRCSET = "https://x.test/hero.webp?w=480 480w, https://x.test/hero.webp?w=768 768w";

/** Dokument po P1.4: jeden kandydat, jego preload z react-dom, logo eager w nagłówku. */
function lcpHtml({ preloadSizes = "50vw", extraBody = "", extraHead = "" } = {}) {
  return `<!doctype html><html><head>
<link rel="preload" as="image" href="/logo.svg"/>
<link rel="preload" as="image" imageSrcSet="${LCP_SRCSET}" imageSizes="${preloadSizes}" fetchPriority="high"/>
<link rel="stylesheet" href="/assets/styles-A.css"/>
<link rel="preload" as="font" href="/assets/font-F.woff2" crossorigin=""/>
${extraHead}</head><body>
<header data-site-header="true"><img src="/logo.svg" alt="Logo" loading="eager" decoding="async"/></header>
<main><img src="https://x.test/hero.webp" srcSet="${LCP_SRCSET}" sizes="50vw" loading="eager" fetchPriority="high" data-lcp-candidate=""/>
<img src="https://x.test/b.webp" loading="lazy" fetchPriority="auto"/>${extraBody}</main>
<script type="module" async src="/assets/index-E.js"></script>
</body></html>`;
}

const LCP_LINK =
  `<https://x.test/hero.webp>; rel="preload"; as="image"; fetchpriority=high; ` +
  `imagesrcset="${LCP_SRCSET}"; imagesizes="50vw", ` +
  `</assets/styles-A.css>; rel="preload"; as="style", ` +
  `</assets/font-F.woff2>; rel="preload"; as="font"; type="font/woff2"; crossorigin, ` +
  `</assets/index-E.js>; rel=modulepreload; as=script, ` +
  `<https://api.x.test>; rel="preconnect"; crossorigin="anonymous"`;

test("ścieżka LCP: KONTROLA NEGATYWNA - 7 obrazów fetchpriority=high oblewa bramkę repo", () => {
  // Stan sprzed P1.4 w miniaturze: każdy widget trzech czołowych sekcji
  // i każdy slider maluje pierwszy obraz eager + high, bez kandydata.
  const imgs = Array.from(
    { length: 7 },
    (_, i) => `<img src="https://x.test/c${i}.webp" loading="eager" fetchPriority="high"/>`,
  ).join("");
  const w = analyzeDocument({ html: `<html><head></head><body>${imgs}</body></html>` });
  assert.equal(w.imgFetchpriorityHigh, 7);
  assert.equal(gate(w, "imgFetchpriorityHigh").ok, false);
  assert.equal(w.imgEagerNonCandidate, 7);
  assert.equal(gate(w, "imgEagerNonCandidate").ok, false);
  assert.equal(w.lcpCandidateMissing, 1);
  assert.equal(gate(w, "lcpCandidateMissing").ok, false);
  // Kontrola pozytywna na tej samej regule: dwa obrazy High to jeszcze norma planu.
  const two = analyzeDocument({
    html: `<html><body>${imgs.split("/>").slice(0, 2).join("/>")}/></body></html>`,
  });
  assert.equal(two.imgFetchpriorityHigh, 2);
  assert.equal(gate(two, "imgFetchpriorityHigh").ok, true);
});

test("ścieżka LCP: kandydat + preload o TYM SAMYM imagesrcset/imagesizes + Link z listy = zielono", () => {
  const w = analyzeDocument({ html: lcpHtml(), linkHeader: LCP_LINK });
  assert.equal(w.lcpCandidateCount, 1);
  assert.equal(w.lcpCandidateMissing, 0);
  assert.equal(w.imgFetchpriorityHigh, 1);
  // Logo w nagłówku powłoki jest eager z definicji (wyjątek bramki), lazy się nie liczy.
  assert.equal(w.imgEagerNonCandidate, 0);
  assert.equal(w.imagePreloadNonCandidate, 0);
  assert.equal(w.linkHeaderDisallowed, 0);
  for (const metric of [
    "imgFetchpriorityHigh",
    "lcpCandidateCount",
    "lcpCandidateMissing",
    "imgEagerNonCandidate",
    "imagePreloadNonCandidate",
    "linkHeaderDisallowed",
  ]) {
    assert.equal(gate(w, metric).ok, true, metric);
  }
});

test("ścieżka LCP: KONTROLA NEGATYWNA - preload innego wariantu niż <img> kandydata", () => {
  // Ten sam srcset, inne `imagesizes`: przeglądarka preloaduje inny wariant
  // niż maluje (podwójny transfer obrazu LCP - EVIDENCE §6, werdykt LP-2).
  const w = analyzeDocument({ html: lcpHtml({ preloadSizes: "25vw" }), linkHeader: LCP_LINK });
  assert.equal(w.imagePreloadNonCandidate, 1);
  assert.equal(gate(w, "imagePreloadNonCandidate").ok, false);
});

test("ścieżka LCP: KONTROLA NEGATYWNA - obraz eager poza kandydatem i poza nagłówkiem", () => {
  // Bez atrybutu `loading` obraz jest eager - też się liczy.
  const w = analyzeDocument({
    html: lcpHtml({ extraBody: '<img src="https://x.test/karta.webp"/>' }),
    linkHeader: LCP_LINK,
  });
  assert.equal(w.imgEagerNonCandidate, 1);
  assert.equal(gate(w, "imgEagerNonCandidate").ok, false);
});

test("ścieżka LCP: wyjątek logo TYLKO w nagłówku powłoki - nie w <header> karty/sekcji (recenzja m5)", () => {
  // `<header>` karty w treści NIE zwalnia obrazu eager z bramki.
  const card = analyzeDocument({
    html: lcpHtml({
      extraBody:
        '<article><header><img src="https://x.test/karta.webp" loading="eager"/></header></article>',
    }),
    linkHeader: LCP_LINK,
  });
  assert.equal(card.imgEagerNonCandidate, 1);
  assert.equal(gate(card, "imgEagerNonCandidate").ok, false);
  // Zagnieżdżony <header> w nagłówku powłoki nie zamyka jego zakresu: logo
  // po wewnętrznym `</header>` dalej jest w powłoce. Napis „<header>” w CSS
  // przed powłoką niczego nie przesuwa; obraz eager ZA powłoką się liczy.
  const nested = analyzeDocument({
    html:
      "<html><head><style>/* <header> wrapper */ :where(header svg){color:red}</style></head><body>" +
      '<header data-site-header="true"><header class="w"><span>menu</span></header>' +
      '<img src="/logo.svg" alt="Logo" loading="eager"/></header>' +
      '<img src="https://x.test/za-powloka.webp" loading="eager"/></body></html>',
  });
  assert.equal(nested.imgEagerNonCandidate, 1);
});

test("ścieżka LCP: dwóch kandydatów z `media` urządzenia - preload i Link nadal kandydatami", () => {
  const MOBILE = "https://x.test/m.webp?w=480 480w";
  const html = lcpHtml({
    extraHead: `<link rel="preload" as="image" imageSrcSet="${MOBILE}" imageSizes="100vw" fetchPriority="high" media="(max-width: 767px)"/>`,
    extraBody: `<img src="https://x.test/m.webp" srcSet="${MOBILE}" sizes="100vw" loading="eager" fetchPriority="high" data-lcp-candidate=""/>`,
  });
  const link =
    `${LCP_LINK}, <https://x.test/m.webp>; rel="preload"; as="image"; fetchpriority=high; ` +
    `imagesrcset="${MOBILE}"; imagesizes="100vw"; media="(max-width: 767px)"`;
  const w = analyzeDocument({ html, linkHeader: link });
  assert.equal(w.lcpCandidateCount, 2);
  assert.equal(w.imagePreloadNonCandidate, 0);
  assert.equal(w.linkHeaderDisallowed, 0);
  assert.equal(gate(w, "imgFetchpriorityHigh").ok, true);
});

test("ścieżka LCP: KONTROLA NEGATYWNA - nagłówek Link spoza listy dozwolonych", () => {
  const stray =
    `${LCP_LINK}, <https://x.test/karta.webp>; rel="preload"; as="image"; fetchpriority=high, ` +
    `</assets/route-R.js>; rel="prefetch"`;
  const w = analyzeDocument({ html: lcpHtml(), linkHeader: stray });
  // Obraz nie-kandydata w Link: i preload spoza kandydata, i wpis spoza listy.
  assert.equal(w.imagePreloadNonCandidate, 1);
  assert.equal(w.linkHeaderDisallowed, 2);
  assert.equal(gate(w, "linkHeaderDisallowed").ok, false);
});

test("ścieżka LCP: obraz bez srcset - klucz zasobu to `src`/`href` (jak w React)", () => {
  assert.equal(imageResourceKey("", "", "https://x.test/a.jpg"), "src:https://x.test/a.jpg");
  assert.equal(imageResourceKey("a 1w", "50vw", "ignored"), "srcset:a 1w\n50vw");
  const html =
    `<html><head><link rel="preload" as="image" href="https://x.test/a.jpg" fetchPriority="high"/></head>` +
    `<body><img src="https://x.test/a.jpg" loading="eager" fetchPriority="high" data-lcp-candidate=""/></body></html>`;
  const w = analyzeDocument({
    html,
    linkHeader: '<https://x.test/a.jpg>; rel="preload"; as="image"; fetchpriority=high',
  });
  assert.equal(w.imagePreloadNonCandidate, 0);
  assert.equal(w.linkHeaderDisallowed, 0);
});

test("ścieżka LCP: preLcpTransferBytes = HTML gz + CSS gz + JS High gz + fonty + obraz z artefaktu", () => {
  const dir = assets();
  writeFileSync(join(dir, "font-F.woff2"), Buffer.alloc(3000, 7));
  writeFileSync(join(dir, "hero-H.webp"), Buffer.alloc(5000, 9));
  const remote = analyzeDocument({ html: lcpHtml(), linkHeader: LCP_LINK, assetsDir: dir });
  assert.equal(remote.fontPreloadBytes, 3000);
  // Obraz kandydata z CDN nie jest liczony (wariant zależy od viewportu).
  assert.equal(remote.lcpImageBytes, 0);
  assert.equal(
    remote.preLcpTransferBytes,
    remote.htmlGzipBytes +
      remote.renderBlockingCssGzipBytes +
      remote.preloadedJsGzipBytes +
      remote.fontPreloadBytes,
  );
  const local = analyzeDocument({
    html: lcpHtml().replace('src="https://x.test/hero.webp"', 'src="/assets/hero-H.webp"'),
    linkHeader: LCP_LINK,
    assetsDir: dir,
  });
  assert.equal(local.lcpImageBytes, 5000);
  assert.equal(
    local.preLcpTransferBytes,
    local.htmlGzipBytes +
      local.renderBlockingCssGzipBytes +
      local.preloadedJsGzipBytes +
      3000 +
      5000,
  );
  // Bez katalogu artefaktu zostaje sam HTML (bramka nie zgaduje bajtów plików).
  const bare = analyzeDocument({ html: lcpHtml(), linkHeader: LCP_LINK });
  assert.equal(bare.preLcpTransferBytes, bare.htmlGzipBytes);
  assert.ok(gate(remote, "preLcpTransferBytes").ok);
});

test("plik progów: preLcpTransferBytes ma zapas z reguły pliku, więc niezmieniona baza jest zielona", () => {
  // Reguła `SKĄD max` dla bajtów: ceil(największa z 5 próbek x 1,02). Próg
  // równy jednemu pomiarowi (741 999, runda 2) był czerwony na tej samej bazie,
  // bo gzip HTML-u waha się między seriami o ±16 B (PROVE P1.4 §3). `measured`
  // to artefakt P1.4 (runda 10); baza fali 1 (cc1a3767, 742 000 B) musi
  // zostać zielona, bo ratchet z P1.4 nie może oblać niezmienionej bazy.
  const file = JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "document-weight-budgets.json"),
      "utf8",
    ),
  );
  const budget = file.budgets.preLcpTransferBytes;
  assert.equal(budget.max, Math.ceil(budget.measured * 1.02));
  const budgets = { preLcpTransferBytes: budget };
  const at = (value) => checkBudgets({ preLcpTransferBytes: value }, budgets)[0].ok;
  assert.ok(at(budget.measured + 16), "rozrzut gzip HTML-u bazy mieści się w progu");
  assert.ok(at(742000 + 16), "baza fali 1 (cc1a3767) z rozrzutem gzip jest zielona");
  assert.ok(at(budget.max));
  // KONTROLA NEGATYWNA: bajt ponad próg jest czerwony.
  assert.equal(at(budget.max + 1), false);
});

test("moduły tylko-serwerowe: KONTROLA NEGATYWNA - lcpCandidate.ts w chunku klienta oblewa", () => {
  // Inwentarz chunków (BUNDLE_INVENTORY=1) zna moduły każdego chunku. Kandydat
  // LCP i preload hero liczy wyłącznie serwer (P1.4, recenzja runda 3, m3).
  const chunk = (file, ids, isEntry = false) => ({
    file,
    isEntry,
    modules: ids.map((id) => ({ id, bytes: 1 })),
  });
  const clean = {
    chunks: [
      chunk("assets/index-A.js", ["/w/src/lib/builder/aboveFold.tsx"], true),
      // Inny moduł o tej samej nazwie pliku - nie jest wyciekiem.
      chunk("assets/archive-B.js", ["/w/src/lib/archive/heroImage.ts"]),
    ],
  };
  assert.deepEqual(serverOnlyModulesInClient(clean), []);
  const leaked = {
    chunks: [
      ...clean.chunks,
      chunk("assets/index-C.js", ["/w/src/lib/builder/lcpCandidate.ts?v=1"], true),
      chunk("assets/route-D.js", ["/w/src/lib/builder/heroImage.ts"]),
    ],
  };
  assert.deepEqual(serverOnlyModulesInClient(leaked), [
    { chunk: "assets/index-C.js", module: "src/lib/builder/lcpCandidate.ts" },
    { chunk: "assets/route-D.js", module: "src/lib/builder/heroImage.ts" },
  ]);
  assert.deepEqual([...SERVER_ONLY_CLIENT_MODULES].sort(), [
    "src/lib/builder/heroImage.ts",
    "src/lib/builder/lcpCandidate.ts",
  ]);
});

test("moduły tylko-serwerowe: inwentarz z innego buildu (inne hashe) jest pomijany, nie zaliczany", () => {
  const dir = mkdtempSync(join(tmpdir(), "nes-dw-inv-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets/index-A.js"), "");
  const inventory = (file) => ({ chunks: [{ file, isEntry: true, modules: [] }] });
  assert.equal(inventoryMatchesBuild(inventory("assets/index-A.js"), dir), true);
  assert.equal(inventoryMatchesBuild(inventory("assets/index-STARY.js"), dir), false);
  assert.equal(inventoryMatchesBuild({ chunks: [] }, dir), false);
});

test("Link: imagesizes jest parsowane razem z imagesrcset", () => {
  const [hero] = parseLinkHeader(LCP_LINK);
  assert.equal(hero.imagesrcset, LCP_SRCSET);
  assert.equal(hero.imagesizes, "50vw");
});

const CHECK = join(dirname(fileURLToPath(import.meta.url)), "check-document-weight.ts");

function checkWeight(args) {
  return spawnSync(process.execPath, [CHECK, ...args], { encoding: "utf8" });
}

test("bramka: KONTROLA NEGATYWNA - brak pliku progów przy aktywnej bramce kończy się kodem 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "nes-dw-cli-"));
  const html = join(dir, "dokument.html");
  writeFileSync(html, HTML);
  const missing = join(dir, "nie-ma-progow.json");
  const report = join(dir, "raport.json");
  const common = ["--root", dir, "--json", report];

  // --html + --assert: bramka aktywna, progów brak.
  const asserted = checkWeight([...common, "--html", html, "--assert", "--budgets", missing]);
  assert.equal(asserted.status, 1, asserted.stdout);
  assert.match(asserted.stderr, /✗ Brak pliku progów .*nie-ma-progow\.json/);

  // Tryb artefaktu (bramka zawsze aktywna): błąd PRZED startem artefaktu -
  // katalog jest pusty, więc start skończyłby się innym komunikatem.
  const artifact = checkWeight([...common, "--budgets", missing]);
  assert.equal(artifact.status, 1, artifact.stdout);
  assert.match(artifact.stderr, /✗ Brak pliku progów/);

  // Kontrola: analiza pliku bez --assert nie jest bramką - brak progów to informacja.
  const analysis = checkWeight([...common, "--html", html, "--budgets", missing]);
  assert.equal(analysis.status, 0, analysis.stderr);
  assert.match(analysis.stdout, /brak pliku progów/);

  // Kontrola pozytywna: ta sama bramka z plikiem progów przechodzi.
  const budgets = join(dir, "progi.json");
  writeFileSync(budgets, JSON.stringify({ budgets: { htmlRawBytes: { max: 10 ** 9 } } }));
  const ok = checkWeight([...common, "--html", html, "--assert", "--budgets", budgets]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /✓ Waga dokumentu w progach/);
});

test("ratchet: progi wyłącznie w dół", () => {
  const w = analyzeDocument({ html: HTML });
  const measured = medianWeights([w]);
  const values = Object.fromEntries(Object.entries(measured).map(([k, v]) => [k, v.max]));
  const tight = ratchetBudgets({ htmlRawBytes: { max: 10, target: 5 } }, values, 0.02);
  assert.equal(tight.htmlRawBytes.max, 10, "pomiar powyżej progu nie podnosi progu");
  assert.equal(tight.htmlRawBytes.target, 5);
  const loose = ratchetBudgets({ htmlRawBytes: { max: 10 ** 9 } }, values, 0.02);
  assert.equal(loose.htmlRawBytes.max, Math.ceil(w.htmlRawBytes * 1.02));
});

function lhr({ lcp, tbt, img = "https://fixture.invalid/cover.jpg" }) {
  return {
    lighthouseVersion: "13.5.0",
    finalDisplayedUrl: "https://fixture.invalid/",
    environment: { benchmarkIndex: 1800 },
    categories: { performance: { score: 0.5 } },
    audits: {
      "largest-contentful-paint": { numericValue: lcp },
      "total-blocking-time": { numericValue: tbt },
      "network-requests": {
        details: {
          items: [
            {
              url: "https://fixture.invalid/",
              resourceType: "Document",
              priority: "VeryHigh",
              networkRequestTime: 0,
              networkEndTime: 50,
              transferSize: 1000,
              protocol: "h2",
            },
            {
              url: "https://fixture.invalid/a.js",
              resourceType: "Script",
              priority: "High",
              networkRequestTime: 60,
              networkEndTime: 300,
              transferSize: 5000,
              protocol: "h2",
            },
            {
              url: img,
              resourceType: "Image",
              priority: "High",
              networkRequestTime: 70,
              networkEndTime: 200,
              transferSize: 9000,
              protocol: "h2",
            },
            {
              url: "https://fixture.invalid/late.js",
              resourceType: "Script",
              priority: "High",
              networkRequestTime: 900,
              networkEndTime: 950,
              transferSize: 7000,
              protocol: "h2",
            },
            {
              url: "https://fixture.invalid/low.webp",
              resourceType: "Image",
              priority: "Low",
              networkRequestTime: 80,
              networkEndTime: 150,
              transferSize: 3000,
              protocol: "h2",
            },
          ],
        },
      },
      "lcp-breakdown-insight": {
        details: {
          type: "list",
          items: [
            { type: "table", items: [{ subpart: "elementRenderDelay", duration: 321 }] },
            {
              type: "node",
              selector: "div > img.eh-img",
              snippet: `<img src="${img}" class="eh-img">`,
            },
          ],
        },
      },
    },
  };
}

test("metryki LH: element LCP, fazy i bajty High przed końcem obrazu LCP", () => {
  const m = extractMetrics(lhr({ lcp: 4000, tbt: 300 }));
  assert.equal(m.lcpElement, "img.eh-img");
  assert.equal(m.lcpRenderDelay, 321);
  // a.js (High, start 60 <= koniec obrazu 200) liczy się; late.js i Low nie; dokument nie.
  assert.equal(m.highPriorityBytesBeforeLcpImage, 5000);
  assert.equal(m.h2Share, 1);
  assert.equal(m.score, 50);
});

test("mediany i DELTA", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  const a = aggregate(
    [lhr({ lcp: 4000, tbt: 300 }), lhr({ lcp: 5000, tbt: 500 }), lhr({ lcp: 4500, tbt: 100 })].map(
      extractMetrics,
    ),
  );
  const b = aggregate([lhr({ lcp: 3000, tbt: 200 })].map(extractMetrics));
  assert.equal(a.median.lcp, 4500);
  assert.match(deltaLine("x", a.median, b.median), /lcp=-1\.50s .*tbt=-100ms/);
});
