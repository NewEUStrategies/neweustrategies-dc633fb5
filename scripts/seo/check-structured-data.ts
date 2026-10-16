#!/usr/bin/env node
// KONTROLA DANYCH STRUKTURALNYCH NA WDROŻONEJ STRONIE - te same reguły, którymi
// Search Console ocenia wynik z okruszkami, przyłożone do HTML-a z produkcji.
//
// Dlaczego osobno od testów jednostkowych i e2e: Search Console widzi dokument
// po routingu, SSR, cache brzegu i z prawdziwymi danymi. 2026-10-16 zgłosił
// „Brakujące pole item (w itemListElement)" na 10 adresach /organization/*,
// których żaden test nie renderował z adresem absolutnym. Ten skrypt czyta
// sitemapę, dociąga każdy adres (plus szablony linkowane z treści, a nieobecne
// w sitemapie - np. /author/*) i przepuszcza KAŻDY blok JSON-LD przez
// `src/lib/seo/structuredDataAudit.ts`.
//
// Uruchamiany gołym `node` (type stripping, node >= 22.18), bez instalacji
// zależności - jak `scripts/performance/psi-sample.mjs`.
//
// Użycie:
//   node scripts/seo/check-structured-data.ts [--base https://neweuropeanstrategies.com]
//        [--concurrency 6] [--limit 2000] [--discover-limit 300] [--no-discover]
//        [--path /author/jan-kowalski ...] [--report reports/structured-data.json]
//
// Kod wyjścia: 0 - każdy adres zbadany i zgodny, 1 - są niezgodności ALBO
// adresy, których nie dało się zbadać (timeout, HTTP != 200, odpowiedź bez
// HTML-a), 2 - nie da się przeprowadzić kontroli (sitemapa niedostępna, zero
// sprawdzonych stron). Niezbadany adres to nie „zgodny": szablon w awarii albo
// strona serwisowa 200 nie może zostawić codziennej kontroli na zielono.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import {
  extractJsonLd,
  findJsonLdNodes,
  structuredDataIssues,
  type StructuredDataIssue,
} from "../../src/lib/seo/structuredDataAudit.ts";

const USER_AGENT = "nes-structured-data-check/1.0 (+https://neweuropeanstrategies.com)";
const FETCH_TIMEOUT_MS = 30_000;
const RETRIES = 2;

// Szablony stron z okruszkami, do których linkuje treść, a których sitemapa
// nie musi wymieniać. Odkrywane z już pobranych stron - także przez
// `<link rel="alternate" hreflang>`, więc /en/category/* (osiągalne dopiero
// z /category/*, a te z treści) wymaga DRUGIEGO skoku.
const MAX_DISCOVERY_HOPS = 3;
const DISCOVERABLE =
  /^(?:\/en)?\/(?:author|people|organization|category|tag|programs|tracker|qa|events)\/[^/?#]+\/?$/;
// Kanały i pliki pod tymi samymi prefiksami (`/tracker/rss.xml`, autodiscovery
// RSS w `<link rel="alternate">`) nie są stronami z okruszkami - bez tego filtra
// kontrola liczyła je jako NIEZBADANE i codzienny przebieg świecił na czerwono.
const NOT_A_PAGE = /\.(?:xml|rss|atom|json|txt|ics|pdf)$/i;

interface PageResult {
  url: string;
  status: number | null;
  breadcrumbLists: number;
  issues: StructuredDataIssue[];
  error?: string;
}

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "https://neweuropeanstrategies.com" },
    concurrency: { type: "string", default: "6" },
    limit: { type: "string", default: "2000" },
    "discover-limit": { type: "string", default: "300" },
    "no-discover": { type: "boolean", default: false },
    path: { type: "string", multiple: true, default: [] },
    report: { type: "string" },
  },
});

const base = new URL(values.base ?? "https://neweuropeanstrategies.com");
const origin = base.origin;
const concurrency = Math.max(1, Number.parseInt(values.concurrency ?? "6", 10) || 6);
const limit = Math.max(1, Number.parseInt(values.limit ?? "2000", 10) || 2000);
const discoverLimit = values["no-discover"]
  ? 0
  : Math.max(0, Number.parseInt(values["discover-limit"] ?? "300", 10) || 0);

async function fetchText(url: string): Promise<{ status: number; type: string; body: string }> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xml;q=0.9" },
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      // 5xx to stan brzegu, nie treść - jedna-dwie próby ponownie.
      if (res.status >= 500 && attempt < RETRIES) {
        lastError = new Error(`HTTP ${res.status}`);
      } else {
        return {
          status: res.status,
          type: res.headers.get("content-type") ?? "",
          body: await res.text(),
        };
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) =>
    (m[1] ?? "").replace(/&amp;/g, "&"),
  );
}

/** Adresy z indeksu sitemap i jego shardów (bez news-sitemapy - dubluje wpisy). */
async function sitemapUrls(): Promise<string[]> {
  const index = await fetchText(`${origin}/sitemap.xml`);
  if (index.status !== 200) throw new Error(`/sitemap.xml -> HTTP ${index.status}`);
  const children = index.body.includes("<sitemapindex") ? locs(index.body) : [];
  const pages = new Set(index.body.includes("<urlset") ? locs(index.body) : []);
  for (const child of children) {
    if (/news-sitemap/i.test(child)) continue;
    const shard = await fetchText(child);
    if (shard.status !== 200) throw new Error(`${child} -> HTTP ${shard.status}`);
    for (const loc of locs(shard.body)) pages.add(loc);
  }
  return [...pages];
}

/** Wewnętrzne linki do szablonów z okruszkami, znalezione w HTML-u strony. */
function discoverLinks(html: string): string[] {
  const found: string[] = [];
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const raw = m[1] ?? "";
    let url: URL;
    try {
      url = new URL(raw, origin);
    } catch {
      continue;
    }
    if (url.origin !== origin || !DISCOVERABLE.test(url.pathname)) continue;
    if (NOT_A_PAGE.test(url.pathname)) continue;
    found.push(`${origin}${url.pathname}`);
  }
  return found;
}

async function checkPage(url: string, discovered: Set<string> | null): Promise<PageResult> {
  try {
    const res = await fetchText(url);
    if (res.status !== 200) {
      return {
        url,
        status: res.status,
        breadcrumbLists: 0,
        issues: [],
        error: `HTTP ${res.status}`,
      };
    }
    if (!res.type.includes("html")) {
      const type = res.type || "brak content-type";
      return {
        url,
        status: res.status,
        breadcrumbLists: 0,
        issues: [],
        error: `200 bez HTML (${type})`,
      };
    }
    if (discovered) for (const link of discoverLinks(res.body)) discovered.add(link);
    const { graphs, issues: parseIssues } = extractJsonLd(res.body);
    return {
      url,
      status: res.status,
      breadcrumbLists: findJsonLdNodes(graphs, "BreadcrumbList").length,
      issues: [...parseIssues, ...structuredDataIssues(graphs)],
    };
  } catch (error) {
    return {
      url,
      status: null,
      breadcrumbLists: 0,
      issues: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runPool(
  urls: readonly string[],
  discovered: Set<string> | null,
): Promise<PageResult[]> {
  const results: PageResult[] = [];
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next];
      next += 1;
      if (url) results.push(await checkPage(url, discovered));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return results;
}

async function main(): Promise<number> {
  let seeds: string[];
  try {
    seeds = await sitemapUrls();
  } catch (error) {
    console.error(`✗ Sitemapa niedostępna: ${error instanceof Error ? error.message : error}`);
    return 2;
  }
  // Jawne `--path` idą PIERWSZE i nie podlegają `--limit` - punktowa kontrola
  // znanego adresu nie może przepaść za to, że sitemapa jest dłuższa.
  const extra = (values.path ?? []).map((p) => new URL(p, origin).toString());
  const all = [...new Set([...extra, ...seeds])];
  const planned = all.slice(0, Math.max(limit, extra.length));
  console.log(`kontrola JSON-LD: ${origin} - ${planned.length} adresów z sitemapy i --path`);
  if (planned.length < all.length) {
    console.log(
      `  (pominięto ${all.length - planned.length} adresów sitemapy ponad --limit ${limit})`,
    );
  }

  const seen = new Set(planned);
  const discovered = discoverLimit > 0 ? new Set<string>() : null;
  const results = await runPool(planned, discovered);
  let budget = discoverLimit;
  for (let hop = 1; discovered && hop <= MAX_DISCOVERY_HOPS; hop += 1) {
    const fresh = [...discovered].filter((u) => !seen.has(u));
    const more = fresh.slice(0, budget);
    if (fresh.length > more.length) {
      console.log(
        `  (pominięto ${fresh.length - more.length} odkrytych adresów ponad --discover-limit)`,
      );
    }
    if (more.length === 0) break;
    for (const u of more) seen.add(u);
    budget -= more.length;
    console.log(`  + ${more.length} adresów odkrytych w treści (skok ${hop})`);
    results.push(...(await runPool(more, hop < MAX_DISCOVERY_HOPS ? discovered : null)));
  }

  results.sort((a, b) => a.url.localeCompare(b.url));
  const failing = results.filter((r) => r.issues.length > 0);
  const unaudited = results.filter((r) => r.error !== undefined);
  const checked = results.filter((r) => r.error === undefined);
  const withCrumbs = checked.filter((r) => r.breadcrumbLists > 0);

  for (const r of failing) {
    console.log(`✗ ${r.url}`);
    for (const issue of r.issues) console.log(`    ${issue.path}: ${issue.message}`);
  }
  for (const r of unaudited) console.log(`! ${r.url}: ${r.error}`);

  console.log(
    [
      `SPRAWDZONE ${checked.length}`,
      `Z OKRUSZKAMI ${withCrumbs.length}`,
      `NIEZGODNE ${failing.length}`,
      `NIEZBADANE ${unaudited.length}`,
    ].join(" | "),
  );

  if (values.report) {
    mkdirSync(dirname(values.report), { recursive: true });
    writeFileSync(
      values.report,
      `${JSON.stringify({ origin, checkedAt: new Date().toISOString(), results }, null, 2)}\n`,
    );
  }
  if (checked.length === 0) {
    console.error("✗ Żadna strona nie została sprawdzona - wynik nie jest dowodem.");
    return 2;
  }
  return failing.length > 0 || unaudited.length > 0 ? 1 : 0;
}

process.exitCode = await main();
