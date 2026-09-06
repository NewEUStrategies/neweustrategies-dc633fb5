// NES Edge Cache - warstwa wykonawcza: dwupoziomowy magazyn + middleware
// dokumentów SSR. Polityka (co i pod jakim kluczem wolno cache'ować) żyje w
// czystym `src/lib/http/documentCache.ts`; tutaj jest wyłącznie pamięć,
// single-flight stale-while-revalidate i zszycie z potokiem żądań.
//
// Architektura dwupoziomowa:
//   - L1: mapa w pamięci izolatu (mikrosekundy, znika z rotacją izolatu);
//   - L2: Cloudflare Cache API per-colo (`documentCacheL2.server.ts`) -
//     współdzielone między izolatami kolonii, unieważniane kluczem
//     wersjonowanym przy purge; poza Workers L2 degraduje do no-op.
//
// Właściwości:
//   - HIT: odpowiedź prosto z L1 (zero SSR, zero odczytów bazy); L1 miss
//     próbuje L2 i - przy trafieniu - zasiewa L1, więc świeży izolat grzeje
//     się jednym odczytem z kolonii zamiast pełnym renderem;
//   - STALE: wpis po świeżości serwowany natychmiast, a odświeżenie biegnie
//     ZA odpowiedzią (`ctx.waitUntil`, single-flight per klucz) - żaden
//     czytelnik nie płaci renderu, dopóki mamy co podać. Nieudane odświeżenie
//     zostawia wpis nietknięty, więc stale działa też jako bezpiecznik na
//     czkawkę bazy; dopiero wypadnięcie z okna SWR daje zwykły MISS.
//     Bez zarejestrowanego drivera (`setDocumentRevalidator`, wpinany
//     z src/server.ts) mechanizm degraduje do wariantu blokującego: jedno
//     żądanie płaci rewalidację synchronicznie;
//   - MISS: middleware wyłącznie dekoruje nagłówki i REJESTRUJE odroczony
//     zapis (WeakMap po tożsamości strumienia body); tee + zbieranie kopii do
//     L1/L2 wykonuje `applyDeferredDocumentStore` w src/server.ts, ZA
//     egzekutorem middleware - tee w środku łańcucha łamał tożsamość body
//     koperty SSR i framework ubijał serwerowy cykl życia renderu w trakcie
//     streamowania (incydent ~61 s, opis przy `decorateMissAndDeferStore`);
//     kopia zbiera się pod `ctx.waitUntil`, więc domknięcie żądania jej nie
//     ucina;
//   - budżet bajtów z approx-LRU (Map w kolejności wstawień, odświeżanej przy
//     trafieniu) - ten sam wzorzec co `edgeTtlCache`, ale liczony w bajtach;
//   - klucz prefiksowany hostem tenanta ("by construction", multi-tenant safe);
//   - Server-Timing: status cache + `ssr;dur` (czas renderu) + `db;dur`
//     (koszt round-tripów planu anon, patrz `ssrTiming.server.ts`);
//   - kill-switch środowiskowy: NES_EDGE_CACHE=off.
//
// Spójność publikacji: purge czyści L1 bieżącego izolatu i podbija wersję L2
// (cała kolonia natychmiast), a pozostałe kolonie doganiają w oknie świeżości
// (maks. DOCUMENT_CACHE_MAX_FRESH_MS = 3 min) - ściśle nie gorzej niż dawny
// per-isolate purge, zwykle dużo lepiej.
import { createMiddleware } from "@tanstack/react-start";

import {
  DOCUMENT_CACHE_MAX_ENTRY_BYTES,
  DOCUMENT_CACHE_MAX_TOTAL_BYTES,
  NES_CACHE_AGE_HEADER,
  NES_CACHE_HEADER,
  NES_EDGE_CACHE_NAME,
  NES_REVALIDATE_HEADER,
  documentStorePolicy,
  planDocumentCache,
  type NesCacheStatus,
} from "@/lib/http/documentCache";
import { readRouteCacheDirective } from "@/lib/http/responseHeaders";
import { currentTenantHost, trustedPublicHost } from "@/lib/http/requestHost";
import { getMiddlewareResponse, withMiddlewareResponse } from "@/lib/http/middlewareResult";
import {
  bumpL2Version,
  l2Match,
  l2Put,
  l2Stats,
  recordL2Serve,
  type L2DocumentEntry,
} from "@/lib/http/documentCacheL2.server";
import { runAfterResponse } from "@/lib/http/waitUntil.server";
import { buildServerTimingValue, type SsrDbTiming } from "@/lib/http/ssrTiming";

/**
 * Migawka telemetrii DB bieżącego żądania. Część server-only telemetrii
 * (getRequest/WeakMap) jest ładowana dynamicznie za bramką SSR - ten moduł
 * jest osiągalny w grafie KLIENTA przez start.ts, a statyczny import
 * `@tanstack/react-start/server` zatrzymałby build na import-protection
 * (dokładnie ten sam wzorzec co lib/http/requestHost.ts).
 */
async function readDbTimingSafe(request: Request): Promise<SsrDbTiming | null> {
  if (!import.meta.env.SSR) return null;
  try {
    const mod = await import("@/lib/http/ssrTiming.server");
    return mod.readDbTiming(request);
  } catch {
    return null;
  }
}

interface DocumentCacheEntry {
  body: Uint8Array;
  bytes: number;
  contentType: string;
  cacheControl: string;
  contentLanguage: string | null;
  /** Nagłówek `Link` renderu (preload LCP/fontów) - bez utrwalenia go tutaj
   *  hinty preload znikałyby na HIT/STALE, czyli dokładnie na ścieżce, którą
   *  dostaje większość czytelników. */
  link: string | null;
  storedAt: number;
  freshMs: number;
  swrMs: number;
}

export interface DocumentCacheL2Snapshot {
  enabled: boolean;
  hits: number;
  stale: number;
  stores: number;
  bumps: number;
}

export interface DocumentCacheSnapshot {
  name: string;
  enabled: boolean;
  entries: number;
  bytes: number;
  maxBytes: number;
  hits: number;
  stale: number;
  misses: number;
  bypass: number;
  stores: number;
  evictions: number;
  purges: number;
  /**
   * Dokumenty ODRZUCONE z cache'a, bo przekroczyły limit rozmiaru wpisu.
   * Rosnące oversize przy stores == 0 dla danej trasy oznacza, że KAŻDY
   * czytelnik płaci pełny render SSR - to była niewidoczna dotąd przyczyna
   * wolnego pierwszego wejścia (diagnoza 2026-08-18).
   */
  oversize: number;
  /** Odświeżenia wpisów uruchomione ZA odpowiedzią (stale-while-revalidate). */
  revalidations: number;
  /** Z tego takie, które nie odłożyły świeżego dokumentu (wpis został STALE). */
  revalidationFailures: number;
  startedAt: string;
  /** Warstwa per-colo (Cache API); `enabled: false` poza Workers. */
  l2: DocumentCacheL2Snapshot;
  /** Ostatnie decyzje cache'a (najnowsze pierwsze) - obserwowalność bez nagłówków. */
  recent: DocumentCacheDecision[];
}

/**
 * Jedna decyzja cache'a zapisana w pierścieniu w pamięci.
 *
 * Warstwa hostingu zdejmuje `x-nes-cache` i `Server-Timing` z odpowiedzi
 * wychodzącej (i nadpisuje `Cache-Control`), więc skuteczności NES Edge Cache
 * nie da się zmierzyć z zewnątrz. Ten pierścień jest źródłem prawdy dla karty
 * /admin/performance: status jest zapisywany po stronie serwera, dokładnie w
 * miejscu podjęcia decyzji, zanim cokolwiek dotknie odpowiedzi.
 */
export interface DocumentCacheDecision {
  at: string;
  path: string;
  status: NesCacheStatus;
  /** Wiek serwowanego wpisu w sekundach (HIT/STALE). */
  ageS?: number;
  /** Czas renderu SSR w ms (MISS / rewalidacja). */
  renderMs?: number;
  /** Cache-Control wyliczony przez aplikację (przed ewentualną zmianą na brzegu). */
  cacheControl?: string;
}

const store = new Map<string, DocumentCacheEntry>();
const revalidating = new Set<string>();
let totalBytes = 0;

const stats = {
  hits: 0,
  stale: 0,
  misses: 0,
  bypass: 0,
  stores: 0,
  evictions: 0,
  purges: 0,
  /** Dokumenty za duże na wpis (> DOCUMENT_CACHE_MAX_ENTRY_BYTES) - patrz komentarz przy stałej. */
  oversize: 0,
  revalidations: 0,
  revalidationFailures: 0,
  startedAt: new Date().toISOString(),
};

/**
 * Nonce znacznika rewalidacji, losowany RAZ na izolat. Rewalidacja biegnie
 * w procesie (ten sam izolat woła ten sam handler), więc wartość nigdy nie
 * opuszcza pamięci workera - żądanie z zewnątrz nie ma jak jej odgadnąć,
 * a bez trafienia w nonce nagłówek jest ignorowany. `crypto.randomUUID` jest
 * dostępne w workerd i w Node >= 19; fallback jest tylko higieną.
 */
const REVALIDATE_NONCE: string = (() => {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `nes-${Date.now().toString(36)}`;
  }
})();

/**
 * Driver pełnego przebiegu potoku dla ODŚWIEŻENIA wpisu w tle. Rejestrowany
 * z `src/server.ts` - tylko tam żyje komplet warstw (handler routera →
 * normalizacja 500 → `applyDeferredDocumentStore`), a ten moduł ma decydować
 * KIEDY odświeżyć, nie JAK uruchomić render.
 *
 * Kontrakt: rozwiązuje się dopiero, gdy odświeżony dokument jest ZAPISANY
 * (albo gdy przebieg się nie powiódł - wtedy rzuca albo zwraca false).
 */
export type DocumentRevalidator = (request: Request) => Promise<boolean>;

/**
 * Sufit czasu, po którym zamek single-flight klucza jest zwalniany niezależnie
 * od losu odświeżenia. Powyżej twardego budżetu strażnika dokumentu
 * (DOC_GUARD_MAX_MS = 20 s), żeby normalny render zawsze zdążył pierwszy.
 */
const DOCUMENT_REVALIDATE_TIMEOUT_MS = 30_000;

let documentRevalidator: DocumentRevalidator | null = null;

/**
 * Wpięcie drivera rewalidacji w tle (woła `src/server.ts` przy starcie
 * modułu). Bez rejestracji mechanizm degraduje do zachowania sprzed zmiany:
 * pierwsze żądanie w oknie STALE płaci render synchronicznie. Tak działa
 * m.in. suita jednostkowa, która woła `handleDocumentRequest` bez potoku.
 */
export function setDocumentRevalidator(revalidator: DocumentRevalidator | null): void {
  documentRevalidator = revalidator;
}

/** Żądanie jest odświeżeniem w tle wystawionym przez ten izolat? */
function isRevalidationRequest(request: Request): boolean {
  return request.headers.get(NES_REVALIDATE_HEADER) === REVALIDATE_NONCE;
}

/** Nagłówek znacznika do doklejenia do syntetycznego żądania rewalidacji. */
export function revalidationHeader(): [string, string] {
  return [NES_REVALIDATE_HEADER, REVALIDATE_NONCE];
}

/**
 * Odświeżenie wpisu ZA odpowiedzią: czytelnik dostał już dokument STALE,
 * a pełny render biegnie pod `ctx.waitUntil`. Single-flight po kluczu chroni
 * przed stampede, gdy wielu czytelników trafi w to samo okno.
 *
 * Porażka jest bezpieczna z konstrukcji: wpis zostaje STALE, więc kolejne
 * żądanie po prostu spróbuje ponownie, a gdy wypadnie z okna SWR - zapłaci
 * zwykły MISS. Nic tu nie może zerwać ścieżki czytelnika.
 */
function scheduleRevalidation(request: Request, key: string): void {
  const revalidator = documentRevalidator;
  if (!revalidator || revalidating.has(key)) return;
  revalidating.add(key);
  stats.revalidations += 1;
  runAfterResponse(
    Promise.race([
      revalidator(request),
      // Zwolnienie zamka single-flight jest gwarantowane CZASEM, nie
      // grzecznością drivera: render, który nigdy się nie domknie (wisząca
      // serializacja - patrz documentStreamGuard), zablokowałby odświeżanie
      // tego klucza do końca życia izolatu. Sufit jest wyżej niż twardy
      // budżet strażnika dokumentu (20 s), więc normalna ścieżka nigdy tu
      // nie dobija.
      new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(false), DOCUMENT_REVALIDATE_TIMEOUT_MS),
      ),
    ])
      .then((stored) => {
        if (!stored) stats.revalidationFailures += 1;
      })
      .catch(() => {
        stats.revalidationFailures += 1;
      })
      .finally(() => {
        revalidating.delete(key);
      }),
  );
}

const RECENT_DECISIONS_LIMIT = 50;
const recentDecisions: DocumentCacheDecision[] = [];

function recordDecision(decision: DocumentCacheDecision): void {
  recentDecisions.unshift(decision);
  if (recentDecisions.length > RECENT_DECISIONS_LIMIT)
    recentDecisions.length = RECENT_DECISIONS_LIMIT;
}

function cacheEnabled(): boolean {
  const flag =
    typeof process !== "undefined" ? (process.env.NES_EDGE_CACHE ?? "").toLowerCase() : "";
  return flag !== "off" && flag !== "0" && flag !== "false";
}

function evictUntilFits(incomingBytes: number): void {
  while (totalBytes + incomingBytes > DOCUMENT_CACHE_MAX_TOTAL_BYTES && store.size > 0) {
    const oldestKey = store.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = store.get(oldestKey);
    store.delete(oldestKey);
    totalBytes -= oldest?.bytes ?? 0;
    stats.evictions += 1;
  }
}

function setEntry(key: string, entry: DocumentCacheEntry): void {
  const previous = store.get(key);
  if (previous) {
    store.delete(key);
    totalBytes -= previous.bytes;
  }
  evictUntilFits(entry.bytes);
  store.set(key, entry);
  totalBytes += entry.bytes;
  stats.stores += 1;
}

/** Odśwież pozycję LRU trafionego klucza (Map trzyma kolejność wstawień). */
function touchEntry(key: string, entry: DocumentCacheEntry): void {
  store.delete(key);
  store.set(key, entry);
}

function replay(
  entry: DocumentCacheEntry,
  status: NesCacheStatus,
  now: number,
  path: string,
): Response {
  const ageS = Math.max(0, Math.round((now - entry.storedAt) / 1000));
  recordDecision({
    at: new Date(now).toISOString(),
    path,
    status,
    ageS,
    cacheControl: entry.cacheControl,
  });
  const headers = new Headers({
    "content-type": entry.contentType,
    "cache-control": entry.cacheControl,
    [NES_CACHE_HEADER]: status,
    [NES_CACHE_AGE_HEADER]: String(Math.max(0, Math.round((now - entry.storedAt) / 1000))),
    "server-timing": buildServerTimingValue(status, undefined, undefined, now - entry.storedAt),
  });
  if (entry.contentLanguage) headers.set("content-language", entry.contentLanguage);
  // Hinty preload (obraz LCP, fonty) wracają na odpowiedź także z cache'a -
  // HIT/STALE to główna ścieżka czytelników i główny beneficjent Early Hints.
  if (entry.link) headers.set("link", entry.link);
  // Kopia bufora: Response może zostać skonsumowane/transferowane przez runtime,
  // a wpis musi pozostać nienaruszony dla kolejnych trafień.
  return new Response(entry.body.slice(), { status: 200, headers });
}

/** Wpis L1 zbudowany z wpisu L2 (odczyt z kolonii zasiewa pamięć izolatu). */
function entryFromL2(l2Entry: L2DocumentEntry): DocumentCacheEntry {
  return {
    body: l2Entry.body,
    bytes: l2Entry.body.byteLength,
    contentType: l2Entry.contentType,
    cacheControl: l2Entry.cacheControl,
    contentLanguage: l2Entry.contentLanguage,
    link: l2Entry.link,
    storedAt: l2Entry.storedAt,
    freshMs: l2Entry.freshMs,
    swrMs: l2Entry.swrMs,
  };
}

interface RenderTiming {
  renderMs: number;
  db: SsrDbTiming | null;
}

function withCacheStatus(
  response: Response,
  status: NesCacheStatus,
  timing?: RenderTiming,
): Response {
  const headers = new Headers(response.headers);
  headers.set(NES_CACHE_HEADER, status);
  headers.set("server-timing", buildServerTimingValue(status, timing?.renderMs, timing?.db));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Zbiera kopię strumienia renderu do bufora (z twardym limitem rozmiaru).
 * Zwraca null, gdy dokument przekroczy limit - wtedy po prostu nie cache'ujemy.
 */
async function collectStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array | "oversize" | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        if (received > maxBytes) {
          // Rozróżniamy odrzut rozmiarowy od błędu strumienia: za duży
          // dokument to sygnał operacyjny (trasa wypada z cache'a NA STAŁE),
          // a nie chwilowy zgrzyt sieci - wołający zlicza go osobno.
          await reader.cancel();
          return "oversize";
        }
        chunks.push(value);
      }
    }
  } catch {
    return null;
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Zapis odroczony do warstwy ZA egzekutorem middleware (patrz
 * `applyDeferredDocumentStore`). Klucz: TOŻSAMOŚĆ strumienia body - dokładnie
 * ta sama tożsamość, którą egzekutor TanStack Start śledzi między kopertą SSR
 * a finalną odpowiedzią. WeakMap = zero wycieków: nieodebrany wpis znika
 * razem ze strumieniem.
 */
interface DeferredDocumentStore {
  request: Request;
  host: string | null;
  key: string;
  contentType: string;
  cacheControl: string;
  contentLanguage: string | null;
  link: string | null;
  storedAt: number;
  freshMs: number;
  swrMs: number;
}

const deferredStores = new WeakMap<ReadableStream<Uint8Array>, DeferredDocumentStore>();

/**
 * Render przeszedł - dekorujemy odpowiedź nagłówkami MISS i - jeśli polityka
 * pozwala - REJESTRUJEMY odroczony zapis do L1/L2 pod tożsamością strumienia
 * body. Świadomie NIE tee-ujemy tutaj.
 *
 * INCYDENT 2026-07-30 ("operator płatności widzi offline", każda strona ~61 s): egzekutor
 * request-middleware TanStack Start przekazuje streamowaną odpowiedź SSR jako
 * kopertę `{ response, serverSsrCleanup: "stream", dispose }` i po przejściu
 * łańcucha porównuje TOŻSAMOŚĆ `response.body` z ciałem koperty. `tee()`
 * w środku middleware podmieniał body (`toClient`), więc egzekutor uznawał
 * odpowiedź za "podmienioną" i wołał `dispose()` -> `serverSsr.cleanup()`
 * W TRAKCIE streamowania. Przedwczesny cleanup tłumi sygnał końca serializacji
 * seroval (guard `cleanupStarted`), `transformStreamWithRouter` czeka na niego
 * do twardego limitu 60 s i ubija strumień błędem - stąd ~61 s na KAŻDYM
 * renderze dokumentu. Tee wykonuje się teraz w src/server.ts, poza zasięgiem
 * porównania tożsamości (`applyDeferredDocumentStore`).
 */
function decorateMissAndDeferStore(
  request: Request,
  host: string | null,
  key: string,
  path: string,
  response: Response,
  now: number,
  timing?: RenderTiming,
): Response {
  recordDecision({
    at: new Date(now).toISOString(),
    path,
    status: "MISS",
    ...(timing?.renderMs === undefined ? {} : { renderMs: timing.renderMs }),
    cacheControl: response.headers.get("cache-control") ?? undefined,
  });
  const policy = documentStorePolicy(
    response.status,
    response.headers.get("content-type"),
    response.headers.get("cache-control"),
  );
  if (policy.store && response.body) {
    deferredStores.set(response.body, {
      request,
      host,
      key,
      contentType: response.headers.get("content-type") ?? "text/html; charset=utf-8",
      cacheControl: response.headers.get("cache-control") ?? "",
      contentLanguage: response.headers.get("content-language"),
      link: response.headers.get("link"),
      storedAt: now,
      freshMs: policy.freshMs,
      swrMs: policy.swrMs,
    });
  }
  return withCacheStatus(response, "MISS", timing);
}

/**
 * Druga połowa zapisu MISS, wołana z `src/server.ts` PO wyjściu odpowiedzi
 * z egzekutora middleware (tam tożsamość body już nie podlega kontroli
 * frameworka): tee strumienia, czytelnik dostaje streaming bez zmian, kopia
 * zbiera się do L1 i L2 pod `ctx.waitUntil`. Kolejne przebudowy Response
 * w łańcuchu middleware zachowują ten sam obiekt strumienia, więc rejestracja
 * z wnętrza middleware jest tu widoczna 1:1.
 */
export function applyDeferredDocumentStore(
  response: Response,
  /**
   * Przejęcie własności zapisu przez wołającego. Domyślnie zapis jedzie pod
   * `ctx.waitUntil` i nikt na niego nie czeka (ścieżka czytelnika). Driver
   * rewalidacji w tle podstawia tu własny kolektor, bo MUSI wiedzieć, kiedy
   * odświeżony wpis realnie wylądował w magazynie - inaczej zwolniłby
   * single-flight zanim cokolwiek się zapisało.
   */
  onStore?: (work: Promise<boolean>) => void,
): Response {
  if (!response.body) return response;
  const record = deferredStores.get(response.body);
  if (!record) return response;
  deferredStores.delete(response.body);

  // A later middleware, h3 header merge, or a Suspense boundary may tighten
  // cache policy after the write was registered. Recheck at BOTH boundaries:
  // before teeing and after the document has finished streaming.
  const canStillStore = () => {
    const directive = readRouteCacheDirective(record.request);
    return (
      documentStorePolicy(
        response.status,
        response.headers.get("content-type"),
        response.headers.get("cache-control"),
      ).store &&
      (!directive || documentStorePolicy(response.status, record.contentType, directive).store)
    );
  };
  if (!canStillStore()) {
    const headers = new Headers(response.headers);
    headers.set("cache-control", "private, no-store");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  // Nagłówek `Link` czytamy TUTAJ, nie w middleware: loadery ustawiają go przez
  // setResponseHeader na nagłówkach ZDARZENIA h3, a te scalają się z odpowiedzią
  // dopiero w toResponse() na granicy requestHandlera - czyli ZA całym łańcuchem
  // middleware. Wewnątrz decorateMissAndDeferStore `headers.get("link")` jest
  // więc zawsze null (cache-control przeżywa tylko dlatego, że
  // defaultCacheControlMiddleware dopisuje go wprost na Response w środku
  // łańcucha). Ta funkcja działa w src/server.ts NA ZEWNĄTRZ handlera, gdzie
  // scalone nagłówki już są; `record.link` zostaje fallbackiem dla wywołań,
  // które dostały nagłówek bezpośrednio na odpowiedzi renderu.
  const link = response.headers.get("link") ?? record.link;
  const [toClient, toCache] = response.body.tee();
  const work = collectStream(toCache, DOCUMENT_CACHE_MAX_ENTRY_BYTES).then(async (body) => {
    if (body === "oversize") {
      // GŁOŚNO, nie po cichu: dokument za duży na wpis oznacza, że ta trasa
      // NIGDY nie trafi do cache'a i każdy czytelnik płaci pełny render SSR.
      // Do 2026-08-18 dokładnie tak (bez śladu w logach i licznikach) strona
      // główna wypadała z NES Edge Cache - patrz komentarz przy
      // DOCUMENT_CACHE_MAX_ENTRY_BYTES.
      stats.oversize += 1;
      console.warn(
        `[nes-edge-cache] dokument > ${DOCUMENT_CACHE_MAX_ENTRY_BYTES} B nie wchodzi do cache: ${record.key}`,
      );
      return false;
    }
    if (!body || !canStillStore()) return false;
    const entry: DocumentCacheEntry = {
      body,
      bytes: body.byteLength,
      contentType: record.contentType,
      cacheControl: record.cacheControl,
      contentLanguage: record.contentLanguage,
      link,
      storedAt: record.storedAt,
      freshMs: record.freshMs,
      swrMs: record.swrMs,
    };
    setEntry(record.key, entry);
    await l2Put(record.host, record.key, entry);
    return true;
  });
  if (onStore) onStore(work);
  else runAfterResponse(work);

  return new Response(toClient, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Rdzeń mechanizmu, wydzielony z middleware dla testowalności: pełny cykl
 * BYPASS / HIT / STALE (single-flight) / MISS dla jednego żądania, z L2 jako
 * drugą szansą przed pełnym renderem. Generyk po wyniku `next()` zachowuje typ
 * frameworkowego łańcucha middleware (wynik nie-Response przepływa nietknięty).
 */
export async function handleDocumentRequest<T>(
  request: Request,
  next: () => T | Promise<T>,
): Promise<T | Response> {
  if (!cacheEnabled()) return next();

  // Zaufany (zwalidowany vs tenants.domain) host - klucz cache prefiksowany
  // hostem nie może przyjmować kardynalności wybieranej przez atakującego
  // spreparowanym X-Forwarded-Host, a wpisy tenanta nie mogą być zasiewane
  // renderem wykonanym pod cudzym hostem (poisoning między tenantami).
  const host = await trustedPublicHost(request);
  const path = safePathname(request.url);
  const plan = planDocumentCache(request, host);
  if (plan.kind === "bypass") {
    if (plan.reason !== "method") {
      stats.bypass += 1;
      recordDecision({ at: new Date().toISOString(), path, status: "BYPASS" });
    }
    return next();
  }

  /** next() z pomiarem czasu renderu + kosztu bazy (Server-Timing). */
  const renderWithTiming = async (): Promise<{ result: T; timing: RenderTiming }> => {
    const startedAt = Date.now();
    const result = await next();
    return {
      result,
      timing: { renderMs: Date.now() - startedAt, db: await readDbTimingSafe(request) },
    };
  };

  // Odświeżenie w tle wystawione przez ten izolat: pomija serwowanie z cache'a
  // (inaczej odczytałoby własny nieświeży wpis i nic by nie odświeżyło) i idzie
  // prosto do renderu, którego wynik zapisze `decorateMissAndDeferStore`.
  // Żadnej kolejnej rewalidacji stąd nie planujemy - rekurencja jest wykluczona.
  const revalidation = isRevalidationRequest(request);

  const now = Date.now();
  const entry = revalidation ? undefined : store.get(plan.key);
  if (entry) {
    const age = now - entry.storedAt;
    if (age < entry.freshMs) {
      stats.hits += 1;
      touchEntry(plan.key, entry);
      return replay(entry, "HIT", now, path);
    }
    if (age < entry.freshMs + entry.swrMs) {
      // Właściwe stale-while-revalidate: czytelnik NIGDY nie płaci renderu,
      // dopóki mamy co podać. Render biegnie za odpowiedzią (`ctx.waitUntil`).
      if (documentRevalidator) {
        scheduleRevalidation(request, plan.key);
        stats.stale += 1;
        return replay(entry, "STALE", now, path);
      }
      // Bez zarejestrowanego drivera (suita jednostkowa, obce entry) zostaje
      // zachowanie sprzed zmiany: jedno żądanie płaci rewalidację synchronicznie.
      if (revalidating.has(plan.key)) {
        stats.stale += 1;
        return replay(entry, "STALE", now, path);
      }
      revalidating.add(plan.key);
      try {
        const { result, timing } = await renderWithTiming();
        const rendered = getMiddlewareResponse(result);
        if (rendered) {
          return withMiddlewareResponse(
            result,
            decorateMissAndDeferStore(request, host, plan.key, path, rendered, Date.now(), timing),
          );
        }
        return result;
      } catch {
        // Render się wywalił - nieświeży dokument jest lepszy niż 500.
        stats.stale += 1;
        return replay(entry, "STALE", now, path);
      } finally {
        revalidating.delete(plan.key);
      }
    }
    // Poza oknem SWR - wpis jest martwy, zwolnij bajty od razu.
    store.delete(plan.key);
    totalBytes -= entry.bytes;
  }

  // L1 pusty: zanim zapłacimy pełny render, sprawdź wpis kolonii (L2).
  const l2Entry = revalidation ? null : await l2Match(host, plan.key);
  if (l2Entry) {
    const l2Age = now - l2Entry.storedAt;
    if (l2Age < l2Entry.freshMs) {
      const seeded = entryFromL2(l2Entry);
      setEntry(plan.key, seeded);
      stats.hits += 1;
      recordL2Serve("HIT");
      return replay(seeded, "HIT", now, path);
    }
    if (l2Age < l2Entry.freshMs + l2Entry.swrMs) {
      const staleEntry = entryFromL2(l2Entry);
      // Wpis kolonii też zasiewa L1: kolejne żądania tego izolatu odpowiadają
      // z pamięci, zamiast wracać po ten sam nieświeży dokument do Cache API.
      setEntry(plan.key, staleEntry);
      if (documentRevalidator) {
        scheduleRevalidation(request, plan.key);
        stats.stale += 1;
        recordL2Serve("STALE");
        return replay(staleEntry, "STALE", now, path);
      }
      if (revalidating.has(plan.key)) {
        stats.stale += 1;
        recordL2Serve("STALE");
        return replay(staleEntry, "STALE", now, path);
      }
      revalidating.add(plan.key);
      try {
        const { result, timing } = await renderWithTiming();
        const rendered = getMiddlewareResponse(result);
        if (rendered) {
          return withMiddlewareResponse(
            result,
            decorateMissAndDeferStore(request, host, plan.key, path, rendered, Date.now(), timing),
          );
        }
        return result;
      } catch {
        stats.stale += 1;
        recordL2Serve("STALE");
        return replay(staleEntry, "STALE", now, path);
      } finally {
        revalidating.delete(plan.key);
      }
    }
    // Wpis L2 poza oknem SWR: ignoruj (wygaśnie własnym TTL-em Cache API).
  }

  // Odświeżenie w tle NIE jest chybieniem: czytelnik dostał już dokument
  // z cache'a, a ten render jest jego konsekwencją, nie kosztem wizyty.
  // Doliczanie go do `misses` zaniżałoby współczynnik trafień na karcie
  // /admin/performance o jeden render na każde serwowanie STALE. Renders
  // trafiają za to do pierścienia decyzji (renderMs) i do `revalidations`.
  if (!revalidation) stats.misses += 1;
  const { result, timing } = await renderWithTiming();
  const rendered = getMiddlewareResponse(result);
  if (rendered) {
    return withMiddlewareResponse(
      result,
      decorateMissAndDeferStore(request, host, plan.key, path, rendered, Date.now(), timing),
    );
  }
  return result;
}

/** Middleware do `requestMiddleware` w `src/start.ts` (najbliżej routera). */
export const documentCacheMiddleware = createMiddleware().server(async ({ request, next }) =>
  handleDocumentRequest(request, next),
);

/**
 * Purge wpisów danego hosta (tenant) albo całego magazynu. Wołane po mutacjach
 * treści (publish/update/delete) i z karty admina; zwraca liczbę usuniętych
 * wpisów L1. Warstwa L2 jest unieważniana bumpem wersji (host albo globalnym)
 * pod `ctx.waitUntil` - natychmiast dla całej kolonii, bez iterowania kluczy.
 */
export function purgeDocumentCache(host?: string | null): number {
  let removed = 0;
  if (host) {
    const prefix = `${host}::`;
    for (const [key, entry] of store) {
      if (key.startsWith(prefix)) {
        store.delete(key);
        totalBytes -= entry.bytes;
        removed += 1;
      }
    }
  } else {
    removed = store.size;
    store.clear();
    totalBytes = 0;
  }
  runAfterResponse(bumpL2Version(host ?? null));
  if (removed > 0) stats.purges += 1;
  return removed;
}

/**
 * Purge dokumentów tenanta BIEŻĄCEGO żądania (host z kontekstu request-scope).
 * Fire-and-forget z perspektywy mutacji treści: nigdy nie rzuca, a brak hosta
 * (praca w tle poza żądaniem) degraduje do purge'a całego magazynu - wolimy
 * niepotrzebnie wychłodzić cache niż serwować nieświeżą publikację.
 */
export async function purgeDocumentCacheForCurrentHost(): Promise<number> {
  try {
    const host = await currentTenantHost();
    return purgeDocumentCache(host);
  } catch {
    return 0;
  }
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Migawka do karty "NES Edge Cache" w /admin/performance. */
export function getDocumentCacheSnapshot(): DocumentCacheSnapshot {
  return {
    name: NES_EDGE_CACHE_NAME,
    enabled: cacheEnabled(),
    entries: store.size,
    bytes: totalBytes,
    maxBytes: DOCUMENT_CACHE_MAX_TOTAL_BYTES,
    hits: stats.hits,
    stale: stats.stale,
    misses: stats.misses,
    bypass: stats.bypass,
    stores: stats.stores,
    evictions: stats.evictions,
    purges: stats.purges,
    oversize: stats.oversize,
    revalidations: stats.revalidations,
    revalidationFailures: stats.revalidationFailures,
    startedAt: stats.startedAt,
    l2: l2Stats(),
    recent: [...recentDecisions],
  };
}

/** Wynik sondy: czy dana ścieżka leży w cache'u tej instancji i w jakim stanie. */
export interface DocumentCacheProbe {
  path: string;
  key: string;
  cacheable: boolean;
  /** Powód pominięcia, gdy `cacheable` = false. */
  bypassReason?: string;
  cached: boolean;
  status: NesCacheStatus;
  ageS?: number;
  freshForS?: number;
  bytes?: number;
  cacheControl?: string;
}

/**
 * Sonda "czy ta ścieżka jest w cache'u" - odpowiednik nagłówka `x-nes-cache`,
 * tyle że czytany bezpośrednio z magazynu, więc niewrażliwy na to, co warstwa
 * hostingu robi z nagłówkami odpowiedzi. Nie renderuje niczego i nie rusza
 * liczników.
 */
export async function probeDocumentCache(
  path: string,
  /** Nadpisanie hosta - wyłącznie dla testów; produkcyjnie host bierzemy z żądania. */
  hostOverride?: string | null,
): Promise<DocumentCacheProbe> {
  const host = hostOverride !== undefined ? hostOverride : await currentTenantHost();
  const url = new URL(path, `https://${host ?? "localhost"}`);
  const plan = planDocumentCache(new Request(url, { method: "GET" }), host);
  if (plan.kind === "bypass") {
    return {
      path: url.pathname,
      key: "",
      cacheable: false,
      bypassReason: plan.reason,
      cached: false,
      status: "BYPASS",
    };
  }

  const now = Date.now();
  const entry =
    store.get(plan.key) ??
    (await l2Match(host, plan.key).then((e) => (e ? entryFromL2(e) : undefined)));
  if (!entry) {
    return { path: url.pathname, key: plan.key, cacheable: true, cached: false, status: "MISS" };
  }
  const age = now - entry.storedAt;
  const fresh = age < entry.freshMs;
  const withinSwr = age < entry.freshMs + entry.swrMs;
  return {
    path: url.pathname,
    key: plan.key,
    cacheable: true,
    cached: withinSwr,
    status: fresh ? "HIT" : withinSwr ? "STALE" : "MISS",
    ageS: Math.max(0, Math.round(age / 1000)),
    freshForS: Math.max(0, Math.round((entry.freshMs - age) / 1000)),
    bytes: entry.bytes,
    cacheControl: entry.cacheControl,
  };
}

/** Hak testowy: wyczyść magazyn, liczniki i stan single-flight. */
export function resetDocumentCacheForTests(): void {
  store.clear();
  revalidating.clear();
  totalBytes = 0;
  stats.hits = 0;
  stats.stale = 0;
  stats.misses = 0;
  stats.bypass = 0;
  stats.stores = 0;
  stats.evictions = 0;
  stats.purges = 0;
  stats.oversize = 0;
  stats.revalidations = 0;
  stats.revalidationFailures = 0;
  stats.startedAt = new Date().toISOString();
  recentDecisions.length = 0;
  documentRevalidator = null;
}
