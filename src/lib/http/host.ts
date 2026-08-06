// Pure, isomorphic host helpers shared by the whole host -> tenant plane:
// the server-side resolver (tenant.server.ts), the Supabase fetch wrapper
// (x-tenant-host header) and the SSR edge cache scoping. One definition of
// "what is the request host" so the SQL side (public.request_public_host())
// and the TS side can never drift apart.

/**
 * Header carrying the public site host to PostgREST. The SQL function
 * public.request_public_host() reads exactly this header, and
 * public.public_tenant_id() maps it to the owning tenant - which makes every
 * anon RLS policy host-aware without touching individual queries.
 *
 * Trust model, per plane:
 *   * browser -> PostgREST: the value is client-controlled by design - it
 *     only ever selects WHICH tenant's PUBLISHED content the caller reads
 *     (data that is public on that tenant's own domain anyway), and the SQL
 *     side matches it against tenants.domain with a default-tenant fallback;
 *   * SSR/edge -> PostgREST: the value is VALIDATED against tenants.domain
 *     before injection (pickTrustedHost in src/lib/server/tenant.server.ts) -
 *     a spoofed X-Forwarded-Host never reaches the database, the SSR caches
 *     or tenant_id attribution.
 * Staff/private reads are scoped by current_tenant_id() (profile-based) and
 * never by this header.
 */
export const TENANT_HOST_HEADER = "x-tenant-host";

/** Normalize a Host header / URL host: lowercase, strip port and brackets. */
export function normalizeHost(rawHost: string | null | undefined): string | null {
  if (!rawHost) return null;
  const host = rawHost.trim().toLowerCase();
  if (!host) return null;
  // IPv6 literals ("[::1]:8080") - keep the bracket content only.
  const bracketMatch = host.match(/^\[([^\]]+)\]/);
  if (bracketMatch) return bracketMatch[1];
  return host.split(":")[0] || null;
}

/**
 * "www." is an alias of the apex domain (and vice versa). Returns the
 * counterpart host so resolvers can match either registration.
 */
export function wwwToggledHost(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : `www.${host}`;
}

/**
 * Hosts that are legitimate previews of the DEFAULT tenant: local dev plus the
 * preview domains issued by the hosting layer of this deployment (Cloudflare
 * Pages / Workers). Crawler surfaces fail CLOSED for every other unknown host
 * (see resolveCrawlerTenantForHost) - an unclaimed production domain must never
 * serve, advertise or index another tenant's content.
 *
 * The list is deliberately SHORT and vendor-neutral. Anything a specific
 * deployment adds belongs in `PREVIEW_HOST_SUFFIXES` (env), not in source:
 * a hardcoded vendor domain is a security-relevant allowlist entry that
 * outlives the vendor, and every entry here widens the fail-open path of the
 * crawler plane.
 */
const BUILTIN_PREVIEW_HOST_SUFFIXES = [".localhost", ".pages.dev", ".workers.dev"] as const;

const PREVIEW_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/**
 * Extra host suffixes from the environment (comma-separated, with or without the
 * leading dot), e.g. `PREVIEW_HOST_SUFFIXES=".preview.example,.stage.example"`.
 * Read once per isolate: the value cannot change inside a running worker.
 */
function envHostSuffixes(name: string): readonly string[] {
  const raw = typeof process !== "undefined" ? process.env?.[name] : undefined;
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`));
}

const envPreviewHostSuffixes = envHostSuffixes("PREVIEW_HOST_SUFFIXES");

/** True for local/dev/platform-preview hosts (never for customer domains). */
export function isPreviewHost(rawHost: string | null | undefined): boolean {
  const host = normalizeHost(rawHost);
  if (!host) return false;
  if (PREVIEW_HOSTS.has(host)) return true;
  if (BUILTIN_PREVIEW_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  return envPreviewHostSuffixes.some((suffix) => host.endsWith(suffix));
}

// ── Kanoniczny origin marki i hosty niekanoniczne ──────────────────────────
//
// JEDNA definicja dla wszystkich powierzchni SEO. Wcześniej `canonicalRedirect`,
// `sitemapRequest.server` i `robots[.]txt` miały każde WŁASNĄ kopię listy
// aliasów i originu kanonicznego - trzy allowlisty istotne dla indeksowania,
// które mogły się rozjechać po cichu (host dopisany w jednym miejscu dostaje
// 301, ale robots.txt dalej pozwala go indeksować - i mamy zduplikowaną treść
// w wynikach wyszukiwania).

/** Origin, na który zbiegają się wszystkie adresy publikowane crawlerom. */
export const CANONICAL_SITE_ORIGIN = "https://neweuropeanstrategies.com";

/** Hosty kanoniczne marki (apex + www). */
export const CANONICAL_SITE_HOSTS: ReadonlySet<string> = new Set([
  "neweuropeanstrategies.com",
  "www.neweuropeanstrategies.com",
]);

export function isCanonicalSiteHost(rawHost: string | null | undefined): boolean {
  const host = normalizeHost(rawHost);
  return host !== null && CANONICAL_SITE_HOSTS.has(host);
}

/**
 * Hosty edytora/podglądu, których NIE kanonizujemy ani nie blokujemy: lokalny
 * dev i podgląd w edytorze (iframe). `EDITOR_HOST_SUFFIXES` nazywa domeny
 * edytora danego wdrożenia; prefiks `id-preview--` zostaje, bo identyfikuje
 * podgląd w edytorze niezależnie od domeny, która go obsługuje.
 */
const envEditorHostSuffixes = envHostSuffixes("EDITOR_HOST_SUFFIXES");

export function isEditorOrLocalHost(rawHost: string | null | undefined): boolean {
  const host = normalizeHost(rawHost);
  if (!host) return false;
  if (PREVIEW_HOSTS.has(host) || host.endsWith(".localhost")) return true;
  if (host.startsWith("id-preview--")) return true;
  return envEditorHostSuffixes.some((suffix) => host.endsWith(suffix));
}

/** Aliasy warstwy hostingu - zawsze niekanoniczne. */
const BUILTIN_NON_CANONICAL_SUFFIXES = [".pages.dev", ".workers.dev"] as const;

const envLegacyHostSuffixes = envHostSuffixes("LEGACY_HOST_SUFFIXES");

/**
 * Host, który obsługuje ten serwis, ale NIE jest kanoniczny: alias hostingu albo
 * domena historyczna z `LEGACY_HOST_SUFFIXES`. Takie hosty dostają 301 na origin
 * kanoniczny, a robots.txt zakazuje ich indeksowania - inaczej wyszukiwarki
 * trzymają w indeksie dwie kopie tej samej treści.
 */
export function isNonCanonicalPublicHost(rawHost: string | null | undefined): boolean {
  const host = normalizeHost(rawHost);
  if (!host) return false;
  if (CANONICAL_SITE_HOSTS.has(host)) return false;
  if (isEditorOrLocalHost(host)) return false;
  return (
    BUILTIN_NON_CANONICAL_SUFFIXES.some((suffix) => host.endsWith(suffix)) ||
    envLegacyHostSuffixes.some((suffix) => host.endsWith(suffix))
  );
}

// ── Klasa hosta na powierzchniach crawlera ─────────────────────────────────
//
// JEDNA decyzja, z której korzystają wszystkie powierzchnie maszynowe:
// robots.txt rozstrzyga nią, czy host wolno indeksować, a sitemapa - na jakim
// originie publikuje adresy. Wcześniej każda powierzchnia składała ten wniosek
// z trzech osobnych predykatów, we własnej kolejności; rozjazd między nimi to
// dokładnie ten błąd, który daje w indeksie dwie kopie tej samej treści (albo
// zaproszenie do indeksowania aliasu hostingu).

export type CrawlHostClass =
  /** Kanoniczny host marki (apex/www): indeksowanie, origin kanoniczny. */
  | "brand"
  /** Domena zajęta przez tenanta (`tenants.domain`): indeksowanie na WŁASNYM originie. */
  | "tenant"
  /** Alias warstwy hostingu / domena historyczna: 301 + pełny zakaz indeksowania. */
  | "alias"
  /** Podgląd w edytorze albo lokalny dev: nigdy nieindeksowany, własny origin. */
  | "editor"
  /** Host, którego nie objął żaden tenant: fail-closed (pełny zakaz). */
  | "unknown";

export interface CrawlHostFacts {
  /** Surowy host żądania - normalizowany wewnątrz. */
  readonly host: string | null | undefined;
  /**
   * Czy host jest DOKŁADNIE domeną zarejestrowaną w `tenants.domain` (także
   * przez alias www/apex). Tylko twarde dopasowanie: fallback na tenanta
   * domyślnego (hosty podglądu, pusty katalog domen) NIE czyni hosta
   * kanonicznym i nie może otworzyć indeksowania obcej domeny.
   */
  readonly tenantDomain?: boolean;
}

/**
 * Klasa hosta dla powierzchni crawlera. Kolejność reguł jest częścią kontraktu:
 * marka > podgląd/alias > katalog domen. Podgląd i alias hostingu wygrywają z
 * katalogiem, więc nawet wpisanie `*.pages.dev` jako domeny tenanta nie
 * otworzy indeksowania aliasu.
 */
export function classifyCrawlHost(facts: CrawlHostFacts): CrawlHostClass {
  const host = normalizeHost(facts.host);
  if (!host) return "unknown";
  if (CANONICAL_SITE_HOSTS.has(host)) return "brand";
  if (isEditorOrLocalHost(host)) return "editor";
  if (isNonCanonicalPublicHost(host)) return "alias";
  return facts.tenantDomain ? "tenant" : "unknown";
}

/** Czy powierzchnie crawlera mogą zaprosić ten host do indeksowania. */
export function crawlHostIsIndexable(hostClass: CrawlHostClass): boolean {
  return hostClass === "brand" || hostClass === "tenant";
}

/**
 * Origin, na którym host tej klasy publikuje adresy crawlerom.
 *
 * Marka i jej aliasy ZAWSZE zbiegają się na originie kanonicznym (alias
 * obsłużył żądanie, ale adresy w mapie i w robots.txt muszą wskazywać domenę
 * docelową). Domena tenanta, podgląd i host nieznany publikują na własnym
 * originie - inaczej mapa jednego serwisu reklamowałaby adresy drugiego.
 */
export function crawlHostOrigin(
  hostClass: CrawlHostClass,
  rawHost: string | null | undefined,
  proto = "https",
): string {
  if (hostClass === "brand" || hostClass === "alias") return CANONICAL_SITE_ORIGIN;
  const host = normalizeHost(rawHost);
  return host ? `${proto}://${host}` : "";
}
