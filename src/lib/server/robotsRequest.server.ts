// Serwerowy kontekst /robots.txt: host -> klasa hosta -> tenant -> ustawienia
// redakcji -> gotowa treść i nagłówki. Trasa jest cienką warstwą nad tym
// modułem (tak samo jak trasy sitemapy nad `sitemapRequest.server.ts`) - plik
// trasy nie jest modułem, z którego wolno importować, więc logika żyje tutaj i
// jest testowalna bez routera.
//
// PRZYCZYNA POWSTANIA (audyt 2026-08-06): trasa robots.txt była poprawna, ale
// nieosiągalna - `public/robots.txt` trafiał do `.output/public/`, które
// wrangler wiąże jako `assets`, a warstwa assetów odpowiada PRZED workerem.
// Produkcja oddawała więc `Allow: /` dla każdego hosta (aliasy hostingu też
// zapraszone do indeksowania) i tylko jedną sitemapę. Przy okazji naprawy
// domknięte są dwie dalsze dziury tej samej powierzchni:
//   1. redakcyjna polityka crawlerów AI (`/admin/settings/seo`) NIE docierała
//      do robots.txt - `aiCrawlerDirectives` nie miał ani jednego wołającego;
//   2. domena zajęta przez tenanta (`tenants.domain`) była klasyfikowana jako
//      host nieznany, więc robots.txt zakazywał indeksowania CAŁEGO serwisu
//      tenanta, choć sitemapa równolegle publikowała jego adresy.
import {
  classifyCrawlHost,
  crawlHostIsIndexable,
  crawlHostOrigin,
  type CrawlHostClass,
} from "@/lib/http/host";
import { trustedPublicHost } from "@/lib/http/requestHost";
import { buildRobotsTxt, type RobotsGroup } from "@/lib/seo/robots";
import { aiCrawlerGroups, parseSeoSettings } from "@/lib/seo/settings";

/** Indeks sitemapy - ogłaszany zawsze, gdy host wolno indeksować. */
const SITEMAP_INDEX_PATH = "/sitemap.xml";
/** Google News - tylko gdy redakcja go włączy (inaczej trasa odpowiada 404). */
const NEWS_SITEMAP_PATH = "/news-sitemap.xml";

export interface RobotsPlan {
  /** Treść pliku. */
  readonly body: string;
  /** Klasa hosta, która o wszystkim zdecydowała (diagnostyka + testy). */
  readonly hostClass: CrawlHostClass;
  /** Czy host wolno indeksować - równocześnie wartość `X-Robots-Tag`. */
  readonly indexable: boolean;
  /** Klasyfikacja niepewna (katalog domen nieosiągalny) - nie cache'ować. */
  readonly volatile: boolean;
}

/**
 * Ustawienia SEO tenanta - best-effort. Awaria warstwy danych nie może wywrócić
 * robots.txt: crawler musi dostać poprawny plik (indeks sitemapy + domyślna,
 * otwarta polityka AI), a nie 500 albo zakaz indeksowania.
 */
async function tenantCrawlPolicy(
  tenantId: string,
): Promise<{ sitemapPaths: string[]; groups: RobotsGroup[] }> {
  const paths = [SITEMAP_INDEX_PATH];
  try {
    const { fetchSeoSettingsValue } = await import("@/lib/server/publishedContent.server");
    const settings = parseSeoSettings(await fetchSeoSettingsValue(tenantId));
    if (settings.news_sitemap_enabled) paths.push(NEWS_SITEMAP_PATH);
    return { sitemapPaths: paths, groups: aiCrawlerGroups(settings) };
  } catch (e) {
    console.warn("[seo] robots.txt settings unavailable:", e);
    return { sitemapPaths: paths, groups: [] };
  }
}

/**
 * Klasa hosta + tenant, którego politykę host ogłasza.
 *
 * Katalog domen jest odpytywany WYŁĄCZNIE wtedy, gdy reguły statyczne nie
 * rozstrzygają (host marki, podglądu i aliasu hostingu klasyfikują się bez
 * bazy). Dzięki temu host marki nigdy nie zależy od dostępności katalogu, a
 * niepewność ("nie wiem, czy to domena tenanta") jest jawnym stanem, nie
 * milczącym zakazem zapisanym w cache.
 */
async function classifyRequestHost(host: string): Promise<{
  hostClass: CrawlHostClass;
  tenantId: string | null;
  volatile: boolean;
}> {
  const staticClass = classifyCrawlHost({ host });
  // Hosty nieindeksowalne (podglądy, aliasy) nie ogłaszają niczego, więc tenant
  // jest im niepotrzebny - i nie warto ich kosztem odpytywać katalogu.
  if (staticClass !== "unknown" && !crawlHostIsIndexable(staticClass)) {
    return { hostClass: staticClass, tenantId: null, volatile: false };
  }

  try {
    const { resolveCrawlerTenantIdForHost, resolveDomainBinding } =
      await import("@/lib/server/tenant.server");
    // Host marki ogłasza politykę swojego tenanta.
    if (staticClass !== "unknown") {
      return {
        hostClass: staticClass,
        tenantId: await resolveCrawlerTenantIdForHost(host),
        volatile: false,
      };
    }
    const { tenant, directoryPopulated } = await resolveDomainBinding(host);
    if (tenant) return { hostClass: "tenant", tenantId: tenant.id, volatile: false };
    return { hostClass: "unknown", tenantId: null, volatile: !directoryPopulated };
  } catch (e) {
    // Warstwa tenantów niedostępna. Klasa statyczna zostaje (host marki nadal
    // jest indeksowalny), ale odpowiedź jest niepewna, więc nie wolno jej
    // cache'ować - patrz `volatile` w RobotsPlan.
    console.warn("[seo] robots.txt tenant directory unavailable:", e);
    return { hostClass: staticClass, tenantId: null, volatile: true };
  }
}

/**
 * Czy wolno ogłosić sitemapy. Trasy mapy są fail-closed: host bez tenanta przy
 * ZASIEDLONYM katalogu dostaje 404, więc ogłoszenie takiego adresu w robots.txt
 * kierowałoby crawlera na błąd - i to samo Search Console raportuje jako błąd
 * pliku sitemap. Degradacja (pusty/nieosiągalny katalog, host podglądu) jest
 * bezpieczna: mapa oddaje wtedy szkielet, nie 404.
 */
async function sitemapsAreServed(host: string, tenantId: string | null): Promise<boolean> {
  if (tenantId) return true;
  try {
    const { crawlerDegradeIsSafe } = await import("@/lib/server/tenant.server");
    return await crawlerDegradeIsSafe(host);
  } catch (e) {
    console.warn("[seo] robots.txt sitemap availability unknown:", e);
    return false;
  }
}

/** Pełny plan odpowiedzi /robots.txt dla żądania. Nigdy nie rzuca. */
export async function planRobotsTxt(request: Request): Promise<RobotsPlan> {
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const host = (await trustedPublicHost(request)) ?? "";
  const { hostClass, tenantId, volatile } = await classifyRequestHost(host);
  const indexable = crawlHostIsIndexable(hostClass);

  let sitemapPaths: readonly string[] = [];
  let groups: readonly RobotsGroup[] = [];
  if (indexable) {
    const policy = tenantId
      ? await tenantCrawlPolicy(tenantId)
      : { sitemapPaths: [SITEMAP_INDEX_PATH], groups: [] };
    // Polityka crawlerów AI obowiązuje niezależnie od tego, czy mapa jest
    // serwowalna - to dwie różne decyzje redakcji.
    groups = policy.groups;
    sitemapPaths = (await sitemapsAreServed(host, tenantId)) ? policy.sitemapPaths : [];
  }

  const body = buildRobotsTxt({
    mode: indexable ? "canonical" : hostClass === "unknown" ? "unknown" : "legacy",
    origin: crawlHostOrigin(hostClass, host, proto),
    sitemapPaths,
    groups,
  });

  return { body, hostClass, indexable, volatile };
}
