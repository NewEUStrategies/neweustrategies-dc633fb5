// INTERPRETACJA RAPORTÓW LIGHTHOUSE - warstwa CZYSTA (bez przeglądarki i plików).
//
// Wyciąga z LHR (Lighthouse 12/13) metryki, którymi oceniamy zmiany pod PSI,
// liczy mediany i różnice wobec zapisanego baseline'u oraz zrzuca audyty,
// które w tym projekcie rozstrzygają diagnozę: żądania sieciowe z priorytetami
// (rywalizacja o pasmo 1,6 Mb/s przed LCP), długie zadania, bootup per skrypt,
// nieużyty JS, rozbicie LCP i zasoby blokujące renderowanie.
//
// Port `lh-summary.py` z pakietu dowodowego 2026-10-03 (narzedzia/), żeby
// harness nie wymagał Pythona.

/** Minimalny kształt LHR, z którego korzystamy - reszta raportu jest ignorowana. */
export interface LhrAudit {
  readonly score?: number | null;
  readonly numericValue?: number;
  readonly displayValue?: string;
  readonly details?: unknown;
}

export interface Lhr {
  readonly lighthouseVersion?: string;
  readonly finalDisplayedUrl?: string;
  readonly runWarnings?: readonly string[];
  readonly environment?: { readonly benchmarkIndex?: number };
  readonly configSettings?: { readonly formFactor?: string };
  readonly categories: { readonly performance?: { readonly score?: number | null } };
  readonly audits: Readonly<Record<string, LhrAudit | undefined>>;
}

export interface NetworkRow {
  readonly url: string;
  readonly priority: string;
  readonly resourceType: string;
  readonly protocol: string;
  readonly start: number;
  readonly end: number;
  readonly transferSize: number;
  readonly resourceSize: number;
}

/** Metryki jednego przebiegu. Liczby w ms / bajtach; `score` 0-100. */
export interface RunMetrics {
  readonly score: number;
  readonly fcp: number;
  readonly lcp: number;
  readonly tbt: number;
  readonly si: number;
  readonly cls: number;
  readonly ttfb: number;
  readonly tti: number;
  readonly benchmarkIndex: number;
  readonly requests: number;
  readonly transferBytes: number;
  readonly scriptTransferBytes: number;
  readonly mainThreadMs: number;
  readonly bootupMs: number;
  readonly unusedJsBytes: number;
  readonly longTasks: number;
  readonly renderBlockingMs: number;
  /** Fazy LCP (obserwowane, nie symulowane) - ttfb/loadDelay/loadDuration/renderDelay. */
  readonly lcpTtfb: number;
  readonly lcpLoadDelay: number;
  readonly lcpLoadDuration: number;
  readonly lcpRenderDelay: number;
  /**
   * Bajty (transfer) żądań VeryHigh/High wystartowanych, zanim skończyło się
   * żądanie obrazu LCP - przybliżenie rywalizacji o pasmo, którą Lantern
   * rozkłada na łącze mobilne (EVIDENCE §10). 0, gdy LCP nie jest obrazem.
   */
  readonly highPriorityBytesBeforeLcpImage: number;
  readonly lcpElement: string;
  readonly lcpImageUrl: string;
  readonly finalPath: string;
  readonly h2Share: number;
}

export const NUMERIC_KEYS = [
  "score",
  "fcp",
  "lcp",
  "tbt",
  "si",
  "cls",
  "ttfb",
  "tti",
  "benchmarkIndex",
  "requests",
  "transferBytes",
  "scriptTransferBytes",
  "mainThreadMs",
  "bootupMs",
  "unusedJsBytes",
  "longTasks",
  "renderBlockingMs",
  "lcpTtfb",
  "lcpLoadDelay",
  "lcpLoadDuration",
  "lcpRenderDelay",
  "highPriorityBytesBeforeLcpImage",
  "h2Share",
] as const;

export type NumericKey = (typeof NUMERIC_KEYS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numericValue(lhr: Lhr, key: string): number {
  return num(lhr.audits[key]?.numericValue);
}

/** `details.items` audytu jako tablica rekordów (puste, gdy brak). */
export function auditItems(lhr: Lhr, key: string): Record<string, unknown>[] {
  const details = lhr.audits[key]?.details;
  if (!isRecord(details)) return [];
  const items = details["items"];
  if (Array.isArray(items)) return items.filter(isRecord);
  if (isRecord(items)) return [items];
  return [];
}

function detailsField(lhr: Lhr, key: string, field: string): unknown {
  const details = lhr.audits[key]?.details;
  return isRecord(details) ? details[field] : undefined;
}

export function networkRows(lhr: Lhr): NetworkRow[] {
  return auditItems(lhr, "network-requests").map((it) => ({
    url: str(it["url"]),
    priority: str(it["priority"]),
    resourceType: str(it["resourceType"]),
    protocol: str(it["protocol"]),
    start: num(it["networkRequestTime"]),
    end: num(it["networkEndTime"]),
    transferSize: num(it["transferSize"]),
    resourceSize: num(it["resourceSize"]),
  }));
}

interface LcpInfo {
  readonly selector: string;
  readonly imageUrl: string;
  readonly phases: Readonly<Record<string, number>>;
}

/** Element i fazy LCP z `lcp-breakdown-insight` (LH 13) z fallbackiem na LH 12. */
export function lcpInfo(lhr: Lhr): LcpInfo {
  const phases: Record<string, number> = {};
  let selector = "";
  let snippet = "";
  for (const key of ["lcp-breakdown-insight", "largest-contentful-paint-element"]) {
    for (const block of auditItems(lhr, key)) {
      if (block["type"] === "node") {
        selector ||= str(block["selector"]);
        snippet ||= str(block["snippet"]);
      }
      const inner = block["items"];
      if (Array.isArray(inner)) {
        for (const row of inner.filter(isRecord)) {
          const name = str(row["subpart"]) || str(row["phase"]);
          if (name) phases[name] = num(row["duration"] ?? row["timing"]);
          const node = row["node"];
          if (isRecord(node)) {
            selector ||= str(node["selector"]);
            snippet ||= str(node["snippet"]);
          }
        }
      }
    }
  }
  const src = /\bsrc="([^"]+)"/.exec(snippet);
  return { selector, imageUrl: src ? src[1].replace(/&amp;/g, "&") : "", phases };
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

function stripQuery(url: string): string {
  return url.split(/[?#]/)[0] ?? url;
}

export function extractMetrics(lhr: Lhr): RunMetrics {
  const rows = networkRows(lhr);
  const lcp = lcpInfo(lhr);
  let highBefore = 0;
  let imageUrl = lcp.imageUrl;
  // Węzeł LCP bywa odpięty z DOM po załadowaniu (slider podmienia <img>) - LH
  // podaje wtedy same fazy bez węzła. Faza `resourceLoadDuration` > 0 znaczy, że
  // LCP był obrazem: bierzemy pierwszy obraz pobierany z priorytetem High.
  if (!imageUrl && num(lcp.phases["resourceLoadDuration"]) > 0) {
    imageUrl =
      rows
        .filter((r) => r.resourceType === "Image" && r.priority === "High")
        .sort((x, y) => x.start - y.start)[0]?.url ?? "";
  }
  if (imageUrl) {
    // `src` z fragmentu HTML bywa innym kandydatem niż pobrany wariant `srcset`
    // (produkcja: `?width=1280` w src, pobrane `?width=768`), a Lighthouse ucina
    // długie fragmenty - dopasowanie: dokładne, po ścieżce, po prefiksie.
    const wanted = stripQuery(imageUrl);
    const prefix = imageUrl.replace(/…$/, "");
    const image =
      rows.find((r) => r.url === imageUrl) ??
      rows
        .filter(
          (r) =>
            r.resourceType === "Image" &&
            (stripQuery(r.url) === wanted || r.url.startsWith(prefix)),
        )
        .sort((x, y) => x.start - y.start)[0];
    if (image) {
      for (const r of rows) {
        if (r === image || r.resourceType === "Document") continue;
        if ((r.priority === "VeryHigh" || r.priority === "High") && r.start <= image.end) {
          highBefore += r.transferSize;
        }
      }
    }
  }
  const withProtocol = rows.filter((r) => r.protocol);
  const h2 = withProtocol.filter((r) => r.protocol === "h2" || r.protocol === "h3").length;
  const perfScore = lhr.categories.performance?.score;
  return {
    score: Math.round(num(perfScore) * 100),
    fcp: numericValue(lhr, "first-contentful-paint"),
    lcp: numericValue(lhr, "largest-contentful-paint"),
    tbt: numericValue(lhr, "total-blocking-time"),
    si: numericValue(lhr, "speed-index"),
    cls: numericValue(lhr, "cumulative-layout-shift"),
    ttfb: numericValue(lhr, "server-response-time"),
    tti: numericValue(lhr, "interactive"),
    benchmarkIndex: num(lhr.environment?.benchmarkIndex),
    requests: rows.length,
    transferBytes: rows.reduce((s, r) => s + r.transferSize, 0),
    scriptTransferBytes: rows
      .filter((r) => r.resourceType === "Script")
      .reduce((s, r) => s + r.transferSize, 0),
    mainThreadMs: numericValue(lhr, "mainthread-work-breakdown"),
    bootupMs: numericValue(lhr, "bootup-time"),
    unusedJsBytes: num(detailsField(lhr, "unused-javascript", "overallSavingsBytes")),
    longTasks: auditItems(lhr, "long-tasks").length,
    renderBlockingMs: num(
      detailsField(lhr, "render-blocking-insight", "overallSavingsMs") ??
        detailsField(lhr, "render-blocking-resources", "overallSavingsMs"),
    ),
    lcpTtfb: num(lcp.phases["timeToFirstByte"]),
    lcpLoadDelay: num(lcp.phases["resourceLoadDelay"]),
    lcpLoadDuration: num(lcp.phases["resourceLoadDuration"] ?? lcp.phases["resourceLoadTime"]),
    lcpRenderDelay: num(lcp.phases["elementRenderDelay"]),
    highPriorityBytesBeforeLcpImage: highBefore,
    lcpElement: lcp.selector.split(">").pop()?.trim() ?? "",
    lcpImageUrl: imageUrl,
    finalPath: pathOf(str(lhr.finalDisplayedUrl)),
    h2Share: withProtocol.length ? h2 / withProtocol.length : 0,
  };
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export type Medians = Readonly<Record<NumericKey, number>>;

export interface Aggregate {
  readonly n: number;
  readonly median: Medians;
  readonly min: Medians;
  readonly max: Medians;
  /** Najczęstszy element LCP i ścieżka końcowa (kontrola porównywalności). */
  readonly lcpElement: string;
  readonly finalPath: string;
}

function mode(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = "";
  let bestCount = -1;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

export function aggregate(runs: readonly RunMetrics[]): Aggregate {
  const pick = (fn: (values: number[]) => number): Medians => {
    const out = {} as Record<NumericKey, number>;
    for (const key of NUMERIC_KEYS) out[key] = fn(runs.map((r) => r[key]));
    return out;
  };
  return {
    n: runs.length,
    median: pick(median),
    min: pick((v) => Math.min(...v)),
    max: pick((v) => Math.max(...v)),
    lcpElement: mode(runs.map((r) => r.lcpElement)),
    finalPath: mode(runs.map((r) => r.finalPath)),
  };
}

const ms = (v: number) => `${Math.round(v)}ms`;
const sec = (v: number) => `${(v / 1000).toFixed(2)}s`;
const kb = (v: number) => `${(v / 1024).toFixed(1)}KB`;

/** Jedna linia przebiegu - format zgodny z `measure-local.sh`. */
export function formatRun(label: string, m: RunMetrics): string {
  return (
    `  ${label.padEnd(30)} perf=${String(m.score).padStart(3)} FCP=${sec(m.fcp)} LCP=${sec(m.lcp)} ` +
    `TBT=${ms(m.tbt)} SI=${sec(m.si)} CLS=${m.cls.toFixed(3)} TTFB=${ms(m.ttfb)} ` +
    `bench=${Math.round(m.benchmarkIndex)} url=${m.finalPath} lcp=${m.lcpElement || "?"}`
  );
}

export function formatMedian(label: string, a: Aggregate): string {
  const m = a.median;
  return (
    `MEDIAN ${label}: perf=${m.score.toFixed(0)} FCP=${sec(m.fcp)} LCP=${sec(m.lcp)} TBT=${ms(m.tbt)} ` +
    `SI=${sec(m.si)} CLS=${m.cls.toFixed(3)} TTFB=${ms(m.ttfb)} TTI=${sec(m.tti)} ` +
    `mainThread=${ms(m.mainThreadMs)} bootup=${ms(m.bootupMs)} longTasks=${m.longTasks} ` +
    `req=${m.requests} transfer=${kb(m.transferBytes)} js=${kb(m.scriptTransferBytes)} ` +
    `highBeforeLcpImg=${kb(m.highPriorityBytesBeforeLcpImage)} bench=${Math.round(m.benchmarkIndex)} ` +
    `(n=${a.n}, TBT ${ms(a.min.tbt)}-${ms(a.max.tbt)}, perf ${a.min.score}-${a.max.score})`
  );
}

/** Metryki, których różnicę raportujemy (kolejność = kolejność w linii DELTA). */
export const DELTA_KEYS: readonly NumericKey[] = [
  "score",
  "fcp",
  "lcp",
  "tbt",
  "si",
  "cls",
  "ttfb",
  "mainThreadMs",
  "bootupMs",
  "transferBytes",
  "scriptTransferBytes",
  "highPriorityBytesBeforeLcpImage",
  "requests",
];

function signed(key: NumericKey, v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "-" : "±";
  const a = Math.abs(v);
  if (key === "score" || key === "requests") return `${sign}${a.toFixed(0)}`;
  if (key === "cls") return `${sign}${a.toFixed(3)}`;
  if (key === "fcp" || key === "lcp" || key === "si") return `${sign}${(a / 1000).toFixed(2)}s`;
  if (key.endsWith("Bytes") || key === "highPriorityBytesBeforeLcpImage")
    return `${sign}${(a / 1024).toFixed(1)}KB`;
  return `${sign}${Math.round(a)}ms`;
}

export function deltaLine(label: string, base: Medians, current: Medians): string {
  const parts = DELTA_KEYS.map((k) => `${k}=${signed(k, current[k] - base[k])}`);
  return `DELTA ${label}: ${parts.join(" ")}`;
}

/**
 * Kontrola porównywalności: różnica w transporcie, ścieżce albo elemencie LCP
 * oznacza, że DELTA porównuje różne rzeczy (np. `/` vs redirect `/en`).
 */
export function comparabilityWarnings(
  base: { transport?: string; finalPath?: string; lcpElement?: string; benchmarkIndex?: number },
  current: { transport?: string; finalPath?: string; lcpElement?: string; benchmarkIndex?: number },
): string[] {
  const out: string[] = [];
  if (base.transport && current.transport && base.transport !== current.transport)
    out.push(`transport ${base.transport} -> ${current.transport}`);
  if (base.finalPath && current.finalPath && base.finalPath !== current.finalPath)
    out.push(`ścieżka końcowa ${base.finalPath} -> ${current.finalPath}`);
  if (base.lcpElement && current.lcpElement && base.lcpElement !== current.lcpElement)
    out.push(`element LCP ${base.lcpElement} -> ${current.lcpElement}`);
  if (base.benchmarkIndex && current.benchmarkIndex) {
    const ratio = current.benchmarkIndex / base.benchmarkIndex;
    if (ratio < 0.8 || ratio > 1.25)
      out.push(
        `benchmarkIndex ${Math.round(base.benchmarkIndex)} -> ${Math.round(current.benchmarkIndex)} ` +
          "(inna klasa CPU/obciążenia - TBT nieporównywalne)",
      );
  }
  return out;
}

function shortUrl(url: string, max = 100): string {
  const p = pathOf(url);
  const shown = /^https?:\/\/(127\.0\.0\.1|fixture\.invalid)/.test(url) ? p : url;
  return shown.length > max ? `${shown.slice(0, max - 1)}…` : shown;
}

/** Zrzut audytów, które rozstrzygają diagnozę (format tekstowy, `top` wierszy na sekcję). */
export function dumpAudits(lhr: Lhr, top = 40): string {
  const out: string[] = [];
  const m = extractMetrics(lhr);
  const push = (line = "") => out.push(line);
  push(
    `URL: ${lhr.finalDisplayedUrl ?? "?"} formFactor=${lhr.configSettings?.formFactor ?? "?"} ` +
      `LH ${lhr.lighthouseVersion ?? "?"} benchmarkIndex=${Math.round(m.benchmarkIndex)}`,
  );
  push(formatRun("run", m));
  for (const w of lhr.runWarnings ?? []) push(`  runWarning: ${w}`);

  push("\n== LCP");
  const lcp = lcpInfo(lhr);
  push(`  element: ${lcp.selector || "?"}  image: ${lcp.imageUrl || "-"}`);
  for (const [phase, d] of Object.entries(lcp.phases)) push(`  ${phase.padEnd(24)} ${ms(d)}`);
  for (const it of auditItems(lhr, "lcp-discovery-insight")) {
    const checklist = it["items"];
    if (it["type"] === "checklist" && isRecord(checklist)) {
      for (const [k, v] of Object.entries(checklist))
        push(`  discovery ${k}: ${isRecord(v) ? String(v["value"]) : "?"}`);
    }
  }

  push("\n== Render-blocking");
  push(`  savings ${ms(m.renderBlockingMs)}`);
  for (const it of [
    ...auditItems(lhr, "render-blocking-insight"),
    ...auditItems(lhr, "render-blocking-resources"),
  ])
    push(
      `  ${kb(num(it["totalBytes"]))} wasted=${ms(num(it["wastedMs"]))} ${shortUrl(str(it["url"]))}`,
    );

  const rows = networkRows(lhr).sort((a, b) => a.start - b.start);
  push(`\n== Network requests (${rows.length}, kolejność startu; transfer ${kb(m.transferBytes)})`);
  const byPriority = new Map<string, { n: number; bytes: number }>();
  for (const r of rows) {
    const e = byPriority.get(r.priority) ?? { n: 0, bytes: 0 };
    e.n += 1;
    e.bytes += r.transferSize;
    byPriority.set(r.priority, e);
  }
  for (const [p, e] of [...byPriority].sort((a, b) => b[1].bytes - a[1].bytes))
    push(`  priority ${(p || "?").padEnd(8)} n=${String(e.n).padStart(3)} transfer=${kb(e.bytes)}`);
  push(
    `  highPriorityBytesBeforeLcpImage=${kb(m.highPriorityBytesBeforeLcpImage)} h2Share=${m.h2Share.toFixed(2)}`,
  );
  push(
    `  ${"start".padStart(6)} ${"end".padStart(6)} ${"prio".padEnd(8)} ${"type".padEnd(10)} ${"transfer".padStart(9)} ${"proto".padEnd(8)} url`,
  );
  for (const r of rows.slice(0, top))
    push(
      `  ${String(Math.round(r.start)).padStart(6)} ${String(Math.round(r.end)).padStart(6)} ` +
        `${r.priority.padEnd(8)} ${r.resourceType.padEnd(10)} ${String(r.transferSize).padStart(9)} ` +
        `${r.protocol.padEnd(8)} ${shortUrl(r.url)}`,
    );

  push("\n== Main thread breakdown");
  push(`  total ${ms(m.mainThreadMs)}`);
  for (const it of auditItems(lhr, "mainthread-work-breakdown"))
    push(`  ${str(it["groupLabel"]).padEnd(36)} ${ms(num(it["duration"]))}`);

  push("\n== Bootup time per script");
  push(`  total ${ms(m.bootupMs)}`);
  for (const it of auditItems(lhr, "bootup-time")
    .sort((a, b) => num(b["total"]) - num(a["total"]))
    .slice(0, top))
    push(
      `  total=${ms(num(it["total"])).padStart(7)} script=${ms(num(it["scripting"])).padStart(7)} ` +
        `parse=${ms(num(it["scriptParseCompile"])).padStart(6)} ${shortUrl(str(it["url"]))}`,
    );

  push("\n== Unused JavaScript");
  push(`  savings ${kb(m.unusedJsBytes)}`);
  for (const it of auditItems(lhr, "unused-javascript")
    .sort((a, b) => num(b["wastedBytes"]) - num(a["wastedBytes"]))
    .slice(0, top))
    push(
      `  wasted=${kb(num(it["wastedBytes"])).padStart(9)} of ${kb(num(it["totalBytes"])).padStart(9)} ` +
        `(${Math.round(num(it["wastedPercent"]))}%) ${shortUrl(str(it["url"]))}`,
    );

  push("\n== Long tasks");
  for (const it of auditItems(lhr, "long-tasks").slice(0, top))
    push(
      `  start=${String(Math.round(num(it["startTime"]))).padStart(6)} dur=${ms(num(it["duration"])).padStart(6)} ` +
        `${shortUrl(str(it["url"]))}`,
    );
  return out.join("\n");
}
