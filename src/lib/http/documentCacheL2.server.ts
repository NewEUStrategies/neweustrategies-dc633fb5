// NES Edge Cache - warstwa L2 (server-only): Cloudflare Cache API per-colo.
//
// L1 (mapa w pamięci izolatu, `documentCache.server.ts`) jest błyskawiczne,
// ale znika z każdą rotacją izolatu i nie jest współdzielone między izolatami
// tej samej kolonii. Cache API jest współdzielone w obrębie kolonii (per-colo)
// - wpis rozgrzany przez jeden izolat serwuje wszystkie pozostałe, a hit-rate
// przestaje być loterią rotacji izolatów.
//
// NAZWANY CACHE, NIE `caches.default` (fala 3, P3.6a / diagnoza
// `faza3/diagnoza/cache-dokumentu.md` R1). Hosting uruchamia aplikację tak, że
// `caches.default` nic nie przechowuje: w produkcji nie było ani jednego
// `nes-layer;desc="L2"`, choć kolonia miała świeże wpisy, a zimne izolaty
// zawsze płaciły odczyt katalogu tenantów z bazy (migawki też nie wracały).
// Dokumentacja Cloudflare dla Workers for Platforms w trybie untrusted mówi
// wprost: „`caches.default` is disabled", ale „each Worker has an isolated
// cache, when using the Cache API" - czyli `caches.open(...)` działa per
// skrypt, wspólnie dla jego izolatów w kolonii. Dlatego `getColoCache()`
// zwraca FASADĘ nad `caches.open(L2_CACHE_NAME)`: nazwany cache otwiera się
// leniwie, raz na izolat, a `match`/`put`/`delete` czekają na otwarcie. Do
// `caches.default` fasada wraca dopiero wtedy, gdy nazwanego cache'u nie da się
// otworzyć. WSZYSTKIE operacje L2 (dokumenty, wersje, purge, migawki
// `bootstrapCache`/`ssrCacheL2`, cache mediów) idą przez tę jedną fasadę, więc
// purge działa na tym samym magazynie, z którego się czyta.
//
// SAMOTEST. Obecność obiektu nie dowodzi, że magazyn działa (tak właśnie
// `l2Stats().enabled` meldowało „włączone" przy martwej warstwie). Raz na
// izolat, pod `runAfterResponse`, fasada zapisuje wpis z losowym nonce i
// czyta go z powrotem. Wynik trafia do `l2Stats().verified`, do jednej linii
// logu `{"kind":"l2",...}` i do metryki Server-Timing `nes-l2` dokumentów.
// Nieudany samotest WYŁĄCZA L2 w tym izolacie (`getColoCache()` -> null):
// zachowanie jak dotąd, bez płacenia za martwe odczyty na każdym MISS-ie.
// Do rozstrzygnięcia samotestu fasada działa optymistycznie - pierwsze żądanie
// zimnego izolatu to dokładnie to, które ma skorzystać z wpisu kolonii.
//
// IDENTYFIKATOR BUILDU W KLUCZU DOKUMENTU. Dotąd L1 znikało z każdym deployem
// (nowe izolaty startują puste), więc stary HTML nie przeżywał wdrożenia.
// Działające L2 z oknem STALE do doby podawałoby HTML wskazujący chunki
// poprzedniego deployu. Klucz dokumentu ma więc segment buildu, stały per
// build: nazwę pliku wejścia klienta z `BOOT_MANIFEST.entry` (hash treści,
// który obejmuje też nazwę arkusza i - przez kaskadę hashy - cały graf
// chunków). Poza buildem (vitest, dev) segment to stały napis; w buildzie
// produkcyjnym bez mapy bootu L2 dokumentów jest wyłączone. Skutek dla układu
// artefaktu serwera (chunk manifestu w `_ssr/`) opisuje `documentBuildId()`.
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
// czyli dokładnie tak, jak dotąd doganiały ją inne IZOLATY. Z działającym L2
// purge przestaje być per izolat i staje się per kolonia; pozostałe kolonie
// doganiają w oknie świeżości. Dla AKTUALIZACJI treści zmiana jest ściśle
// nie-gorsza: świeżość bez zmian, hit-rate rośnie z per-isolate do per-colo.
// ZDJĘCIE albo PRZEKIEROWANIE ścieżki dogania inaczej: rewalidacja kończy się
// wtedy 404/3xx bez zapisu (`src/server.ts`: „wpis zostaje STALE"), więc
// kolonia bez purge podaje STALE do końca okna swr wpisu L2 - dotąd dotyczyło
// to pojedynczego, krótko żyjącego izolatu. Zasada usuwania wpisu po
// ostatecznym 404/3xx należy do zasad zapisu (P3.6b), nie do tej warstwy.
//
// Poza Workers (brak `caches` - vite dev na Node, vitest, Node preview) każda
// funkcja degraduje do no-op, a testom pozwala wstrzyknąć własny magazyn przez
// `setColoCacheForTests`.
import type { NesCacheStatus } from "@/lib/http/documentCache";
import { runAfterResponse } from "@/lib/http/waitUntil.server";

/**
 * Minimalny kontrakt Cache API używany przez L2. `match`/`put` są konieczne;
 * `delete` (standardowe `Cache.delete`) jest OPCJONALNE, bo minimalne atrapy i
 * runtime'y wykrywane duck-typingiem w `getColoCache` mogą go nie mieć -
 * `l2Delete` degraduje wtedy do no-op, a purge per ścieżka wciąż czyści L1.
 */
export interface ColoCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
  delete?(request: Request): Promise<boolean>;
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

/** Magazyn, nad którym pracuje L2 w tym izolacie. */
export type L2Store = "named" | "default";

/**
 * Stan samotestu dla metryki Server-Timing `nes-l2`: `pending` - samotest
 * jeszcze trwa, `named`/`default` - magazyn przeszedł samotest, `off` - nie
 * przeszedł i L2 jest w tym izolacie wyłączone.
 */
export type L2SelfTestLabel = "pending" | L2Store | "off";

/**
 * Nazwa cache'u w Cache API. Zmiana nazwy to świadomy reset całej L2 we
 * wszystkich koloniach (nowa przestrzeń kluczy, stara wygasa TTL-em).
 */
const L2_CACHE_NAME = "nes-edge-v1";

// Syntetyczny origin kluczy: nigdy nie koliduje z realnymi żądaniami, a
// Cache API wymaga poprawnego URL-a http(s) jako klucza.
const KEY_ORIGIN = "https://nes-edge-cache.internal";
const VERSION_PATH = "/__nes/version";
const DOC_PATH = "/__nes/doc";
const SELF_TEST_PATH = "/__nes/selftest";
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
/** Wpis samotestu wygasa sam - nie ma czego sprzątać. */
const SELF_TEST_TTL_SECONDS = 60;
/**
 * Jedno ponowienie odczytu samotestu po krótkiej przerwie: fałszywe „nie
 * działa" wyłączyłoby L2 na całe życie izolatu, a ponowienie kosztuje jeden
 * odczyt pod `waitUntil`, nigdy czas czytelnika.
 */
const SELF_TEST_RETRY_MS = 100;
/** Segment buildu poza buildem (vitest, dev): stały napis, nigdy zegar. */
const DEV_BUILD_ID = "dev";
const BUILD_ID_MAX_LENGTH = 64;

// Nagłówki metadanych wpisu dokumentu (prefiks x-nes-l2-*).
const H_STORED_AT = "x-nes-l2-stored-at";
const H_FRESH_MS = "x-nes-l2-fresh-ms";
const H_SWR_MS = "x-nes-l2-swr-ms";
const H_CONTENT_TYPE = "x-nes-l2-content-type";
const H_CACHE_CONTROL = "x-nes-l2-cache-control";
const H_CONTENT_LANGUAGE = "x-nes-l2-content-language";
const H_LINK = "x-nes-l2-link";

let injectedCache: ColoCache | null | undefined;

/** `globalThis.caches` widziane duck-typingiem (workerd, atrapy w testach). */
interface RuntimeCaches {
  readonly default?: unknown;
  readonly open?: unknown;
}

/**
 * Stan L2 izolatu dla jednego obiektu `globalThis.caches`. Inny obiekt (test
 * podmienił globalny) = nowy stan, jak w świeżym izolacie.
 */
interface RuntimeState {
  readonly source: RuntimeCaches;
  /** Fasada nazwanego cache'u albo `caches.default` (runtime bez `open`). */
  cache: ColoCache | null;
  /** Czy obowiązuje samotest (tylko fasada nazwanego cache'u). */
  readonly selfTest: boolean;
  /** Magazyn faktycznie użyty; null = jeszcze nie otwarty albo niedostępny. */
  store: L2Store | null;
  /** Otwarty magazyn fasady; undefined = jeszcze nie otwierany. */
  opened: ColoCache | null | undefined;
  /** Wynik samotestu; null = trwa albo nie dotyczy. */
  verified: boolean | null;
  selfTestScheduled: boolean;
}

let runtime: RuntimeState | null = null;

/**
 * Segment buildu w kluczu dokumentu; undefined = jeszcze nie rozstrzygnięty,
 * null = build produkcyjny bez mapy bootu (L2 dokumentów wyłączone).
 */
let buildId: string | null | undefined;

interface VersionMemoEntry {
  at: number;
  value: string;
}

const versionMemo = new Map<string, VersionMemoEntry>();

const stats = { hits: 0, stale: 0, stores: 0, bumps: 0, deletes: 0 };

function readRuntimeCaches(): RuntimeCaches | null {
  try {
    const caches = (globalThis as { caches?: unknown }).caches;
    return typeof caches === "object" && caches !== null ? (caches as RuntimeCaches) : null;
  } catch {
    return null;
  }
}

function asColoCache(candidate: unknown): ColoCache | null {
  const cache = candidate as Partial<ColoCache> | null | undefined;
  return cache && typeof cache.match === "function" && typeof cache.put === "function"
    ? (cache as ColoCache)
    : null;
}

/** `caches.default` albo null - sam odczyt pola bywa w runtime'ach hostingu zablokowany. */
function readDefaultCache(source: RuntimeCaches): ColoCache | null {
  try {
    return asColoCache(source.default);
  } catch {
    return null;
  }
}

/**
 * Otwarcie magazynu fasady: nazwany cache, a gdy go nie ma - `caches.default`.
 *
 * Memoizowany jest WYŁĄCZNIE wynik, nie obietnica: obietnica I/O utworzona
 * w kontekście jednego żądania nie może być oczekiwana z innego (workerd
 * potrafi ją wtedy zawiesić). Równoległe pierwsze żądania otwierają więc
 * cache każde w swoim kontekście, a pierwszy wynik wygrywa. Sam obiekt `Cache`
 * nie jest związany z żądaniem (jak `caches.default`), więc jego ponowne użycie
 * jest bezpieczne.
 */
async function openStore(state: RuntimeState): Promise<ColoCache | null> {
  if (state.opened !== undefined) return state.opened;
  let cache: ColoCache | null = null;
  let store: L2Store | null = null;
  try {
    const storage = state.source as { open(name: string): Promise<unknown> };
    cache = asColoCache(await storage.open(L2_CACHE_NAME));
    if (cache) store = "named";
  } catch {
    cache = null;
  }
  if (!cache) {
    cache = readDefaultCache(state.source);
    store = cache ? "default" : null;
  }
  if (state.opened === undefined) {
    state.opened = cache;
    state.store = store;
  }
  return state.opened;
}

/** Fasada z synchronicznym kontraktem `getColoCache()` nad leniwie otwieranym magazynem. */
function namedCacheFacade(state: RuntimeState): ColoCache {
  return {
    async match(request) {
      const cache = await openStore(state);
      return cache ? cache.match(request) : undefined;
    },
    async put(request, response) {
      const cache = await openStore(state);
      if (cache) await cache.put(request, response);
    },
    async delete(request) {
      const cache = await openStore(state);
      return cache && typeof cache.delete === "function" ? cache.delete(request) : false;
    },
  };
}

function resolveRuntime(source: RuntimeCaches): RuntimeState {
  if (typeof source.open === "function") {
    const state: RuntimeState = {
      source,
      cache: null,
      selfTest: true,
      store: null,
      opened: undefined,
      verified: null,
      selfTestScheduled: false,
    };
    state.cache = namedCacheFacade(state);
    return state;
  }
  // Runtime bez `caches.open` (atrapy, polyfille): `caches.default` wprost,
  // bez fasady i bez samotestu - zachowanie sprzed nazwanego cache'u.
  const cache = readDefaultCache(source);
  return {
    source,
    cache,
    selfTest: false,
    store: cache ? "default" : null,
    opened: cache,
    verified: null,
    selfTestScheduled: false,
  };
}

function runtimeState(): RuntimeState | null {
  const source = readRuntimeCaches();
  if (!source) return null;
  if (runtime?.source !== source) runtime = resolveRuntime(source);
  return runtime;
}

function selfTestNonce(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

async function selfTestHit(cache: ColoCache, request: Request, nonce: string): Promise<boolean> {
  const hit = await cache.match(request);
  return hit ? (await hit.text()) === nonce : false;
}

/**
 * Samotest magazynu: zapis wpisu z nonce i odczyt. Biegnie raz na izolat pod
 * `runAfterResponse` (nonce losowany w kontekście żądania - w zasięgu modułu
 * workerd losowania zabrania). Nigdy nie rzuca.
 */
async function runSelfTest(state: RuntimeState, cache: ColoCache): Promise<void> {
  const startedAt = Date.now();
  let ok = false;
  try {
    const nonce = selfTestNonce();
    const request = new Request(`${KEY_ORIGIN}${SELF_TEST_PATH}/${nonce}`);
    await cache.put(
      request,
      new Response(nonce, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": `public, max-age=${SELF_TEST_TTL_SECONDS}`,
        },
      }),
    );
    ok = await selfTestHit(cache, request, nonce);
    if (!ok) {
      await new Promise((resolve) => setTimeout(resolve, SELF_TEST_RETRY_MS));
      ok = await selfTestHit(cache, request, nonce);
    }
  } catch {
    ok = false;
  }
  state.verified = ok;
  try {
    // Jedna linia na izolat (Workers Logs): czy L2 w ogóle działa i na którym
    // magazynie. Bez niej „brak L2" w liniach dokumentów nie odróżnia martwego
    // magazynu od braku wpisu.
    console.log(
      JSON.stringify({ kind: "l2", verified: ok, store: state.store, ms: Date.now() - startedAt }),
    );
  } catch {
    /* telemetria nie może zerwać pracy w tle */
  }
}

/** Dostępny magazyn per-colo albo null (poza Workers albo po nieudanym samoteście). */
export function getColoCache(): ColoCache | null {
  if (injectedCache !== undefined) return injectedCache;
  const state = runtimeState();
  if (!state?.cache || state.verified === false) return null;
  if (state.selfTest && !state.selfTestScheduled) {
    state.selfTestScheduled = true;
    runAfterResponse(runSelfTest(state, state.cache));
  }
  return state.cache;
}

/**
 * Hak testowy: wstrzyknij magazyn (null = symuluj brak Cache API). Każde
 * wywołanie zeruje też stan izolatu L2 (fasada, samotest, build, memo wersji,
 * liczniki) - `setColoCacheForTests(undefined)` to „rotacja izolatu" dla L2.
 */
export function setColoCacheForTests(cache: ColoCache | null | undefined): void {
  injectedCache = cache;
  runtime = null;
  buildId = undefined;
  versionMemo.clear();
  stats.hits = 0;
  stats.stale = 0;
  stats.stores = 0;
  stats.bumps = 0;
  stats.deletes = 0;
}

/** Segment buildu z URL-a wejścia klienta (`/assets/index-AbC123.js` -> `index-AbC123`). */
function buildIdFromEntry(entry: string | null | undefined): string | null {
  const file = (entry ?? "").split("/").pop() ?? "";
  const token = file
    .replace(/\.m?js$/, "")
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, BUILD_ID_MAX_LENGTH);
  return token || null;
}

/**
 * Identyfikator buildu do klucza dokumentu, raz na izolat.
 *
 * Mapa bootu jest importowana DYNAMICZNIE za bramką SSR. Statyczna krawędź
 * wciągnęłaby moduł manifestu Start (~216 KB) do chunku wejścia Workera
 * (`_ssr/index.mjs`), wykonywanego przy starcie każdego izolatu - także dla
 * żądań, które L2 dokumentów w ogóle nie dotykają (API, zalogowani, zasoby).
 * Dynamicznie manifest ładuje się przy pierwszym dostępie do L2 dokumentu
 * (albo razem z handlerem, jeśli ten był pierwszy), raz na izolat.
 *
 * UKŁAD ARTEFAKTU (P3.6a, runda 9). Zaślepka jest w buildzie czystym
 * reeksportem, więc ten import robi z niej nowy dynamiczny punkt wejścia,
 * który Rollup scala z modułem manifestu w jeden chunk nazwany od ostatniego
 * modułu: `.output/server/_ssr/bootManifest-*.mjs` zamiast
 * `.output/server/_tanstack-start-manifest_v-*.mjs`. Runtime tego nie widzi
 * (framework importuje ten sam moduł z tego samego chunku), ale bramki
 * artefaktu, które czytają z manifestu chunk startowy klienta
 * (`check:bundle`, `check:entry-purity`, fallback wagi dokumentu), muszą
 * szukać mapy bootu także w `_ssr/`. Import wirtualnego modułu manifestu wprost
 * zachowałby dawny układ, ale analiza importów vitest (środowisko `client`,
 * bez wtyczek Start) nie rozwiązuje tego specyfikatora i nie transformuje
 * wtedy żadnego modułu importującego L2.
 *
 * Nieudany import NIE jest zapamiętywany: przejściowy błąd ładowania chunku na
 * zimnym izolacie nie może wyłączyć L2 dokumentów na całe życie izolatu -
 * następne żądanie spróbuje znowu. Zapamiętywany jest wyłącznie wynik
 * rozstrzygnięty (także `null` buildu produkcyjnego bez mapy).
 */
async function documentBuildId(): Promise<string | null> {
  if (buildId !== undefined) return buildId;
  let entry: string | undefined;
  if (import.meta.env.SSR) {
    try {
      entry = (await import("@/lib/boot/bootManifest")).BOOT_MANIFEST?.entry;
    } catch {
      return import.meta.env.PROD ? null : DEV_BUILD_ID;
    }
  }
  // Build produkcyjny bez mapy bootu nie ma stałego identyfikatora - wtedy
  // lepiej nie mieć L2 dokumentów niż podawać HTML poprzedniego deployu.
  const resolved = buildIdFromEntry(entry) ?? (import.meta.env.PROD ? null : DEV_BUILD_ID);
  buildId = resolved;
  return resolved;
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
 * Adres wpisu dokumentu pod bieżącym buildem i wersjami (global + host).
 * Klucz planu (`host::pathname?query`) jest już tenant-scoped - tu tylko koduje
 * się do ścieżki URL, segment buildu odcina dokumenty innych deployów,
 * a segmenty wersji unieważniają całość bez iterowania. Null = build bez
 * identyfikatora (L2 dokumentów wyłączone).
 */
async function documentRequest(
  cache: ColoCache,
  host: string | null,
  planKey: string,
): Promise<Request | null> {
  const build = await documentBuildId();
  if (build === null) return null;
  const [globalVersion, hostVersion] = await Promise.all([
    readVersion(cache, "__global"),
    readVersion(cache, host ?? "no-host"),
  ]);
  return new Request(
    `${KEY_ORIGIN}${DOC_PATH}/${build}/${globalVersion}/${hostVersion}/${encodeURIComponent(planKey)}`,
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
    if (!request) return null;
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
    if (!request) return;
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

/**
 * Usunięcie JEDNEGO wpisu dokumentu z L2 (purge selektywny per ścieżka -
 * publikacja wpisu nie musi już bumpować wersji całego hosta, czyli chłodzić
 * całej kolonii). Adres liczony pod BIEŻĄCYM buildem i wersjami: wpisy spod
 * starszych są i tak nieosiągalne. Cache API nie listuje kluczy, więc warianty
 * z query (`?page=N`) NIE są tu usuwane - dogania je okno świeżości (<= 3 min),
 * dokładnie tak jak inne kolonie. Zwraca, czy coś realnie usunięto; poza
 * Workers i na runtime bez `delete` degraduje do no-op (false).
 */
export async function l2Delete(host: string | null, planKey: string): Promise<boolean> {
  const cache = getColoCache();
  if (!cache || typeof cache.delete !== "function") return false;
  try {
    const request = await documentRequest(cache, host, planKey);
    if (!request) return false;
    const removed = await cache.delete(request);
    if (removed) stats.deletes += 1;
    return removed;
  } catch {
    /* best-effort: L2 to akcelerator, nigdy warunek poprawności */
    return false;
  }
}

/** Liczniki diagnostyczne L2 do karty /admin/performance. */
export function l2Stats(): {
  /** L2 ma magazyn i nie oblało samotestu (samotest w toku = optymistycznie włączone). */
  enabled: boolean;
  /** Wynik samotestu izolatu; null = trwa albo nie dotyczy (atrapa, runtime bez `caches.open`). */
  verified: boolean | null;
  /** Magazyn izolatu: nazwany cache albo `caches.default`; null = nieznany/brak. */
  store: L2Store | null;
  /** Segment buildu w kluczach dokumentów; null = jeszcze nieustalony albo build bez mapy. */
  build: string | null;
  hits: number;
  stale: number;
  stores: number;
  bumps: number;
  /** Wpisy usunięte purge'em selektywnym (`l2Delete`). */
  deletes: number;
} {
  const enabled = getColoCache() !== null;
  const state = injectedCache === undefined ? runtime : null;
  return {
    enabled,
    verified: state?.verified ?? null,
    store: state?.store ?? null,
    build: buildId ?? null,
    ...stats,
  };
}

/**
 * Stan samotestu tego izolatu dla metryki Server-Timing `nes-l2` dokumentów
 * (sonda produkcyjna: jedno `curl` mówi, czy L2 izolatu działa). Null = samotest
 * nie dotyczy (atrapa w testach, runtime bez `caches.open`, poza Workers) -
 * wtedy metryki nie ma, a nagłówek jest bajt w bajt dawnym napisem.
 */
export function l2SelfTestLabel(): L2SelfTestLabel | null {
  if (injectedCache !== undefined) return null;
  const state = runtimeState();
  if (!state?.selfTest) return null;
  if (state.verified === null) return "pending";
  return state.verified && state.store ? state.store : "off";
}

/** Doliczanie trafień L2 (wołane z warstwy wykonawczej L1). */
export function recordL2Serve(status: Extract<NesCacheStatus, "HIT" | "STALE">): void {
  if (status === "HIT") stats.hits += 1;
  else stats.stale += 1;
}
