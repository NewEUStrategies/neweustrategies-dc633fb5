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
//     Jedyny wyjątek od filtra W SQL to odczyt zimnego izolatu
//     (`readEnabledRulesOfAllTenants`): biegnie, zanim host jest rozstrzygnięty,
//     więc filtr `tenant_id` tenanta hosta nakłada KOD, zanim cokolwiek trafi
//     do indeksu - cudze reguły nigdy nie wchodzą do cache per tenant, do
//     matchera ani do migawki L2.
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
 * (`tenant_id`, `is_enabled`), a nie raport. Na zimnym izolacie oba terminy
 * tej płaszczyzny biegną RÓWNOLEGLE (`coldRulesReadForRequest`), więc sufit
 * warstwy to 1 500 ms; szeregowo (host -> tenant, potem reguły, razem
 * 3 000 ms - tyle, co cała rozgrzewka korzenia) idą już tylko zejścia, gdy
 * odczyt wszystkich reguł nie nadaje się do użycia. Zejście po terminie to TA
 * SAMA gałąź, co dla błędu (nieświeży indeks albo pusty).
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

/** Stan odczytu zimnego izolatu - opis i uzasadnienie przy `coldRulesReadForRequest`. */
let coldReadGeneration = 0;
let coldReadInFlight: ColdRulesRead | null = null;
const coldReadsByTenant = new Map<string, ColdRulesRead>();

/** Test hook - drop every cached tenant index. */
export function invalidateRedirectCache(): void {
  // An explicit local invalidation must not immediately restore an old L2
  // snapshot. The next successful database read publishes its replacement.
  sharedSnapshotsAllowed = false;
  cache.clear();
  inflight.clear();
  // Odczyt zimnego izolatu sprzed inwalidacji nie może zasiać indeksu po niej:
  // nowe pokolenie unieważnia też uchwyty trzymane przez żądania w locie.
  coldReadGeneration += 1;
  coldReadInFlight = null;
  coldReadsByTenant.clear();
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
      const snapshot = await readRedirectSnapshot(tenantId);
      if (snapshot) return snapshot;
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
    return publishLoadedRules(tenantId, (data ?? []).map(toRedirectRule), Date.now());
  } catch (e) {
    console.warn("[redirects] index load failed:", e);
    return degradedIndex(tenantId, "error");
  }
}

/** Migawka L2 reguł tenanta jako wpis cache'u z ORYGINALNYM `at` albo null. */
async function readRedirectSnapshot(tenantId: string): Promise<CachedIndex | null> {
  const snapshot = await readBootstrapSnapshot(
    `redirects:${tenantId}`,
    REDIRECT_CACHE_TTL_MS,
    isRedirectRules,
  );
  if (!snapshot) return null;
  const index = buildRedirectIndex(snapshot.value);
  return { at: snapshot.at, index, count: index.exact.size + index.wildcards.length };
}

/** Wiersz `redirects` w kolumnach, które czyta indeks (oba odczyty: per tenant i zimny). */
interface RedirectRuleRow {
  id: unknown;
  source_path: unknown;
  target_path: unknown;
  status_code: unknown;
}

function toRedirectRule(row: RedirectRuleRow): RedirectRule {
  return {
    id: row.id as string,
    source_path: row.source_path as string,
    target_path: row.target_path as string,
    status_code: row.status_code as number,
  };
}

/**
 * Indeks z reguł UDANEGO odczytu bazy i jego migawka współdzielona za
 * odpowiedzią - jedna ścieżka dla odczytu per tenant i odczytu zimnego izolatu,
 * więc oba publikują w kolonii ten sam kształt pod tym samym kluczem.
 */
function publishLoadedRules(tenantId: string, rules: RedirectRule[], at: number): CachedIndex {
  const index = buildRedirectIndex(rules);
  // Świeżość = REDIRECT_CACHE_TTL_MS, przetrwanie = domyślna doba migawki.
  runAfterResponse(
    writeBootstrapSnapshot(`redirects:${tenantId}`, { at, value: rules }, REDIRECT_CACHE_TTL_MS),
  );
  return { at, index, count: index.exact.size + index.wildcards.length };
}

// ---------------------------------------------------------------------------
// Zimny izolat: reguły wszystkich tenantów równolegle z katalogiem tenantów
// ---------------------------------------------------------------------------

/** Wiersz odczytu zimnego izolatu - z `tenant_id`, bo filtr tenanta nakłada kod. */
interface ColdRuleRow extends RedirectRuleRow {
  tenant_id: unknown;
}

/** Wynik odczytu zimnego izolatu. Nigdy nie odrzuca. */
type ColdRulesOutcome =
  | { kind: "rows"; at: number; rows: readonly ColdRuleRow[] }
  /** Termin minął - zejście jak w `loadIndexForTenant`, bez drugiego odczytu. */
  | { kind: "timeout" }
  /** Błąd, `data: null` albo wynik na limicie - zejście do odczytu per tenant. */
  | { kind: "unusable" };

interface ColdRulesRead {
  /** Pokolenie `invalidateRedirectCache`; uchwyt starszego pokolenia jest martwy. */
  generation: number;
  outcome: Promise<ColdRulesOutcome>;
}

/**
 * ODCZYT ZIMNEGO IZOLATU (2026-10-22) - reguły WSZYSTKICH tenantów jednym
 * zapytaniem, wystartowanym RÓWNOLEGLE z `resolveTenantForHost`.
 *
 * DLACZEGO. Na hostingu produkcyjnym (Lovable, Workers for Platforms) każde
 * żądanie trafia w zimny izolat, a Cache API nie działa (`nes-l2;desc="off"`),
 * więc ani cache w pamięci, ani migawki L2 niczego nie ratują. Przed cache
 * dokumentów `redirectMiddleware` czekał na DWA SZEREGOWE odczyty planu
 * service-role do eu-west-1: katalog tenantów, a dopiero po nim reguły
 * przekierowań tenanta hosta. Server-Timing `edge-routing` mierzył na tym
 * odcinku 456-1291 ms, a Speed Index PageSpeed liczy realny czas odpowiedzi
 * serwera (mobile x1,4). Reguł nie da się przefiltrować tenantem, zanim
 * katalog odpowie - da się je natomiast przeczytać WSZYSTKIE w tym samym
 * czasie: koszt zimnego żądania spada z katalog + reguły do max(katalog,
 * reguły).
 *
 * IZOLACJA TENANTÓW. Filtr `tenant_id` nakłada `loadIndexFromColdRead` -
 * wyłącznie tenantem rozstrzygniętym ze ZWALIDOWANEGO hosta żądania, nigdy
 * z ładunku. Cudze wiersze żyją tylko w obietnicy odczytu: nie trafiają do
 * cache per tenant, do matchera ani do migawki `redirects:<tenant>`.
 *
 * KIEDY NIE. Ścieżki chronione i metody inne niż GET/HEAD wychodzą wcześniej.
 * Izolat z JAKIMKOLWIEK indeksem w cache albo w locie idzie zwykłą ścieżką
 * per tenant (SWR) - odczyt wszystkich reguł opłaca się tylko wtedy, gdy i tak
 * trzeba czekać na katalog. Wynik na limicie `REDIRECT_ROW_LIMIT` mógł uciąć
 * reguły dowolnego tenanta, więc razem z błędem i `data: null` schodzi do
 * dzisiejszego odczytu per tenant; lapsus terminu idzie zejściem „timeout"
 * bez drugiego blokującego odczytu.
 *
 * KOSZT, świadomy: przy DZIAŁAJĄCYM L2 zimny izolat i tak wysyła ten odczyt,
 * choć świeża migawka odpowie szybciej (wyścig w `loadIndexFromColdRead`) -
 * jeden odczyt w tle na zimny izolat, bez wpływu na czas odpowiedzi. Przy
 * migawce NIEŚWIEŻEJ ten sam odczyt jest jej odświeżeniem, nie dodatkowym.
 *
 * Równoległe żądania zimnego izolatu dzielą jeden odczyt w locie.
 */
function coldRulesReadForRequest(): ColdRulesRead | null {
  if (cache.size > 0 || inflight.size > 0) return null;
  if (coldReadInFlight) return coldReadInFlight;
  const read: ColdRulesRead = {
    generation: coldReadGeneration,
    outcome: readEnabledRulesOfAllTenants(),
  };
  coldReadInFlight = read;
  // Współdzielony tylko w locie: rozstrzygnięty wynik nie może zasiać indeksu
  // żądania, które przyjdzie dowolnie później.
  void read.outcome.then(() => {
    if (coldReadInFlight === read) coldReadInFlight = null;
  });
  return read;
}

async function readEnabledRulesOfAllTenants(): Promise<ColdRulesOutcome> {
  try {
    const { supabaseAdmin } = await loadAdminClient();
    const settled = await settleWithinBudget(
      supabaseAdmin
        .from("redirects")
        .select("id, source_path, target_path, status_code, tenant_id")
        .eq("is_enabled", true)
        .limit(REDIRECT_ROW_LIMIT),
      REDIRECT_INDEX_BUDGET_MS,
    );
    if (settled === BUDGET_LAPSED) return { kind: "timeout" };
    const { data, error } = settled;
    if (error || !data || data.length >= REDIRECT_ROW_LIMIT) return { kind: "unusable" };
    return { kind: "rows", at: Date.now(), rows: data };
  } catch {
    // Bez ostrzeżenia: zejście per tenant zaloguje błąd, jeśli się powtórzy.
    return { kind: "unusable" };
  }
}

/**
 * Przypisz odczyt zimnego izolatu tenantowi hosta. Konsumuje go
 * `startIndexRefresh`, więc single-flight i SWR zostają te same co dla odczytu
 * per tenant. Tenant z indeksem w cache albo w locie go nie dostaje.
 */
function adoptColdRulesRead(tenantId: string, read: ColdRulesRead): void {
  if (read.generation !== coldReadGeneration) return;
  if (cache.has(tenantId) || inflight.has(tenantId)) return;
  coldReadsByTenant.set(tenantId, read);
}

/**
 * Indeks tenanta z odczytu zimnego izolatu. Migawka L2 (gdy wolno jej użyć)
 * ŚCIGA się z odczytem, który już leci: przy działającym L2 wygrywa jak dotąd
 * (zero czekania na bazę, także dla migawki nieświeżej), przy martwym jej
 * chybienie nie dokłada do ścieżki żądania niczego ponad odczyt w locie.
 * `null` z wyścigu to „odczyt rozstrzygnął się pierwszy" ALBO „migawki nie
 * ma" - w obu przypadkach decyduje odczyt.
 */
async function loadIndexFromColdRead(tenantId: string, read: ColdRulesRead): Promise<CachedIndex> {
  try {
    if (sharedSnapshotsAllowed && !cache.has(tenantId)) {
      const first = await Promise.race([
        read.outcome.then(() => null),
        readRedirectSnapshot(tenantId),
      ]);
      if (first) {
        // Nieświeża migawka: odczyt w locie zostaje przy tenancie i staje się
        // odświeżeniem, które `getIndexForTenant` startuje zaraz po niej.
        if (
          Date.now() - first.at >= REDIRECT_CACHE_TTL_MS &&
          read.generation === coldReadGeneration
        ) {
          coldReadsByTenant.set(tenantId, read);
        }
        return first;
      }
    }
    const outcome = await read.outcome;
    if (outcome.kind === "timeout") return degradedIndex(tenantId, "timeout");
    if (outcome.kind === "unusable") return await loadIndexForTenant(tenantId);
    const rules = outcome.rows.filter((row) => row.tenant_id === tenantId).map(toRedirectRule);
    return publishLoadedRules(tenantId, rules, outcome.at);
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
 * pozostają poprawne - ale na żądaniu dokumentu czeka na odczyt wystartowany
 * równolegle z katalogiem tenantów (`coldRulesReadForRequest`); zimny izolat
 * z migawką nieświeżą serwuje ją od ręki i odświeża w tle jeszcze w tym samym
 * żądaniu (patrz `loadIndexForTenant` i `loadIndexFromColdRead`).
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

/**
 * Single-flight per tenant: jedno odświeżenie indeksu naraz, dokończone pod
 * waitUntil. Odczyt zimnego izolatu przypisany tenantowi (`adoptColdRulesRead`)
 * jest konsumowany TU, jako jego ładowanie - stąd te same single-flight i SWR.
 */
function startIndexRefresh(tenantId: string): Promise<RedirectIndex> {
  let pending = inflight.get(tenantId);
  if (!pending) {
    const coldRead = coldReadsByTenant.get(tenantId);
    coldReadsByTenant.delete(tenantId);
    const load = coldRead
      ? loadIndexFromColdRead(tenantId, coldRead)
      : loadIndexForTenant(tenantId);
    pending = load.then((loaded) => {
      cache.set(tenantId, loaded);
      inflight.delete(tenantId);
      return loaded.index;
    });
    inflight.set(tenantId, pending);
    // Bez waitUntil runtime Workers ucinałby odświeżenie w tle razem
    // z domknięciem żądania. Żaden z dwóch loaderów nigdy nie rzuca.
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
 *     `id` pochodzi z indeksu wczytanego `.eq("tenant_id", <tenant hosta>)`,
 *     z odczytu zimnego izolatu przefiltrowanego w kodzie tym samym
 *     `tenant_id` (`loadIndexFromColdRead`) albo z migawki L2 pod kluczem
 *     `redirects:<tenant>`, więc indeks żądania na hoście tenanta A nie
 *     zawiera identyfikatora reguły tenanta B.
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
  // Zimny izolat: reguły wszystkich tenantów lecą RÓWNOLEGLE z katalogiem
  // tenantów (zamiast po nim), a do indeksu trafiają wyłącznie reguły tenanta
  // rozstrzygniętego niżej z hosta - patrz `coldRulesReadForRequest`.
  const coldRead = coldRulesReadForRequest();
  const tenant = await resolveTenantForHost(url.hostname);
  if (!tenant) return null;
  if (coldRead) adoptColdRulesRead(tenant.id, coldRead);
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
