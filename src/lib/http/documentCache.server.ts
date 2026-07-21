// NES Edge Cache - warstwa wykonawcza: magazyn per-isolate + middleware
// dokumentów SSR. Polityka (co i pod jakim kluczem wolno cache'ować) żyje w
// czystym `src/lib/http/documentCache.ts`; tutaj jest wyłącznie pamięć,
// single-flight stale-while-revalidate i zszycie z potokiem żądań.
//
// Właściwości:
//   - HIT: odpowiedź prosto z pamięci (zero SSR, zero odczytów bazy);
//   - STALE: wpis po świeżości serwowany natychmiast, a JEDNO żądanie
//     (single-flight) płaci rewalidację; render, który się wywali, NIE zdejmuje
//     strony - stale działa też jako bezpiecznik na czkawkę bazy;
//   - MISS: strumień renderu jest tee-owany - czytelnik dostaje streaming SSR
//     bez zmian, kopia zbiera się równolegle do magazynu (limit rozmiaru);
//   - budżet bajtów z approx-LRU (Map w kolejności wstawień, odświeżanej przy
//     trafieniu) - ten sam wzorzec co `edgeTtlCache`, ale liczony w bajtach;
//   - klucz prefiksowany hostem tenanta ("by construction", multi-tenant safe);
//   - kill-switch środowiskowy: NES_EDGE_CACHE=off.
//
// Ograniczenie (świadome): pamięć jest per-isolate, więc purge przy publikacji
// czyści bieżący isolate, a pozostałe doganiają w oknie świeżości (maks.
// DOCUMENT_CACHE_MAX_FRESH_MS = 3 min). To kompromis "własnego mechanizmu"
// bez zewnętrznego CDN-a/klastra - szybkość bez ryzyka wiecznie nieświeżych stron.
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

function replay(entry: DocumentCacheEntry, status: NesCacheStatus, now: number): Response {
  const headers = new Headers({
    "content-type": entry.contentType,
    "cache-control": entry.cacheControl,
    [NES_CACHE_HEADER]: status,
    [NES_CACHE_AGE_HEADER]: String(Math.max(0, Math.round((now - entry.storedAt) / 1000))),
    "server-timing": `nes-edge;desc="${status}"`,
  });
  if (entry.contentLanguage) headers.set("content-language", entry.contentLanguage);
  // Kopia bufora: Response może zostać skonsumowane/transferowane przez runtime,
  // a wpis musi pozostać nienaruszony dla kolejnych trafień.
  return new Response(entry.body.slice(), { status: 200, headers });
}

function withCacheStatus(response: Response, status: NesCacheStatus): Response {
  const headers = new Headers(response.headers);
  headers.set(NES_CACHE_HEADER, status);
  headers.set("server-timing", `nes-edge;desc="${status}"`);
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
 * wraca do czytelnika (streaming bez zmian), druga zbiera się do magazynu.
 */
function passThroughAndMaybeStore(key: string, response: Response, now: number): Response {
  const policy = documentStorePolicy(
    response.status,
    response.headers.get("content-type"),
    response.headers.get("cache-control"),
  );
  if (!policy.store || !response.body) return withCacheStatus(response, "MISS");

  const [toClient, toCache] = response.body.tee();
  const contentType = response.headers.get("content-type") ?? "text/html; charset=utf-8";
  const cacheControl = response.headers.get("cache-control") ?? "";
  const contentLanguage = response.headers.get("content-language");
  // Celowo bez await: czytelnik dostaje pierwsze bajty natychmiast. Jeśli
  // runtime utnie zbieranie po domknięciu odpowiedzi, wpis po prostu nie
  // powstanie (kolejne żądanie znów będzie MISS) - degradacja, nie korupcja.
  void collectStream(toCache, DOCUMENT_CACHE_MAX_ENTRY_BYTES)
    .then((body) => {
      if (!body) return;
      setEntry(key, {
        body,
        bytes: body.byteLength,
        contentType,
        cacheControl,
        contentLanguage,
        storedAt: now,
        freshMs: policy.freshMs,
        swrMs: policy.swrMs,
      });
    })
    .catch(() => undefined);

  const headers = new Headers(response.headers);
  headers.set(NES_CACHE_HEADER, "MISS");
  headers.set("server-timing", 'nes-edge;desc="MISS"');
  return new Response(toClient, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Rdzeń mechanizmu, wydzielony z middleware dla testowalności: pełny cykl
 * BYPASS / HIT / STALE (single-flight) / MISS dla jednego żądania. Generyk po
 * wyniku `next()` zachowuje typ frameworkowego łańcucha middleware (wynik
 * nie-Response przepływa nietknięty).
 */
export async function handleDocumentRequest<T>(
  request: Request,
  next: () => T | Promise<T>,
): Promise<T | Response> {
  if (!cacheEnabled()) return next();

  const plan = planDocumentCache(request, requestPublicHost(request));
  if (plan.kind === "bypass") {
    if (plan.reason !== "method") stats.bypass += 1;
    return next();
  }

  const now = Date.now();
  const entry = store.get(plan.key);
  if (entry) {
    const age = now - entry.storedAt;
    if (age < entry.freshMs) {
      stats.hits += 1;
      touchEntry(plan.key, entry);
      return replay(entry, "HIT", now);
    }
    if (age < entry.freshMs + entry.swrMs) {
      if (revalidating.has(plan.key)) {
        stats.stale += 1;
        return replay(entry, "STALE", now);
      }
      revalidating.add(plan.key);
      try {
        const response = await next();
        if (response instanceof Response) {
          return passThroughAndMaybeStore(plan.key, response, Date.now());
        }
        return response;
      } catch {
        // Render się wywalił - nieświeży dokument jest lepszy niż 500.
        stats.stale += 1;
        return replay(entry, "STALE", now);
      } finally {
        revalidating.delete(plan.key);
      }
    }
    // Poza oknem SWR - wpis jest martwy, zwolnij bajty od razu.
    store.delete(plan.key);
    totalBytes -= entry.bytes;
  }

  stats.misses += 1;
  const response = await next();
  if (response instanceof Response) {
    return passThroughAndMaybeStore(plan.key, response, Date.now());
  }
  return response;
}

/** Middleware do `requestMiddleware` w `src/start.ts` (najbliżej routera). */
export const documentCacheMiddleware = createMiddleware().server(async ({ request, next }) =>
  handleDocumentRequest(request, next),
);

/**
 * Purge wpisów danego hosta (tenant) albo całego magazynu. Wołane po mutacjach
 * treści (publish/update/delete) i z karty admina; zwraca liczbę usuniętych.
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
}
