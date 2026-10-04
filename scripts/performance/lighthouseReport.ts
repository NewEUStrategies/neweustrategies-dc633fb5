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
//
// P0.1-FIX (recenzja B1, I2, I3, D1): HIT nie wystarcza. Ten sam klucz cache
// trzyma różne WARIANTY dokumentu (pełny render, render ze zdegradowanym
// chrome'em `s-maxage=30`, wariant bota), a `x-nes-cache` jest w nich identyczne.
// Przebieg mierzy więc wariant wzorcowy serii (odcisk: polityka `cache-control`
// wpisu + długość body), przy obciążeniu ≤ `--max-load` i bez renderu SSR
// (także BYPASS) w trakcie.

/**
 * Górny pułap świeżości wpisu cache dokumentu w artefakcie, w sekundach:
 * `DOCUMENT_CACHE_MAX_FRESH_MS` z `src/lib/http/documentCache.ts`. Tu stała,
 * bo skrypty Node nie rozwiązują importów `src/` bez rozszerzeń; równość
 * pilnuje test synchronizacji w `harness-ext.test.mjs` (czyta tekst tamtego
 * pliku). Świeżość KONKRETNEGO wpisu to min(s-maxage, ten pułap)
 * (`documentStorePolicy`), więc stała jest wyłącznie górnym limitem.
 */
export const DOCUMENT_FRESH_WINDOW_S = 180;

/** Nagłówki cache jednej odpowiedzi dokumentu (rozgrzewka, front albo devtoolsLog LH). */
export interface DocumentObservation {
  readonly source: "warm" | "front" | "devtools";
  readonly status: number;
  /** `x-nes-cache`: HIT | STALE | MISS | BYPASS; null = brak nagłówka. */
  readonly cache: string | null;
  /** `x-nes-cache-age` w sekundach; null = brak. */
  readonly ageS: number | null;
  readonly serverTiming: string | null;
  /**
   * `cache-control` odpowiedzi. Na HIT/STALE magazyn odtwarza politykę
   * ZAPISANEGO wpisu, więc to część odcisku wariantu (pełny render:
   * `s-maxage=900`; zdegradowany chrome: `s-maxage=30`).
   */
  readonly cacheControl: string | null;
  /** Świeżość wpisu w magazynie: min(s-maxage, `DOCUMENT_FRESH_WINDOW_S`); null = brak s-maxage. */
  readonly freshS: number | null;
  /** Długość body bez kompresji (B); null = nieznana (devtoolsLog, strumień bez końca). */
  readonly bytes: number | null;
}

/** `s-maxage` z `cache-control` w sekundach; null = brak dyrektywy. */
export function sharedMaxAge(cacheControl: string | null): number | null {
  if (!cacheControl) return null;
  const match = /(?:^|[,\s])s-maxage\s*=\s*"?(\d+)/i.exec(cacheControl);
  return match ? Number.parseInt(match[1], 10) : null;
}

/** Świeżość wpisu w magazynie artefaktu (jak `documentStorePolicy`): min(s-maxage, pułap). */
export function entryFreshS(cacheControl: string | null): number | null {
  const sMaxAge = sharedMaxAge(cacheControl);
  return sMaxAge === null ? null : Math.min(sMaxAge, DOCUMENT_FRESH_WINDOW_S);
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

/**
 * Obserwacja dokumentu z nagłówków odpowiedzi (Headers z fetch albo rekord z CDP / node:http).
 * `bytes` = długość body bez kompresji, jeśli wołający ją zna (rozgrzewka, front).
 */
export function observeDocument(
  source: DocumentObservation["source"],
  status: number,
  headers: HeaderSource,
  bytes: number | null = null,
): DocumentObservation {
  const age = headerValue(headers, "x-nes-cache-age");
  const parsedAge = age === null ? Number.NaN : Number.parseFloat(age);
  const cacheControl = headerValue(headers, "cache-control");
  return {
    source,
    status,
    cache: headerValue(headers, "x-nes-cache")?.trim().toUpperCase() || null,
    ageS: Number.isFinite(parsedAge) ? parsedAge : null,
    serverTiming: headerValue(headers, "server-timing"),
    cacheControl,
    freshS: entryFreshS(cacheControl),
    bytes: bytes !== null && Number.isFinite(bytes) ? bytes : null,
  };
}

// ── odcisk wariantu dokumentu (B1) ──────────────────────────────────────────

/** Odcisk wariantu: polityka `cache-control` wpisu + długość body bez kompresji. */
export interface DocumentVariant {
  readonly cacheControl: string | null;
  readonly bytes: number | null;
}

/**
 * Tolerancja długości body w obrębie JEDNEGO wariantu (B). Zmierzone
 * 2026-10-04 na artefakcie 3ac0f43 (jeden port): pełny render 390 950 B
 * w 3/3 zimnych renderach, render rewalidacji (zdegradowany chrome)
 * 391 141 B w 3/3, czyli +191 B (recenzja: 391 040 vs 391 231 B, też +191 B).
 * Wariant bota jest o ~9 KB krótszy. 64 B rozdziela je z zapasem, a nie
 * wyklucza przebiegu za drobną różnicę liczby w danych.
 */
export const VARIANT_BYTES_TOLERANCE = 64;

export function documentVariant(
  o: Pick<DocumentObservation, "cacheControl" | "bytes">,
): DocumentVariant {
  return { cacheControl: o.cacheControl, bytes: o.bytes };
}

/** Dyrektywy bez względu na kolejność, wielkość liter i spacje wokół `=`. */
function normalizeCacheControl(value: string | null): string | null {
  if (!value) return null;
  return value
    .split(",")
    .map((part) =>
      part
        .trim()
        .toLowerCase()
        .replace(/\s*=\s*/, "="),
    )
    .filter(Boolean)
    .sort()
    .join(", ");
}

/** `s-maxage=30, 391231 B` (polityka skrócona do s-maxage, gdy jest). */
export function formatVariant(v: DocumentVariant | null | undefined): string {
  if (!v) return "-";
  const sMaxAge = sharedMaxAge(v.cacheControl);
  const policy = sMaxAge !== null ? `s-maxage=${sMaxAge}` : (v.cacheControl ?? "bez cache-control");
  return v.bytes === null ? policy : `${policy}, ${v.bytes} B`;
}

/**
 * Powód niezgodności wariantu z wzorcem albo null. Różna polityka
 * `cache-control` albo długość body poza tolerancją = inny dokument. Pole
 * nieznane po którejś stronie (devtoolsLog nie zna bajtów) nie rozstrzyga.
 */
export function variantMismatch(
  reference: DocumentVariant,
  observed: DocumentVariant,
  toleranceBytes: number = VARIANT_BYTES_TOLERANCE,
): string | null {
  const refPolicy = normalizeCacheControl(reference.cacheControl);
  const obsPolicy = normalizeCacheControl(observed.cacheControl);
  const policyDiffers = refPolicy !== null && obsPolicy !== null && refPolicy !== obsPolicy;
  const bytesDiffer =
    reference.bytes !== null &&
    observed.bytes !== null &&
    Math.abs(observed.bytes - reference.bytes) > toleranceBytes;
  if (!policyDiffers && !bytesDiffer) return null;
  return `wariant dokumentu (${formatVariant(observed)}; wzorzec ${formatVariant(reference)})`;
}

/**
 * Wpis z pełną świeżością magazynu (s-maxage ≥ pułap) - tak wygląda pełny
 * render (`contentCacheControl`, s-maxage=900). Render ze zdegradowanym
 * chrome'em ma s-maxage=30 i NIE nadaje się na wzorzec serii.
 */
export function isFullFreshness(o: Pick<DocumentObservation, "freshS">): boolean {
  return o.freshS !== null && o.freshS >= DOCUMENT_FRESH_WINDOW_S;
}

/**
 * Odpowiedź, która nigdy nie stanie się HIT-em (I3): redirect albo błąd
 * (3xx-5xx), brak `x-nes-cache` (trasa poza mechanizmem cache) albo BYPASS.
 * Null = odpowiedź z mechanizmu cache (HIT/STALE/MISS).
 */
export function uncachedReason(o: Pick<DocumentObservation, "status" | "cache">): string | null {
  if (o.status >= 300) return `status ${o.status}`;
  if (o.cache === null) return "brak x-nes-cache";
  if (o.cache === "BYPASS") return "BYPASS";
  return null;
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

/** Odpowiedź z magazynu (HIT/STALE) - jedyne statusy, za którymi nie stoi render SSR. */
function servedFromCache(cache: string | null): boolean {
  const status = cache?.toUpperCase() ?? null;
  return status === "HIT" || status === "STALE";
}

/**
 * Czy linia logu oznacza render SSR w procesie serwera: rewalidacja w tle
 * albo każda odpowiedź spoza magazynu (MISS, BYPASS, brak statusu). BYPASS to
 * też pełny render (recenzja D1).
 */
export function isServerRender(doc: ServerLogDoc): boolean {
  return doc.revalidation || !servedFromCache(doc.cache);
}

export interface RunValidity {
  readonly excluded: boolean;
  readonly reasons: readonly string[];
}

const decimal = (v: number) => v.toFixed(1).replace(".", ",");

/**
 * Ważność przebiegu. `document` = odpowiedź, którą dostał Lighthouse (log
 * frontu), `devtools` = ta sama odpowiedź z devtoolsLog (kontrola krzyżowa,
 * gdy zapisujemy artefakty), `serverDocs` = linie logów serwerów dopisane
 * W TRAKCIE przebiegu, `rewarmOk` = rozgrzewka skończyła się świeżym HIT-em
 * wariantu wzorcowego. Przebieg jest ważny wyłącznie, gdy:
 *   - dokument był HIT i ma wariant wzorcowy serii (`referenceVariant`, B1),
 *   - żaden serwer nie renderował SSR (D1: także BYPASS),
 *   - loadavg przed przebiegiem ≤ `maxLoad` (I2).
 * `allowUncached` (`--allow-uncached`, I3): dokument nie musi być HIT, a render
 * każdego dokumentu podanego przez front w trakcie przebiegu (`runDocuments`,
 * czyli samej nawigacji Lighthouse'a) jest dozwolony; każdy inny render,
 * w tym rewalidacja w tle, nadal wyklucza.
 */
export function classifyRun(input: {
  readonly document: DocumentObservation | null;
  readonly serverDocs: readonly ServerLogDoc[];
  readonly devtools?: DocumentObservation | null;
  readonly rewarmOk?: boolean;
  /** Wariant wzorcowy serii (rozgrzewka początkowa); null/brak = bez kontroli wariantu. */
  readonly referenceVariant?: DocumentVariant | null;
  readonly variantToleranceBytes?: number;
  /** loadavg(1 min) zmierzony przed przebiegiem. */
  readonly load?: number;
  /** Próg `--max-load`; brak = bez bramki obciążenia. */
  readonly maxLoad?: number;
  readonly allowUncached?: boolean;
  /** Dokumenty podane przez front W TRAKCIE przebiegu (tylko `allowUncached`). */
  readonly runDocuments?: readonly DocumentObservation[];
}): RunValidity {
  const reasons: string[] = [];
  const doc = input.document;
  const allowUncached = input.allowUncached === true;
  if (!doc) {
    if (!allowUncached) reasons.push("brak odpowiedzi dokumentu w logu frontu");
  } else if (doc.cache !== "HIT" && !allowUncached)
    reasons.push(`dokument ${doc.cache ?? "bez x-nes-cache"} (status ${doc.status})`);
  const dev = input.devtools;
  if (dev && dev.cache !== "HIT" && dev.cache !== doc?.cache && !allowUncached)
    reasons.push(`devtoolsLog: dokument ${dev.cache ?? "bez x-nes-cache"}`);
  const reference = input.referenceVariant;
  if (reference) {
    const tolerance = input.variantToleranceBytes ?? VARIANT_BYTES_TOLERANCE;
    const docMismatch = doc ? variantMismatch(reference, documentVariant(doc), tolerance) : null;
    // devtoolsLog nie zna bajtów - porównuje samą politykę wpisu.
    const devMismatch =
      dev && !docMismatch
        ? variantMismatch(reference, { cacheControl: dev.cacheControl, bytes: null }, tolerance)
        : null;
    if (docMismatch) reasons.push(docMismatch);
    else if (devMismatch) reasons.push(`devtoolsLog: ${devMismatch}`);
  }
  if (input.rewarmOk === false) reasons.push("rozgrzewka bez świeżego HIT wariantu wzorcowego");
  const renders = input.serverDocs.filter(isServerRender);
  // Render samej nawigacji LH (tylko --allow-uncached): po jednym na dokument spoza magazynu.
  let allowed = allowUncached
    ? (input.runDocuments ?? (doc ? [doc] : [])).filter((d) => !servedFromCache(d.cache)).length
    : 0;
  const excess = renders.filter((r) => {
    if (!r.revalidation && allowed > 0) {
      allowed -= 1;
      return false;
    }
    return true;
  });
  if (excess.length) {
    const kinds = excess.map((r) => (r.revalidation ? "rewalidacja" : (r.cache ?? "render")));
    reasons.push(`SSR w trakcie przebiegu: ${excess.length}x (${[...new Set(kinds)].join(", ")})`);
  }
  if (
    input.load !== undefined &&
    input.maxLoad !== undefined &&
    Number.isFinite(input.load) &&
    Number.isFinite(input.maxLoad) &&
    input.load > input.maxLoad
  )
    reasons.push(`obciążenie (${decimal(input.load)} > ${decimal(input.maxLoad)})`);
  return { excluded: reasons.length > 0, reasons };
}

/**
 * Jedna próba przebiegu harnessu tak, jak widzi ją `lighthouse-local.mjs`
 * (P0.1-FIX, runda 2, D8): komplet wejść `classifyRun` w jednym miejscu, żeby
 * test obejmował całe okablowanie (wariant wzorcowy, wynik rozgrzewki, oba
 * pomiary obciążenia, `--allow-uncached`), a nie tylko samą regułę.
 */
export interface AttemptObservation {
  /** Lighthouse oddał LHR (false = błąd wykonania po powtórce). */
  readonly lhrOk: boolean;
  readonly document: DocumentObservation | null;
  readonly serverDocs: readonly ServerLogDoc[];
  readonly devtools: DocumentObservation | null;
  readonly rewarmOk: boolean;
  readonly referenceVariant: DocumentVariant | null;
  /** loadavg(1 min) po czekaniu na bezczynność, PRZED rozgrzewką (i ewentualnym restartem). */
  readonly loadBefore: number;
  /** loadavg(1 min) PO rozgrzewce, tuż przed startem Lighthouse'a (restart serwera też obciąża). */
  readonly loadAfter: number;
  readonly maxLoad: number;
  readonly allowUncached: boolean;
  readonly runDocuments: readonly DocumentObservation[];
}

/**
 * Ważność próby. Bramka obciążenia bierze WIĘKSZY z dwóch pomiarów: przed
 * rozgrzewką (stan po czekaniu) i po niej (restart procesu serwera i render
 * MISS dokładają CPU tuż przed Lighthouse'em).
 */
export function classifyAttempt(a: AttemptObservation): RunValidity & { readonly load: number } {
  const loads = [a.loadBefore, a.loadAfter].filter((v) => Number.isFinite(v));
  const load = loads.length ? Math.max(...loads) : Number.NaN;
  if (!a.lhrOk) return { excluded: true, reasons: ["przebieg nieudany"], load };
  const validity = classifyRun({
    document: a.document,
    serverDocs: a.serverDocs,
    devtools: a.devtools,
    rewarmOk: a.rewarmOk,
    referenceVariant: a.referenceVariant,
    load,
    maxLoad: a.maxLoad,
    allowUncached: a.allowUncached,
    runDocuments: a.runDocuments,
  });
  return { ...validity, load };
}

/**
 * Domyślny `--max-load`: 0,6 x liczba CPU (2,4 na 4 CPU), zgodnie z protokołem
 * P0.5 (ważne przebiegi przy load 1,0-2,8; przy load ≥ 4 na 4 CPU TBT rośnie
 * wielokrotnie). Dawny domyślny próg = liczba CPU przepuszczał A/A przy 3,7-4,0.
 */
export function defaultMaxLoad(cpuCount: number): number {
  return Math.round(0.6 * Math.max(1, cpuCount) * 10) / 10;
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
// standardowe (n-1) różnic B-A, MDE = (t₀,₉₇₅ + t₀,₈)·σΔ/√n z df = n-1 (test
// sparowany, α 0,05 dwustronnie, moc 0,8). Dawne 2,8 = 1,96 + 0,84 to
// przybliżenie dużych prób: przy n = 5 zaniża próg o 25 % (3,72 vs 2,8),
// przy n = 3 prawie dwukrotnie (5,36) - recenzja P0.1, I4. Linia PAIRS podaje
// MDE(t) (próg obowiązujący) i MDE(z) (dawne 2,8, do porównania). Pozycja,
// której oczekiwany efekt jest mniejszy niż MDE(t), NIE jest oceniana medianą,
// tylko księgą per zadanie.

export interface PairedStat {
  readonly key: NumericKey;
  readonly n: number;
  readonly meanDelta: number;
  readonly sdDelta: number;
  /** MDE(t) = mnożnik t(df = n-1) · σΔ/√n - próg obowiązujący. */
  readonly mde: number;
  /** MDE(z) = 2,8 · σΔ/√n (przybliżenie dużych prób, tylko do porównania). */
  readonly mdeZ: number;
  /** Mnożnik użyty w MDE(t): t₀,₉₇₅(df) + t₀,₈(df). */
  readonly tMultiplier: number;
}

export const PAIRED_KEYS: readonly NumericKey[] = ["score", "fcp", "lcp", "tbt", "si", "tti"];

/** z₀,₉₇₅ + z₀,₈ ≈ 1,96 + 0,84 - mnożnik dla df > 30. */
export const MDE_Z_MULTIPLIER = 2.8;

// Kwantyle rozkładu t Studenta dla df = 1..30 (tablice standardowe, 3 miejsca).
const T_0975 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145,
  2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048,
  2.045, 2.042,
];
const T_080 = [
  1.376, 1.061, 0.978, 0.941, 0.92, 0.906, 0.896, 0.889, 0.883, 0.879, 0.876, 0.873, 0.87, 0.868,
  0.866, 0.865, 0.863, 0.862, 0.861, 0.86, 0.859, 0.858, 0.858, 0.857, 0.856, 0.856, 0.855, 0.855,
  0.854, 0.854,
];

/** t₀,₉₇₅(df) + t₀,₈(df) dla df 1..30, powyżej 2,8 (z); NaN dla df < 1. */
export function mdeMultiplier(df: number): number {
  if (!Number.isFinite(df) || df < 1) return Number.NaN;
  const i = Math.floor(df);
  return i <= T_0975.length ? T_0975[i - 1] + T_080[i - 1] : MDE_Z_MULTIPLIER;
}

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
    const tMultiplier = mdeMultiplier(n - 1);
    return {
      key,
      n,
      meanDelta: mean,
      sdDelta: sd,
      mde: n > 1 ? (tMultiplier * sd) / Math.sqrt(n) : Number.NaN,
      mdeZ: n > 1 ? (MDE_Z_MULTIPLIER * sd) / Math.sqrt(n) : Number.NaN,
      tMultiplier,
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
  const multiplier = stats[0]?.tMultiplier;
  const parts = stats.map(
    (s) =>
      `${s.key}: Δ=${statValue(s.key, s.meanDelta)} σΔ=${statValue(s.key, s.sdDelta)} ` +
      `MDE(t)=${statValue(s.key, s.mde)} MDE(z)=${statValue(s.key, s.mdeZ)}`,
  );
  const tLabel =
    multiplier !== undefined && Number.isFinite(multiplier)
      ? `, t(df=${n - 1})=${multiplier.toFixed(2)}`
      : "";
  return `PAIRS ${label} (n=${n}${tLabel}): ${parts.join(" | ")}`;
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

/**
 * Linia AA. `modes` (I1) = rozkład trybów FCP przebiegów ważnych obu stron,
 * np. `A pełny x3, częściowy x2 | B pełny x5`; bez niego (brak księgi) linia
 * mówi, że trybu nie znamy.
 */
export function formatAaCheck(form: string, a: Medians, b: Medians, modes?: string): string {
  const dFcp = Math.abs(b.fcp - a.fcp);
  const dLcp = Math.abs(b.lcp - a.lcp);
  const ok = dFcp <= AA_TOLERANCE_MS && dLcp <= AA_TOLERANCE_MS;
  const hint = modes
    ? `tryby FCP: ${modes}`
    : "tryb FCP nieznany - uruchom z --save-artifacts (księga)";
  return (
    `AA ${form}: |ΔFCP|=${(dFcp / 1000).toFixed(3)}s |ΔLCP|=${(dLcp / 1000).toFixed(3)}s ` +
    `${ok ? "OK (≤ 0,02 s)" : `PONAD PRÓG 0,02 s (${hint})`}`
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
  /** Tryb FCP z księgi Lantern (`lanternTasks.fcpModeOf`); null/brak = nieznany (bez artefaktów). */
  readonly fcpMode?: string | null;
  /** Odcisk wariantu dokumentu, który dostał Lighthouse (B1). */
  readonly variant?: DocumentVariant | null;
  /** Rozgrzewka przebiegu; `restores` > 0 = Lighthouse mierzył świeżo uruchomiony proces serwera. */
  readonly rewarm?: { readonly restores?: number } | null;
}

/** Pary (A_n, B_n) z tej samej rundy przeplotu, w których OBA przebiegi są ważne. */
export function validPairs(
  a: readonly RunRecordLike[],
  b: readonly RunRecordLike[],
): [RunMetrics, RunMetrics][] {
  return validRecordPairs(a, b).map(([x, y]) => [x.metrics, y.metrics]);
}

type ValidRecord = RunRecordLike & { readonly metrics: RunMetrics };

function validRecordPairs(
  a: readonly RunRecordLike[],
  b: readonly RunRecordLike[],
): [ValidRecord, ValidRecord][] {
  const byN = (list: readonly RunRecordLike[]) => {
    const map = new Map<number, ValidRecord>();
    for (const r of list) if (r.valid && r.metrics) map.set(r.n, { ...r, metrics: r.metrics });
    return map;
  };
  const left = byN(a);
  const right = byN(b);
  const out: [ValidRecord, ValidRecord][] = [];
  for (const [n, rec] of [...left].sort((x, y) => x[0] - y[0])) {
    const other = right.get(n);
    if (other) out.push([rec, other]);
  }
  return out;
}

/**
 * Pary ważne rozwarstwione po trybie FCP (recenzja P0.1, I1). Dwumodalność FCP
 * (graf FCP z bootem JS albo bez niego) rozjeżdża σΔ par, w których strony
 * trafiły różne tryby - takie pary liczymy osobno (`mixed`) i nie wchodzą do
 * żadnej warstwy. `unknown` = para bez trybu po którejś stronie (brak księgi).
 */
export interface ModePairs {
  readonly byMode: ReadonlyMap<string, [RunMetrics, RunMetrics][]>;
  readonly mixed: number;
  readonly unknown: number;
  readonly total: number;
}

export function pairsByFcpMode(
  a: readonly RunRecordLike[],
  b: readonly RunRecordLike[],
): ModePairs {
  const byMode = new Map<string, [RunMetrics, RunMetrics][]>();
  let mixed = 0;
  let unknown = 0;
  const pairs = validRecordPairs(a, b);
  for (const [x, y] of pairs) {
    if (!x.fcpMode || !y.fcpMode) unknown += 1;
    else if (x.fcpMode !== y.fcpMode) mixed += 1;
    else byMode.set(x.fcpMode, [...(byMode.get(x.fcpMode) ?? []), [x.metrics, y.metrics]]);
  }
  return { byMode, mixed, unknown, total: pairs.length };
}

/** `pełny 3, częściowy 1; mieszane 1/5; nieznany 0` - jedna linia rozkładu par. */
export function formatModePairs(label: string, split: ModePairs): string {
  const layers = [...split.byMode]
    .sort((x, y) => y[1].length - x[1].length)
    .map(([mode, list]) => `${mode} ${list.length}`)
    .join(", ");
  return (
    `PAIRS ${label} tryb FCP: ${layers || "-"}; pary mieszane ${split.mixed}/${split.total}` +
    (split.unknown ? `; bez trybu ${split.unknown}/${split.total}` : "")
  );
}

/** Metryki przebiegów ważnych pogrupowane po trybie FCP (warstwy linii AA). */
export function validMetricsByFcpMode(
  records: readonly RunRecordLike[],
): Map<string, RunMetrics[]> {
  const out = new Map<string, RunMetrics[]>();
  for (const r of records) {
    if (!r.valid || !r.metrics || !r.fcpMode) continue;
    out.set(r.fcpMode, [...(out.get(r.fcpMode) ?? []), r.metrics]);
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
  /** Wariant dokumentu (`formatVariant`) -> liczba przebiegów ważnych (B1). */
  readonly variants: Readonly<Record<string, number>>;
  /** Tryb FCP -> liczba przebiegów ważnych (I1); pusty bez księgi. */
  readonly fcpModes: Readonly<Record<string, number>>;
  /**
   * Przebiegi ważne, przed którymi rozgrzewka restartowała serwer (świeży
   * proces: zimny JIT i cache izolatu). Etap pomiarowy sprawdza, czy nie
   * skupiają się po jednej stronie A/A (recenzja P0.1-FIX, runda 2).
   */
  readonly restored: number;
}

export function summarizeValidity(records: readonly RunRecordLike[]): ValiditySummary {
  const rounds = new Set(records.map((r) => r.n));
  const valid = new Set(records.filter((r) => r.valid).map((r) => r.n));
  const reasons: Record<string, number> = {};
  const variants: Record<string, number> = {};
  const fcpModes: Record<string, number> = {};
  let excludedAttempts = 0;
  let restored = 0;
  for (const r of records) {
    if (r.valid) {
      if ((r.rewarm?.restores ?? 0) > 0) restored += 1;
      if (r.variant) {
        const label = formatVariant(r.variant);
        variants[label] = (variants[label] ?? 0) + 1;
      }
      if (r.fcpMode) fcpModes[r.fcpMode] = (fcpModes[r.fcpMode] ?? 0) + 1;
      continue;
    }
    excludedAttempts += 1;
    for (const reason of r.reasons ?? []) {
      const key = reason.replace(/\s*\(.*\)$/, "").replace(/: \d+x$/, "");
      reasons[key] = (reasons[key] ?? 0) + 1;
    }
  }
  return {
    nValid: valid.size,
    rounds: rounds.size,
    excludedAttempts,
    reasons,
    variants,
    fcpModes,
    restored,
  };
}

/** `pełny x3, częściowy x2` (malejąco). */
export function formatCounts(counts: Readonly<Record<string, number>> | undefined): string {
  return Object.entries(counts ?? {})
    .sort((x, y) => y[1] - x[1])
    .map(([k, v]) => `${k} x${v}`)
    .join(", ");
}

export function formatValidity(label: string, s: ValiditySummary): string {
  const why = Object.entries(s.reasons)
    .map(([k, v]) => `${k} x${v}`)
    .join("; ");
  const variants = formatCounts(s.variants);
  const modes = formatCounts(s.fcpModes);
  return (
    `VALID ${label}: n_valid=${s.nValid}/${s.rounds} excluded=${s.excludedAttempts}` +
    (why ? ` (${why})` : "") +
    (variants ? ` wariant: ${variants}` : "") +
    (modes ? ` trybFCP: ${modes}` : "") +
    (s.nValid ? ` po restarcie serwera: ${s.restored}/${s.nValid}` : "")
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WYNIK SERII: PRÓG `n_valid`, KOD WYJŚCIA, ZAPIS BASELINE'U (recenzja I3, D8)
//
// Seria, w której forma ma mniej niż `--min-valid` przebiegów ważnych, NIE jest
// sukcesem: kod wyjścia 1 i odmowa zapisu baseline'u tej formy (dawniej zero
// ważnych przebiegów kończyło się kodem 0, a `--save-baseline` zapisywał pusty
// plik, który `loadBaseline` przedkładał potem nad śledzony).

/**
 * `--min-valid`: domyślnie `runs`; jawna wartość nie schodzi poniżej
 * min(3, runs) - baseline i mediana z 1-2 przebiegów z 5 nic nie znaczą.
 * Wartość większa niż `runs` jest nieosiągalna, a wartość nieliczbowa
 * (`--min-valid abc`) nie jest „brakiem flagi" - obie są błędem wywołania,
 * tak jak niepoprawne `--max-load`. Tekst z CLI parsujemy ściśle (`Number`,
 * nie `parseInt`, więc `5abc` też jest błędem).
 */
export function resolveMinValid(requested: number | string | undefined, runs: number): number {
  const floor = Math.min(3, Math.max(1, runs));
  if (requested === undefined) return Math.max(floor, runs);
  const parsed =
    typeof requested === "string"
      ? requested.trim() === ""
        ? Number.NaN
        : Number(requested)
      : requested;
  if (!Number.isFinite(parsed))
    throw new Error(`--min-valid ${String(requested)}: oczekiwana liczba całkowita`);
  const value = Math.floor(parsed);
  if (value > runs) throw new Error(`--min-valid ${value} > --runs ${runs}: próg nieosiągalny`);
  return Math.max(floor, value);
}

export interface SeriesEntry {
  /** Strona serii: "" (pojedynczy artefakt), "A" albo "B". */
  readonly tag: string;
  readonly form: string;
  readonly validity: Pick<ValiditySummary, "nValid" | "rounds">;
}

export interface SeriesOutcome {
  readonly exitCode: 0 | 1;
  /** Linie `FAIL …` do druku (po jednej na formę/stronę poniżej progu). */
  readonly failures: readonly string[];
  /** Formy strony baseline'u, które wolno zapisać (`n_valid` ≥ próg). */
  readonly baselineForms: readonly string[];
  /** Formy strony baseline'u, których zapisu odmawiamy. */
  readonly refusedBaselineForms: readonly string[];
  /** Powód przerwania serii w połowie (wyjątek w trakcie przebiegów); null = seria kompletna. */
  readonly aborted: string | null;
}

/**
 * Wynik serii. `aborted` (P0.1-FIX, runda 2): seria przerwana wyjątkiem
 * w trakcie przebiegów (np. serwer artefaktu nie wstał po restarcie) NIE
 * gubi już przebiegów ukończonych - harness liczy z nich podsumowanie
 * i summary.json - ale jest porażką (kod 1) i nie zapisuje baseline'u
 * żadnej formy, bo nie wiadomo, czy brakujące rundy nie zmieniłyby median.
 */
export function seriesOutcome(
  entries: readonly SeriesEntry[],
  options: {
    readonly minValid: number;
    readonly baselineTag: string;
    readonly aborted?: string | null;
  },
): SeriesOutcome {
  const failures: string[] = [];
  const baselineForms: string[] = [];
  const refusedBaselineForms: string[] = [];
  const aborted = options.aborted ?? null;
  if (aborted)
    failures.push(`FAIL seria przerwana: ${aborted} (wyniki częściowe, baseline bez zapisu)`);
  for (const e of entries) {
    const ok = e.validity.nValid >= options.minValid && e.validity.nValid > 0;
    if (!ok)
      failures.push(
        `FAIL ${e.tag ? `${e.tag} ` : ""}${e.form}: n_valid=${e.validity.nValid}/${e.validity.rounds} ` +
          `< --min-valid ${options.minValid}`,
      );
    if (e.tag === options.baselineTag)
      (ok && !aborted ? baselineForms : refusedBaselineForms).push(e.form);
  }
  return {
    exitCode: failures.length ? 1 : 0,
    failures,
    baselineForms,
    refusedBaselineForms,
    aborted,
  };
}

/**
 * Korzeń artefaktu do zapisu (D3, runda 2): wewnątrz repo harnessu - ścieżka
 * względna (`.`, `worktrees/x`); poza nim - `poza-repo:<nazwa katalogu>`.
 * `relative()` dawał dla `/tmp/x/wt` ścieżkę `../../tmp/x/wt`, czyli układ
 * maszyny w formie względnej. Tożsamość artefaktu niesie i tak `commit`.
 */
export function portableRoot(root: string, harnessRoot: string): string {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const r = norm(root);
  const base = norm(harnessRoot);
  if (r === base) return ".";
  if (r.startsWith(`${base}/`)) return r.slice(base.length + 1);
  const name = r.split("/").filter(Boolean).at(-1) ?? "?";
  return `poza-repo:${name}`;
}

/**
 * Tekst do zapisu bez ścieżek maszyny (D3, runda 2): każde wystąpienie ścieżki
 * z `labels` zastępuje etykieta (najdłuższe ścieżki najpierw, żeby korzeń
 * worktree nie zjadł prefiksu ścieżki wyników). Dotyczy komunikatu przerwania
 * serii (`aborted`), który niesie `root` z wyjątku startu serwera.
 */
export function scrubPaths(
  text: string,
  labels: readonly (readonly [path: string, label: string])[],
): string {
  return [...labels]
    .filter(([path]) => path.length > 1)
    .sort((x, y) => y[0].length - x[0].length)
    .reduce((out, [path, label]) => out.split(path).join(label), text);
}

// ─────────────────────────────────────────────────────────────────────────────
// LINIA K Z FLAGAMI (recenzja D6)

/** Flagi, z którymi k jest zdefiniowane (P0.1 pkt 8: TBT_PSI / TBT_fixture_z_flagami). */
export const CALIBRATION_FLAGS = flagsLabel("fixture", "fake-gtag");

const RECALC_HINT = " (|k-1| > 0,2: przelicz cele fixture)";

/**
 * Linia K z etykietą flag. Bez pełnych flag (`CALIBRATION_FLAGS`) k NIE
 * kalibruje niczego: dopisek `(bez flag, nie kalibruje)` albo `(niepełne flagi,
 * nie kalibruje)` i bez wskazówki przeliczenia celów.
 */
export function formatCalibrationLine(
  form: FormName,
  fixture: Medians,
  reference: PsiReference,
  flags: string,
): string {
  const line = formatCalibration(form, fixture, reference);
  if (flags === CALIBRATION_FLAGS) return `${line} {${flags}}`;
  const why = flags === NO_FLAGS ? "bez flag" : "niepełne flagi";
  return `${line.replace(RECALC_HINT, "")} {${flags}} (${why}, nie kalibruje)`;
}
