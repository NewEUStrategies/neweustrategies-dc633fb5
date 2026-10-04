// Awaryjny wrapper SSR entry (skill: tanstack-ssr-error-handling).
//
// Rola:
//   1. Lazy import bundlowanego handlera TanStack Start - błąd inicjalizacji
//      modułu można wtedy złapać przez try/catch (zamiast wywrócić cały
//      izolat Workera przy imporcie).
//   2. Try/catch wokół fetch dla rzuconych błędów - łapie wyjątki, które
//      wyszły PRZED dispatchem routera (middleware, request setup).
//   3. Normalizacja odpowiedzi 500 zamienionej przez h3 na generyczne
//      `{"unhandled":true,"message":"HTTPError"}`: gdy złapiemy taki
//      kształt, konsumujemy ostatni globalThis-error (patrz error-capture)
//      i renderujemy przyjazną stronę zamiast surowego JSON-a.
//
//   4. Strażnik strumienia DOKUMENTU (lib/http/documentStreamGuard.server):
//      każda odpowiedź text/html ma zagwarantowane domknięcie body. Bez tego
//      wisząca serializacja seroval trzyma strumień otwarty do wewnętrznego
//      limitu frameworka (60 s) i ubija go błędem - każda strona "odpowiada"
//      po ~61 s, a monitory (np. operatora płatności) raportują serwis jako offline.
//
//   5. Telemetria dokumentu (Workers Logs + Server-Timing): jedna linia JSON
//      per dokument HTML, emitowana PO KOŃCU body (owijka strumienia za
//      strażnikiem), z licznikiem żądań izolatu, kolonią, ray-em i klasą UA.
//      Obietnica końca body jedzie pod `ctx.waitUntil` z bezpiecznikiem, linia
//      niesie wynik odroczonego zapisu, a strona 500 ze ścieżki `catch` też
//      ma swoją linię (recenzja P0.4).
//
// Wpięcie: vite.config.ts -> tanstackStart.server.entry: "server".
import "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { consumeLastCapturedError } from "./lib/error-capture";
import { DOC_GUARD_MAX_MS, guardDocumentResponse } from "./lib/http/documentStreamGuard.server";
import { fetchWithFrameworkPreloads } from "./lib/http/frameworkPreloads.server";
import {
  applyDeferredDocumentStore,
  revalidationHeader,
  setDocumentRevalidator,
} from "./lib/http/documentCache.server";
import { NES_CACHE_HEADER, documentStorePolicy } from "./lib/http/documentCache";
import { runAfterResponse } from "./lib/http/waitUntil.server";
import { LANG_COOKIE } from "./lib/i18n/langCookie";
import {
  buildDocumentLogLine,
  buildEntryServerTimingValue,
  observeBodyEnd,
  resolveRequestColo,
  type BodyEndOutcome,
  type DocumentStoreOutcome,
  type IsolateSample,
} from "./lib/http/ssrTiming";
import type { Register } from "@tanstack/react-router";
import type { RequestHandler } from "@tanstack/react-start/server";

/**
 * Kontrakt bundlowanego handlera bierzemy WPROST z frameworka, zamiast
 * przepisywać go strukturalnie u siebie. `RequestHandler<Register>` to
 * `(request: Request, opts?: RequestOptions<Register>)`
 * (@tanstack/start-server-core/src/request-handler.ts:79-88), a `RequestOptions`
 * ma dokładnie cztery pola: `context` | `inlineCss` | `onEarlyHints` |
 * `responseLinkHeader` (tamże :60-68).
 *
 * Dlaczego typ frameworka, a nie własny: drugi argument nie może się już
 * rozjechać z kontraktem. Gdy ktoś zadeklaruje `server.requestContext`
 * w `Register`, `opts` przestanie być opcjonalne i `tsc` wskaże OBA wywołania
 * `handler.fetch` w tym pliku - zamiast pozwolić im dalej wołać handler bez
 * kontekstu, którego framework od tej chwili wymaga.
 */
type ServerEntry = { fetch: RequestHandler<Register> };

let serverEntryPromise: Promise<ServerEntry> | undefined;
/**
 * Import bundla entry już się rozstrzygnął. Żądanie, które weszło przed tym
 * momentem, płaci zimny start - także gdy nie jest pierwsze (`coldEntry`
 * w linii logu; recenzja P0.4, MINOR 4).
 */
let serverEntryReady = false;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then((m) => {
      serverEntryReady = true;
      return (m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry);
    });
  }
  return serverEntryPromise;
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

// Klient rozłączył się w trakcie SSR (nawigacja/refresh) - to NIE jest błąd
// aplikacji: nie logujemy i nie renderujemy strony błędu.
function isClientAbort(request: Request, error?: unknown): boolean {
  if (request.signal.aborted) return true;
  // Transport wrappers can form cycles in `cause`; never recurse indefinitely
  // while deciding how to handle the original SSR failure.
  const seen = new Set<unknown>();
  let current = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    const err = current as { code?: string; name?: string; message?: string; cause?: unknown };
    const text = `${err.code ?? ""} ${err.name ?? ""} ${err.message ?? ""}`.toLowerCase();
    if (text.includes("econnreset") || text.includes("aborted") || text.includes("abort"))
      return true;
    current = err.cause;
  }
  return false;
}

async function normalizeCatastrophicSsrResponse(
  request: Request,
  response: Response,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  // clone(): body jest strumieniem, oryginał musimy zwrócić w cało¶ci jesli
  // nie rozpoznamy sygnatury h3.
  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  const captured = consumeLastCapturedError();
  if (isClientAbort(request, captured)) {
    return new Response(null, { status: 499, headers: { "cache-control": "no-store" } });
  }

  // Raw Error (nie .message) - Server Logs potrzebują .stack.
  console.error(captured ?? new Error(`h3 swallowed SSR error: ${body}`));

  return new Response(renderErrorPage(), {
    status: 500,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

// Nitro's runtime arguments are not RequestOptions. Only our request-scoped
// collector is passed in slot 2. It merges manifest modulepreloads AFTER h3's
// header merge, before the deferred L1/L2 write, preserving font/image/locale
// hints from loaders. Inline CSS stays disabled: the split public stylesheet
// remains cacheable between routes instead of being copied into each document.

/**
 * Nagłówki syntetycznego żądania odświeżenia. Świadomie WĄSKA lista:
 *   - `host` / `x-forwarded-host` / `x-forwarded-proto` - bez nich render
 *     trafiłby w innego tenanta (klucz cache jest prefiksowany hostem),
 *   - `accept` / `accept-language` - odtwarzają negocjację języka, żeby
 *     odświeżenie nie skończyło się redirectem zamiast dokumentem,
 *   - ciasteczko JĘZYKA (i tylko ono) - z tego samego powodu.
 * `authorization` i ciasteczka sesji `sb-*` są WYKLUCZONE z definicji:
 * dokument w cache'u jest anonimową skorupą i taki musi pozostać.
 */
function revalidationHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const name of [
    "host",
    "x-forwarded-host",
    "x-forwarded-proto",
    "accept",
    "accept-language",
    "user-agent",
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const lang = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LANG_COOKIE}=`));
  if (lang) headers.set("cookie", lang);
  const [markerName, markerValue] = revalidationHeader();
  headers.set(markerName, markerValue);
  return headers;
}

/**
 * Bezpiecznik linii logu dokumentu (recenzja P0.4, MAJOR 1 i MINOR 9).
 *
 * Na Workers zerwanie klienta nie gwarantuje, że wykona się JS `cancel()`
 * owijki końca body ani że kontekst wywołania dożyje końca strumienia. Dlatego
 * obietnica „linia zapisana" jedzie pod `runAfterResponse` (`ctx.waitUntil`),
 * a ten bezpiecznik rozstrzyga ją najpóźniej po DOC_GUARD_MAX_MS + 2 s od
 * utworzenia owijki. Twardy sufit strażnika dokumentu (20 s) domyka wcześniej
 * WYJŚCIE strażnika, ale strażnik pompuje źródło sam, niezależnie od tempa
 * klienta, a owijka idzie w tempie czytelnika. Bezpiecznik odpala więc wtedy,
 * gdy body nie skończyło się w 22 s: nikt go nie czyta ani nie anuluje,
 * czytelnik jest bardzo wolny (dokument i tak dochodzi później w całości,
 * tylko linia ma już `aborted`) albo strażnik jest wyłączony
 * (SSR_DOC_GUARD=off, wisząca serializacja do ~60 s). Linia wychodzi wtedy ze
 * `streamEnd: "aborted"`, a `streamMs` ≈ `appMs` + 22 000, bo `streamMs` liczy
 * się od wejścia żądania, a bezpiecznik od powrotu handlera. 22 s mieści się
 * w 30 s, które `waitUntil` daje po odpowiedzi. Nastawa `SSR_DOC_GUARD_MAX_MS`
 * z env NIE przesuwa bezpiecznika - podniesiona powyżej 20 s da linię
 * `aborted`, zanim strażnik domknie body.
 */
const DOC_LOG_FUSE_MS = DOC_GUARD_MAX_MS + 2_000;

/**
 * Odświeżanie wpisów NES Edge Cache ZA odpowiedzią (stale-while-revalidate).
 *
 * Dlaczego tutaj, a nie w middleware: rewalidacja musi przejść PEŁNY potok
 * (router → normalizacja 500 → odroczony zapis), a `documentCache.server.ts`
 * zna tylko swoje middleware. Zwrócenie z middleware innej odpowiedzi niż ta,
 * którą zwrócił render, złamałoby tożsamość body koperty SSR i uruchomiło
 * `serverSsr.cleanup()` w trakcie streamowania - dokładnie mechanizm incydentu
 * ~61 s. Dlatego odświeżenie to OSOBNY, pełnoprawny przebieg potoku na
 * syntetycznym żądaniu: własny cykl życia renderu, tożsamość body nienaruszona.
 */
async function revalidateDocument(request: Request): Promise<boolean> {
  const synthetic = new Request(request.url, {
    method: "GET",
    headers: revalidationHeaders(request),
    redirect: "manual",
  });
  const startedAt = Date.now();
  const handler = await getServerEntry();
  const rendered = await fetchWithFrameworkPreloads(handler.fetch, synthetic);
  const normalized = await normalizeCatastrophicSsrResponse(synthetic, rendered);
  const appMs = Date.now() - startedAt;

  // Render w tle też idzie do logu - z flagą, bo to koszt CPU izolatu, a nie
  // czas czytelnika; bez niej zaniżałby rozkład TTFB i zawyżał udział MISS.
  // Bez `streamMs`: body tej odpowiedzi czyta tylko kolektor zapisu niżej.
  //
  // KIEDY (recenzja P0.4, MINOR 5): po decyzji magazynu, żeby `degraded`
  // miało tę samą definicję co na ścieżce czytelnika (także degradacja
  // odkryta W TRAKCIE strumieniowania), ale PRZED wpisem w L1 - `onOutcome`
  // woła się synchronicznie przed `setEntry`, więc harness pomiaru, który po
  // HIT-cie rozgrzewki stawia kursor logu, nie zobaczy tej linii w przebiegu
  // Lighthouse'a. Bez rejestracji zapisu decyzji nie ma na co czekać - linia
  // wychodzi od razu, jak dotąd. Wiszący render: bezpiecznik jak na ścieżce
  // czytelnika (< 30 s budżetu `scheduleRevalidation`).
  //
  // Kolonia i `ray` pochodzą z żądania WYZWALAJĄCEGO i idą wyłącznie do
  // logu - nigdy jako nagłówki syntetycznego żądania, bo te wpływają na render.
  // Ten sam `ray` ma więc też linia czytelnika, która ją wyzwoliła (STALE
  // albo zdegradowany MISS): kto deduplikuje linie po `ray`, musi rozróżniać
  // `revalidation`.
  let logged = false;
  let fuse: ReturnType<typeof setTimeout> | undefined;
  const logOnce = (storeOutcome?: DocumentStoreOutcome): void => {
    if (logged) return;
    logged = true;
    if (fuse !== undefined) clearTimeout(fuse);
    logDocument(synthetic, normalized, {
      serverInitMs: 0,
      appMs,
      colo: requestColo(request),
      cfRay: request.headers.get("cf-ray"),
      storeOutcome,
    });
  };

  let storeWork: Promise<boolean> | null = null;
  const finalized = applyDeferredDocumentStore(
    normalized,
    (work) => {
      storeWork = work;
    },
    logOnce,
  );
  const pending = storeWork as Promise<boolean> | null;
  if (pending) fuse = setTimeout(() => logOnce(), DOC_LOG_FUSE_MS);
  else logOnce();
  // Kolektor zapisu czyta jedną gałąź tee - druga (ta "dla klienta") musi
  // zostać skonsumowana, inaczej strumień renderu nigdy nie dojdzie do końca.
  // Strażnik strumienia jest tu zbędny: nikt na tę odpowiedź nie czeka, a
  // wiszący render zamknie się własnym budżetem albo poleci w catch wołającego.
  await finalized.arrayBuffer().catch(() => undefined);

  // Brak rejestracji zapisu = render nie dał dokumentu nadającego się do
  // cache'owania (redirect, 404, `no-store`). Wpis zostaje STALE i kolejne
  // żądanie spróbuje ponownie - nigdy nie nadpisujemy go czymś gorszym.
  if (!pending) return false;
  try {
    return await pending;
  } finally {
    // Zapis rozstrzygnął się bez decyzji (np. odrzucona praca) - linia i tak.
    logOnce();
  }
}

setDocumentRevalidator(revalidateDocument);

/**
 * Licznik żądań TEGO izolatu i znacznik jego pierwszego żądania - flaga
 * zimnego startu w logu (`isoReq == 1`) i wiek izolatu (`isoAgeS`).
 *
 * Znacznik jest brany LENIWIE, przy pierwszym żądaniu, a nie w zasięgu
 * modułu: zegar Workers stoi w czasie czystej pracy CPU (Date.now() rusza
 * się tylko na I/O), więc czas „załadowania modułu" - liczony w trakcie
 * parsowania 13 MB bundla - nie znaczyłby nic (werdykt SC-1, poprawka b).
 * Liczymy KAŻDE żądanie, które weszło do `fetch` (też API i assety
 * przechodzące przez worker): zimny start płaci pierwsze z nich, nie
 * pierwsze żądanie dokumentu. Rewalidacja w tle nie jest liczona - nie
 * przyszła z zewnątrz.
 */
let isolateRequests = 0;
let isolateFirstRequestAt: number | null = null;

function countIsolateRequest(now: number): IsolateSample {
  isolateRequests += 1;
  if (isolateFirstRequestAt === null) isolateFirstRequestAt = now;
  return {
    isoReq: isolateRequests,
    isoAgeS: Math.max(0, Math.round((now - isolateFirstRequestAt) / 1000)),
    coldEntry: !serverEntryReady,
  };
}

/**
 * Odroczony zapis NES Edge Cache razem z jego wynikiem dla linii logu
 * (recenzja P0.4, MAJOR 2). Własność pracy zapisu przejmuje wołający
 * (`onStore`), więc wiadomo, czy tee ruszył i decyzja jeszcze przed nami.
 */
interface TrackedStore {
  /** Praca zapisu (tee) albo null: odpowiedź nie była zarejestrowana do zapisu. */
  readonly work: Promise<boolean> | null;
  /** Decyzja magazynu; undefined = brak zapisu albo decyzja jeszcze nie zapadła. */
  readonly outcome: DocumentStoreOutcome | undefined;
  /** Rozstrzyga się z decyzją magazynu (od razu, gdy zapisu nie ma). */
  readonly decided: Promise<void>;
}

function applyTrackedDocumentStore(response: Response): {
  response: Response;
  store: TrackedStore;
} {
  let work: Promise<boolean> | null = null;
  let outcome: DocumentStoreOutcome | undefined;
  let markDecided: () => void = () => {};
  const decided = new Promise<void>((resolve) => {
    markDecided = resolve;
  });
  const finalized = applyDeferredDocumentStore(
    response,
    (pending) => {
      work = pending;
    },
    (result) => {
      outcome = result;
      markDecided();
    },
  );
  const store: TrackedStore = {
    get work() {
      return work;
    },
    get outcome() {
      return outcome;
    },
    decided,
  };
  if (!store.work) markDecided();
  return { response: finalized, store };
}

/**
 * Czekanie na decyzję magazynu przy NORMALNYM końcu body - najwyżej jedno
 * makrozadanie. Gdy źródło renderu domknęło się samo, gałąź tee kolektora
 * zapisu dostaje `done` w tym samym kroku co gałąź czytelnika, a decyzja
 * zapada w tej samej serii mikrozadań; makrozadanie jest wyłącznie
 * bezpiecznikiem. Dłużej czekać nie wolno, bo owijka wstrzymuje koniec body
 * czytelnika do rozstrzygnięcia: po zamknięciu wymuszonym przez strażnika
 * (sentinel/idle/timeout) render wciąż trwa, a kolektor czyta go dalej -
 * wtedy linia wychodzi bez `store`, z `degraded` z nagłówków.
 */
function awaitStoreDecision(store: TrackedStore): Promise<void> {
  return new Promise<void>((resolve) => {
    const cap = setTimeout(resolve, 0);
    void store.decided.then(() => {
      clearTimeout(cap);
      resolve();
    });
  });
}

/** Kolonia z `request.cf.colo` (Workers), fallback: sufiks nagłówka `cf-ray`. */
function requestColo(request: Request): string | null {
  const cf = "cf" in request ? request.cf : undefined;
  return resolveRequestColo(cf, request.headers.get("cf-ray"));
}

/**
 * Czy MISS pełnego dokumentu wyszedł zdegradowany: polityka zapisu odmówiła
 * mu wspólnego cache'a - `private, no-store` w nagłówkach (odporny loader
 * albo dociśnięcie na granicy handlera w `applyDeferredDocumentStore`) ALBO
 * decyzja magazynu `degraded` (dyrektywa trasy zawężona dopiero W TRAKCIE
 * strumieniowania - nagłówki już wyszły, więc tego nie widzą). Ta sama
 * definicja co odświeżenie po degradacji w documentCache.server.ts.
 * Undefined poza MISS-em 200/HTML - HIT/STALE z definicji podają czysty wpis,
 * a BYPASS nie konsultował cache'a.
 */
function degradedMiss(
  response: Response,
  storeOutcome: DocumentStoreOutcome | undefined,
): boolean | undefined {
  const contentType = response.headers.get("content-type");
  if (response.headers.get(NES_CACHE_HEADER) !== "MISS") return undefined;
  if (response.status !== 200 || !contentType?.includes("text/html")) return undefined;
  if (storeOutcome === "degraded") return true;
  return !documentStorePolicy(response.status, contentType, response.headers.get("cache-control"))
    .store;
}

interface DocumentLogTiming {
  serverInitMs: number;
  appMs: number;
  /** Próbka licznika izolatu - tylko żądania z zewnątrz (nie rewalidacja). */
  isolate?: IsolateSample;
  colo?: string | null;
  /**
   * `cf-ray` do linii zamiast nagłówka `request` - rewalidacja w tle podaje
   * ray żądania, które ją wyzwoliło (syntetyczne żądanie go nie niesie).
   */
  cfRay?: string | null;
  /** Koniec body względem wejścia żądania; brak = odpowiedź bez body. */
  streamMs?: number;
  streamEnd?: BodyEndOutcome;
  /** Decyzja odroczonego zapisu, jeśli zapadła przed linią. */
  storeOutcome?: DocumentStoreOutcome;
}

/**
 * Jedna linia JSON per dokument HTML do Workers Logs (audyt 0.1 / F40).
 * Hosting zdejmuje `Server-Timing` i `x-nes-cache` z odpowiedzi, więc to
 * JEDYNE miejsce, w którym rozkład TTFB na fazy i status cache przeżywają.
 * Bez PII: sama ścieżka (bez query), status, liczby, kolonia, `cf-ray`
 * i KLASA user-agenta (nigdy sam napis, nigdy IP). Nigdy nie rzuca.
 */
function logDocument(request: Request, response: Response, timing: DocumentLogTiming): void {
  if (!response.headers.get("content-type")?.includes("text/html")) return;
  try {
    const [markerName, markerValue] = revalidationHeader();
    console.log(
      JSON.stringify(
        buildDocumentLogLine({
          path: new URL(request.url).pathname,
          status: response.status,
          cacheStatus: response.headers.get("x-nes-cache"),
          serverTiming: response.headers.get("server-timing"),
          serverInitMs: timing.serverInitMs,
          appMs: timing.appMs,
          revalidation: request.headers.get(markerName) === markerValue,
          streamMs: timing.streamMs,
          streamEnd: timing.streamEnd,
          colo: timing.colo,
          isolate: timing.isolate,
          userAgent: request.headers.get("user-agent"),
          cfRay: timing.cfRay !== undefined ? timing.cfRay : request.headers.get("cf-ray"),
          degraded: degradedMiss(response, timing.storeOutcome),
          storeOutcome: timing.storeOutcome,
        }),
      ),
    );
  } catch {
    /* telemetria nie może zerwać potoku dokumentu */
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    // Licznik izolatu PRZED `try`: strona 500 z `catch` też ma linię logu
    // (recenzja P0.4, MINOR 8), także gdy padł import entry na zimnym izolacie.
    const startedAt = Date.now();
    const isolate = countIsolateRequest(startedAt);
    let initializedAt: number | null = null;
    try {
      const handler = await getServerEntry();
      initializedAt = Date.now();
      const response = await fetchWithFrameworkPreloads(handler.fetch, request);
      const normalized = await normalizeCatastrophicSsrResponse(request, response);
      // Odroczony zapis NES Edge Cache: tee strumienia dokumentu MUSI się
      // wydarzyć dopiero tutaj, ZA egzekutorem middleware TanStack Start -
      // tee w środku łańcucha łamie tożsamość body koperty SSR i egzekutor
      // wołał serverSsr.cleanup() w trakcie streamowania (incydent ~61 s,
      // patrz documentCache.server.ts). Praca zapisu jedzie pod `waitUntil`
      // jak dotąd; przejmujemy ją tylko po to, żeby linia logu znała wynik.
      const { response: stored, store } = applyTrackedDocumentStore(normalized);
      if (store.work) runAfterResponse(store.work);
      // Dokumenty HTML wychodzą wyłącznie przez strażnika strumienia - body
      // ZAWSZE się kończy, niezależnie od stanu serializacji frameworka.
      const guarded = guardDocumentResponse(request, stored);
      if (!guarded.headers.get("content-type")?.includes("text/html")) return guarded;
      // Measured outside the router's SSR budget and outside the cache write:
      // includes current middleware and cache lookup work on both MISS/HIT.
      // Body streaming and network transport happen later, so this is not TTFB.
      // Zegar Workers stoi w czasie czystej pracy CPU, więc appMs i streamMs
      // nie widzą CPU renderu między await-ami ani startu izolatu; to daje
      // dopiero `cpuTimeMs`/`wallTimeMs` wywołania w Workers Logs.
      const serverInitMs = initializedAt - startedAt;
      const appMs = Date.now() - startedAt;
      const colo = requestColo(request);
      const headers = new Headers(guarded.headers);
      // Bez metryki końca strumienia: nagłówki wychodzą PRZED body.
      headers.append("server-timing", buildEntryServerTimingValue(serverInitMs, appMs, colo));
      const timing: DocumentLogTiming = { serverInitMs, appMs, isolate, colo };
      // Linia logu powstaje PO KOŃCU body, żeby niosła `streamMs`. Owijka
      // siedzi na JUŻ przebudowanym Response - za tee zapisu i za strażnikiem,
      // poza zasięgiem porównania tożsamości body egzekutora (incydent ~61 s).
      // HEAD i odpowiedź bez body nie mają końca strumienia, na który dałoby
      // się czekać (runtime takiego body nie czyta) - logujemy od razu.
      let body: ReadableStream<Uint8Array> | null = guarded.body;
      if (body && request.method !== "HEAD") {
        let lineWritten: () => void = () => {};
        const written = new Promise<void>((resolve) => {
          lineWritten = resolve;
        });
        const write = (outcome: BodyEndOutcome, endedAt: number): void => {
          logDocument(request, guarded, {
            ...timing,
            streamMs: endedAt - startedAt,
            streamEnd: outcome,
            storeOutcome: store.outcome,
          });
          lineWritten();
        };
        body = observeBodyEnd(
          body,
          (outcome) => {
            const endedAt = Date.now();
            // Zerwanie i bezpiecznik: linia OD RAZU, z tym, co magazyn już
            // wie (tee kolektora potrafi trzymać render jeszcze długo).
            if (outcome !== "done" || !store.work || store.outcome !== undefined) {
              write(outcome, endedAt);
              return undefined;
            }
            // Normalny koniec MISS-a do zapisu: decyzja magazynu zapada
            // w tej samej serii mikrozadań - czytelnik zobaczy `done` po
            // linii z prawdziwym `degraded`/`store` (owijka czeka na tę
            // obietnicę, najwyżej jedno makrozadanie).
            return awaitStoreDecision(store).then(() => write(outcome, endedAt));
          },
          { fuseMs: DOC_LOG_FUSE_MS },
        );
        // Na Workers kontekst wywołania żyje tyle, ile `waitUntil` - bez tego
        // linia zerwanego dokumentu mogłaby nie powstać wcale (MAJOR 1).
        runAfterResponse(written);
      } else {
        logDocument(request, guarded, timing);
      }
      return new Response(body, {
        status: guarded.status,
        statusText: guarded.statusText,
        headers,
      });
    } catch (error) {
      if (isClientAbort(request, error)) {
        return new Response(null, { status: 499, headers: { "cache-control": "no-store" } });
      }
      console.error(error);
      const page = new Response(renderErrorPage(), {
        status: 500,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      });
      // Wyjątek przed dispatchem (też padnięty import entry na zimnym
      // izolacie) to dokument jak każdy inny: linia z licznikiem izolatu
      // i kolonią, bez `streamMs` (body to gotowy napis). Server-Timing tej
      // strony zostaje bez zmian - kolonia jest tu tylko w logu. Dotyczy
      // KAŻDEGO żądania, które tu wpadło, także /api i zasobów idących przez
      // worker: strona błędu to HTML, więc linia ma `kind: "doc"`
      // i `cache: null`, a harness pomiaru liczy ją jako render serwera.
      const failedAt = Date.now();
      logDocument(request, page, {
        serverInitMs: (initializedAt ?? failedAt) - startedAt,
        appMs: failedAt - startedAt,
        isolate,
        colo: requestColo(request),
      });
      return page;
    }
  },
};
