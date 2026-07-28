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
//   - STALE: wpis po świeżości serwowany natychmiast, a JEDNO żądanie
//     (single-flight) płaci rewalidację; render, który się wywali, NIE zdejmuje
//     strony - stale działa też jako bezpiecznik na czkawkę bazy;
//   - MISS: strumień renderu jest tee-owany - czytelnik dostaje streaming SSR
//     bez zmian, kopia zbiera się do L1 i L2 pod `ctx.waitUntil` (praca "za
//     odpowiedzią" nie jest już ucinana przez domknięcie żądania);
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
  documentStorePolicy,
  planDocumentCache,
  type NesCacheStatus,
} from "@/lib/http/documentCache";
import { currentTenantHost, requestPublicHost } from "@/lib/http/requestHost";
import {
  getMiddlewareResponse,
  withMiddlewareResponse,
} from "@/lib/http/middlewareResult";
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
  startedAt: new Date().toISOString(),
};

const RECENT_DECISIONS_LIMIT = 50;
const recentDecisions: DocumentCacheDecision[] = [];

function recordDecision(decision: DocumentCacheDecision): void {
  recentDecisions.unshift(decision);
  if (recentDecisions.length > RECENT_DECISIONS_LIMIT) recentDecisions.length = RECENT_DECISIONS_LIMIT;
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
    "server-timing": buildServerTimingValue(status),
  });
  if (entry.contentLanguage) headers.set("content-language", entry.contentLanguage);
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
): Promise<Uint8Array | null> {
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
          await reader.cancel();
          return null;
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
 * Render przeszedł - jeśli polityka pozwala, tee-uj strumień: jedna gałąź
 * wraca do czytelnika (streaming bez zmian), druga zbiera się do L1 i L2.
 * Zbieranie biegnie pod `ctx.waitUntil` - domknięcie odpowiedzi nie ucina go.
 */
function passThroughAndMaybeStore(
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
  if (!policy.store || !response.body) return withCacheStatus(response, "MISS", timing);

  const [toClient, toCache] = response.body.tee();
  const contentType = response.headers.get("content-type") ?? "text/html; charset=utf-8";
  const cacheControl = response.headers.get("cache-control") ?? "";
  const contentLanguage = response.headers.get("content-language");
  runAfterResponse(
    collectStream(toCache, DOCUMENT_CACHE_MAX_ENTRY_BYTES).then(async (body) => {
      if (!body) return;
      const entry: DocumentCacheEntry = {
        body,
        bytes: body.byteLength,
        contentType,
        cacheControl,
        contentLanguage,
        storedAt: now,
        freshMs: policy.freshMs,
        swrMs: policy.swrMs,
      };
      setEntry(key, entry);
      await l2Put(host, key, entry);
    }),
  );

  const headers = new Headers(response.headers);
  headers.set(NES_CACHE_HEADER, "MISS");
  headers.set("server-timing", buildServerTimingValue("MISS", timing?.renderMs, timing?.db));
  return new Response(toClient, {
    status: response.status,
    statusText: response.statusText,
    headers,
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

  const host = requestPublicHost(request);
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

  const now = Date.now();
  const entry = store.get(plan.key);
  if (entry) {
    const age = now - entry.storedAt;
    if (age < entry.freshMs) {
      stats.hits += 1;
      touchEntry(plan.key, entry);
      return replay(entry, "HIT", now, path);
    }
    if (age < entry.freshMs + entry.swrMs) {
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
            passThroughAndMaybeStore(host, plan.key, path, rendered, Date.now(), timing),
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
  const l2Entry = await l2Match(host, plan.key);
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
            passThroughAndMaybeStore(host, plan.key, path, rendered, Date.now(), timing),
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

  stats.misses += 1;
  const { result, timing } = await renderWithTiming();
  const rendered = getMiddlewareResponse(result);
  if (rendered) {
    return withMiddlewareResponse(
      result,
      passThroughAndMaybeStore(host, plan.key, path, rendered, Date.now(), timing),
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
export async function probeDocumentCache(path: string): Promise<DocumentCacheProbe> {
  const host = await currentTenantHost();
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
  const entry = store.get(plan.key) ?? (await l2Match(host, plan.key).then((e) => (e ? entryFromL2(e) : undefined)));
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
  stats.startedAt = new Date().toISOString();
  recentDecisions.length = 0;
}
