#!/usr/bin/env node
// PORÓWNANIE META I JSON-LD DWÓCH DOKUMENTÓW (P3.2a / P4.2).
//
// PO CO. P3.2a skraca adresy mediów do ścieżek względnych WYŁĄCZNIE w `src`/`srcset`
// renderowanym do HTML-u, w preloadzie obrazu w `<head>` i w nagłówku `Link`
// (`renderedMediaUrl`, `src/lib/cropSizes.ts`). og:image, twitter:image, JSON-LD
// (Organization, Article, BreadcrumbList...) muszą zostać ABSOLUTNE i bajtowo
// identyczne - czytają je roboty i serwisy społecznościowe, nie przeglądarka.
// Ten skrypt porównuje każdy znacznik `<meta>` (w kolejności dokumentu, surowy
// tekst znacznika) i treść każdego `<script type="application/ld+json">` dwóch
// dokumentów: przed zmianą i po niej.
//
// UŻYCIE:
//   node scripts/performance/compare-head-meta.mjs <przed> <po> [<przed2> <po2> ...]
// Każdy argument to plik HTML albo adres http(s) (pobierany z nagłówkiem
// przeglądarki). Kod wyjścia: 0 = wszystkie pary równe, 1 = różnica (wypisana),
// 2 = błąd wejścia. Dowód P3.2a: zapisany HIT produkcji sprzed wdrożenia (`d2`)
// wobec HIT-u po wdrożeniu; na fixture `/` porównanie przechodzi trywialnie.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** Treść `<script>`/`<style>` zamaskowana - `<meta>` w napisie skryptu nie jest znacznikiem. */
function withoutScriptBodies(html) {
  return html.replace(/(<(script|style)\b[^>]*>)[\s\S]*?(<\/\2>)/gi, "$1$3");
}

/** Podpis dokumentu: surowe znaczniki `<meta>` i treści bloków JSON-LD, w kolejności. */
export function headMetaSignature(html) {
  const meta = [...withoutScriptBodies(html).matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const jsonLd = [
    ...html.matchAll(
      /<script\b[^>]*\btype=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ].map((m) => m[1]);
  return { meta, jsonLd };
}

/** Różnice dwóch podpisów (pusta lista = bajtowo równe). */
export function compareHeadMeta(before, after) {
  const a = headMetaSignature(before);
  const b = headMetaSignature(after);
  const diffs = [];
  for (const kind of ["meta", "jsonLd"]) {
    const n = Math.max(a[kind].length, b[kind].length);
    if (a[kind].length !== b[kind].length) {
      diffs.push(`${kind}: liczba ${a[kind].length} -> ${b[kind].length}`);
    }
    for (let i = 0; i < n; i += 1) {
      if (a[kind][i] !== b[kind][i]) {
        diffs.push(`${kind}[${i}]:\n  - ${a[kind][i] ?? "(brak)"}\n  + ${b[kind][i] ?? "(brak)"}`);
      }
    }
  }
  return diffs;
}

async function load(source) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, {
      headers: { "user-agent": BROWSER_UA, accept: "text/html" },
    });
    if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
    return response.text();
  }
  return readFileSync(source, "utf8");
}

async function main(args) {
  if (args.length < 2 || args.length % 2 !== 0) {
    console.error("użycie: compare-head-meta.mjs <przed> <po> [<przed2> <po2> ...]");
    return 2;
  }
  let failed = false;
  for (let i = 0; i < args.length; i += 2) {
    const [before, after] = [args[i], args[i + 1]];
    const diffs = compareHeadMeta(await load(before), await load(after));
    const { meta, jsonLd } = headMetaSignature(await load(after));
    if (diffs.length === 0) {
      console.log(`RÓWNE  ${before} == ${after} (meta ${meta.length}, JSON-LD ${jsonLd.length})`);
    } else {
      failed = true;
      console.log(`RÓŻNE  ${before} != ${after}`);
      for (const diff of diffs) console.log(`  ${diff}`);
    }
  }
  return failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(2);
    },
  );
}
