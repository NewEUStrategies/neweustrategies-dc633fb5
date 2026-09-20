// Warstwa L2 `edgeTtlCache` (server-only): migawki wartości w Cache API per-colo.
//
// L1 w `ssrCache.ts` to Map w pamięci izolatu - znika z każdą rotacją izolatu
// i nie jest współdzielone między izolatami tej samej kolonii. Klucze
// decydujące o pierwszym bajcie KAŻDEJ trasy (ustawienia, tokeny motywu, menu,
// ticker, strona główna, rezolucja ścieżki) były więc odbudowywane z bazy na
// każdym zimnym izolacie, także w kolonii, która miała już ciepły L2
// dokumentów (audyt CWV 2026-09-20, F03 / plan 1.3: 6-9 round-tripów w 3
// falach ≈ 0,4 s). Ten moduł kładzie pod L1 migawkę w `caches.default` przez
// istniejące `readBootstrapSnapshot` / `writeBootstrapSnapshot` - ten sam
// mechanizm, którym katalog tenantów i reguły przekierowań przeżywają rotację.
//
// PODZIAŁ ODPOWIEDZIALNOŚCI. Polityka (biała lista kluczy, TTL, okno
// serve-stale, limit rozmiaru, termin odczytu, kolejność na chybieniu) żyje w
// `ssrCache.ts`, bo tam jest kontrakt `edgeTtlCache`. Tu jest wyłącznie
// adresowanie i I/O: ten plik jest importowany DYNAMICZNIE za bramką
// `import.meta.env.SSR`, żeby graf server-only (Cache API, `process.env`) nie
// trafił do bundla przeglądarki - `ssrCache.ts` jest współdzielony z klientem
// (hooki ustawień, tokeny motywu), więc statyczna krawędź wciągnęłaby go do
// chunku wejściowego.
//
// UNIEWAŻNIANIE = WERSJA W KLUCZU. Cache API nie listuje kluczy, więc klucz
// migawki niesie te same dwa segmenty wersji, którymi `documentCacheL2.server`
// unieważnia dokumenty: globalny i per-host. Pełny purge dokumentów
// (`purgeDocumentCache` -> `bumpL2Version`, czyli zapis ustawień, menu, motywu,
// stron przez `recordAudit` bez `documentPaths`) podbija wersję hosta - i tym
// samym ruchem odcina WSZYSTKIE migawki edgeTtlCache tego hosta w całej
// kolonii, bez osobnego purge'a i bez wyścigu. Purge selektywny per ścieżka
// (publikacja wpisu) wersji nie rusza: migawki dogania okno świeżości (TTL),
// dokładnie tak, jak dotąd doganiały je izolaty z własnym L1.
//
// Poza Workers (vite dev, vitest, Node preview) `getColoCache()` zwraca null,
// a bez `SUPABASE_URL` migawka nie ma adresu - wszystko degraduje do no-op.
import { readBootstrapSnapshot, writeBootstrapSnapshot } from "@/lib/http/bootstrapCache.server";
import { getColoCache } from "@/lib/http/documentCacheL2.server";

/** Migawka z L2 z werdyktem świeżości (`stale` = wiek >= ttlMs, patrz bootstrapCache). */
export interface EdgeTtlL2Snapshot<T> {
  value: T;
  at: number;
  stale: boolean;
}

/**
 * Kontrakt warstwy L2 widziany z `ssrCache.ts`. Wstrzykiwany (testy) albo
 * rozwiązywany dynamicznie z tego modułu (SSR). Żadna metoda nie rzuca.
 */
export interface EdgeTtlL2Adapter {
  /** Czy warstwa ma gdzie pisać: Cache API dostępne i projekt bazy znany. */
  enabled(): boolean;
  read<T>(
    scope: string,
    key: string,
    ttlMs: number,
    maxAgeMs: number,
  ): Promise<EdgeTtlL2Snapshot<T> | null>;
  write(
    scope: string,
    key: string,
    snapshot: { at: number; value: unknown },
    ttlMs: number,
    maxAgeMs: number,
  ): Promise<void>;
}

/**
 * Adres wpisów wersji - ŚWIADOMA KOPIA prywatnych stałych
 * `documentCacheL2.server.ts` (`KEY_ORIGIN`, `VERSION_PATH`, zakresy
 * `"__global"` / host / `"no-host"`). Moduł dokumentów nie eksportuje
 * czytnika wersji, a ten plik nie może go tam dopisać (własność innego
 * strumienia prac). Dryf jest wykrywany testem, który bumpuje wersję PRZEZ
 * `bumpL2Version` i oczekuje, że migawka spod starej wersji stanie się
 * nieosiągalna - gdyby adres się rozjechał, test padnie, a produkcja
 * degraduje wyłącznie do „wersja zawsze 0", czyli do unieważniania TTL-em.
 */
const VERSION_ORIGIN = "https://nes-edge-cache.internal";
const VERSION_PATH = "/__nes/version";
const VERSION_ZERO = "0";
const GLOBAL_SCOPE = "__global";

/**
 * Memo wersji w pamięci izolatu - ta sama wartość, co w `documentCacheL2`:
 * krótka (2 s), żeby bump z innego izolatu tej kolonii był widoczny niemal
 * natychmiast, a jednocześnie zimny izolat rozgrzewający 6-9 kluczy naraz
 * płacił DWA `match()` wersji, nie dwanaście. Memoizowana jest OBIETNICA, więc
 * równoległe odczyty dzielą jeden lot.
 */
const VERSION_MEMO_TTL_MS = 2_000;

interface VersionMemo {
  at: number;
  value: Promise<string>;
}

const versionMemo = new Map<string, VersionMemo>();

function versionRequest(scope: string): Request {
  return new Request(`${VERSION_ORIGIN}${VERSION_PATH}/${encodeURIComponent(scope)}`);
}

function readVersion(scope: string): Promise<string> {
  const now = Date.now();
  const memo = versionMemo.get(scope);
  if (memo && now - memo.at < VERSION_MEMO_TTL_MS) return memo.value;
  const cache = getColoCache();
  const value = (async () => {
    if (!cache) return VERSION_ZERO;
    try {
      const hit = await cache.match(versionRequest(scope));
      const text = hit ? (await hit.text()).trim() : "";
      return text || VERSION_ZERO;
    } catch {
      // Uszkodzony wpis wersji = wersja zerowa; migawki wygasną oknem TTL.
      return VERSION_ZERO;
    }
  })();
  versionMemo.set(scope, { at: now, value });
  return value;
}

/**
 * Klucz migawki pod BIEŻĄCYMI wersjami. `readBootstrapSnapshot` dokłada z
 * przodu origin bazy (środowiska dzielące kolonię nie mieszają danych), a
 * `scope` to host żądania (`"no-host"` bez hosta) - ten sam, którym L1 kluczuje
 * wpisy, więc migawka tenanta A nigdy nie zasili L1 tenanta B.
 */
async function snapshotKey(scope: string, key: string): Promise<string> {
  const [globalVersion, hostVersion] = await Promise.all([
    readVersion(GLOBAL_SCOPE),
    readVersion(scope),
  ]);
  return `edge:v${globalVersion}.${hostVersion}:${scope}::${key}`;
}

function hasSnapshotOrigin(): boolean {
  return typeof process !== "undefined" && Boolean(process.env?.SUPABASE_URL);
}

const isPresent = <T>(value: unknown): value is T => value !== null && value !== undefined;

export const edgeTtlL2Adapter: EdgeTtlL2Adapter = {
  enabled: () => getColoCache() !== null && hasSnapshotOrigin(),

  async read<T>(scope: string, key: string, ttlMs: number, maxAgeMs: number) {
    try {
      const snapshot = await readBootstrapSnapshot<T>(
        await snapshotKey(scope, key),
        ttlMs,
        isPresent,
        { maxAgeMs },
      );
      return snapshot ? { value: snapshot.value, at: snapshot.at, stale: snapshot.stale } : null;
    } catch {
      return null;
    }
  },

  async write(scope, key, snapshot, ttlMs, maxAgeMs) {
    try {
      await writeBootstrapSnapshot(await snapshotKey(scope, key), snapshot, ttlMs, { maxAgeMs });
    } catch {
      // L2 to akcelerator, nigdy warunek poprawności - błąd zapisu jest cichy.
    }
  },
};

/** Hak testowy: zapomnij memo wersji (np. po `setColoCacheForTests`). */
export function resetEdgeTtlL2ForTests(): void {
  versionMemo.clear();
}
