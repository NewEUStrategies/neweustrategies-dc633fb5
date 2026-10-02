// Server-only glue for the redirect manager + 404 monitor. This module is what
// wires the pure matcher in `@/lib/seo/redirects` into the actual SSR request
// path (via `src/start.ts`). Without it the admin UI (/admin/redirects) and
// its rules table are dead metadata: users can add rules, but requests never
// see them and post-WP migration 404s stay 404 - which was the reported bug.
//
// Design constraints (per the security-headers middleware note in start.ts):
//
//   * Middleware MUST NOT crash the SSR chain. Every DB touch is wrapped so a
//     transient Supabase failure degrades to "no redirect / no logging",
//     never a 500 on a document request.
//
//   * DB lookups are cached per isolate (short TTL, per tenant) so a hot page
//     never adds a round-trip. Cache is invalidated by version bump; the
//     admin functions do NOT need to poke the middleware.
//
//   * Redirect rules and 404 hits are scoped by request-host tenant (service
//     role bypasses RLS, so this filter is what stops cross-tenant leakage).
//
//   * Only text/html 404s from the router feed the monitor - asset / API /
//     sitemap 404s are noise. `.` in the last segment is treated as a static
//     asset (favicon.ico, robots.txt, sitemap.xml). `?` query is preserved
//     on the stored path so WP shortlinks (`/?p=123`) show up individually.
import { resolveTenantForHost } from "@/lib/server/tenant.server";
import { runAfterResponse } from "@/lib/http/waitUntil.server";
import { readBootstrapSnapshot, writeBootstrapSnapshot } from "@/lib/http/bootstrapCache.server";
import { BUDGET_LAPSED, settleWithinBudget } from "@/lib/asyncBudget";
import {
  buildRedirectIndex,
  isProtectedPath,
  matchRedirectForPath,
  type RedirectIndex,
  type RedirectRule,
} from "@/lib/seo/redirects";

type AdminClientModule = typeof import("@/integrations/supabase/client.server");
let adminClientModule: Promise<AdminClientModule> | undefined;

/**
 * Jeden współdzielony dynamiczny import klienta service-role dla trzech
 * wołających tego modułu (odczyt indeksu, licznik trafień, monitor 404) -
 * zamiast osobnego `import()` w każdym wywołaniu. Import zostaje dynamiczny
 * (moduł nie wchodzi do grafu, dopóki pierwsze żądanie go nie potrzebuje),
 * a nieudany import NIE jest zapamiętywany: kolejne wywołanie próbuje znowu.
 * Ubocznie: równoległe pierwsze importy mockowanego modułu w vitest 4
 * potrafią rozwiązać się do prawdziwego `client.server` - jedna obietnica
 * zamyka tę różnicę między testem a produkcją.
 */
function loadAdminClient(): Promise<AdminClientModule> {
  adminClientModule ??= import("@/integrations/supabase/client.server").catch((e: unknown) => {
    adminClientModule = undefined;
    throw e;
  });
  return adminClientModule;
}

// ---------------------------------------------------------------------------
// Per-tenant redirect index cache
// ---------------------------------------------------------------------------

interface CachedIndex {
  at: number;
  index: RedirectIndex;
  count: number;
}

const REDIRECT_CACHE_TTL_MS = 30_000;

/**
 * TERMIN round-tripu indeksu przekierowań - stała W KODZIE, nie w zmiennej
 * środowiskowej.
 *
 * `redirectMiddleware` stoi na pozycji 6 w `requestMiddleware`, czyli PRZED
 * `documentCacheMiddleware` (pozycja 10). Dopóki ten odczyt nie miał terminu,
 * zawieszone połączenie z bazą czekało PRZED konsultacją cache'u dokumentów -
 * więc nawet gorący wpis nie ratował czytelnika i cała logika „HIT to
 * mikrosekundy" się przewracała. `try/catch` niżej broni przed BŁĘDEM;
 * zawieszenie nie rzuca, ono czeka.
 *
 * DLACZEGO 1 500 ms, tak samo jak w katalogu tenantów: to odczyt po indeksie
 * (`tenant_id`, `is_enabled`), a nie raport. Dwa terminy tej płaszczyzny są
 * SZEREGOWE (najpierw host -> tenant, potem reguły), więc wspólny sufit tej
 * warstwy to 3 000 ms - tyle, co cała rozgrzewka korzenia. Zejście po terminie
 * to TA SAMA gałąź, co dla błędu (nieświeży indeks albo pusty).
 */
const REDIRECT_INDEX_BUDGET_MS = 1_500;

/**
 * Twardy limit wierszy zapytania. ROZSTRZYGNIĘCIE (2026-09-12, punkt A9.4
 * zlecenia): liczba ZOSTAJE, bo jej obniżenie CICHO wyłączyłoby część reguł
 * 301 - a cicho zepsuta 301-ka jest gorsza od wolnego odczytu. Zmienia się
 * natomiast to, że osiągnięcie limitu przestaje być niewidoczne: przy pełnym
 * wyniku logujemy ostrzeżenie, bo od 5 000. wiersza reguły są obcinane bez
 * żadnego sygnału. Koszt czasu ogranicza dziś termin wyżej, nie limit.
 */
const REDIRECT_ROW_LIMIT = 5000;
const cache = new Map<string, CachedIndex>();
const inflight = new Map<string, Promise<RedirectIndex>>();
let sharedSnapshotsAllowed = true;

/** Test hook - drop every cached tenant index. */
export function invalidateRedirectCache(): void {
  // An explicit local invalidation must not immediately restore an old L2
  // snapshot. The next successful database read publishes its replacement.
  sharedSnapshotsAllowed = false;
  cache.clear();
  inflight.clear();
  hitWindows.clear();
}

function isRedirectRules(value: unknown): value is RedirectRule[] {
  return (
    Array.isArray(value) &&
    value.length <= 5000 &&
    value.every(
      (row) =>
        row &&
        typeof row === "object" &&
        typeof row.id === "string" &&
        typeof row.source_path === "string" &&
        typeof row.target_path === "string" &&
        typeof row.status_code === "number" &&
        [301, 302, 307, 308, 410].includes(row.status_code),
    )
  );
}

async function loadIndexForTenant(tenantId: string): Promise<CachedIndex> {
  try {
    // Migawka NIEŚWIEŻA (po TTL, przed dobą) też wraca - z ORYGINALNYM `at`,
    // więc `getIndexForTenant` serwuje ją jak własny wpis po TTL i odświeża
    // w tle. Zimny izolat po ciszy dłuższej niż 30 s przestaje płacić
    // blokujący odczyt planu service-role przed cache dokumentów (audyt F01);
    // nieświeże 301-ki są lepsze niż pusty indeks, na który spadała
    // degradacja po terminie.
    if (sharedSnapshotsAllowed && !cache.has(tenantId)) {
      const snapshot = await readBootstrapSnapshot(
        `redirects:${tenantId}`,
        REDIRECT_CACHE_TTL_MS,
        isRedirectRules,
      );
      if (snapshot) {
        const index = buildRedirectIndex(snapshot.value);
        return { at: snapshot.at, index, count: index.exact.size + index.wildcards.length };
      }
    }
    const { supabaseAdmin } = await loadAdminClient();
    const settled = await settleWithinBudget(
      supabaseAdmin
        .from("redirects")
        .select("id, source_path, target_path, status_code")
        .eq("tenant_id", tenantId)
        .eq("is_enabled", true)
        .limit(REDIRECT_ROW_LIMIT),
      REDIRECT_INDEX_BUDGET_MS,
    );
    if (settled === BUDGET_LAPSED) return degradedIndex(tenantId, "timeout");
    const { data, error } = settled;
    if (error) throw error;
    if ((data?.length ?? 0) >= REDIRECT_ROW_LIMIT) {
      console.warn(
        `[redirects] rule set hit the ${REDIRECT_ROW_LIMIT}-row read limit for tenant ${tenantId} - rules beyond it are SILENTLY not served`,
      );
    }
    const rules: RedirectRule[] = (data ?? []).map((row) => ({
      id: row.id as string,
      source_path: row.source_path as string,
      target_path: row.target_path as string,
      status_code: row.status_code as number,
    }));
    const at = Date.now();
    const index = buildRedirectIndex(rules);
    // Świeżość = REDIRECT_CACHE_TTL_MS, przetrwanie = domyślna doba migawki.
    runAfterResponse(
      writeBootstrapSnapshot(`redirects:${tenantId}`, { at, value: rules }, REDIRECT_CACHE_TTL_MS),
    );
    return { at, index, count: index.exact.size + index.wildcards.length };
  } catch (e) {
    console.warn("[redirects] index load failed:", e);
    return degradedIndex(tenantId, "error");
  }
}

/**
 * Jedno zejście dla OBU przyczyn degradacji - i jedyne miejsce, które je
 * ROZRÓŻNIA w logu. „failed" to odpowiedź bazy, której nie da się użyć;
 * „timed out" to brak odpowiedzi w terminie: inna awaria, inna naprawa,
 * a do 2026-09-12 obie kończyły się tym samym `console.warn`. Zachowanie
 * pozostaje identyczne: nieświeży indeks jest lepszy od twardej awarii
 * każdego żądania, pusty gdy nic jeszcze nie ma; migawka współdzielona
 * powstaje wyłącznie po UDANYM odczycie z bazy.
 */
function degradedIndex(tenantId: string, reason: "error" | "timeout"): CachedIndex {
  if (reason === "timeout") {
    console.warn(
      `[redirects] index load timed out after ${REDIRECT_INDEX_BUDGET_MS}ms (budget lapsed, no database error)`,
    );
  }
  const previous = cache.get(tenantId);
  return {
    at: Date.now(),
    index: previous?.index ?? buildRedirectIndex([]),
    count: previous?.count ?? 0,
  };
}

/**
 * Stale-while-revalidate: po TTL nieświeży indeks serwuje NATYCHMIAST,
 * a odświeżenie biegnie w tle pod `waitUntil` (single-flight per tenant).
 * Middleware przekierowań stoi PRZED cache dokumentów, więc blokujące
 * odświeżanie dokładało pełny round-trip do TTFB pierwszego żądania każdych
 * 30 s na każdym izolacie - zanim NES Edge Cache mógł w ogóle odpowiedzieć.
 * Nowa reguła przekierowania może obowiązywać o sekundy później; zimny
 * izolat bez ŻADNEJ migawki w kolonii nadal blokuje jednorazowo - 301-ki
 * pozostają poprawne; zimny izolat z migawką nieświeżą serwuje ją od ręki
 * i odświeża w tle jeszcze w tym samym żądaniu (patrz `loadIndexForTenant`).
 */
async function getIndexForTenant(tenantId: string): Promise<RedirectIndex> {
  const now = Date.now();
  const cached = cache.get(tenantId);
  if (cached && now - cached.at < REDIRECT_CACHE_TTL_MS) return cached.index;
  const pending = startIndexRefresh(tenantId);
  // Nieświeży wpis: serwuj od ręki - odświeżenie już biegnie w tle.
  if (cached) return cached.index;
  const index = await pending;
  // Zimny izolat wstał z NIEŚWIEŻEJ migawki współdzielonej (oryginalne `at`
  // sprzed TTL): odświeżenie startuje TERAZ, za odpowiedzią - izolat, który
  // obsłuży jednego czytelnika, inaczej nigdy nie odnowiłby migawki.
  const loaded = cache.get(tenantId);
  if (loaded && Date.now() - loaded.at >= REDIRECT_CACHE_TTL_MS) startIndexRefresh(tenantId);
  return index;
}

/** Single-flight per tenant: jedno odświeżenie indeksu naraz, dokończone pod waitUntil. */
function startIndexRefresh(tenantId: string): Promise<RedirectIndex> {
  let pending = inflight.get(tenantId);
  if (!pending) {
    pending = loadIndexForTenant(tenantId).then((loaded) => {
      cache.set(tenantId, loaded);
      inflight.delete(tenantId);
      return loaded.index;
    });
    inflight.set(tenantId, pending);
    // Bez waitUntil runtime Workers ucinałby odświeżenie w tle razem
    // z domknięciem żądania. loadIndexForTenant nigdy nie rzuca.
    runAfterResponse(pending.then(() => undefined));
  }
  return pending;
}

/**
 * Indeks reguł tenanta dla konsumentów spoza ścieżki żądania (sitemap, feedy).
 * Korzysta z tego samego cache co middleware, więc sitemapa i 301-ki nigdy nie
 * rozjadą się w interpretacji reguł.
 */
export async function getRedirectIndexForTenant(tenantId: string): Promise<RedirectIndex> {
  return getIndexForTenant(tenantId);
}

// ---------------------------------------------------------------------------
// Request-time helpers
// ---------------------------------------------------------------------------

/**
 * DŁAWIENIE licznika trafień - per izolat, per reguła, okno stałe.
 *
 * DLACZEGO. Bez niego KAŻDY GET na regule był osobnym
 * `UPDATE redirects SET hit_count = hit_count + 1 WHERE id = <ta sama reguła>`.
 * Tenant `nes` ma wildcardowe reguły 410 na `/wp-admin/*`, `/wp-includes/*`,
 * `/wp-content/*` i `/wp-json/*` (migracja 20260801152304) - czyli dokładnie
 * tam, gdzie bez przerwy biją skanery WordPressa. Seria skanera to setki
 * aktualizacji JEDNEGO wiersza na sekundę: serializowane na blokadzie wiersza,
 * zajmujące połączenia PostgREST service-role - tę samą pulę, z której
 * czytają rozwiązywanie tenanta i indeks reguł z terminem 1 500 ms. Zator
 * licznika degradowałby więc 301-ki całej witryny.
 *
 * CO GWARANTUJE. Najwyżej `REDIRECT_HIT_WRITES_PER_WINDOW` zapisów jednej
 * reguły na `REDIRECT_HIT_WINDOW_MS` w izolacie. Zwykły ruch na stary adres
 * (kilka wejść na 10 s na izolat to już dużo) jest liczony DOKŁADNIE; ponad
 * próg trafienia są pomijane, więc `hit_count` staje się DOLNYM OSZACOWANIEM,
 * a `last_hit_at` spóźnia się najwyżej o jedno okno. Na pytanie, któremu
 * służy kolumna „Trafienia" („czy na ten stary adres ktoś jeszcze wchodzi"),
 * odpowiada to tak samo dobrze. Dokładna suma wymagałaby RPC przyjmującego
 * przyrost (`record_redirect_hit(_id, _n)`) - zmiana schematu i typów poza
 * tym modułem.
 *
 * PAMIĘĆ. Mapa ma sufit `REDIRECT_HIT_TRACKED_MAX` wpisów: po jego
 * osiągnięciu najpierw wypadają okna wygasłe, a gdy to nie wystarczy - cała
 * mapa. Wyczyszczenie może najwyżej przepuścić jedno dodatkowe okno zapisów;
 * nigdy nie blokuje liczenia.
 */
const REDIRECT_HIT_WINDOW_MS = 10_000;
const REDIRECT_HIT_WRITES_PER_WINDOW = 5;
const REDIRECT_HIT_TRACKED_MAX = 2_000;

interface HitWindow {
  start: number;
  writes: number;
}

const hitWindows = new Map<string, HitWindow>();

/** Czy to trafienie reguły mieści się w budżecie zapisów bieżącego okna. */
function admitRedirectHit(ruleId: string, now: number): boolean {
  const current = hitWindows.get(ruleId);
  if (current && now - current.start < REDIRECT_HIT_WINDOW_MS) {
    if (current.writes >= REDIRECT_HIT_WRITES_PER_WINDOW) return false;
    current.writes += 1;
    return true;
  }
  if (!current && hitWindows.size >= REDIRECT_HIT_TRACKED_MAX) {
    for (const [id, window] of hitWindows) {
      if (now - window.start >= REDIRECT_HIT_WINDOW_MS) hitWindows.delete(id);
    }
    if (hitWindows.size >= REDIRECT_HIT_TRACKED_MAX) hitWindows.clear();
  }
  hitWindows.set(ruleId, { start: now, writes: 1 });
  return true;
}

/**
 * Licznik trafień reguły (`redirects.hit_count`, `last_hit_at`) - jedno
 * wywołanie atomowego RPC `record_redirect_hit` (UPDATE ... hit_count + 1)
 * ZA odpowiedzią, pod `waitUntil`, o ile trafienie mieści się w budżecie
 * dławienia (`admitRedirectHit`). Do 2026-10-02 RPC nie miał ani jednego
 * wołającego, a panel /admin/redirects pokazywał kolumnę „Trafienia", która
 * zawsze stała na 0.
 *
 * UPRAWNIENIA, wprost: migracje 20260702130000/20260702195636 dały EXECUTE
 * service_role i zdjęły je tylko z PUBLIC, a domyślne uprawnienia platformy
 * nadają EXECUTE na nowe funkcje w `public` JAWNIE rolom anon i authenticated.
 * Zdjęcie ich z tej funkcji i z `record_seo_404` robi migracja
 * 20261002140000_redirect_hit_seo_404_rpc_execute_service_role_only; pilnuje
 * tego pgTAP `redirects_seo_404_tenant_rls_test.sql`.
 *
 * Gwarancje, wprost:
 *   * ZERO opóźnienia 301-ki: rejestracja w `runAfterResponse` jest
 *     synchroniczna, round-trip biegnie po wysłaniu odpowiedzi;
 *   * nigdy nie rzuca i nigdy nie oddaje odrzuconej obietnicy - błąd (także
 *     `{ error }` z PostgREST) kończy się `console.warn`, nie 500-ką;
 *   * RPC aktualizuje po samym `id`, bez filtra tenanta - i nie musi go mieć:
 *     `id` pochodzi z indeksu wczytanego `.eq("tenant_id", <tenant hosta>)`
 *     (albo z migawki L2 pod kluczem `redirects:<tenant>`), więc żądanie na
 *     hoście tenanta A fizycznie nie zna identyfikatora reguły tenanta B.
 */
function scheduleRedirectHit(ruleId: string): void {
  if (!admitRedirectHit(ruleId, Date.now())) return;
  runAfterResponse(recordRedirectHit(ruleId));
}

async function recordRedirectHit(ruleId: string): Promise<void> {
  try {
    const { supabaseAdmin } = await loadAdminClient();
    const { error } = await supabaseAdmin.rpc("record_redirect_hit", { _id: ruleId });
    if (error) console.warn("[redirects] hit accounting failed:", error);
  } catch (e) {
    console.warn("[redirects] hit accounting failed:", e);
  }
}

/**
 * Match a raw GET/HEAD request against the tenant's redirect rules.
 *
 * KTÓRA reguła jest liczona: WEJŚCIOWA (`hit.entryRule`), czyli ta, którą
 * dopasował adres żądania - także w łańcuchu A->B->C, w którym cel i kod
 * bierze się z reguły końcowej. Licznik ma odpowiadać na pytanie „czy na ten
 * stary adres ktoś jeszcze wchodzi"; liczenie reguły końcowej pokazywałoby
 * zero przy /a i fałszywy ruch przy /b, którego nikt nie odwiedził - a to
 * zero kusi operatora do usunięcia żywej 301-ki. 410 Gone też jest liczone:
 * „usunięty adres wciąż dostaje ruch" to dokładnie ten sygnał, którego panel
 * potrzebuje. HEAD nie jest liczone: to ruch narzędzi (monitoring, link
 * checkery), a nie czytelników ani robotów indeksujących, i nie powinien
 * kosztować zapisu w bazie.
 */
export async function resolveRedirectForRequest(request: Request): Promise<{
  target: string;
  status: number;
} | null> {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return null;
  const url = new URL(request.url);
  if (isProtectedPath(url.pathname)) return null;
  const tenant = await resolveTenantForHost(url.hostname);
  if (!tenant) return null;
  const index = await getIndexForTenant(tenant.id);
  if (index.exact.size === 0 && index.wildcards.length === 0) return null;
  const hit = matchRedirectForPath(index, url.pathname, url.search);
  if (!hit) return null;
  if (method === "GET") scheduleRedirectHit(hit.entryRule.id);
  if (hit.gone) return { target: "", status: 410 };
  // Relative targets stay path-only; absolute (allow-listed) URLs are already
  // full URLs coming out of matchRedirect / normalizeTargetPath.
  return { target: hit.target, status: hit.statusCode };
}

// ---------------------------------------------------------------------------
// 404 monitor
// ---------------------------------------------------------------------------

const STATIC_ASSET_RE = /\.[a-z0-9]{1,8}(?:$|\?)/i;

function shouldLog404(pathname: string, contentType: string | null): boolean {
  if (!contentType || !contentType.includes("text/html")) return false;
  if (isProtectedPath(pathname)) return false;
  // Trailing-file paths (favicon.ico, /robots.txt, /some.pdf) are asset noise
  // even when a route accidentally rendered HTML.
  if (STATIC_ASSET_RE.test(pathname)) return false;
  if (pathname.length > 2048) return false;
  return true;
}

/**
 * Limit długości `path` i `last_referrer` monitora 404 - ten sam, który
 * egzekwuje BAZA: `record_seo_404` zapisuje `left(_path, 500)` i
 * `left(_referrer, 500)` (migracja 20260703090300_redirects_tenant_scope).
 * Aplikacja do 2026-10-02 cięła do 2048, więc dwa źródła prawdy się
 * rozjeżdżały; teraz obcięcie dzieje się tu, jawnie, a RPC dostaje wartości,
 * których już nie musi skracać. `url.pathname`/`url.search` są
 * percent-encoded, a nagłówek `Referer` to ByteString - oba są ASCII, więc
 * `slice` (jednostki UTF-16) i `left` (znaki) liczą tu to samo.
 */
const SEO_404_TEXT_LIMIT = 500;

/**
 * Zapis trafienia 404 jednym atomowym RPC `record_seo_404`
 * (INSERT ... ON CONFLICT (tenant_id, path) DO UPDATE SET hits = hits + 1).
 * Zastąpił read-then-write (`select hits` + `update hits + 1` albo `upsert`):
 * dwa round-tripy na każde 404 i zgubione zliczenia, gdy dwa żądania na tę
 * samą ścieżkę czytały to samo `hits`. RPC jest SECURITY DEFINER (omija RLS),
 * a tenant przychodzi jawnie z hosta żądania - dlatego EXECUTE ma wyłącznie
 * service_role: GRANT z 20260703090300, a zdjęcie jawnych grantów anon
 * i authenticated z domyślnych uprawnień platformy - migracja
 * 20261002140000_redirect_hit_seo_404_rpc_execute_service_role_only (bez
 * niej anon przez /rest/v1/rpc/record_seo_404 dopisywał dowolne ścieżki do
 * monitora 404 DOWOLNEGO tenanta).
 *
 * Różnica semantyki, świadoma: brak referera NIE kasuje ostatniego znanego
 * (`COALESCE(EXCLUDED.last_referrer, h.last_referrer)`), podczas gdy stary
 * update nadpisywał go nullem.
 */
async function recordSeo404Hit(
  tenantId: string,
  path: string,
  referer: string | null,
): Promise<void> {
  try {
    const { supabaseAdmin } = await loadAdminClient();
    const { error } = await supabaseAdmin.rpc("record_seo_404", {
      _tenant_id: tenantId,
      _path: path.slice(0, SEO_404_TEXT_LIMIT),
      ...(referer ? { _referrer: referer.slice(0, SEO_404_TEXT_LIMIT) } : {}),
    });
    if (error) console.warn("[seo-404] log failed:", error);
  } catch (e) {
    console.warn("[seo-404] log failed:", e);
  }
}

/** Fire-and-forget 404 logger; safe to `void` from middleware. */
export async function maybeLog404(request: Request, response: Response): Promise<void> {
  if (response.status !== 404) return;
  const url = new URL(request.url);
  const contentType = response.headers.get("content-type");
  if (!shouldLog404(url.pathname, contentType)) return;
  const tenant = await resolveTenantForHost(url.hostname);
  if (!tenant) return;
  const referer = request.headers.get("referer") ?? request.headers.get("referrer");
  // Obcięcie do SEO_404_TEXT_LIMIT robi `recordSeo404Hit` - jedno miejsce.
  await recordSeo404Hit(tenant.id, `${url.pathname}${url.search}`, referer);
}
