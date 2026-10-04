#!/usr/bin/env node
// KSIĘGA TBT PER ZADANIE (Lantern) Z ZAPISANYCH ARTEFAKTÓW LIGHTHOUSE'A (P0.1).
//
// Produktyzacja `$SCRATCH/phase1/ledger/tbt-tasks.mjs` (faza 1C, PLAN.md §1.5).
// Z artefaktów przebiegu (`lighthouse -G` = ślad + devtoolsLog; harness:
// `lighthouse-local.mjs --save-artifacts`) liczy blokowanie KAŻDEGO
// symulowanego węzła CPU dokładnie tak, jak robi to Lantern w audycie TBT:
//   - symulacja grafu optymistycznego i pesymistycznego (te same co w audycie),
//   - okno optymistyczne [FCP_pes, TTI_opt], pesymistyczne [FCP_opt, TTI_pes]
//     (Lantern celowo bierze PRZECIWNE oszacowanie FCP - TotalBlockingTime.js),
//   - blokowanie zadania = max(0, czas w oknie - 50 ms) (TBTUtils.js),
//   - TBT = 0,5 x suma optymistyczna + 0,5 x suma pesymistyczna.
// Suma księgi = audyt TBT co do zaokrąglenia (sprawdzane: `ledger` vs `tbt`
// w nagłówku; harness porównuje też z `total-blocking-time` z LHR).
//
// Dlaczego per zadanie, a nie mediana TBT: TBT jest progowe i wypukłe (zadanie
// 60 ms sym. daje 10 ms, 120 ms daje 70), dwie zmiany skracające TO SAMO zadanie
// nie sumują się, a szum A/A TBT na tym hoście sięga setek ms. Zadanie, które
// zniknęło z księgi w każdym przebiegu B, jest dowodem; mediana nie zawsze.
//
// Klasy węzłów: Navigation, ParseHTML, ParseCSS, Style (UpdateLayoutTree/Layout),
// Script:<chunk>, Timer:<chunk>, GC, ScriptCatchup (dokańczanie kompilacji
// zestawu modułów), Layerize-UpdateLayer (kompozytor), Paint, Other. Flaga L =
// zadanie z Layout, które Lantern mnoży tylko x mult/2 (inwariant 4, PLAN §1.3).
//
// Lighthouse NIE jest zależnością repo: moduły `core/` bierzemy z instalacji,
// na którą wskazuje LIGHTHOUSE_CLI (…/lighthouse/cli/index.js) albo
// LIGHTHOUSE_CORE (…/lighthouse/core), albo `--lighthouse-core`.
//
// Użycie:
//   node scripts/performance/lanternTasks.ts <artefakty>... [--min 1] [--json plik]
//        [--lhr plik.json] [--exclude-script <regex>]... [--strict]
//   node scripts/performance/lanternTasks.ts --diff <artefakty-A> <artefakty-B> [--min 1]
//   node scripts/performance/lanternTasks.ts --diff-series <katalog-wyników> [--form mobile]
//     (pary A-<forma>-<n> / B-<forma>-<n> z ważnych przebiegów w summary.json)

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const BLOCKING_THRESHOLD_MS = 50;

/** `/~flock.js` wstrzykuje hosting (Lovable), nie aplikacja - raportowany osobno (krytyka m11). */
export const DEFAULT_EXCLUDE_SCRIPTS: readonly string[] = ["^/~flock\\.js$"];

// ─────────────────────────────────────────────────────────────────────────────
// Warstwa czysta (testy: harness-ext.test.mjs)

export interface TraceEventLike {
  readonly name: string;
  readonly ts: number;
  readonly dur?: number;
  readonly args?: {
    /** Ramka zdarzenia (`navigationStart`, `firstContentfulPaint`, `largestContentfulPaint::*`). */
    readonly frame?: string;
    readonly data?: {
      readonly url?: string;
      readonly stackTrace?: readonly { readonly url?: string }[];
      readonly isLoadingMainFrame?: boolean;
    };
    readonly fileName?: string;
  };
}

export type TaskClass =
  | "Navigation"
  | "ParseHTML"
  | "ParseCSS"
  | "Style"
  | "Script"
  | "Timer"
  | "GC"
  | "ScriptCatchup"
  | "Layerize-UpdateLayer"
  | "Paint"
  | "Other";

export interface TaskClassification {
  readonly cls: TaskClass;
  /** Pełny URL skryptu, który zajął najwięcej czasu zadania ("" = brak). */
  readonly url: string;
  readonly layout: boolean;
  /** Etykieta do druku: `Script:vendor-react`, `Style`, ... */
  readonly label: string;
  /** Domieszki ≥ 20 % zadania z innej kategorii (np. `ParseHTML 31%` w commicie Reacta). */
  readonly mixins: readonly string[];
}

const SCRIPT_ROOTS = new Set([
  "FunctionCall",
  "EvaluateScript",
  "v8.evaluateModule",
  "v8.callFunction",
  "TimerFire",
  "FireAnimationFrame",
  "FireIdleCallback",
  "EventDispatch",
  "RunMicrotasks",
  "XHRReadyStateChange",
  "v8.compile",
  "v8.compileModule",
]);
const STYLE = new Set(["UpdateLayoutTree", "Layout", "RecalculateStyles"]);
const GC = new Set(["MinorGC", "MajorGC", "V8.GC_SCAVENGER", "V8.GC_MARK_COMPACTOR"]);
const COMPOSITOR = new Set(["Layerize", "UpdateLayer", "Commit", "PrePaint", "UpdateLayerTree"]);
const PAINT = new Set(["Paint", "PaintImage", "RasterTask", "Rasterize"]);

/** Długość sumy przedziałów (nakładające się zdarzenia zagnieżdżone liczone raz), µs. */
export function unionDuration(events: readonly TraceEventLike[]): number {
  const spans = events
    .filter((e) => (e.dur ?? 0) > 0)
    .map((e) => [e.ts, e.ts + (e.dur ?? 0)] as const)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = Number.NaN;
  let curEnd = Number.NaN;
  for (const [s, e] of spans) {
    if (Number.isNaN(curStart) || s > curEnd) {
      if (!Number.isNaN(curStart)) total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    } else if (e > curEnd) curEnd = e;
  }
  if (!Number.isNaN(curStart)) total += curEnd - curStart;
  return total;
}

function eventUrl(e: TraceEventLike): string {
  return e.args?.data?.url || e.args?.fileName || e.args?.data?.stackTrace?.[0]?.url || "";
}

/** Krótka nazwa skryptu: chunk bez hasha (`vendor-react`), host + ścieżka dla obcych originów. */
export function shortScriptName(url: string, documentUrl = ""): string {
  if (!url) return "";
  if (documentUrl && url.split("#")[0] === documentUrl.split("#")[0]) return "(dokument)";
  try {
    const u = new URL(url);
    const local = u.hostname === "fixture.invalid" || u.hostname === "127.0.0.1";
    const file = u.pathname.replace(/^\/assets\//, "").replace(/-[A-Za-z0-9_-]{8}\.m?js$/, "");
    if (local) return file || u.pathname;
    return `${u.hostname.replace(/^www\./, "")}${u.pathname}${u.searchParams.get("id") ? `?id=${u.searchParams.get("id")}` : ""}`;
  } catch {
    return url.slice(0, 80);
  }
}

/**
 * Klasa zadania z jego zdarzeń potomnych. Kategoria dominująca (≥ 30 % czasu
 * zadania, przedziały sumowane bez podwójnego liczenia zagnieżdżeń) wygrywa;
 * bez dominującej - obecność znaczników (ScriptCatchup, kompozytor, Paint).
 */
export function classifyTask(
  children: readonly TraceEventLike[],
  taskDurUs: number,
  documentUrl = "",
): TaskClassification {
  const names = new Set(children.map((c) => c.name));
  const layout = names.has("Layout");
  const pick = (set: ReadonlySet<string>) => children.filter((c) => set.has(c.name));
  const scriptEvents = pick(SCRIPT_ROOTS);
  const byUrl = new Map<string, number>();
  for (const e of scriptEvents) {
    const url = eventUrl(e);
    if (url) byUrl.set(url, (byUrl.get(url) ?? 0) + (e.dur ?? 0));
  }
  if (!byUrl.size) {
    for (const e of children) {
      const url = eventUrl(e);
      if (url && /\.m?js(\?|$)|\/gtag\/js|gtm\.js/.test(url))
        byUrl.set(url, (byUrl.get(url) ?? 0) + (e.dur ?? 0));
    }
  }
  const url = [...byUrl].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const shares: [TaskClass, number][] = [
    ["Script", unionDuration(scriptEvents)],
    ["ParseHTML", unionDuration(children.filter((c) => c.name === "ParseHTML"))],
    ["ParseCSS", unionDuration(children.filter((c) => c.name === "ParseAuthorStyleSheet"))],
    ["Style", unionDuration(pick(STYLE))],
    ["GC", unionDuration(pick(GC))],
  ];
  const total = Math.max(1, taskDurUs);
  const mixins = shares
    .filter(([, d]) => d / total >= 0.2)
    .map(([c, d]) => `${c} ${Math.round((100 * d) / total)}%`);
  let cls: TaskClass;
  if (names.has("DocumentLoader::CommitNavigation")) cls = "Navigation";
  else {
    const [top, topDur] = [...shares].sort((a, b) => b[1] - a[1])[0];
    if (topDur / total >= 0.3) {
      cls = top;
      if (cls === "Script") {
        const timer = unionDuration(children.filter((c) => c.name === "TimerFire"));
        if (timer >= 0.5 * topDur) cls = "Timer";
      }
    } else if (names.has("ScriptCatchup")) cls = "ScriptCatchup";
    else if ([...names].some((n) => COMPOSITOR.has(n))) cls = "Layerize-UpdateLayer";
    else if ([...names].some((n) => PAINT.has(n))) cls = "Paint";
    else cls = "Other";
  }
  const short = shortScriptName(url, documentUrl);
  const withUrl = cls === "Script" || cls === "Timer";
  return {
    cls,
    url,
    layout,
    label: withUrl && short ? `${cls}:${short}` : cls,
    mixins: mixins.filter((m) => !m.startsWith(cls === "Timer" ? "Script" : cls)),
  };
}

/** Blokowanie jednego zdarzenia w oknie [start, end] - `calculateTbtImpactForEvent` Lantern. */
export function blockingInWindow(
  event: { readonly start: number; readonly end: number; readonly duration: number },
  windowStart: number,
  windowEnd: number,
): number {
  if (windowEnd <= windowStart) return 0;
  if (event.duration < BLOCKING_THRESHOLD_MS) return 0;
  if (event.end < windowStart || event.start > windowEnd) return 0;
  const clipped = Math.min(event.end, windowEnd) - Math.max(event.start, windowStart);
  return clipped < BLOCKING_THRESHOLD_MS ? 0 : clipped - BLOCKING_THRESHOLD_MS;
}

export interface SimTiming {
  readonly startTime: number;
  readonly endTime: number;
  readonly duration: number;
}

export interface TaskRow {
  readonly id: string;
  /** Obserwowany start od navigationStart i czas trwania (ms, niedławione). */
  readonly obsStart: number;
  readonly obsDur: number;
  /** Symulacja pesymistyczna (start, czas) - jak w tabelach PLAN.md §1.5. */
  readonly simStart: number;
  readonly simDur: number;
  readonly opt: number;
  readonly pes: number;
  /** 0,5 x opt + 0,5 x pes = wkład zadania do TBT. */
  readonly blocking: number;
  readonly cls: TaskClass;
  readonly label: string;
  readonly url: string;
  readonly layout: boolean;
  readonly mixins: readonly string[];
}

export interface LedgerWindows {
  readonly optimistic: readonly [number, number];
  readonly pessimistic: readonly [number, number];
}

/** Okna Lantern: optymistyczne [FCP_pes, TTI_opt], pesymistyczne [FCP_opt, TTI_pes]. */
export function lanternWindows(
  fcp: { readonly optimistic: number; readonly pessimistic: number },
  tti: { readonly optimistic: number; readonly pessimistic: number },
): LedgerWindows {
  return {
    optimistic: [fcp.pessimistic, tti.optimistic],
    pessimistic: [fcp.optimistic, tti.pessimistic],
  };
}

export interface CpuTaskInput {
  readonly id: string;
  readonly obsStart: number;
  readonly obsDur: number;
  readonly children: readonly TraceEventLike[];
}

/**
 * Wiersze księgi z węzłów CPU i ich czasów symulowanych. Węzeł bez czasu w danej
 * symulacji (nie należał do grafu) ma tam blokowanie 0 - tak jak w audycie.
 */
export function ledgerRows(
  tasks: readonly CpuTaskInput[],
  optimistic: ReadonlyMap<string, SimTiming>,
  pessimistic: ReadonlyMap<string, SimTiming>,
  windows: LedgerWindows,
  documentUrl = "",
): TaskRow[] {
  const rows: TaskRow[] = [];
  for (const t of tasks) {
    const o = optimistic.get(t.id);
    const p = pessimistic.get(t.id);
    if (!o && !p) continue;
    const opt = o
      ? blockingInWindow(
          { start: o.startTime, end: o.endTime, duration: o.duration },
          ...windows.optimistic,
        )
      : 0;
    const pes = p
      ? blockingInWindow(
          { start: p.startTime, end: p.endTime, duration: p.duration },
          ...windows.pessimistic,
        )
      : 0;
    const c = classifyTask(t.children, t.obsDur * 1000, documentUrl);
    const sim = p ?? o;
    rows.push({
      id: t.id,
      obsStart: t.obsStart,
      obsDur: t.obsDur,
      simStart: sim?.startTime ?? 0,
      simDur: sim?.duration ?? 0,
      opt,
      pes,
      blocking: 0.5 * opt + 0.5 * pes,
      cls: c.cls,
      label: c.label,
      url: c.url,
      layout: c.layout,
      mixins: c.mixins,
    });
  }
  return rows.sort((a, b) => a.obsStart - b.obsStart);
}

export interface NetworkRecordLike {
  readonly url: string;
  readonly resourceType?: string;
  readonly transferSize?: number;
  /** ms, zegar monotoniczny (jak `ts` śladu / 1000). */
  readonly networkEndTime?: number;
}

export interface ScriptBytes {
  readonly bytes: number;
  readonly count: number;
  readonly excludedBytes: number;
  readonly excludedCount: number;
  readonly excludedUrls: readonly string[];
}

/**
 * Bajty transferu skryptów zakończonych (obserwowane) przed obserwowanym LCP -
 * zbiór, który Lantern wlicza do grafu LCP (inwariant 1, PLAN §1.3). Skrypty
 * pasujące do `excludes` (ścieżka URL, np. `/~flock.js`) raportujemy osobno.
 */
export function scriptBytesEndedBefore(
  records: readonly NetworkRecordLike[],
  lcpMs: number,
  excludes: readonly RegExp[],
): ScriptBytes {
  let bytes = 0;
  let count = 0;
  let excludedBytes = 0;
  let excludedCount = 0;
  const excludedUrls: string[] = [];
  for (const r of records) {
    if (r.resourceType !== "Script") continue;
    const end = r.networkEndTime ?? Number.POSITIVE_INFINITY;
    if (!(end < lcpMs)) continue;
    let path = r.url;
    try {
      path = new URL(r.url).pathname;
    } catch {
      /* zostaje surowy URL */
    }
    if (excludes.some((re) => re.test(path))) {
      excludedBytes += r.transferSize ?? 0;
      excludedCount += 1;
      excludedUrls.push(path);
      continue;
    }
    bytes += r.transferSize ?? 0;
    count += 1;
  }
  return { bytes, count, excludedBytes, excludedCount, excludedUrls };
}

// ── obserwowane FCP/LCP nawigacji (recenzja D5) ──────────────────────────────

export const LCP_CANDIDATE = "largestContentfulPaint::Candidate";
export const LCP_INVALIDATE = "largestContentfulPaint::Invalidate";

/**
 * Zdarzenia głównej ramki nawigacji od `t0`: ślad zawiera też ramki podrzędne
 * (iframe'y) i zdarzenia sprzed nawigacji (about:blank). Bez ramki (stare
 * ślady bez `args.frame`) - filtr tylko po czasie.
 */
function navigationEvents(
  events: readonly TraceEventLike[],
  t0: number,
  frame: string | undefined,
): TraceEventLike[] {
  return events.filter((e) => e.ts >= t0 && (!frame || e.args?.frame === frame));
}

/** Obserwowane FCP nawigacji (ts µs) albo undefined. */
export function observedFcpTs(
  events: readonly TraceEventLike[],
  t0: number,
  frame: string | undefined,
): number | undefined {
  return navigationEvents(events, t0, frame)
    .filter((e) => e.name === "firstContentfulPaint")
    .sort((a, b) => a.ts - b.ts)[0]?.ts;
}

/**
 * Obserwowane LCP nawigacji (ts µs) jak w Lighthouse (`TraceProcessor`):
 * OSTATNIE zdarzenie `largestContentfulPaint::Candidate|Invalidate` głównej
 * ramki od `t0`; gdy ostatnie jest `Invalidate`, LCP nie ma (undefined).
 */
export function observedLcpTs(
  events: readonly TraceEventLike[],
  t0: number,
  frame: string | undefined,
): number | undefined {
  let last: TraceEventLike | undefined;
  for (const e of navigationEvents(events, t0, frame)) {
    if (e.name !== LCP_CANDIDATE && e.name !== LCP_INVALIDATE) continue;
    if (!last || e.ts >= last.ts) last = e;
  }
  return last?.name === LCP_CANDIDATE ? last.ts : undefined;
}

// ── tryb FCP (recenzja I1) ───────────────────────────────────────────────────
//
// Dwumodalność FCP mobile (POMIAR.md §3): albo boot JS wchodzi do grafu FCP
// Lantern (cały, ~500 KB na 1,6 Mb/s = FCP ~4,2 s), albo tylko jego część
// (~120 KB, FCP ~2,1 s). Dawny próg „> 50 KB = js" oznaczał OBA tryby jako `js`
// (17 skryptów / 118 KB i 25 / 506 KB). Tryb = udział bajtów skryptów grafu FCP
// w bajtach skryptów startowych zakończonych przed obserwowanym LCP.

export type FcpMode = "pełny" | "pośredni" | "częściowy" | "bez-js" | "?";

/** Udział ≥ 0,9: graf FCP niesie (prawie) cały boot. */
export const FCP_MODE_FULL_SHARE = 0.9;
/** Udział < 0,5: graf FCP niesie mniejszość bootu. */
export const FCP_MODE_PARTIAL_SHARE = 0.5;

export interface FcpModeInfo {
  readonly mode: FcpMode;
  /** Bajty grafu FCP / bajty skryptów startowych (NaN, gdy mianownik nieznany). */
  readonly share: number;
  readonly graphScripts: number;
  readonly graphBytes: number;
  readonly startupBytes: number;
}

export function fcpModeOf(
  graphScripts: number,
  graphBytes: number,
  startupBytes: number,
): FcpModeInfo {
  const base = { graphScripts, graphBytes, startupBytes };
  if (graphScripts === 0 || graphBytes <= 0) return { ...base, mode: "bez-js", share: 0 };
  if (!(startupBytes > 0)) return { ...base, mode: "?", share: Number.NaN };
  const share = graphBytes / startupBytes;
  const mode: FcpMode =
    share >= FCP_MODE_FULL_SHARE
      ? "pełny"
      : share < FCP_MODE_PARTIAL_SHARE
        ? "częściowy"
        : "pośredni";
  return { ...base, mode, share };
}

/** Wejścia `fcpModeOf` z jednego przebiegu (P0.1-FIX, runda 2). */
export interface FcpModeInputs {
  /** Skrypty pierwszej strony w pesymistycznym grafie FCP Lantern. */
  readonly graphScripts: number;
  readonly graphBytes: number;
  /**
   * Mianownik: bajty transferu skryptów PIERWSZEJ STRONY zakończonych przed
   * obserwowanym LCP, RAZEM z wykluczonymi z sumy inwariantu 1 (np.
   * `/~flock.js`) - graf FCP też je widzi.
   */
  readonly startupBytes: number;
  /** Bajty skryptów obcych originów przed LCP, pominięte w mianowniku (diagnostyka). */
  readonly thirdPartyBytes: number;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Tryb FCP liczony WYŁĄCZNIE ze skryptów originu dokumentu (recenzja
 * P0.1-FIX, runda 2). Tag Google (`--third-party fake-gtag`, ~170 KB
 * transferu) kończy się przed obserwowanym LCP w części przebiegów, a w części
 * nie; w mianowniku przesuwałby udział przez próg 0,9 (`pełny` -> `pośredni`)
 * bez zmiany grafu FCP pierwszej strony, czyli fałszywe pary mieszane.
 * Licznik (graf FCP) filtrujemy tak samo, żeby udział nie przekraczał 1.
 * Nieznany origin dokumentu = bez filtra (dawne zachowanie).
 */
export function fcpModeInputs(
  graphRequests: readonly NetworkRecordLike[],
  records: readonly NetworkRecordLike[],
  lcpMs: number,
  documentUrl: string,
): FcpModeInputs {
  const own = originOf(documentUrl);
  const firstParty = (r: NetworkRecordLike) => own === null || originOf(r.url) === own;
  let graphScripts = 0;
  let graphBytes = 0;
  for (const r of graphRequests) {
    if (r.resourceType !== "Script" || !firstParty(r)) continue;
    graphScripts += 1;
    graphBytes += r.transferSize ?? 0;
  }
  let startupBytes = 0;
  let thirdPartyBytes = 0;
  for (const r of records) {
    if (r.resourceType !== "Script") continue;
    if (!((r.networkEndTime ?? Number.POSITIVE_INFINITY) < lcpMs)) continue;
    if (firstParty(r)) startupBytes += r.transferSize ?? 0;
    else thirdPartyBytes += r.transferSize ?? 0;
  }
  return { graphScripts, graphBytes, startupBytes, thirdPartyBytes };
}

/** `pełny (25 skr. / 506,2 KB = 97 % z 520,0 KB)` - tryb z liczbami, do ksiąg i linii LEDGER. */
export function formatFcpMode(info: FcpModeInfo): string {
  const kb = (v: number) => (v / 1024).toFixed(1).replace(".", ",");
  const share = Number.isFinite(info.share) ? `${Math.round(info.share * 100)} %` : "?";
  return (
    `${info.mode} (${info.graphScripts} skr. / ${kb(info.graphBytes)} KB = ${share} ` +
    `z ${kb(info.startupBytes)} KB)`
  );
}

export interface DiffRow {
  readonly a: TaskRow | null;
  readonly b: TaskRow | null;
  readonly delta: number;
  readonly status: "zniknęło" | "krótsze" | "dłuższe" | "bez zmian" | "nowe";
}

/** Zadanie istotne dla księgi: blokuje albo trwa ≥ 50 ms sym. (może wejść do okna po zmianie). */
function relevant(r: TaskRow): boolean {
  return r.blocking > 0 || r.simDur >= BLOCKING_THRESHOLD_MS;
}

/**
 * Parowanie zadań A i B: ta sama klasa i URL, najbliższy obserwowany start
 * (tolerancja max(150 ms, 25 % startu)). Zadania bez pary: `zniknęło` (A)
 * albo `nowe` (B). Dopasowanie zachłanne od największego blokowania A.
 */
export function diffLedgers(a: readonly TaskRow[], b: readonly TaskRow[]): DiffRow[] {
  const left = a.filter(relevant);
  const right = b.filter(relevant);
  const used = new Set<TaskRow>();
  const out: DiffRow[] = [];
  for (const ta of [...left].sort((x, y) => y.blocking - x.blocking)) {
    const tolerance = Math.max(150, 0.25 * ta.obsStart);
    let best: TaskRow | null = null;
    for (const tb of right) {
      if (used.has(tb) || tb.label !== ta.label) continue;
      const d = Math.abs(tb.obsStart - ta.obsStart);
      if (d > tolerance) continue;
      if (!best || d < Math.abs(best.obsStart - ta.obsStart)) best = tb;
    }
    if (best) used.add(best);
    const delta = (best?.blocking ?? 0) - ta.blocking;
    const status: DiffRow["status"] = !best
      ? "zniknęło"
      : delta < -1
        ? best.blocking === 0
          ? "zniknęło"
          : "krótsze"
        : delta > 1
          ? "dłuższe"
          : "bez zmian";
    out.push({ a: ta, b: best, delta, status });
  }
  for (const tb of right) {
    if (!used.has(tb)) out.push({ a: null, b: tb, delta: tb.blocking, status: "nowe" });
  }
  return out.sort((x, y) => anchorOf(x).obsStart - anchorOf(y).obsStart);
}

/** Zadanie, po którym wiersz różnicy jest sortowany i opisany (A, a gdy brak - B). */
export function anchorOf(row: DiffRow): TaskRow {
  const task = row.a ?? row.b;
  if (!task) throw new Error("Wiersz różnicy bez zadania");
  return task;
}

export interface Ledger {
  readonly dir: string;
  readonly cpuMultiplier: number;
  /** TBT z Lantern (audyt) i suma księgi - muszą się zgadzać do ~1 ms. */
  readonly tbt: number;
  readonly ledgerSum: number;
  readonly fcpSim: { readonly optimistic: number; readonly pessimistic: number };
  readonly ttiSim: { readonly optimistic: number; readonly pessimistic: number };
  readonly obsFcp: number;
  readonly obsLcp: number;
  /** Skrypty w pesymistycznym grafie FCP Lantern = „tryb FCP" przebiegu (dwumodalność, M3). */
  readonly fcpGraphScripts: number;
  readonly fcpGraphScriptBytes: number;
  /**
   * Tryb FCP z udziału bajtów grafu FCP w skryptach startowych, oba liczone
   * dla originu dokumentu (`fcpModeInputs`, `fcpModeOf`, I1).
   */
  readonly fcpMode: FcpMode;
  readonly fcpModeInfo: FcpModeInfo;
  readonly scriptBytesEndedBeforeObsLcp: ScriptBytes;
  readonly tasks: readonly TaskRow[];
  /** Zadania z kodu Google (googletagmanager) - kontrola pozytywna `--third-party fake-gtag`. */
  readonly googleTasks: number;
  readonly googleBlocking: number;
}

const ms = (v: number) => `${Math.round(v)}`;

export function formatLedger(ledger: Ledger, minBlocking = 1): string {
  const lines: string[] = [];
  const sb = ledger.scriptBytesEndedBeforeObsLcp;
  lines.push(
    `# ${ledger.dir}`,
    `# TBT=${ledger.tbt.toFixed(1)} ledger=${ledger.ledgerSum.toFixed(1)} cpuMult=${ledger.cpuMultiplier} ` +
      `FCPsim opt/pes=${ms(ledger.fcpSim.optimistic)}/${ms(ledger.fcpSim.pessimistic)} ` +
      `TTIsim opt/pes=${ms(ledger.ttiSim.optimistic)}/${ms(ledger.ttiSim.pessimistic)} ` +
      `obsFCP=${ms(ledger.obsFcp)} obsLCP=${ms(ledger.obsLcp)}`,
    `# trybFCP=${formatFcpMode(ledger.fcpModeInfo)} ` +
      `scriptBytesEndedBeforeObsLcp=${(sb.bytes / 1024).toFixed(1)} KB (${sb.count}) ` +
      `+ wykluczone ${(sb.excludedBytes / 1024).toFixed(1)} KB (${sb.excludedUrls.join(",") || "-"}) ` +
      `google: ${ledger.googleTasks} zadań / ${ms(ledger.googleBlocking)} ms`,
    "obsStart obsDur simStart simDur L  blocking(opt/pes/avg)  klasa",
  );
  for (const r of ledger.tasks) {
    if (r.blocking < minBlocking && r.simDur < BLOCKING_THRESHOLD_MS) continue;
    lines.push(
      `${r.obsStart.toFixed(0).padStart(8)} ${r.obsDur.toFixed(1).padStart(6)} ${r.simStart.toFixed(0).padStart(8)} ` +
        `${r.simDur.toFixed(0).padStart(6)} ${r.layout ? "L" : " "}  ${r.opt.toFixed(0).padStart(5)}/${r.pes.toFixed(0).padStart(5)}/${r.blocking.toFixed(0).padStart(5)}  ` +
        `${r.label}${r.mixins.length ? ` [${r.mixins.join(", ")}]` : ""}`,
    );
  }
  const byLabel = new Map<string, number>();
  for (const r of ledger.tasks) byLabel.set(r.label, (byLabel.get(r.label) ?? 0) + r.blocking);
  lines.push("# blokowanie per klasa:");
  for (const [label, v] of [...byLabel].sort((x, y) => y[1] - x[1]))
    if (v >= 0.5) lines.push(`#   ${label.padEnd(44)} ${v.toFixed(0)}`);
  return lines.join("\n");
}

export function formatDiff(a: Ledger, b: Ledger, rows: readonly DiffRow[]): string {
  const cell = (r: TaskRow | null) =>
    r
      ? `${r.obsStart.toFixed(0).padStart(6)}/${r.obsDur.toFixed(1).padStart(5)} ${r.layout ? "L" : " "} ${r.blocking.toFixed(0).padStart(4)}`
      : "                   -";
  const lines = [
    `# A ${a.dir}: TBT=${a.tbt.toFixed(0)} trybFCP=${a.fcpMode} google=${a.googleTasks}`,
    `# B ${b.dir}: TBT=${b.tbt.toFixed(0)} trybFCP=${b.fcpMode} google=${b.googleTasks}`,
    `# ΔTBT B-A = ${(b.tbt - a.tbt).toFixed(0)} ms`,
    "      A start/dur L blk |       B start/dur L blk |  Δblk  status     klasa",
  ];
  for (const r of rows) {
    lines.push(
      `${cell(r.a)} | ${cell(r.b)} | ${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(0).padStart(4)}  ${r.status.padEnd(10)} ${anchorOf(r).label}`,
    );
  }
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Warstwa Lighthouse'a (moduły core/ z instalacji LIGHTHOUSE_CLI)

interface LanternNode {
  readonly type: string;
  readonly id: string;
  readonly event?: TraceEventLike;
  readonly childEvents?: readonly TraceEventLike[];
  readonly duration?: number;
  readonly request?: {
    readonly url: string;
    readonly resourceType?: string;
    readonly transferSize?: number;
  };
}

interface LanternEstimate {
  readonly timeInMs: number;
  readonly nodeTimings?: Map<LanternNode, SimTiming>;
}

interface LanternMetricResult {
  readonly timing: number;
  readonly optimisticEstimate: LanternEstimate;
  readonly pessimisticEstimate: LanternEstimate;
  readonly pessimisticGraph?: { traverse(cb: (node: LanternNode) => void): void };
}

interface ComputedArtifact<I, O> {
  request(input: I, context: unknown): Promise<O>;
}

interface LhArtifacts {
  readonly settings: { readonly throttling?: { readonly cpuSlowdownMultiplier?: number } };
  readonly Trace?: { readonly traceEvents: readonly TraceEventLike[] };
  readonly DevtoolsLog?: unknown;
  readonly GatherContext?: unknown;
  readonly URL?: { readonly finalDisplayedUrl?: string; readonly mainDocumentUrl?: string };
  readonly SourceMaps?: unknown;
  readonly HostDPR?: unknown;
}

/** Katalog `lighthouse/core` z LIGHTHOUSE_CORE, LIGHTHOUSE_CLI albo jawnej ścieżki. */
export function resolveLighthouseCore(explicit?: string): string | null {
  const candidates = [
    explicit,
    process.env.LIGHTHOUSE_CORE,
    process.env.LIGHTHOUSE_CLI ? join(dirname(dirname(process.env.LIGHTHOUSE_CLI)), "core") : "",
  ];
  for (const c of candidates) {
    if (c && existsSync(join(c, "lib/asset-saver.js"))) return resolve(c);
  }
  return null;
}

/**
 * Nazwa i wersja Lighthouse'a do zapisów harnessu (summary.json, baseline):
 * `lighthouse 13.5.0` z `package.json` instalacji LIGHTHOUSE_CLI, NIE ścieżka
 * maszyny (recenzja P0.1, D3). Bez LIGHTHOUSE_CLI harness woła `npx lighthouse@13`.
 */
export function lighthouseLabel(cli: string | undefined = process.env.LIGHTHOUSE_CLI): string {
  if (!cli) return "npx lighthouse@13";
  try {
    const pkg: unknown = JSON.parse(
      readFileSync(join(dirname(dirname(cli)), "package.json"), "utf8"),
    );
    const { name, version } = (pkg ?? {}) as { name?: unknown; version?: unknown };
    if (typeof name === "string" && typeof version === "string") return `${name} ${version}`;
  } catch {
    /* niestandardowy układ instalacji - zostaje etykieta bez wersji */
  }
  return "lighthouse (LIGHTHOUSE_CLI, wersja nieznana)";
}

async function importCore<T>(core: string, rel: string): Promise<T> {
  const mod: T = await import(pathToFileURL(join(core, rel)).href);
  return mod;
}

function traceEventsOf(art: LhArtifacts): readonly TraceEventLike[] {
  return art.Trace?.traceEvents ?? [];
}

/** Liczy księgę z katalogu artefaktów (`artifacts.json` + `trace.json` + `devtoolslog.json`). */
export async function analyzeArtifacts(
  dir: string,
  options: { readonly lighthouseCore?: string; readonly excludeScripts?: readonly string[] } = {},
): Promise<Ledger> {
  const core = resolveLighthouseCore(options.lighthouseCore);
  if (!core) {
    throw new Error(
      "Nie znaleziono lighthouse/core: ustaw LIGHTHOUSE_CLI (…/lighthouse/cli/index.js), " +
        "LIGHTHOUSE_CORE albo --lighthouse-core",
    );
  }
  const { loadArtifacts } = await importCore<{
    loadArtifacts(dir: string): Promise<LhArtifacts>;
  }>(core, "lib/asset-saver.js");
  const { LoadSimulator } = await importCore<{
    LoadSimulator: ComputedArtifact<{ devtoolsLog: unknown; settings: unknown }, unknown>;
  }>(core, "computed/load-simulator.js");
  const { LanternTotalBlockingTime } = await importCore<{
    LanternTotalBlockingTime: ComputedArtifact<unknown, LanternMetricResult>;
  }>(core, "computed/metrics/lantern-total-blocking-time.js");
  const { LanternFirstContentfulPaint } = await importCore<{
    LanternFirstContentfulPaint: ComputedArtifact<unknown, LanternMetricResult>;
  }>(core, "computed/metrics/lantern-first-contentful-paint.js");
  const { LanternInteractive } = await importCore<{
    LanternInteractive: ComputedArtifact<unknown, LanternMetricResult>;
  }>(core, "computed/metrics/lantern-interactive.js");
  const { NetworkRecords } = await importCore<{
    NetworkRecords: ComputedArtifact<unknown, NetworkRecordLike[]>;
  }>(core, "computed/network-records.js");

  const art = await loadArtifacts(dir);
  const settings = art.settings;
  const context = { computedCache: new Map(), settings };
  const devtoolsLog = art.DevtoolsLog;
  const trace = art.Trace;
  const simulator = await LoadSimulator.request({ devtoolsLog, settings }, context);
  const data = {
    trace,
    devtoolsLog,
    gatherContext: art.GatherContext,
    settings,
    simulator,
    URL: art.URL,
    SourceMaps: art.SourceMaps ?? [],
    HostDPR: art.HostDPR,
  };
  const fcp = await LanternFirstContentfulPaint.request(data, context);
  const tti = await LanternInteractive.request(data, context);
  const tbt = await LanternTotalBlockingTime.request(data, context);

  const events = traceEventsOf(art);
  const nav = events.find(
    (e) => e.name === "navigationStart" && e.args?.data?.isLoadingMainFrame === true,
  );
  const t0 = nav?.ts ?? 0;
  // Tylko główna ramka nawigacji i zdarzenia od jej startu; LCP unieważnione
  // (`Invalidate`) jak w Lighthouse (D5).
  const mainFrame = nav?.args?.frame;
  const obsFcpTs = observedFcpTs(events, t0, mainFrame);
  const obsLcpTs = observedLcpTs(events, t0, mainFrame);

  const cpuNodes = new Map<string, CpuTaskInput>();
  const optimistic = new Map<string, SimTiming>();
  const pessimistic = new Map<string, SimTiming>();
  for (const [which, target] of [
    [tbt.optimisticEstimate, optimistic],
    [tbt.pessimisticEstimate, pessimistic],
  ] as const) {
    for (const [node, timing] of which.nodeTimings ?? new Map<LanternNode, SimTiming>()) {
      if (node.type !== "cpu" || !node.event) continue;
      target.set(node.id, timing);
      if (!cpuNodes.has(node.id)) {
        cpuNodes.set(node.id, {
          id: node.id,
          obsStart: (node.event.ts - t0) / 1000,
          obsDur: (node.duration ?? 0) / 1000,
          children: node.childEvents ?? [],
        });
      }
    }
  }
  const windows = lanternWindows(
    { optimistic: fcp.optimisticEstimate.timeInMs, pessimistic: fcp.pessimisticEstimate.timeInMs },
    { optimistic: tti.optimisticEstimate.timeInMs, pessimistic: tti.pessimisticEstimate.timeInMs },
  );
  const documentUrl = art.URL?.mainDocumentUrl ?? art.URL?.finalDisplayedUrl ?? "";
  const tasks = ledgerRows([...cpuNodes.values()], optimistic, pessimistic, windows, documentUrl);

  // Skrypty pesymistycznego grafu FCP (wszystkie originy; tryb FCP liczy
  // z nich tylko pierwszą stronę - `fcpModeInputs`).
  const fcpGraphRequests: NetworkRecordLike[] = [];
  fcp.pessimisticGraph?.traverse((node) => {
    if (node.type !== "network" || node.request?.resourceType !== "Script") return;
    fcpGraphRequests.push(node.request);
  });
  const fcpGraphScripts = fcpGraphRequests.length;
  const fcpGraphScriptBytes = fcpGraphRequests.reduce((s, r) => s + (r.transferSize ?? 0), 0);

  const records = await NetworkRecords.request(devtoolsLog, context);
  const excludes = (options.excludeScripts ?? DEFAULT_EXCLUDE_SCRIPTS).map((s) => new RegExp(s));
  const google = tasks.filter((t) => /googletagmanager|google-analytics/.test(t.url));
  const obsLcpMs = obsLcpTs === undefined ? Number.POSITIVE_INFINITY : obsLcpTs / 1000;
  const scriptBytesEndedBeforeObsLcp = scriptBytesEndedBefore(records, obsLcpMs, excludes);
  // Tryb FCP: skrypty pierwszej strony w grafie FCP / skrypty pierwszej strony
  // przed LCP (także wykluczone z sumy, np. /~flock.js), bez tagu Google.
  const modeInputs = fcpModeInputs(fcpGraphRequests, records, obsLcpMs, documentUrl);
  const fcpModeInfo = fcpModeOf(
    modeInputs.graphScripts,
    modeInputs.graphBytes,
    modeInputs.startupBytes,
  );
  return {
    dir,
    cpuMultiplier: settings.throttling?.cpuSlowdownMultiplier ?? 1,
    tbt: tbt.timing,
    ledgerSum: tasks.reduce((s, t) => s + t.blocking, 0),
    fcpSim: windowsSource(fcp),
    ttiSim: windowsSource(tti),
    obsFcp: obsFcpTs === undefined ? Number.NaN : (obsFcpTs - t0) / 1000,
    obsLcp: obsLcpTs === undefined ? Number.NaN : (obsLcpTs - t0) / 1000,
    fcpGraphScripts,
    fcpGraphScriptBytes,
    fcpMode: fcpModeInfo.mode,
    fcpModeInfo,
    scriptBytesEndedBeforeObsLcp,
    tasks,
    googleTasks: google.filter((t) => t.simDur >= 1).length,
    googleBlocking: google.reduce((s, t) => s + t.blocking, 0),
  };
}

function windowsSource(m: LanternMetricResult): { optimistic: number; pessimistic: number } {
  return { optimistic: m.optimisticEstimate.timeInMs, pessimistic: m.pessimisticEstimate.timeInMs };
}

/** Plik LHR zapisany obok katalogu artefaktów przez harness (`X.artifacts` -> `X.json`). */
export function siblingLhr(dir: string): string | null {
  const candidate = dir.replace(/\.artifacts\/?$/, ".json");
  return candidate !== dir && existsSync(candidate) ? candidate : null;
}

export function auditTbt(lhrFile: string): number {
  const lhr: unknown = JSON.parse(readFileSync(lhrFile, "utf8"));
  const audits = (lhr as { audits?: Record<string, { numericValue?: number }> }).audits;
  return audits?.["total-blocking-time"]?.numericValue ?? Number.NaN;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI

interface SummaryRun {
  readonly n?: number;
  readonly artifacts?: string | null;
  readonly valid?: boolean;
}

/**
 * Pary katalogów artefaktów A/B formy `form` z ważnych przebiegów serii
 * (summary.json), a bez niego - po nazwach katalogów.
 */
export function seriesPairs(resultsDir: string, form: string): [string, string][] {
  const summaryFile = join(resultsDir, "summary.json");
  const pairs: [string, string][] = [];
  if (existsSync(summaryFile)) {
    const summary = JSON.parse(readFileSync(summaryFile, "utf8")) as {
      forms?: Record<string, { runs?: SummaryRun[]; records?: SummaryRun[] }>;
    };
    // Ścieżki w summary.json są względne wobec katalogu wyników (D3: bez ścieżek
    // maszyny); `resolve` przyjmuje też dawne, bezwzględne.
    const valid = (key: string) =>
      new Map(
        (summary.forms?.[key]?.records ?? [])
          .filter((r) => r.valid && r.artifacts && typeof r.n === "number")
          .map((r) => [r.n as number, resolve(resultsDir, r.artifacts as string)]),
      );
    const a = valid(`A:${form}`);
    const b = valid(`B:${form}`);
    for (const [n, dirA] of [...a].sort((x, y) => x[0] - y[0])) {
      const dirB = b.get(n);
      if (dirB) pairs.push([dirA, dirB]);
    }
    return pairs;
  }
  // Bez summary.json: pary po nazwach katalogów A-<forma>-<n>.artifacts / B-...
  const names = readdirSync(resultsDir);
  for (const name of names) {
    const m = new RegExp(`^A-${form}-(\\d+)\\.artifacts$`).exec(name);
    if (!m) continue;
    const other = `B-${form}-${m[1]}.artifacts`;
    if (names.includes(other)) pairs.push([join(resultsDir, name), join(resultsDir, other)]);
  }
  return pairs;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      min: { type: "string", default: "1" },
      json: { type: "string" },
      lhr: { type: "string" },
      diff: { type: "boolean", default: false },
      "diff-series": { type: "string" },
      form: { type: "string", default: "mobile" },
      "exclude-script": { type: "string", multiple: true },
      "lighthouse-core": { type: "string" },
      strict: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help || (!positionals.length && !values["diff-series"])) {
    const header = readFileSync(new URL(import.meta.url), "utf8")
      .split("\n")
      .slice(1)
      .filter((_, i, all) => i < all.findIndex((l) => !l.startsWith("//")));
    console.log(header.map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    return;
  }
  const minBlocking = Number.parseFloat(values.min) || 0;
  const opts = {
    lighthouseCore: values["lighthouse-core"],
    excludeScripts: values["exclude-script"]?.length
      ? values["exclude-script"]
      : DEFAULT_EXCLUDE_SCRIPTS,
  };
  if (values["diff-series"]) {
    const pairs = seriesPairs(resolve(values["diff-series"]), values.form);
    if (!pairs.length) throw new Error(`Brak par A/B formy ${values.form} z artefaktami`);
    for (const [dirA, dirB] of pairs) {
      const a = await analyzeArtifacts(dirA, opts);
      const b = await analyzeArtifacts(dirB, opts);
      console.log(`\n## ${basename(dirA)} vs ${basename(dirB)}`);
      console.log(formatDiff(a, b, diffLedgers(a.tasks, b.tasks)));
    }
    return;
  }
  if (values.diff) {
    if (positionals.length !== 2) throw new Error("--diff wymaga dwóch katalogów artefaktów: A B");
    const a = await analyzeArtifacts(resolve(positionals[0]), opts);
    const b = await analyzeArtifacts(resolve(positionals[1]), opts);
    console.log(formatDiff(a, b, diffLedgers(a.tasks, b.tasks)));
    return;
  }
  const out: Ledger[] = [];
  let mismatch = false;
  for (const dir of positionals) {
    const ledger = await analyzeArtifacts(resolve(dir), opts);
    out.push(ledger);
    console.log(formatLedger(ledger, minBlocking));
    const lhrFile = values.lhr ?? siblingLhr(resolve(dir));
    if (lhrFile) {
      const audit = auditTbt(lhrFile);
      const delta = ledger.ledgerSum - audit;
      const ok = Math.abs(delta) <= 1;
      if (!ok) mismatch = true;
      console.log(
        `# audyt total-blocking-time=${audit.toFixed(1)} (${basename(lhrFile)}) ledger-audyt=${delta.toFixed(2)} ms ${ok ? "OK (±1 ms)" : "NIEZGODNOŚĆ"}`,
      );
    }
    console.log("");
  }
  if (values.json) writeFileSync(values.json, `${JSON.stringify(out, null, 2)}\n`);
  if (values.strict && mismatch) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
