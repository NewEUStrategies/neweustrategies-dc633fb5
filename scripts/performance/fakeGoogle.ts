// FAŁSZYWY TAG GOOGLE DLA LOKALNEGO LIGHTHOUSE'A (P0.1, `--third-party fake-gtag`).
//
// PO CO. Na fixture gtag NIE ładuje się wcale: bramka hosta w
// `src/lib/analytics/tagIds.ts` (`analyticsAllowedHere`) przepuszcza wyłącznie
// neweuropeanstrategies.com, a sandbox i tak nie ma wyjścia do Google. Tymczasem
// na PSI gtag to 153 z 202 ms TBT w śladzie mobile (76 %) i przesunięcie TTI
// 7,1 -> 10,6 s (raport third-party). Bez atrapy żadna zmiana polityki ładowania
// tagu (TP-1/TP-2, P1.1) nie jest mierzalna lokalnie.
//
// JAK. Serwer HTTPS (h2 + h1) na losowym porcie; Chrome mapuje na niego hosty
// Google (`--host-resolver-rules`), a front harnessu wstrzykuje do <head>
// `window.__NES_GA_ANY_HOST__=true` (flaga testowa z tagIds.ts), więc działa
// PRAWDZIWY snippet SSR i PRAWDZIWA polityka `gtagLoadPolicy.ts` z artefaktu -
// atrapa podmienia wyłącznie treść `gtag/js` i odbiera pingi.
//
// KSZTAŁT KOSZTU = PRODUKCJA, przeliczona przez benchmarkIndex. Zmierzone na
// produkcji (`lighthouse/prod-mobile.json`, M3 Pro, benchmarkIndex 3702,5):
//   G-...  : 489 KB raw / 170 KB transfer, zadania 17,2 + 12,7 ms obserwowane
//            (69 + 51 ms symulowane x4),
//   AW-... : 623 KB raw / 200 KB transfer, zadanie 45,7 ms (183 ms sym.),
//            dociągany przez G, bo w warstwie danych jest `config AW-...`,
//   + 6-8 pingów (collect / conversion / ccm).
// Na wolniejszym hoście ten sam skrypt trwa dłużej: czas zadania = czas M3 x
// (3702,5 / benchmarkIndex hosta). benchmarkIndex hosta mierzymy RAZ na serię
// tą samą funkcją i w tym samym Chrome, którego używa Lighthouse
// (`measureChromeBenchmarkIndex`: `--headless=new --dump-dom` na stronie
// z kopią `computeBenchmarkIndex`, mediana 3 prób) - V8 Node'a daje na tym
// hoście ~1600 zamiast ~2100 z Chrome'a, więc nie nadaje się jako proxy.
// Skala jest stała w obrębie serii (obie strony A/B, każdy przebieg), więc
// zadania atrapy nie dokładają szumu. Eksperyment fazy 1 (`exp/fake-google.mjs`)
// trzymał 600 KB losowego base64 w LITERALE łańcucha i dawał zadania 2,2x
// produkcji (410/184/180 ms sym. zamiast 183/69/51) - parsowanie i ewaluacja
// literału doszły do pętli. Tu ładunek bajtowy siedzi w KOMENTARZU, a pętla
// zajętości liczy czas zadania z ODJĘCIEM kompilacji: pod instrumentacją
// Lighthouse'a (Debugger.scriptParsed) kompilacja skryptu na głównym wątku
// kosztuje ~proporcjonalnie do bajtów niezależnie od treści (zmierzone
// 2026-10-04: 489 KB komentarza = v8.compile 30,7 ms na tym hoście, a bez
// instrumentacji < 1 ms), a produkcyjne 17,2/45,7 ms to CAŁE zadanie, razem
// z kompilacją. Dlatego (1) ładunek ma tylko część losową o rozmiarze
// transferu produkcji (raw ~227/266 KB zamiast 489/623 KB - Lantern symuluje
// sieć z transferu, a raw wpływa wyłącznie na czas kompilacji), (2) pierwsza
// pętla liczy od `responseEnd` skryptu z Resource Timing (początek zadania
// kompilacji, gdy wątek był wolny), z odjęciem najwyżej 60 % celu, żeby
// kolejka na zajętym wątku nie skróciła zadania do zera.
// Kontrola: `lanternTasks.ts` na artefaktach przebiegu pokazuje zadania
// googletagmanager - liczby w POMIAR.md §7.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createSecureServer, type Http2ServerRequest, type Http2ServerResponse } from "node:http2";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { fixtureTls, type Stoppable } from "./artifactServer.ts";

/** Hosty Google, które Chrome mapuje na atrapę (script-src/connect-src z CSP w `src/start.ts`). */
export const FAKE_GOOGLE_HOSTS: readonly string[] = [
  "www.googletagmanager.com",
  "googletagmanager.com",
  "region1.google-analytics.com",
  "www.google-analytics.com",
  "region1.analytics.google.com",
  "analytics.google.com",
  "stats.g.doubleclick.net",
  "googleads.g.doubleclick.net",
  "td.doubleclick.net",
  "pagead2.googlesyndication.com",
  "www.googleadservices.com",
  "www.google.com",
];

/** benchmarkIndex hosta, na którym zmierzono produkcyjne zadania gtag (M3 Pro). */
export const PRODUCTION_BENCHMARK_INDEX = 3702.5;

/** Obserwowane (niedławione) zadania gtag na produkcji, M3 Pro - patrz nagłówek pliku. */
export const PRODUCTION_GTAG_TASKS_MS = { g: [17.2, 12.7], aw: [45.7] } as const;

/** Rozmiary produkcyjne: raw i transfer (brotli) obu kontenerów; atrapa odtwarza transfer. */
export const PRODUCTION_GTAG_BYTES = {
  g: { raw: 489_000, transfer: 170_002 },
  aw: { raw: 623_000, transfer: 199_590 },
} as const;

/** Wstrzykiwane do <head> przez front: bramka hosta z tagIds.ts przepuszcza fixture.invalid. */
export const GA_ANY_HOST_SNIPPET = "<script>window.__NES_GA_ANY_HOST__=true</script>";

/**
 * Skala czasu zadań: ile razy wolniej ten host wykonuje ten sam JS niż M3 Pro.
 * Ograniczona do [0,25; 8], żeby błędny benchmark nie zrobił z atrapy zadania
 * sekundowego (albo zerowego).
 */
export function fakeGoogleScale(hostBenchmarkIndex: number): number {
  if (!Number.isFinite(hostBenchmarkIndex) || hostBenchmarkIndex <= 0) return 1;
  return Math.min(8, Math.max(0.25, PRODUCTION_BENCHMARK_INDEX / hostBenchmarkIndex));
}

/**
 * Kopia `computeBenchmarkIndex` z `lighthouse/core/lib/page-functions.js`
 * (Lighthouse 13, Apache-2.0): średnia indeksu „GC" (sklejanie łańcucha 10 000
 * znaków) i „bez GC" (kopiowanie tablicy 100 000 liczb), iteracje / 10 / s.
 */
const BENCHMARK_FUNCTION = `function computeBenchmarkIndex(){
function gc(){var start=Date.now(),it=0;while(Date.now()-start<500){var s='';for(var j=0;j<10000;j++)s+='a';if(s.length===1)throw new Error('x');it++;}return Math.round(it/10/((Date.now()-start)/1000));}
function nogc(){var a=[],b=[];for(var i=0;i<100000;i++)a[i]=b[i]=i;var start=Date.now(),it=0;while(it%10!==0||Date.now()-start<500){var src=it%2===0?a:b,tgt=it%2===0?b:a;for(var j=0;j<src.length;j++)tgt[j]=src[j];it++;}return Math.round(it/10/((Date.now()-start)/1000));}
return (gc()+nogc())/2;}`;

/** Strona, która wpisuje `NES_BENCHMARK=<indeks>` do DOM (odczyt przez `--dump-dom`). */
export const BENCHMARK_PAGE = `<!doctype html><html><body><script>${BENCHMARK_FUNCTION}document.body.textContent='NES_BENCHMARK='+computeBenchmarkIndex();</script></body></html>`;

/** `NES_BENCHMARK=2128.5` z wyjścia `--dump-dom` -> 2128,5 (NaN, gdy brak). */
export function parseBenchmarkDump(stdout: string): number {
  const match = /NES_BENCHMARK=(\d+(?:\.\d+)?)/.exec(stdout);
  return match ? Number.parseFloat(match[1]) : Number.NaN;
}

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface ChromeBenchmark {
  readonly median: number;
  readonly samples: readonly number[];
}

/**
 * benchmarkIndex hosta zmierzony w Chrome z CHROME_PATH (ten sam binarny co
 * Lighthouse), `runs` prób w świeżych profilach. null = brak Chrome'a albo
 * żadna próba nie dała liczby (wtedy wołający podaje `--fake-gtag-scale`).
 */
export async function measureChromeBenchmarkIndex(
  options: {
    readonly chromePath?: string;
    readonly flags?: readonly string[];
    readonly runs?: number;
    readonly timeoutMs?: number;
  } = {},
): Promise<ChromeBenchmark | null> {
  const chrome = options.chromePath ?? process.env.CHROME_PATH;
  if (!chrome) return null;
  const url = `data:text/html;base64,${Buffer.from(BENCHMARK_PAGE).toString("base64")}`;
  const samples: number[] = [];
  for (let i = 0; i < (options.runs ?? 3); i++) {
    const profile = mkdtempSync(join(tmpdir(), "nes-bench-"));
    try {
      const stdout = await new Promise<string>((done) => {
        const child = spawn(
          chrome,
          [...(options.flags ?? []), `--user-data-dir=${profile}`, "--dump-dom", url],
          { stdio: ["ignore", "pipe", "ignore"] },
        );
        let out = "";
        child.stdout.on("data", (c: Buffer) => (out += c.toString()));
        const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs ?? 60_000);
        child.on("error", () => done(""));
        child.on("exit", () => {
          clearTimeout(timer);
          done(out);
        });
      });
      const value = parseBenchmarkDump(stdout);
      if (Number.isFinite(value) && value > 0) samples.push(value);
    } finally {
      rmSync(profile, { recursive: true, force: true });
    }
  }
  return samples.length ? { median: medianOf(samples), samples } : null;
}

/** Deterministyczny PRNG (mulberry32): ten sam ładunek w każdym przebiegu = ten sam transfer. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Ładunek bajtowy w komentarzu: losowe base64 (brotli ~0,75 rozmiaru) dobrane
 * tak, żeby TRANSFER odpowiadał produkcji. Bez wypełniacza o zerowej entropii:
 * dokładałby tylko bajty do kompilacji (patrz nagłówek pliku). Komentarz nie
 * może zawierać `*` + `/` - base64 ich nie ma.
 */
function payloadComment(transfer: number, seed: number): string {
  const randomLen = Math.round(transfer / 0.75);
  const next = prng(seed);
  const bytes = Buffer.alloc(Math.ceil((randomLen * 3) / 4));
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(next() * 256);
  return `/*${bytes.toString("base64").slice(0, randomLen)}*/`;
}

const busy = (ms: number) => `var __e=__t0+${ms.toFixed(1)};while(performance.now()<__e){}`;

/**
 * Pętla PIERWSZEGO zadania skryptu: cel liczony od `responseEnd` (koniec
 * pobrania = początek zadania kompilacji), nie od pierwszej instrukcji, ale
 * z odjęciem najwyżej 60 % celu.
 */
const busyFromResponseEnd = (ms: number) =>
  "var __c=document.currentScript,__r=__c&&__c.src?performance.getEntriesByName(__c.src)[0]:null," +
  `__b=__r&&__r.responseEnd>0&&__r.responseEnd<__t0?Math.max(__r.responseEnd,__t0-${(0.6 * ms).toFixed(1)}):__t0;` +
  `var __e=__b+${ms.toFixed(1)};while(performance.now()<__e){}`;

const ping = (host: string, path: string) =>
  `try{fetch("https://${host}${path}&_r="+Math.random(),{mode:"no-cors",keepalive:true}).catch(function(){})}catch(e){}`;

/**
 * Treść `gtag/js?id=<id>` w skali `scale`. G odtwarza zachowanie prawdziwego
 * kontenera: po pierwszym zadaniu planuje drugie (setTimeout 0), w którym
 * dociąga kontener AW, JEŚLI warstwa danych zawiera `config AW-...` (dziś
 * snippet SSR konfiguruje AW przed zgodą - TP-2 to zmienia, a atrapa to zobaczy),
 * także gdy `config AW` przyjdzie później (przechwycony `dataLayer.push`).
 */
export function fakeGtagScript(id: string, scale: number): string {
  const isAw = id.startsWith("AW-");
  const tasks = isAw ? PRODUCTION_GTAG_TASKS_MS.aw : PRODUCTION_GTAG_TASKS_MS.g;
  const bytes = isAw ? PRODUCTION_GTAG_BYTES.aw : PRODUCTION_GTAG_BYTES.g;
  const [first, second = 0] = tasks.map((t) => t * scale);
  const body = isAw
    ? `(function(){var __t0=performance.now();${busyFromResponseEnd(first)}` +
      ping("pagead2.googlesyndication.com", `/ccm/collect?tid=${encodeURIComponent(id)}`) +
      ping("region1.google-analytics.com", "/g/collect?v=2&en=user_engagement") +
      "})();"
    : "(function(){var __t0=performance.now();" +
      busyFromResponseEnd(first) +
      "var w=window,dl=w.dataLayer=w.dataLayer||[],loaded={};" +
      "function aw(a){if(a&&a[0]==='config'&&typeof a[1]==='string'&&a[1].indexOf('AW-')===0&&!loaded[a[1]]){" +
      "loaded[a[1]]=1;var s=document.createElement('script');s.async=true;" +
      "s.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(a[1])+'&cx=c&gtm=fake';" +
      "document.head.appendChild(s);}}" +
      "setTimeout(function(){var __t0=performance.now();" +
      busy(second) +
      "for(var i=0;i<dl.length;i++)aw(dl[i]);" +
      "var push=dl.push;dl.push=function(){for(var j=0;j<arguments.length;j++)aw(arguments[j]);return push.apply(dl,arguments)};" +
      ping(
        "region1.google-analytics.com",
        `/g/collect?v=2&tid=${encodeURIComponent(id)}&en=page_view`,
      ) +
      ping("region1.google-analytics.com", "/measurement/conversion?en=page_view") +
      ping("region1.google-analytics.com", "/measurement/conversion?en=first_visit") +
      ping("region1.google-analytics.com", "/measurement/conversion?en=session_start") +
      ping("pagead2.googlesyndication.com", "/ccm/collect?tid=AW-11463700688") +
      "},0);})();";
  // Ziarno zależne od typu kontenera: dwa różne, ale stałe ładunki.
  return `${body}\n${payloadComment(bytes.transfer, isAw ? 2 : 1)}\n`;
}

export interface FakeGoogleStats {
  readonly scripts: number;
  readonly pings: number;
  readonly byId: Readonly<Record<string, number>>;
}

export interface RunningFakeGoogle extends Stoppable {
  readonly port: number;
  readonly scale: number;
  /** Reguły `MAP host 127.0.0.1:port` dla `--host-resolver-rules`. */
  readonly hostResolverRules: readonly string[];
  stats(): FakeGoogleStats;
}

/** Startuje atrapę na 127.0.0.1:`port` (0 = wolny port) ze skalą `scale`. */
export async function startFakeGoogle(options: {
  readonly port?: number;
  readonly scale: number;
}): Promise<RunningFakeGoogle> {
  const scale = options.scale;
  const cache = new Map<string, Buffer>();
  const counters = { scripts: 0, pings: 0, byId: {} as Record<string, number> };
  const compressed = (id: string): Buffer => {
    const kind = id.startsWith("AW-") ? id : `G:${id}`;
    let body = cache.get(kind);
    if (!body) {
      body = brotliCompressSync(Buffer.from(fakeGtagScript(id, scale), "utf8"), {
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
      });
      cache.set(kind, body);
    }
    return body;
  };
  const handler = (req: Http2ServerRequest, res: Http2ServerResponse): void => {
    const url = new URL(req.url ?? "/", "https://fake.google");
    if (url.pathname === "/gtag/js" || url.pathname === "/gtm.js") {
      const id = url.searchParams.get("id") ?? "G-UNKNOWN";
      counters.scripts += 1;
      counters.byId[id] = (counters.byId[id] ?? 0) + 1;
      // gtm.js (kontener GTM z ConsentScriptInjector) - produkcja go nie ładuje;
      // pusty skrypt, żeby ewentualne wywołanie nie skończyło się błędem sieci.
      const body = url.pathname === "/gtm.js" ? Buffer.from("/* fake gtm */") : compressed(id);
      res.writeHead(200, {
        "content-type": "application/javascript; charset=utf-8",
        ...(url.pathname === "/gtm.js" ? {} : { "content-encoding": "br" }),
        "content-length": String(body.length),
        "cache-control": "private, max-age=900",
        "access-control-allow-origin": "*",
      });
      res.end(body);
      return;
    }
    counters.pings += 1;
    res.writeHead(204, { "access-control-allow-origin": "*", "cache-control": "no-store" });
    res.end();
  };
  const server = createSecureServer({ ...fixtureTls(), allowHTTP1: true }, handler);
  const port = await new Promise<number>((done, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      const address = server.address();
      done(typeof address === "object" && address ? address.port : 0);
    });
  });
  return {
    port,
    scale,
    hostResolverRules: FAKE_GOOGLE_HOSTS.map((host) => `MAP ${host} 127.0.0.1:${port}`),
    stats: () => ({ scripts: counters.scripts, pings: counters.pings, byId: { ...counters.byId } }),
    stop: () =>
      new Promise<void>((closed) => {
        server.close(() => closed());
        setTimeout(() => closed(), 1000).unref();
      }),
  };
}
