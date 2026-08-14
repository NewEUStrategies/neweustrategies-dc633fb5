// NES Edge Cache - warstwa L2 (server-only): Cloudflare Cache API per-colo.
//
// L1 (mapa w pamięci izolatu, `documentCache.server.ts`) jest błyskawiczne,
// ale znika z każdą rotacją izolatu i nie jest współdzielone między izolatami
// tej samej kolonii. `caches.default` jest dostępne w każdym Workerze bez
// bindingów i współdzielone w obrębie kolonii (per-colo) - wpis rozgrzany
// przez jeden izolat serwuje wszystkie pozostałe, a hit-rate przestaje być
// loterią rotacji izolatów.
//
// Unieważnianie bez iterowania kluczy (Cache API nie ma listowania):
// KLUCZ WERSJONOWANY. Adres wpisu dokumentu zawiera dwa segmenty wersji -
// globalny i per-host - trzymane jako osobne wpisy w tym samym cache. Purge
// (publikacja treści) podbija wersję hosta: wszystkie dotychczasowe wpisy
// dokumentów stają się nieosiągalne w CAŁEJ kolonii natychmiast, bez
// wyścigów, i wygasają naturalnie TTL-em. Purge globalny podbija wersję
// globalną (segment wspólny każdego klucza).
//
// Zakres spójności (świadomy, opisany też w OCENA_SSR): bump wersji jest
// per-colo, jak sam cache. Kolonia, która nie obsłużyła publikacji, odświeży
// wpis najpóźniej po oknie świeżości (fresh <= 3 min - ten sam sufit co L1),
// czyli dokładnie tak, jak dotąd doganiały ją inne IZOLATY. Zmiana jest
// ściśle nie-gorsza: świeżość bez zmian, hit-rate rośnie z per-isolate do
// per-colo.
//
// Poza Workers (`caches.default` niedostępne - vite dev, vitest, Node preview)
// każda funkcja degraduje do no-op, a testom pozwala wstrzyknąć własny
// magazyn przez `setColoCacheForTests`.
import type { NesCacheStatus } from "@/lib/http/documentCache";

/** Minimalny kontrakt Cache API używany przez L2 (match/put wystarczą). */
export interface ColoCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

/** Wpis dokumentu odtworzony z L2 wraz z metadanymi świeżości. */
export interface L2DocumentEntry {
  body: Uint8Array;
  contentType: string;
  cacheControl: string;
  contentLanguage: string | null;
  /** Nagłówek `Link` renderu (preload LCP/fontów) - patrz DocumentCacheEntry. */
  link: string | null;
  storedAt: number;
  freshMs: number;
  swrMs: number;
}

// Syntetyczny origin kluczy: nigdy nie koliduje z realnymi żądaniami, a
// Cache API wymaga poprawnego URL-a http(s) jako klucza.
const KEY_ORIGIN = "https://nes-edge-cache.internal";
const VERSION_PATH = "/__nes/version";
const DOC_PATH = "/__nes/doc";
/** TTL wpisów wersji: długie (wersja żyje do następnego bumpa). */
const VERSION_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Wersja "0" = host/global nigdy nie bumpowany (brak wpisu wersji). */
const VERSION_ZERO = "0";
/**
 * Memo wersji w pamięci izolatu: HIT dokumentu nie płaci dwóch `match()` na
 * każde żądanie. Krótkie (2 s), żeby bump z innego izolatu tej samej kolonii
 * był widoczny niemal natychmiast.
 */
const VERSION_MEMO_TTL_MS = 2_000;

// Nagłówki metadanych wpisu dokumentu (prefiks x-nes-l2-*).
const H_STORED_AT = "x-nes-l2-stored-at";
const H_FRESH_MS = "x-nes-l2-fresh-ms";
const H_SWR_MS = "x-nes-l2-swr-ms";
const H_CONTENT_TYPE = "x-nes-l2-content-type";
const H_CACHE_CONTROL = "x-nes-l2-cache-control";
const H_CONTENT_LANGUAGE = "x-nes-l2-content-language";
const H_LINK = "x-nes-l2-link";

let injectedCache: ColoCache | null | undefined;

interface VersionMemoEntry {
  at: number;
  value: string;
}

const versionMemo = new Map<string, VersionMemoEntry>();

const stats = { hits: 0, stale: 0, stores: 0, bumps: 0 };

/** Dostępny magazyn per-colo albo null (poza Workers). */
export function getColoCache(): ColoCache | null {
  if (injectedCache !== undefined) return injectedCache;
  const caches = (globalThis as { caches?: { default?: unknown } }).caches;
  const candidate = caches?.default as ColoCache | undefined;
  if (candidate && typeof candidate.match === "function" && typeof candidate.put === "function") {
    return candidate;
  }
  return null;
}

/** Hak testowy: wstrzyknij magazyn (null = symuluj brak Cache API). */
export function setColoCacheForTests(cache: ColoCache | null | undefined): void {
  injectedCache = cache;
  versionMemo.clear();
  stats.hits = 0;
  stats.stale = 0;
  stats.stores = 0;
  stats.bumps = 0;
}

function versionRequest(scope: string): Request {
  return new Request(`${KEY_ORIGIN}${VERSION_PATH}/${encodeURIComponent(scope)}`);
}

async function readVersion(cache: ColoCache, scope: string): Promise<string> {
  const now = Date.now();
  const memo = versionMemo.get(scope);
  if (memo && now - memo.at < VERSION_MEMO_TTL_MS) return memo.value;
  let value = VERSION_ZERO;
  try {
    const hit = await cache.match(versionRequest(scope));
    if (hit) {
      const text = (await hit.text()).trim();
      if (text) value = text;
    }
  } catch {
    /* uszkodzony wpis wersji = wersja zerowa; wpisy dokumentów wygasną TTL-em */
  }
  versionMemo.set(scope, { at: now, value });
  return value;
}

/**
 * Podbij wersję zakresu (host albo "__global"). Wołane z purge - wszystkie
 * wpisy dokumentów pod starą wersją stają się nieosiągalne w całej kolonii.
 */
export async function bumpL2Version(host: string | null): Promise<void> {
  const cache = getColoCache();
  if (!cache) return;
  const scope = host ?? "__global";
  const value = Date.now().toString(36);
  try {
    await cache.put(
      versionRequest(scope),
      new Response(value, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": `public, max-age=${VERSION_TTL_SECONDS}`,
        },
      }),
    );
    versionMemo.set(scope, { at: Date.now(), value });
    stats.bumps += 1;
  } catch {
    /* best-effort: bez bumpa wpisy i tak wygasną oknem świeżości */
  }
}

/**
 * Adres wpisu dokumentu pod bieżącymi wersjami (global + host). Klucz planu
 * (`host::pathname?query`) jest już tenant-scoped - tu tylko koduje się do
 * ścieżki URL, a segmenty wersji unieważniają całość bez iterowania.
 */
async function documentRequest(cache: ColoCache, host: string | null, planKey: string) {
  const [globalVersion, hostVersion] = await Promise.all([
    readVersion(cache, "__global"),
    readVersion(cache, host ?? "no-host"),
  ]);
  return new Request(
    `${KEY_ORIGIN}${DOC_PATH}/${globalVersion}/${hostVersion}/${encodeURIComponent(planKey)}`,
  );
}

/** Odczyt wpisu dokumentu z L2. Null = brak/wygasły/uszkodzony/nie-Workers. */
export async function l2Match(
  host: string | null,
  planKey: string,
): Promise<L2DocumentEntry | null> {
  const cache = getColoCache();
  if (!cache) return null;
  try {
    const request = await documentRequest(cache, host, planKey);
    const hit = await cache.match(request);
    if (!hit) return null;
    const storedAt = Number(hit.headers.get(H_STORED_AT));
    const freshMs = Number(hit.headers.get(H_FRESH_MS));
    const swrMs = Number(hit.headers.get(H_SWR_MS));
    if (!Number.isFinite(storedAt) || !Number.isFinite(freshMs) || !Number.isFinite(swrMs)) {
      return null;
    }
    const body = new Uint8Array(await hit.arrayBuffer());
    return {
      body,
      contentType: hit.headers.get(H_CONTENT_TYPE) ?? "text/html; charset=utf-8",
      cacheControl: hit.headers.get(H_CACHE_CONTROL) ?? "",
      contentLanguage: hit.headers.get(H_CONTENT_LANGUAGE),
      link: hit.headers.get(H_LINK),
      storedAt,
      freshMs,
      swrMs,
    };
  } catch {
    return null;
  }
}

/**
 * Zapis wpisu dokumentu do L2. TTL wpisu = fresh + swr (Cache API honoruje
 * max-age NAGŁÓWKÓW WPISU; oryginalny Cache-Control odpowiedzi jedzie obok
 * jako metadana i wraca na odpowiedź przy replay z L1/L2).
 */
export async function l2Put(
  host: string | null,
  planKey: string,
  entry: L2DocumentEntry,
): Promise<void> {
  const cache = getColoCache();
  if (!cache) return;
  try {
    const request = await documentRequest(cache, host, planKey);
    const ttlSeconds = Math.max(1, Math.ceil((entry.freshMs + entry.swrMs) / 1000));
    // Kopia bufora: wpis L1 i odpowiedź klienta współdzielą oryginał; L2
    // dostaje własny, żeby transfer/konsumpcja przez runtime niczego nie psuła.
    await cache.put(
      request,
      new Response(entry.body.slice(), {
        headers: {
          "content-type": entry.contentType,
          "cache-control": `public, max-age=${ttlSeconds}`,
          [H_STORED_AT]: String(entry.storedAt),
          [H_FRESH_MS]: String(entry.freshMs),
          [H_SWR_MS]: String(entry.swrMs),
          [H_CONTENT_TYPE]: entry.contentType,
          [H_CACHE_CONTROL]: entry.cacheControl,
          ...(entry.contentLanguage ? { [H_CONTENT_LANGUAGE]: entry.contentLanguage } : {}),
          ...(entry.link ? { [H_LINK]: entry.link } : {}),
        },
      }),
    );
    stats.stores += 1;
  } catch {
    /* best-effort: L2 to akcelerator, nigdy warunek poprawności */
  }
}

/** Liczniki diagnostyczne L2 do karty /admin/performance. */
export function l2Stats(): {
  enabled: boolean;
  hits: number;
  stale: number;
  stores: number;
  bumps: number;
} {
  return { enabled: getColoCache() !== null, ...stats };
}

/** Doliczanie trafień L2 (wołane z warstwy wykonawczej L1). */
export function recordL2Serve(status: Extract<NesCacheStatus, "HIT" | "STALE">): void {
  if (status === "HIT") stats.hits += 1;
  else stats.stale += 1;
}
