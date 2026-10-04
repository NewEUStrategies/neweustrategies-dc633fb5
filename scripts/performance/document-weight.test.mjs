// Testy warstw czystych harnessu pomiarowego (2026-10-03): documentWeight.ts
// i lighthouseReport.ts. Każda bramka ma KONTROLĘ NEGATYWNĄ - dowód, że oblewa
// na zepsutym wejściu, a nie tylko przechodzi na dzisiejszym.
//
// Uruchomienie: node --test scripts/performance/document-weight.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  analyzeDocument,
  checkBudgets,
  medianWeights,
  parseLinkHeader,
  ratchetBudgets,
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
