// Host -> tenant resolution for the public path (server-only).
//
// Every service-role public surface (sitemap.xml, rss.xml, news-sitemap.xml,
// llms.txt, the redirect middleware, the 404 monitor) MUST scope its reads by
// the tenant that owns the request host - the service role bypasses RLS, so
// without this filter a second tenant's content leaks across sites.
//
// Two resolution contracts, matching two very different failure costs:
//
//   * CONTENT plane (resolveTenantForHost): unknown host -> DEFAULT tenant.
//     Previews and not-yet-claimed domains must still render a site; the anon
//     database plane (public.public_tenant_id()) applies the same fallback,
//     so HTML and data always agree.
//
//   * CRAWLER plane (resolveCrawlerTenantForHost): FAIL-CLOSED. The fallback
//     is allowed only for local/platform preview hosts, or while no tenant
//     has claimed any custom domain yet (single-tenant bootstrap - there is
//     nothing to cross-leak). Any other unknown host resolves to null and the
//     surface answers 404 / "Disallow: /" - an unclaimed domain must never
//     advertise, serve or index a tenant's content to crawlers.
//
// The full tenant directory is tiny and changes rarely, so it is cached per
// isolate with a short TTL (same pattern as the redirect rules cache) and
// resolution never adds a per-request round-trip in steady state.
import { isPreviewHost, normalizeHost, wwwToggledHost } from "@/lib/http/host";
import { runAfterResponse } from "@/lib/http/waitUntil.server";
import { readBootstrapSnapshot, writeBootstrapSnapshot } from "@/lib/http/bootstrapCache.server";

export interface TenantDirectoryEntry {
  id: string;
  slug: string;
  domain: string | null;
  isDefault: boolean;
}

export interface TenantDirectory {
  byDomain: ReadonlyMap<string, TenantDirectoryEntry>;
  defaultTenant: TenantDirectoryEntry | null;
}

const CACHE_TTL_MS = 60_000;

interface DirectoryCache {
  at: number;
  directory: TenantDirectory;
}

let cache: DirectoryCache | null = null;
let inflight: Promise<TenantDirectory> | null = null;
let sharedSnapshotAllowed = true;

const EMPTY_DIRECTORY: TenantDirectory = {
  byDomain: new Map<string, TenantDirectoryEntry>(),
  defaultTenant: null,
};

function buildDirectory(rows: readonly TenantDirectoryEntry[]): TenantDirectory {
  const byDomain = new Map<string, TenantDirectoryEntry>();
  let defaultTenant: TenantDirectoryEntry | null = null;
  for (const row of rows) {
    if (row.domain) byDomain.set(row.domain.toLowerCase(), row);
    if (row.isDefault) defaultTenant = row;
  }
  // A deployment without an explicit default still needs a deterministic
  // fallback - a single-tenant install behaves exactly as before.
  if (!defaultTenant && rows.length === 1) defaultTenant = rows[0];
  return { byDomain, defaultTenant };
}

function isDirectoryRows(value: unknown): value is TenantDirectoryEntry[] {
  return (
    Array.isArray(value) &&
    value.length <= 500 &&
    value.every(
      (row) =>
        row &&
        typeof row === "object" &&
        typeof row.id === "string" &&
        typeof row.slug === "string" &&
        (row.domain === null || typeof row.domain === "string") &&
        typeof row.isDefault === "boolean",
    )
  );
}

async function loadDirectory(): Promise<DirectoryCache> {
  try {
    // Consult L2 only when this isolate has no directory. Refreshes always
    // reach the database, and preserve the original snapshot timestamp.
    if (sharedSnapshotAllowed && !cache) {
      const snapshot = await readBootstrapSnapshot("tenants", CACHE_TTL_MS, isDirectoryRows);
      if (snapshot) return { at: snapshot.at, directory: buildDirectory(snapshot.value) };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("tenants")
      .select("id, slug, domain, is_default")
      .limit(500);
    if (error) throw error;
    const rows = (data ?? []).map((t) => ({
      id: t.id,
      slug: t.slug,
      domain: t.domain,
      isDefault: t.is_default,
    }));
    const at = Date.now();
    runAfterResponse(writeBootstrapSnapshot("tenants", { at, value: rows }, CACHE_TTL_MS));
    return { at, directory: buildDirectory(rows) };
  } catch (e) {
    console.warn("[tenant] directory load failed:", e);
    // Preserve the existing local retry backoff during a database outage.
    // Never publish that stale fallback as a fresh shared snapshot.
    return { at: Date.now(), directory: cache?.directory ?? EMPTY_DIRECTORY };
  }
}

/**
 * Cached tenant directory; concurrent cold requests share one round-trip.
 *
 * Stale-while-revalidate: po TTL nieświeży katalog serwuje NATYCHMIAST,
 * a odświeżenie biegnie w tle pod `waitUntil` (single-flight). Katalog stoi
 * na ścieżce KAŻDEGO dokumentu (klucz NES Edge Cache, redirecty, asercja
 * tenanta) ZANIM cache dokumentów może odpowiedzieć - blokujące odświeżanie
 * dokładało pełny round-trip do TTFB pierwszego żądania każdej minuty na
 * każdym izolacie. Zmiana domeny tenanta to zdarzenie administracyjne;
 * widoczność opóźniona o sekundy jest bez znaczenia. Zimny izolat (brak
 * wpisu) nadal blokuje jednorazowo - poprawność ponad szybkość.
 */
export async function getTenantDirectory(): Promise<TenantDirectory> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.directory;
  if (!inflight) {
    inflight = loadDirectory().then((loaded) => {
      cache = loaded;
      inflight = null;
      return loaded.directory;
    });
    // Żądanie może się domknąć zanim odświeżenie wróci z bazy - bez waitUntil
    // runtime Workers uciąłby fetch w tle i wpis tkwiłby nieświeży do
    // następnej (znów ucinanej) próby. loadDirectory nigdy nie rzuca.
    runAfterResponse(inflight.then(() => undefined));
  }
  // Nieświeży wpis: serwuj od ręki - odświeżenie już biegnie w tle.
  if (cache) return cache.directory;
  return inflight;
}

/** Test hook: drop the per-isolate cache. */
export function invalidateTenantDirectoryCache(): void {
  sharedSnapshotAllowed = false;
  cache = null;
  inflight = null;
}

/** Exact domain match, then the "www." alias of the apex (and vice versa). */
function matchDomain(directory: TenantDirectory, host: string | null): TenantDirectoryEntry | null {
  if (!host) return null;
  return directory.byDomain.get(host) ?? directory.byDomain.get(wwwToggledHost(host)) ?? null;
}

/**
 * `X-Forwarded-Host` bywa listą (kolejne proxy dopisują wartości po
 * przecinku). Normalizujemy każdą pozycję i twardo ograniczamy ich liczbę -
 * nagłówek jest wejściem atakującego, a walidacja niżej i tak przepuszcza
 * wyłącznie zarejestrowane domeny, więc limit chroni tylko koszt pętli.
 */
const MAX_FORWARDED_HOSTS = 8;

function forwardedHostCandidates(rawForwarded: string | null | undefined): string[] {
  if (!rawForwarded) return [];
  const out: string[] = [];
  for (const part of rawForwarded.split(",")) {
    const host = normalizeHost(part);
    if (host) out.push(host);
    if (out.length >= MAX_FORWARDED_HOSTS) break;
  }
  return out;
}

/**
 * ZAUFANY host żądania - walidacja hosta vs `tenants.domain` na krawędzi
 * (domknięcie audytu "x-tenant-host wciąż spoofowalny - brak trusted-proxy").
 *
 * Zamiast sekretu współdzielonego z proxy mechanizmem zaufania jest sam
 * katalog tenantów: nagłówek wart zaufania to taki, który wskazuje domenę
 * faktycznie zarejestrowaną w `tenants.domain` (dokładnie albo przez alias
 * www./apex) - a przy konflikcie wygrywa nagłówek, którego klient NIE może
 * sfałszować bez przejęcia routingu:
 *
 *   1. `Host` zarejestrowany w katalogu - autorytatywny: to nim warstwa
 *      hostingu (Cloudflare) routuje żądanie do zony, więc klient nie wskaże
 *      nim cudzej domeny nie trafiając fizycznie na jej site;
 *   2. `X-Forwarded-Host` zarejestrowany w katalogu - realne łańcuchy proxy
 *      (front z publiczną domeną przed originem o wewnętrznym `Host`);
 *      spreparowana wartość spoza katalogu nigdy tu nie przejdzie, a
 *      wartość wskazująca CUDZĄ domenę przegrywa z regułą 1;
 *   3. hosty podglądu (localhost / *.pages.dev / *.workers.dev itd.) -
 *      powierzchnie tenanta domyślnego, jak dotychczas;
 *   4. katalog bez żadnej zajętej domeny (bootstrap przed multi-domain albo
 *      katalog nieosiągalny) - nie ma czego cross-tenantowo pomylić, więc
 *      zachowujemy historyczny porządek `X-Forwarded-Host ?? Host`;
 *   5. inaczej null - "brak wskazówki tenanta": fetch do PostgREST nie
 *      wysyła `x-tenant-host` (baza i tak spadłaby na tenanta domyślnego),
 *      a scope'y cache SSR zlewają się do jednego kubełka zamiast przyjąć
 *      nieograniczoną, wybieraną przez atakującego kardynalność kluczy.
 *
 * Czysta funkcja decyzyjna - eksportowana do testów jednostkowych.
 */
export function pickTrustedHost(
  directory: TenantDirectory,
  rawHost: string | null | undefined,
  rawForwarded: string | null | undefined,
): string | null {
  const host = normalizeHost(rawHost);
  const forwarded = forwardedHostCandidates(rawForwarded);

  if (matchDomain(directory, host)) return host;
  for (const candidate of forwarded) {
    if (matchDomain(directory, candidate)) return candidate;
  }
  if (isPreviewHost(host)) return host;
  for (const candidate of forwarded) {
    if (isPreviewHost(candidate)) return candidate;
  }
  if (directory.byDomain.size === 0) return forwarded[0] ?? host;
  return null;
}

/**
 * Zaufany host żądania z walidacją vs `tenants.domain` (katalog per-izolat,
 * TTL 60 s - w stanie ustalonym zero dodatkowych round-tripów). Jedyny
 * poprawny punkt wejścia dla WSZYSTKICH serwerowych konsumentów hosta:
 * nagłówka `x-tenant-host` (fetchWithTenantHost), scope'ów NES Edge Cache /
 * ssrCache, atrybucji tenant_id anonimowych INSERT-ów i budowy URL-i absolutnych
 * na powierzchniach crawlera. Nigdy nie rzuca.
 */
export async function resolveTrustedRequestHost(request: Request): Promise<string | null> {
  const directory = await getTenantDirectory();
  return pickTrustedHost(
    directory,
    request.headers.get("host"),
    request.headers.get("x-forwarded-host"),
  );
}

/**
 * CONTENT plane: resolve the tenant owning a request host. Unknown hosts fall
 * back to the default tenant (previews / unclaimed domains still render a
 * site); null only when the directory is empty/unavailable (callers then skip
 * tenant-scoped side effects rather than mixing tenants).
 */
export async function resolveTenantForHost(
  rawHost: string | null | undefined,
): Promise<TenantDirectoryEntry | null> {
  const directory = await getTenantDirectory();
  return matchDomain(directory, normalizeHost(rawHost)) ?? directory.defaultTenant;
}

/** Convenience: content-plane tenant id for a host (null when unresolvable). */
export async function resolveTenantIdForHost(
  rawHost: string | null | undefined,
): Promise<string | null> {
  const tenant = await resolveTenantForHost(rawHost);
  return tenant?.id ?? null;
}

/**
 * CRAWLER plane: fail-closed host -> tenant resolution for the surfaces
 * crawlers consume and cache (sitemap.xml, rss.xml, news-sitemap.xml,
 * llms.txt, robots.txt) and for the redirect/404 middleware.
 *
 * The default-tenant fallback applies ONLY when the ambiguity is harmless:
 *   * the host is a local/platform preview (admins test the default site), or
 *   * no tenant has claimed any custom domain yet (pre-multi-domain install -
 *     routing cannot distinguish tenants, so there is nothing to leak).
 * Every other unknown host returns null and the caller must answer 404 /
 * "Disallow: /" instead of exposing the default tenant's content on an
 * unclaimed domain.
 */
export async function resolveCrawlerTenantForHost(
  rawHost: string | null | undefined,
): Promise<TenantDirectoryEntry | null> {
  const directory = await getTenantDirectory();
  const host = normalizeHost(rawHost);
  const matched = matchDomain(directory, host);
  if (matched) return matched;
  const fallbackIsSafe = isPreviewHost(host) || directory.byDomain.size === 0;
  return fallbackIsSafe ? directory.defaultTenant : null;
}

export interface DomainBinding {
  /** Tenant, którego `tenants.domain` DOKŁADNIE pasuje do hosta (lub przez alias www/apex). */
  readonly tenant: TenantDirectoryEntry | null;
  /**
   * Czy katalog domen jest zasiedlony. `false` = żaden tenant nie zajął domeny
   * ALBO katalog był nieosiągalny; w obu przypadkach brak dopasowania NIE jest
   * dowodem, że host jest obcy - wołający musi odróżnić "nie ten host" od
   * "nie wiem" (robots.txt nie cache'uje wtedy fail-closed zakazu).
   */
  readonly directoryPopulated: boolean;
}

/**
 * ŚCIŚLE domenowe rozstrzygnięcie hosta - bez żadnego fallbacku na tenanta
 * domyślnego. Używane tam, gdzie "host wygląda znajomo" nie wystarcza, bo
 * decyzja dotyczy indeksowania: robots.txt otwiera indeksowanie WYŁĄCZNIE dla
 * hosta marki albo domeny faktycznie zajętej w katalogu.
 */
export async function resolveDomainBinding(
  rawHost: string | null | undefined,
): Promise<DomainBinding> {
  const directory = await getTenantDirectory();
  return {
    tenant: matchDomain(directory, normalizeHost(rawHost)),
    directoryPopulated: directory.byDomain.size > 0,
  };
}

/** Convenience: crawler-plane tenant id for a host (null = fail closed). */
export async function resolveCrawlerTenantIdForHost(
  rawHost: string | null | undefined,
): Promise<string | null> {
  const tenant = await resolveCrawlerTenantForHost(rawHost);
  return tenant?.id ?? null;
}

/**
 * Rozróżnia dwa powody, dla których crawler-plane nie ma tenanta:
 *   * fail-closed - realny, nieznany host przy ZASIEDLONYM katalogu domen:
 *     powierzchnia crawlera musi odpowiedzieć 404 (nie wolno reklamować treści
 *     domyślnego tenanta na cudzej domenie) - ta funkcja zwraca false;
 *   * degradacja - host podglądu/lokalny albo katalog pusty/niedostępny (np.
 *     baza nieosiągalna w CI z placeholderowym Supabase): nie ma czego
 *     wyciekać, więc sitemap/rss mogą podać statyczny szkielet zamiast 404 -
 *     ta funkcja zwraca true.
 * Utrzymywane razem z resolveCrawlerTenantForHost, żeby predykat
 * bezpieczeństwa był jeden.
 */
export async function crawlerDegradeIsSafe(rawHost: string | null | undefined): Promise<boolean> {
  const directory = await getTenantDirectory();
  const host = normalizeHost(rawHost);
  return isPreviewHost(host) || directory.byDomain.size === 0;
}
