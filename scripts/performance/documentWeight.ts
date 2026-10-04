// WAGA DOKUMENTU SSR - warstwa CZYSTA (bez serwera; czyta tylko pliki artefaktu).
//
// PO CO. EVIDENCE §3/§8 (2026-10-03): dokument `/` na produkcji ma 569 KB
// (fixture: ~390 KB), z czego 133 KB to 51 bloków inline `<style>`, 107 KB
// dehydratowany stan `$tsr-stream-barrier`, a `<head>` + nagłówek `Link`
// niosą ~30 preloadów, w tym obraz LCP 4x i przypadkowe chunki tras. Na łączu
// mobilnym PSI (1,6 Mb/s) każdy z tych bajtów konkuruje z CSS, fontami
// i obrazem LCP, a parsowanie 575 KB HTML to ~250 ms długich zadań przed
// jakimkolwiek JS. Żadna bramka repo tego nie mierzyła: `check:bundle` liczy
// chunki (i raportuje `bootRaw` bez progu), `check:ssr-budgets` czyta źródła.
// Ta warstwa liczy to, co PRZEGLĄDARKA dostaje w pierwszym dokumencie.
//
// Metryki są celowo „bajtowe": artefakt jest deterministyczny co do bajtów
// zasobów, a dokument fixture - prawie (strumieniowanie granic Suspense daje
// rozrzut rzędu kilku KB między żądaniami; runner bierze medianę próbek).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";

export type Attributes = Readonly<Record<string, string>>;

/** Atrybuty znacznika otwierającego; nazwy małymi literami, encje `&amp;` zdekodowane. */
export function parseAttributes(tag: string): Attributes {
  const out: Record<string, string> = {};
  const body = tag.replace(/^<\s*[a-zA-Z0-9-]+/, "").replace(/\/?>$/, "");
  const re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
  for (const m of body.matchAll(re)) {
    const value = m[2] ?? m[3] ?? m[4] ?? "";
    out[m[1].toLowerCase()] = value.replace(/&amp;/g, "&").replace(/&quot;/g, '"');
  }
  return out;
}

export interface LinkEntry {
  readonly source: "head" | "body" | "header";
  readonly rel: string;
  readonly href: string;
  readonly as: string;
  readonly imagesrcset: string;
  readonly fetchpriority: string;
  readonly media: string;
}

/** Nagłówek `Link` (RFC 8288): przecinki poza `<...>` i cudzysłowami rozdzielają wpisy. */
export function parseLinkHeader(value: string | null | undefined): LinkEntry[] {
  if (!value) return [];
  const parts: string[] = [];
  let current = "";
  let inAngle = false;
  let inQuote = false;
  for (const ch of value) {
    if (ch === "<" && !inQuote) inAngle = true;
    else if (ch === ">" && !inQuote) inAngle = false;
    else if (ch === '"' && !inAngle) inQuote = !inQuote;
    if (ch === "," && !inAngle && !inQuote) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.flatMap((part) => {
    const m = /^\s*<([^>]*)>(.*)$/.exec(part);
    if (!m) return [];
    const params: Record<string, string> = {};
    for (const p of m[2].split(";")) {
      const kv = /^\s*([^=\s]+)\s*(?:=\s*(?:"([^"]*)"|([^\s;]*)))?/.exec(p);
      if (kv && kv[1]) params[kv[1].toLowerCase()] = kv[2] ?? kv[3] ?? "";
    }
    return [
      {
        source: "header" as const,
        rel: (params["rel"] ?? "").toLowerCase(),
        href: m[1],
        as: (params["as"] ?? "").toLowerCase(),
        imagesrcset: params["imagesrcset"] ?? "",
        fetchpriority: (params["fetchpriority"] ?? "").toLowerCase(),
        media: params["media"] ?? "",
      },
    ];
  });
}

interface Block {
  readonly attrs: Attributes;
  readonly content: string;
}

function blocks(html: string, tag: "script" | "style"): Block[] {
  const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "gi");
  return [...html.matchAll(re)].map((m) => ({
    attrs: parseAttributes(`<${tag}${m[1]}>`),
    content: m[2],
  }));
}

const byteLength = (s: string) => Buffer.byteLength(s, "utf8");
const DATA_SCRIPT_TYPES = /^(application\/(ld\+)?json|speculationrules|importmap)$/i;

/** Sufiks ścieżki `/assets/x.js` -> nazwa pliku w `.output/public/assets`. */
function assetName(href: string): string | null {
  const m = /\/assets\/([A-Za-z0-9._$~-]+\.(?:js|css))(?:[?#].*)?$/.exec(href);
  return m ? m[1] : null;
}

/**
 * Krawędzie WYŁĄCZNIE STATYCZNE - ten sam wzorzec i ta sama reguła odfiltrowania
 * `import(` co `STATIC_EDGE_RE` w scripts/check-bundle-size.ts (domknięcie bootu
 * = to, co przeglądarka MUSI wykonać przed hydratacją).
 */
const STATIC_EDGE_RE = /(import\s*\(?\s*|from\s*)["'](\.\/[^"']+\.js)["']/g;

export interface FileWeight {
  readonly name: string;
  readonly rawBytes: number;
  readonly gzipBytes: number;
}

export interface ClosureWeight {
  readonly roots: readonly string[];
  readonly files: readonly FileWeight[];
  readonly missing: readonly string[];
  readonly rawBytes: number;
  readonly gzipBytes: number;
}

const gzipCache = new Map<string, number>();
function weigh(dir: string, name: string): FileWeight | null {
  const path = join(dir, name);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path);
  let gz = gzipCache.get(path);
  if (gz === undefined) {
    // Domyślny poziom gzip - jak `gzipKb()` w scripts/check-bundle-size.ts.
    gz = gzipSync(raw).length;
    gzipCache.set(path, gz);
  }
  return { name, rawBytes: raw.length, gzipBytes: gz };
}

function sumWeights(files: readonly FileWeight[]): { rawBytes: number; gzipBytes: number } {
  return {
    rawBytes: files.reduce((s, f) => s + f.rawBytes, 0),
    gzipBytes: files.reduce((s, f) => s + f.gzipBytes, 0),
  };
}

/** Statyczne domknięcie importów od `roots` w katalogu `assetsDir`. */
export function staticClosure(assetsDir: string, roots: readonly string[]): ClosureWeight {
  const seen = new Set<string>();
  const missing: string[] = [];
  const stack = [...roots];
  while (stack.length > 0) {
    const name = stack.pop() as string;
    if (seen.has(name)) continue;
    const path = join(assetsDir, name);
    if (!existsSync(path)) {
      missing.push(name);
      seen.add(name);
      continue;
    }
    seen.add(name);
    for (const m of readFileSync(path, "utf8").matchAll(STATIC_EDGE_RE)) {
      if (m[1].trimEnd().endsWith("(")) continue;
      const next = basename(m[2]);
      if (!seen.has(next)) stack.push(next);
    }
  }
  const files = [...seen]
    .filter((n) => !missing.includes(n))
    .map((n) => weigh(assetsDir, n))
    .filter((f): f is FileWeight => f !== null)
    .sort((a, b) => b.rawBytes - a.rawBytes);
  return { roots: [...roots], files, missing, ...sumWeights(files) };
}

/**
 * Korzenie bootu z manifestu TanStack Start w `.output/server` - ta sama metoda
 * co `findBootChunks()` w scripts/check-bundle-size.ts (fallback, gdy dokument
 * nie ma `<script type="module" src>`).
 */
export function manifestBootRoots(serverDir: string): string[] {
  const scriptRe = /scripts:\s*\[[^\]]*?src:\s*["']\/assets\/([A-Za-z0-9._$-]+\.js)["']/g;
  const found = new Set<string>();
  if (!existsSync(serverDir)) return [];
  for (const file of readdirSync(serverDir)) {
    if (!file.endsWith(".mjs") && !file.endsWith(".js")) continue;
    for (const m of readFileSync(join(serverDir, file), "utf8").matchAll(scriptRe)) found.add(m[1]);
  }
  return [...found];
}

export interface DuplicateEntry {
  readonly key: string;
  readonly count: number;
  readonly sources: readonly string[];
}

export interface DocumentWeight {
  readonly htmlRawBytes: number;
  readonly htmlGzipBytes: number;
  readonly headRawBytes: number;
  readonly inlineStyleCount: number;
  readonly inlineStyleBytes: number;
  readonly inlineStyleLargestBytes: number;
  readonly inlineScriptCount: number;
  readonly inlineScriptBytes: number;
  /** Inline skrypty wykonywalne (bez JSON-LD, speculationrules, importmap). */
  readonly inlineExecutableScriptBytes: number;
  /** `<script id="$tsr-stream-barrier">` - dehydratowany stan routera/loaderów. */
  readonly dehydratedStateBytes: number;
  readonly moduleScriptCount: number;
  /** Unikalne `modulepreload` z `<head>`/body i nagłówka `Link` łącznie. */
  readonly modulepreloadCount: number;
  readonly modulepreloadInHead: number;
  readonly modulepreloadInHeader: number;
  readonly linkHeaderEntries: number;
  /** Wystąpienia preloadu ponad pierwsze (ten sam zasób: href albo imagesrcset). */
  readonly preloadDuplicates: number;
  /**
   * Duplikaty WEWNĄTRZ dokumentu (head/body bez nagłówka `Link`) - np. obraz LCP
   * preloadowany kilka razy z różnym `imagesizes`, co na desktopie pobiera inny
   * wariant niż `<img>` (EVIDENCE §6). Nakładanie się `Link` z `<head>` kosztuje
   * tylko parsowanie; duplikat w dokumencie potrafi kosztować bajty.
   */
  readonly documentPreloadDuplicates: number;
  readonly duplicates: readonly DuplicateEntry[];
  readonly imagePreloadCount: number;
  readonly fontPreloadCount: number;
  readonly imgCount: number;
  readonly imgFetchpriorityHigh: number;
  readonly imgLazy: number;
  readonly inlineSvgCount: number;
  readonly elementCount: number;
  /** Domknięcie statyczne `<script type="module">` (null bez katalogu assets). */
  readonly bootClosure: ClosureWeight | null;
  readonly bootClosureRawBytes: number;
  readonly bootClosureGzipBytes: number;
  /**
   * JS pobierany z priorytetem High przed/obok pierwszego malowania:
   * domknięcie bootu ∪ wszystkie `modulepreload` (head + `Link`). To jest
   * pula, która na 1,6 Mb/s rywalizuje z obrazem LCP (EVIDENCE §10).
   */
  readonly preloadedJsCount: number;
  readonly preloadedJsRawBytes: number;
  readonly preloadedJsGzipBytes: number;
  /** Preloady JS spoza domknięcia bootu (widgety + przypadkowe chunki tras). */
  readonly preloadOutsideBoot: readonly FileWeight[];
  readonly renderBlockingCssCount: number;
  readonly renderBlockingCssRawBytes: number;
  readonly renderBlockingCssGzipBytes: number;
}

export interface AnalyzeInput {
  readonly html: string;
  readonly linkHeader?: string | null;
  /** `.output/public/assets` - bez niego metryki plikowe są 0, a `bootClosure` null. */
  readonly assetsDir?: string | null;
  /** `.output/server` - fallback korzeni bootu. */
  readonly serverDir?: string | null;
}

function linkEntries(html: string): LinkEntry[] {
  const headEnd = html.search(/<\/head>/i);
  return [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => {
    const a = parseAttributes(m[0]);
    return {
      source: headEnd >= 0 && (m.index ?? 0) < headEnd ? ("head" as const) : ("body" as const),
      rel: (a["rel"] ?? "").toLowerCase(),
      href: a["href"] ?? "",
      as: (a["as"] ?? "").toLowerCase(),
      imagesrcset: a["imagesrcset"] ?? "",
      fetchpriority: (a["fetchpriority"] ?? "").toLowerCase(),
      media: a["media"] ?? "",
    };
  });
}

const isPreload = (l: LinkEntry) => l.rel === "preload" || l.rel === "modulepreload";
/** Ten sam zasób: dla obrazów responsywnych liczy się `imagesrcset`, nie `href`. */
const preloadKey = (l: LinkEntry) => (l.imagesrcset ? `srcset:${l.imagesrcset}` : l.href);

export function analyzeDocument(input: AnalyzeInput): DocumentWeight {
  const { html } = input;
  const headMatch = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html);
  const scripts = blocks(html, "script");
  const inline = scripts.filter((s) => !s.attrs["src"]);
  const styles = blocks(html, "style");
  const links = [...linkEntries(html), ...parseLinkHeader(input.linkHeader)];
  const preloads = links.filter(isPreload);

  const groups = new Map<string, LinkEntry[]>();
  for (const l of preloads) {
    const key = preloadKey(l);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  const duplicates: DuplicateEntry[] = [...groups]
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({ key, count: list.length, sources: list.map((l) => l.source) }))
    .sort((a, b) => b.count - a.count);

  const modulepreloads = preloads.filter((l) => l.rel === "modulepreload");
  const moduleScripts = scripts.filter(
    (s) => (s.attrs["type"] ?? "").toLowerCase() === "module" && s.attrs["src"],
  );
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => parseAttributes(m[0]));
  const bodyStart = html.search(/<body\b/i);
  const body = bodyStart >= 0 ? html.slice(bodyStart) : html;

  const assetsDir = input.assetsDir && existsSync(input.assetsDir) ? input.assetsDir : null;
  let bootClosure: ClosureWeight | null = null;
  let preloadedJs: FileWeight[] = [];
  let preloadOutsideBoot: FileWeight[] = [];
  let css: FileWeight[] = [];
  if (assetsDir) {
    let roots = moduleScripts
      .map((s) => assetName(s.attrs["src"] ?? ""))
      .filter((n): n is string => n !== null);
    if (roots.length === 0 && input.serverDir) roots = manifestBootRoots(input.serverDir);
    bootClosure = staticClosure(assetsDir, roots);
    const bootNames = new Set(bootClosure.files.map((f) => f.name));
    const preloadNames = new Set(
      preloads
        .filter((l) => l.rel === "modulepreload" || l.as === "script")
        .map((l) => assetName(l.href))
        .filter((n): n is string => n !== null && n.endsWith(".js")),
    );
    preloadOutsideBoot = [...preloadNames]
      .filter((n) => !bootNames.has(n))
      .map((n) => weigh(assetsDir, n))
      .filter((f): f is FileWeight => f !== null)
      .sort((a, b) => b.gzipBytes - a.gzipBytes);
    preloadedJs = [...bootClosure.files, ...preloadOutsideBoot];
    const cssNames = new Set(
      links
        .filter(
          (l) =>
            l.source !== "body" &&
            l.rel === "stylesheet" &&
            (l.media === "" || l.media === "all" || l.media === "screen"),
        )
        .map((l) => assetName(l.href))
        .filter((n): n is string => n !== null && n.endsWith(".css")),
    );
    css = [...cssNames].map((n) => weigh(assetsDir, n)).filter((f): f is FileWeight => f !== null);
  }
  const preloadedSum = sumWeights(preloadedJs);
  const cssSum = sumWeights(css);

  return {
    htmlRawBytes: byteLength(html),
    htmlGzipBytes: gzipSync(Buffer.from(html, "utf8"), { level: 6 }).length,
    headRawBytes: headMatch ? byteLength(headMatch[0]) : 0,
    inlineStyleCount: styles.length,
    inlineStyleBytes: styles.reduce((s, b) => s + byteLength(b.content), 0),
    inlineStyleLargestBytes: Math.max(0, ...styles.map((b) => byteLength(b.content))),
    inlineScriptCount: inline.length,
    inlineScriptBytes: inline.reduce((s, b) => s + byteLength(b.content), 0),
    inlineExecutableScriptBytes: inline
      .filter((b) => !DATA_SCRIPT_TYPES.test(b.attrs["type"] ?? ""))
      .reduce((s, b) => s + byteLength(b.content), 0),
    dehydratedStateBytes: inline
      .filter((b) => b.attrs["id"] === "$tsr-stream-barrier")
      .reduce((s, b) => s + byteLength(b.content), 0),
    moduleScriptCount: moduleScripts.length,
    modulepreloadCount: new Set(modulepreloads.map((l) => l.href)).size,
    modulepreloadInHead: modulepreloads.filter((l) => l.source !== "header").length,
    modulepreloadInHeader: modulepreloads.filter((l) => l.source === "header").length,
    linkHeaderEntries: links.filter((l) => l.source === "header").length,
    preloadDuplicates: duplicates.reduce((s, d) => s + d.count - 1, 0),
    documentPreloadDuplicates: duplicates.reduce(
      (s, d) => s + Math.max(0, d.sources.filter((src) => src !== "header").length - 1),
      0,
    ),
    duplicates,
    imagePreloadCount: preloads.filter((l) => l.as === "image").length,
    fontPreloadCount: preloads.filter((l) => l.as === "font").length,
    imgCount: imgs.length,
    imgFetchpriorityHigh: imgs.filter((a) => (a["fetchpriority"] ?? "").toLowerCase() === "high")
      .length,
    imgLazy: imgs.filter((a) => (a["loading"] ?? "").toLowerCase() === "lazy").length,
    inlineSvgCount: (html.match(/<svg\b/gi) ?? []).length,
    elementCount: (body.match(/<[a-zA-Z][a-zA-Z0-9-]*[\s/>]/g) ?? []).length,
    bootClosure,
    bootClosureRawBytes: bootClosure?.rawBytes ?? 0,
    bootClosureGzipBytes: bootClosure?.gzipBytes ?? 0,
    preloadedJsCount: preloadedJs.length,
    preloadedJsRawBytes: preloadedSum.rawBytes,
    preloadedJsGzipBytes: preloadedSum.gzipBytes,
    preloadOutsideBoot,
    renderBlockingCssCount: css.length,
    renderBlockingCssRawBytes: cssSum.rawBytes,
    renderBlockingCssGzipBytes: cssSum.gzipBytes,
  };
}

/** Metryki bramkowane (liczbowe pola `DocumentWeight`). */
export const GATED_METRICS = [
  "htmlRawBytes",
  "htmlGzipBytes",
  "headRawBytes",
  "inlineStyleCount",
  "inlineStyleBytes",
  "inlineScriptBytes",
  "inlineExecutableScriptBytes",
  "dehydratedStateBytes",
  "modulepreloadCount",
  "linkHeaderEntries",
  "preloadDuplicates",
  "documentPreloadDuplicates",
  "imagePreloadCount",
  "imgFetchpriorityHigh",
  "bootClosureRawBytes",
  "bootClosureGzipBytes",
  "preloadedJsCount",
  "preloadedJsGzipBytes",
  "renderBlockingCssGzipBytes",
] as const;

export type GatedMetric = (typeof GATED_METRICS)[number];

export interface Budget {
  /** Próg twardy: pomiar > max = czerwono. Wolno go WYŁĄCZNIE obniżać. */
  readonly max: number;
  /** Wartość zmierzona przy ostatnim zaciśnięciu (dokumentacja ratchetu). */
  readonly measured?: number;
  /** Kierunek z planu (np. HTML < 200 KB) - informacyjnie, nie bramkuje. */
  readonly target?: number;
}

export type Budgets = Readonly<Partial<Record<GatedMetric, Budget>>>;

export interface BudgetResult {
  readonly metric: GatedMetric;
  readonly value: number;
  readonly max: number;
  readonly target: number | undefined;
  readonly ok: boolean;
}

export function checkBudgets(weight: DocumentWeight, budgets: Budgets): BudgetResult[] {
  return GATED_METRICS.flatMap((metric) => {
    const b = budgets[metric];
    if (!b) return [];
    const value = weight[metric];
    return [{ metric, value, max: b.max, target: b.target, ok: value <= b.max }];
  });
}

/**
 * Ratchet: nowy próg = min(stary próg, ceil(pomiar x (1 + zapas))). Nigdy w górę -
 * ta sama reguła co FROZEN_BUDGET_KB w scripts/check-bundle-size.ts.
 */
export function ratchetBudgets(
  budgets: Budgets,
  measured: Readonly<Record<GatedMetric, number>>,
  headroom: number,
): Record<GatedMetric, Budget> {
  const out = {} as Record<GatedMetric, Budget>;
  for (const metric of GATED_METRICS) {
    const value = measured[metric];
    // Liczniki (bloki, preloady, obrazy) są deterministyczne - zapas tylko dla bajtów.
    const proposed = metric.endsWith("Bytes") ? Math.ceil(value * (1 + headroom)) : value;
    const previous = budgets[metric];
    const max = previous ? Math.min(previous.max, proposed) : proposed;
    out[metric] = {
      max,
      measured: value,
      ...(previous?.target !== undefined ? { target: previous.target } : {}),
    };
  }
  return out;
}

/** Mediana każdej bramkowanej metryki po próbkach (strumień daje rozrzut kilku KB). */
export function medianWeights(
  samples: readonly DocumentWeight[],
): Record<GatedMetric, { median: number; min: number; max: number }> {
  const out = {} as Record<GatedMetric, { median: number; min: number; max: number }>;
  for (const metric of GATED_METRICS) {
    const values = samples.map((s) => s[metric]).sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    const median =
      values.length % 2 ? values[mid] : Math.round((values[mid - 1] + values[mid]) / 2);
    out[metric] = { median, min: values[0], max: values[values.length - 1] };
  }
  return out;
}
