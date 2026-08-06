// Polityka crawlerów dla robots.txt: klasyfikacja hosta + odczyt ustawień SEO
// tenanta, w JEDNYM przebiegu.
//
// Dlaczego osobny moduł, a nie ciało trasy: plik trasy jest transformowany przez
// plugin routera i nie jest modułem, z którego się importuje - bez tego nie da
// się objąć decyzji testem jednostkowym (dokładnie ten sam powód, dla którego
// helpery mapy strony żyją w `sitemapRequest.server.ts`).
//
// Kontrakt: NIGDY nie rzuca. robots.txt musi odpowiedzieć nawet przy padniętej
// warstwie danych - brak odpowiedzi jest przez Google interpretowany jako
// tymczasowy zakaz crawlowania CAŁEJ domeny.
import {
  CANONICAL_SITE_HOSTS,
  crawlerPublishOrigin,
  isEditorOrLocalHost,
  isNonCanonicalPublicHost,
} from "@/lib/http/host";
import { robotsModeFor, type RobotsHostFacts, type RobotsMode } from "@/lib/seo/robots";
import { aiCrawlerDirectives, parseSeoSettings } from "@/lib/seo/settings";

export interface RobotsPolicy {
  mode: RobotsMode;
  /** Origin, na którym ogłaszamy sitemapy (wspólna reguła z mapą strony). */
  origin: string;
  /** Sitemapy do ogłoszenia (puste poza trybem kanonicznym). */
  sitemapPaths: readonly string[];
  /** Grupy `User-agent` polityki AI (puste = wszystkie crawlery wpuszczone). */
  agentGroups: readonly string[];
  /** Tenant, którego ustawienia zbudowały tę politykę (null = brak/degradacja). */
  tenantId: string | null;
}

/** Indeks sitemapy jest ogłaszany zawsze - to jedyny obowiązkowy adres. */
const SITEMAP_INDEX_PATH = "/sitemap.xml";

/** Sitemap Google News - tylko gdy redakcja ma ją włączoną (inaczej 404). */
const NEWS_SITEMAP_PATH = "/news-sitemap.xml";

/**
 * Fakty o hoście z perspektywy katalogu tenantów. Wydzielone, bo to jedyne
 * miejsce z I/O w całej decyzji - resztę rozstrzyga czysty `robotsModeFor`.
 */
async function hostFacts(host: string): Promise<RobotsHostFacts> {
  const facts: RobotsHostFacts = {
    brandCanonical: CANONICAL_SITE_HOSTS.has(host),
    aliasOrPreview: isEditorOrLocalHost(host) || isNonCanonicalPublicHost(host),
    tenantClaimed: false,
    directoryDegraded: false,
  };
  // Hosta marki ani aliasu nie ma sensu szukać w katalogu - decyzja jest już
  // podjęta, a to oszczędza round-trip na najczęstszej ścieżce.
  if (facts.brandCanonical || facts.aliasOrPreview) return facts;
  try {
    const { getTenantDirectory, resolveClaimedTenantForHost } =
      await import("@/lib/server/tenant.server");
    const [claimed, directory] = await Promise.all([
      resolveClaimedTenantForHost(host),
      getTenantDirectory(),
    ]);
    return {
      ...facts,
      tenantClaimed: claimed !== null,
      directoryDegraded: directory.byDomain.size === 0,
    };
  } catch (e) {
    // Katalog nieosiągalny = degradacja, nie fail-closed: patrz `robotsModeFor`.
    console.warn("[seo] robots.txt tenant directory unavailable:", e);
    return { ...facts, directoryDegraded: true };
  }
}

/**
 * Ustawienia SEO tenanta obsługującego hosta: lista sitemap do ogłoszenia +
 * polityka crawlerów AI. Best-effort - przy awarii zostaje sam indeks sitemapy
 * i brak ograniczeń per-agent (crawl działa dalej).
 */
async function crawlSettingsFor(
  host: string,
): Promise<Pick<RobotsPolicy, "sitemapPaths" | "agentGroups" | "tenantId">> {
  const fallback = { sitemapPaths: [SITEMAP_INDEX_PATH], agentGroups: [], tenantId: null };
  try {
    const { resolveCrawlerTenantIdForHost } = await import("@/lib/server/tenant.server");
    const tenantId = await resolveCrawlerTenantIdForHost(host);
    if (!tenantId) return fallback;
    const { fetchSeoSettingsValue } = await import("@/lib/server/publishedContent.server");
    const settings = parseSeoSettings(await fetchSeoSettingsValue(tenantId));
    return {
      // Kierowanie crawlera na 404 to gotowy błąd w raporcie Search Console -
      // news sitemap ogłaszamy tylko wtedy, gdy trasa faktycznie odpowie 200.
      sitemapPaths: settings.news_sitemap_enabled
        ? [SITEMAP_INDEX_PATH, NEWS_SITEMAP_PATH]
        : [SITEMAP_INDEX_PATH],
      agentGroups: aiCrawlerDirectives(settings),
      tenantId,
    };
  } catch (e) {
    console.warn("[seo] robots.txt settings unavailable:", e);
    return fallback;
  }
}

/**
 * Pełna polityka robots.txt dla hosta żądania. Jedno rozstrzygnięcie tenanta i
 * jeden odczyt ustawień na żądanie (obydwa za cache'em per-izolat).
 */
export async function resolveRobotsPolicy(host: string, proto: string): Promise<RobotsPolicy> {
  const mode = robotsModeFor(await hostFacts(host));
  const origin = crawlerPublishOrigin(host, proto);
  if (mode !== "canonical") {
    return { mode, origin, sitemapPaths: [], agentGroups: [], tenantId: null };
  }
  return { mode, origin, ...(await crawlSettingsFor(host)) };
}
