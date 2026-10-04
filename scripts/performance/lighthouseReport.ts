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
export interface ComparableSide {
  transport?: string;
  finalPath?: string;
  lcpElement?: string;
  benchmarkIndex?: number;
  /** Flagi harnessu (`client-backend=…,third-party=…`); brak = zapis sprzed P0.1 (bez flag). */
  flags?: string;
}

export function comparabilityWarnings(base: ComparableSide, current: ComparableSide): string[] {
  const out: string[] = [];
  if (base.transport && current.transport && base.transport !== current.transport)
    out.push(`transport ${base.transport} -> ${current.transport}`);
  if (current.flags !== undefined && (base.flags ?? NO_FLAGS) !== current.flags)
    out.push(
      `flagi harnessu ${base.flags ?? NO_FLAGS} -> ${current.flags} (inny backend/tag - delta nieporównywalna)`,
    );
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

// ─────────────────────────────────────────────────────────────────────────────
// FORMY POMIARU (P0.1, 2026-10-04)
//
// `desktop` przy x1 na tym sandboksie daje TBT 0, a PSI desktop mierzy 740 ms -
// host PSI jest wielokrotnie wolniejszy (EVIDENCE §1). `desktop4x`/`desktop5x`
// to preset desktopowy (sieć, ekran, UA) z mnożnikiem CPU Lantern x4/x5
// (werdykt LA-C1: model analityka stawia host PSI desktop bliżej x5). Mnożnik
// jest SYMULOWANY (throttlingMethod=simulate), więc obserwowany ślad jest ten
// sam co przy x1, a TBT liczy Lantern z czasów x mult (Layout: x mult/2).

export type FormName = "mobile" | "desktop" | "desktop4x" | "desktop5x";

/** Opis flag harnessu w zapisach (summary/baseline); wartość domyślna = bez flag. */
export const NO_FLAGS = "client-backend=none,third-party=none";

export function flagsLabel(clientBackend: string, thirdParty: string): string {
  return `client-backend=${clientBackend},third-party=${thirdParty}`;
}

export interface FormSpec {
  readonly name: FormName;
  /** Forma PSI, z którą porównujemy (kalibracja k). */
  readonly psiForm: "mobile" | "desktop";
  /** Dodatkowe argumenty CLI Lighthouse'a. */
  readonly args: readonly string[];
}

export const FORMS: Readonly<Record<FormName, FormSpec>> = {
  mobile: { name: "mobile", psiForm: "mobile", args: [] },
  desktop: { name: "desktop", psiForm: "desktop", args: ["--preset=desktop"] },
  desktop4x: {
    name: "desktop4x",
    psiForm: "desktop",
    args: ["--preset=desktop", "--throttling.cpuSlowdownMultiplier=4"],
  },
  desktop5x: {
    name: "desktop5x",
    psiForm: "desktop",
    args: ["--preset=desktop", "--throttling.cpuSlowdownMultiplier=5"],
  },
};

export function isFormName(value: string): value is FormName {
  return Object.hasOwn(FORMS, value);
}

/** `mobile,desktop4x` -> lista form; nieznana forma = błąd (literówka nie może zmierzyć czegoś innego). */
export function parseForms(spec: string): FormName[] {
  const out: FormName[] = [];
  for (const raw of spec.split(",")) {
    const name = raw.trim();
    if (!name) continue;
    if (!isFormName(name))
      throw new Error(`Nieznana forma: ${name} (dozwolone: ${Object.keys(FORMS).join(", ")})`);
    if (!out.includes(name)) out.push(name);
  }
  if (!out.length) throw new Error("Pusta lista form");
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// WAŻNOŚĆ PRZEBIEGU: STAN CACHE DOKUMENTU I RENDER SSR W TRAKCIE (werdykt M1 #1)
//
// Okno świeżości wpisu cache dokumentu to 3 min (DOCUMENT_CACHE_MAX_FRESH_MS).
// Rozgrzewka raz na serię kończyła się dokumentem STALE w środku serii i
// rewalidacją SSR w tym samym procesie Node, który serwuje wszystkie JS/CSS -
// asymetrycznie między A i B (ab-h1-h2: A 4x, B 2x). Dlatego: rozgrzanie przed
// KAŻDYM przebiegiem, a przebieg, w którym Lighthouse dostał dokument inny niż
// HIT albo w trakcie którego serwer renderował SSR, jest `excluded` i powtarzany.

/** Nagłówki cache jednej odpowiedzi dokumentu (rozgrzewka, front albo devtoolsLog LH). */
export interface DocumentObservation {
  readonly source: "warm" | "front" | "devtools";
  readonly status: number;
  /** `x-nes-cache`: HIT | STALE | MISS | BYPASS; null = brak nagłówka. */
  readonly cache: string | null;
  /** `x-nes-cache-age` w sekundach; null = brak. */
  readonly ageS: number | null;
  readonly serverTiming: string | null;
}

/** Linia `{"kind":"doc",...}` z logu serwera artefaktu (`src/server.ts` logDocument). */
export interface ServerLogDoc {
  readonly path: string;
  readonly status: number;
  readonly cache: string | null;
  /** true = odświeżenie w tle (stale-while-revalidate), czyli render SSR. */
  readonly revalidation: boolean;
  readonly appMs: number;
}

type HeaderSource =
  Headers | Readonly<Record<string, string | readonly string[] | number | undefined>>;

function headerValue(headers: HeaderSource, name: string): string | null {
  if (headers instanceof Headers) return headers.get(name);
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== name) continue;
    if (value === undefined) return null;
    return Array.isArray(value) ? value.join(", ") : String(value);
  }
  return null;
}

/** Obserwacja dokumentu z nagłówków odpowiedzi (Headers z fetch albo rekord z CDP / node:http). */
export function observeDocument(
  source: DocumentObservation["source"],
  status: number,
  headers: HeaderSource,
): DocumentObservation {
  const age = headerValue(headers, "x-nes-cache-age");
  const parsedAge = age === null ? Number.NaN : Number.parseFloat(age);
  return {
    source,
    status,
    cache: headerValue(headers, "x-nes-cache")?.trim().toUpperCase() || null,
    ageS: Number.isFinite(parsedAge) ? parsedAge : null,
    serverTiming: headerValue(headers, "server-timing"),
  };
}

/** Linie `kind: doc` z fragmentu logu serwera (pozostałe linie są ignorowane). */
export function parseServerLogDocs(text: string): ServerLogDoc[] {
  const out: ServerLogDoc[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.includes('"kind":"doc"')) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!isRecord(parsed) || parsed["kind"] !== "doc") continue;
      out.push({
        path: str(parsed["path"]),
        status: num(parsed["status"]),
        cache: typeof parsed["cache"] === "string" ? parsed["cache"] : null,
        revalidation: parsed["revalidation"] === true,
        appMs: num(parsed["appMs"]),
      });
    } catch {
      /* obcięta linia na granicy odczytu - pomijamy */
    }
  }
  return out;
}

/** Czy linia logu oznacza render SSR w procesie serwera (MISS albo rewalidacja w tle). */
export function isServerRender(doc: ServerLogDoc): boolean {
  return doc.revalidation || doc.cache === "MISS" || doc.cache === null;
}

export interface RunValidity {
  readonly excluded: boolean;
  readonly reasons: readonly string[];
}

/**
 * Ważność przebiegu. `document` = odpowiedź, którą dostał Lighthouse (log
 * frontu), `devtools` = ta sama odpowiedź z devtoolsLog (kontrola krzyżowa,
 * gdy zapisujemy artefakty), `serverDocs` = linie logów serwerów dopisane
 * W TRAKCIE przebiegu, `rewarmOk` = rozgrzewka skończyła się świeżym HIT-em.
 * Przebieg jest ważny wyłącznie, gdy dokument był HIT i żaden serwer nie
 * renderował SSR.
 */
export function classifyRun(input: {
  readonly document: DocumentObservation | null;
  readonly serverDocs: readonly ServerLogDoc[];
  readonly devtools?: DocumentObservation | null;
  readonly rewarmOk?: boolean;
}): RunValidity {
  const reasons: string[] = [];
  const doc = input.document;
  if (!doc) reasons.push("brak odpowiedzi dokumentu w logu frontu");
  else if (doc.cache !== "HIT")
    reasons.push(`dokument ${doc.cache ?? "bez x-nes-cache"} (status ${doc.status})`);
  const dev = input.devtools;
  if (dev && dev.cache !== "HIT" && dev.cache !== doc?.cache)
    reasons.push(`devtoolsLog: dokument ${dev.cache ?? "bez x-nes-cache"}`);
  if (input.rewarmOk === false) reasons.push("rozgrzewka bez świeżego HIT (limit czasu)");
  const renders = input.serverDocs.filter(isServerRender);
  if (renders.length) {
    const kinds = renders.map((r) => (r.revalidation ? "rewalidacja" : (r.cache ?? "render")));
    reasons.push(`SSR w trakcie przebiegu: ${renders.length}x (${[...new Set(kinds)].join(", ")})`);
  }
  return { excluded: reasons.length > 0, reasons };
}

/** `nes-edge;desc="HIT", app;dur=1` -> `nes-edge=HIT,app=1` (pełna wartość zostaje w summary.json). */
export function compactServerTiming(value: string | null): string {
  if (!value) return "-";
  return value
    .split(",")
    .map((entry) => {
      const [name = "", ...params] = entry.trim().split(";");
      const param = (key: string) =>
        params
          .map((p) => p.trim())
          .find((p) => p.startsWith(`${key}=`))
          ?.slice(key.length + 1)
          .replace(/^"|"$/g, "");
      const shown = param("desc") ?? param("dur");
      return shown === undefined ? name : `${name}=${shown}`;
    })
    .filter(Boolean)
    .join(",");
}

/** Jedna linia logu stanu cache przebiegu. */
export function formatObservation(o: DocumentObservation | null): string {
  if (!o) return "-";
  const age = o.ageS === null ? "-" : `${o.ageS}s`;
  return `${o.cache ?? "-"} age=${age} st=${compactServerTiming(o.serverTiming)}`;
}

/**
 * Odpowiedź dokumentu głównej ramki z devtoolsLog Lighthouse'a (pierwsze
 * `Network.responseReceived` typu Document) - to, co przeglądarka NAPRAWDĘ dostała.
 */
export function documentFromDevtoolsLog(log: unknown): DocumentObservation | null {
  if (!Array.isArray(log)) return null;
  for (const entry of log) {
    if (!isRecord(entry) || entry["method"] !== "Network.responseReceived") continue;
    const params = entry["params"];
    if (!isRecord(params) || params["type"] !== "Document") continue;
    const response = params["response"];
    if (!isRecord(response)) continue;
    const headers = response["headers"];
    const flat: Record<string, string> = {};
    if (isRecord(headers)) for (const [k, v] of Object.entries(headers)) flat[k] = String(v);
    return observeDocument("devtools", num(response["status"]), flat);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// A/A I MINIMALNY WYKRYWALNY EFEKT
//
// Dla par przebiegów (A_n, B_n z tej samej rundy przeplotu): σΔ = odchylenie
// standardowe (n-1) różnic B-A, MDE = 2,8·σΔ/√n (test sparowany, α 0,05
// dwustronnie, moc 0,8: 1,96 + 0,84). Pozycja, której oczekiwany efekt jest
// mniejszy niż MDE, NIE jest oceniana medianą, tylko księgą per zadanie.

export interface PairedStat {
  readonly key: NumericKey;
  readonly n: number;
  readonly meanDelta: number;
  readonly sdDelta: number;
  readonly mde: number;
}

export const PAIRED_KEYS: readonly NumericKey[] = ["score", "fcp", "lcp", "tbt", "si", "tti"];

export function pairedStats(
  pairs: readonly (readonly [RunMetrics, RunMetrics])[],
  keys: readonly NumericKey[] = PAIRED_KEYS,
): PairedStat[] {
  return keys.map((key) => {
    const deltas = pairs.map(([a, b]) => b[key] - a[key]);
    const n = deltas.length;
    const mean = n ? deltas.reduce((s, v) => s + v, 0) / n : Number.NaN;
    const variance = n > 1 ? deltas.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : Number.NaN;
    const sd = Math.sqrt(variance);
    return {
      key,
      n,
      meanDelta: mean,
      sdDelta: sd,
      mde: n > 1 ? (2.8 * sd) / Math.sqrt(n) : Number.NaN,
    };
  });
}

function statValue(key: NumericKey, v: number): string {
  if (!Number.isFinite(v)) return "-";
  if (key === "fcp" || key === "lcp" || key === "si" || key === "tti")
    return `${(v / 1000).toFixed(3)}s`;
  if (key === "score") return v.toFixed(1);
  return `${Math.round(v)}ms`;
}

export function formatPairedStats(label: string, stats: readonly PairedStat[]): string {
  const n = stats[0]?.n ?? 0;
  const parts = stats.map(
    (s) =>
      `${s.key}: Δ=${statValue(s.key, s.meanDelta)} σΔ=${statValue(s.key, s.sdDelta)} MDE=${statValue(s.key, s.mde)}`,
  );
  return `PAIRS ${label} (n=${n}): ${parts.join(" | ")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// KALIBRACJA FIXTURE -> PSI (krytyka M8)
//
// k = TBT_PSI / TBT_fixture_z_flagami per forma. PSI 2026-10-03 18:58 CEST
// (EVIDENCE §1, raporty użytkownika, hl=pl). Mediany JSON-ów PSI z D13
// zastąpią te liczby, gdy powstaną (`--psi-reference plik.json`).

export interface PsiReference {
  readonly label: string;
  readonly forms: Readonly<Record<"mobile" | "desktop", Partial<Record<NumericKey, number>>>>;
}

export const PSI_REFERENCE_2026_10_03: PsiReference = {
  label: "PSI 2026-10-03 18:58 CEST (hl=pl)",
  forms: {
    mobile: { score: 53, fcp: 3100, lcp: 6600, tbt: 600, si: 4900, cls: 0 },
    desktop: { score: 70, fcp: 600, lcp: 1100, tbt: 740, si: 1500, cls: 0 },
  },
};

/** k = PSI / fixture; NaN, gdy fixture = 0 (TBT 0 nie kalibruje niczego). */
export function calibrationK(psi: number, fixture: number): number {
  return fixture > 0 && Number.isFinite(psi) ? psi / fixture : Number.NaN;
}

export function formatCalibration(
  form: FormName,
  fixture: Medians,
  reference: PsiReference = PSI_REFERENCE_2026_10_03,
): string {
  const psi = reference.forms[FORMS[form].psiForm];
  const tbtPsi = psi.tbt ?? Number.NaN;
  const k = calibrationK(tbtPsi, fixture.tbt);
  const flag =
    Number.isFinite(k) && Math.abs(k - 1) > 0.2 ? " (|k-1| > 0,2: przelicz cele fixture)" : "";
  return (
    `K ${form}: TBT fixture=${ms(fixture.tbt)} PSI(${FORMS[form].psiForm})=${ms(tbtPsi)} ` +
    `k=${Number.isFinite(k) ? k.toFixed(2) : "-"}${flag} [${reference.label}]`
  );
}

/** Wczytanie `--psi-reference` (np. mediany JSON-ów PSI z D13) z walidacją kształtu. */
export function parsePsiReference(value: unknown): PsiReference {
  if (!isRecord(value) || Array.isArray(value))
    throw new Error("psi-reference: oczekiwany obiekt JSON");
  const forms = value["forms"];
  if (!isRecord(forms)) throw new Error("psi-reference: brak `forms`");
  const pick = (name: "mobile" | "desktop"): Partial<Record<NumericKey, number>> => {
    const raw = forms[name];
    if (!isRecord(raw)) throw new Error(`psi-reference: brak formy ${name}`);
    const out: Partial<Record<NumericKey, number>> = {};
    for (const key of NUMERIC_KEYS) {
      const v = raw[key];
      if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    }
    if (out.tbt === undefined) throw new Error(`psi-reference: forma ${name} bez liczby \`tbt\``);
    return out;
  };
  return {
    label: str(value["label"]) || "psi-reference",
    forms: { mobile: pick("mobile"), desktop: pick("desktop") },
  };
}

/** Próg A/A z planu (P0.1): mediany FCP i LCP obu stron różnią się o ≤ 0,02 s. */
export const AA_TOLERANCE_MS = 20;

export function formatAaCheck(form: string, a: Medians, b: Medians): string {
  const dFcp = Math.abs(b.fcp - a.fcp);
  const dLcp = Math.abs(b.lcp - a.lcp);
  const ok = dFcp <= AA_TOLERANCE_MS && dLcp <= AA_TOLERANCE_MS;
  return (
    `AA ${form}: |ΔFCP|=${(dFcp / 1000).toFixed(3)}s |ΔLCP|=${(dLcp / 1000).toFixed(3)}s ` +
    `${ok ? "OK (≤ 0,02 s)" : "PONAD PRÓG 0,02 s (sprawdź tryb FCP przebiegów)"}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SERIA: POWTÓRKI PRZEBIEGÓW `excluded` I PARY A/B

/** Ile razy najwyżej powtarzamy przebieg `excluded` (PLAN P0.1 pkt 4). */
export const MAX_EXCLUDED_REPEATS = 2;

/**
 * Próba + do `repeats` powtórek, dopóki próba jest nieważna. Zwraca WSZYSTKIE
 * próby (do logu i summary.json); ważna jest co najwyżej ostatnia.
 */
export async function runWithRepeats<T extends { readonly valid: boolean }>(
  attempt: (index: number) => Promise<T>,
  repeats: number = MAX_EXCLUDED_REPEATS,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i <= Math.max(0, repeats); i++) {
    const result = await attempt(i);
    out.push(result);
    if (result.valid) break;
  }
  return out;
}

/** Minimalny kształt rekordu przebiegu w summary.json, z którego liczymy pary i `n_valid`. */
export interface RunRecordLike {
  readonly n: number;
  readonly valid: boolean;
  readonly reasons?: readonly string[];
  readonly metrics?: RunMetrics | null;
}

/** Pary (A_n, B_n) z tej samej rundy przeplotu, w których OBA przebiegi są ważne. */
export function validPairs(
  a: readonly RunRecordLike[],
  b: readonly RunRecordLike[],
): [RunMetrics, RunMetrics][] {
  const byN = (list: readonly RunRecordLike[]) => {
    const map = new Map<number, RunMetrics>();
    for (const r of list) if (r.valid && r.metrics) map.set(r.n, r.metrics);
    return map;
  };
  const left = byN(a);
  const right = byN(b);
  const out: [RunMetrics, RunMetrics][] = [];
  for (const [n, m] of [...left].sort((x, y) => x[0] - y[0])) {
    const other = right.get(n);
    if (other) out.push([m, other]);
  }
  return out;
}

export interface ValiditySummary {
  /** Rundy z ważnym przebiegiem. */
  readonly nValid: number;
  /** Rundy (różne `n`). */
  readonly rounds: number;
  /** Próby oznaczone `excluded` (także te, po których powtórka się udała). */
  readonly excludedAttempts: number;
  /** Powód (bez liczb w nawiasach) -> liczba prób. */
  readonly reasons: Readonly<Record<string, number>>;
}

export function summarizeValidity(records: readonly RunRecordLike[]): ValiditySummary {
  const rounds = new Set(records.map((r) => r.n));
  const valid = new Set(records.filter((r) => r.valid).map((r) => r.n));
  const reasons: Record<string, number> = {};
  let excludedAttempts = 0;
  for (const r of records) {
    if (r.valid) continue;
    excludedAttempts += 1;
    for (const reason of r.reasons ?? []) {
      const key = reason.replace(/\s*\(.*\)$/, "").replace(/: \d+x$/, "");
      reasons[key] = (reasons[key] ?? 0) + 1;
    }
  }
  return { nValid: valid.size, rounds: rounds.size, excludedAttempts, reasons };
}

export function formatValidity(label: string, s: ValiditySummary): string {
  const why = Object.entries(s.reasons)
    .map(([k, v]) => `${k} x${v}`)
    .join("; ");
  return (
    `VALID ${label}: n_valid=${s.nValid}/${s.rounds} excluded=${s.excludedAttempts}` +
    (why ? ` (${why})` : "")
  );
}
