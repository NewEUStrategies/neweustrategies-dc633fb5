// Wspólny kontekst żądania powierzchni sitemapy: origin kanoniczny, hosty
// „tego samego serwisu", indeks przekierowań i nagłówki cache.
//
// Dzielą to DWIE trasy - indeks (/sitemap.xml) i shardy (/sitemaps/<sekcja>.xml)
// - a plik trasy nie jest modułem, z którego się importuje: plugin routera
// transformuje pliki w katalogu tras, więc import między nimi wiąże shard z
// rejestracją innej trasy. Helpery żyją tu, obie trasy tylko je wołają.
import { getRequest } from "@tanstack/react-start/server";
import { trustedPublicHost } from "@/lib/http/requestHost";
import { CANONICAL_SITE_HOSTS, crawlerPublishOrigin } from "@/lib/http/host";
import type { RedirectIndex } from "@/lib/seo/redirects";

// Alias nazwy utrzymany dla czytelności wywołań w trasach sitemapy; źródłem
// prawdy jest lib/http/host.ts (jedna lista dla 301, robots.txt i sitemapy).
export const SITEMAP_CANONICAL_HOSTS = CANONICAL_SITE_HOSTS;

/**
 * Origin, na którym mapa publikuje adresy.
 *
 * Legacy / kanoniczne hosty marki ZAWSZE emitują adresy na originie kanonicznym,
 * żeby wyszukiwarki zbiegały się na neweuropeanstrategies.com niezależnie od
 * tego, który alias obsłużył żądanie mapy.
 *
 * Sama reguła originu żyje w `lib/http/host.ts` (`crawlerPublishOrigin`) i jest
 * WSPÓLNA z robots.txt - mapa i jej ogłoszenie muszą wskazywać ten sam origin.
 */
export async function sitemapRequestContext(): Promise<{ origin: string; host: string }> {
  const req = getRequest();
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = (await trustedPublicHost(req)) ?? "";
  return { origin: crawlerPublishOrigin(host, proto), host };
}

/** Hosty uznawane za „ten sam serwis" przy kanonizacji przekierowań. */
export function sameOriginHostsFor(host: string): string[] {
  return [...SITEMAP_CANONICAL_HOSTS, host].filter(Boolean);
}

/**
 * Indeks przekierowań tenanta: sitemapa publikuje adres docelowy, nie ten, który
 * zaraz odpowie 301/410. Degraduje się do braku kanonizacji, gdy warstwa danych
 * nie odpowiada.
 */
export async function loadRedirectIndex(tenantId: string | null): Promise<RedirectIndex | null> {
  if (!tenantId) return null;
  try {
    const { getRedirectIndexForTenant } = await import("@/lib/seo/redirects.server");
    return await getRedirectIndexForTenant(tenantId);
  } catch (e) {
    console.warn("[seo] sitemap redirect index unavailable:", e);
    return null;
  }
}

/** Nagłówki wspólne dla indeksu i shardów. */
export const SITEMAP_CACHE_HEADERS = {
  "Content-Type": "application/xml; charset=utf-8",
  // Zawsze rewaliduj u klienta; CDN trzyma świeżą kopię przez 60s, stare
  // zwracane jako fallback do 30 min - dzięki temu zmiany SEO (nowy wpis,
  // seo_noindex, redirect) propagują się bez ręcznego odświeżania cache.
  "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=1800, must-revalidate",
} as const;

/**
 * Rozstrzygnięcie tenanta dla powierzchni mapy.
 *
 * FAIL-CLOSED: host, którego nie objął żaden tenant (i który nie jest hostem
 * podglądowym), nie może reklamować niczyich adresów - dostaje 404, zamiast
 * mapować treść tenanta domyślnego na obcą domenę.
 * DEGRADACJA ≠ fail-closed: gdy tenanta nie ma, bo katalog domen jest
 * pusty/nieosiągalny albo host jest podglądowy/lokalny (dev, e2e z
 * placeholderowym Supabase), crawler dostaje statyczny szkielet mapy zamiast
 * 404 - nie ma tam żadnej cudzej treści do wycieku.
 */
export async function resolveSitemapTenant(
  host: string,
): Promise<{ tenantId: string | null; blocked: boolean }> {
  const { resolveCrawlerTenantIdForHost, crawlerDegradeIsSafe } =
    await import("@/lib/server/tenant.server");
  const tenantId = await resolveCrawlerTenantIdForHost(host);
  if (!tenantId && !(await crawlerDegradeIsSafe(host))) return { tenantId: null, blocked: true };
  return { tenantId, blocked: false };
}
