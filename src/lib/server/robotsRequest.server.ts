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
import { BUDGET_LAPSED, settleWithinBudget } from "@/lib/asyncBudget";
import { planNewsSitemap } from "@/lib/seo/newsSitemap";
import { buildRobotsTxt, type RobotsGroup, type RobotsUsagePolicy } from "@/lib/seo/robots";
import {
  DEFAULT_SEO_SETTINGS,
  aiCrawlerGroups,
  parseSeoSettings,
  robotsUsagePolicy,
  type SeoSettings,
} from "@/lib/seo/settings";

/** Polityka crawlowania jednego tenanta: mapy, grupy botów, warunki cytowania. */
interface CrawlPolicy {
  readonly sitemapPaths: string[];
  readonly groups: RobotsGroup[];
  readonly usage: RobotsUsagePolicy;
  /** Decyzja o news-sitemapie nie zapadła (awaria / budżet) - nie cache'ować. */
  readonly volatile: boolean;
}

/** Indeks sitemapy - ogłaszany zawsze, gdy host wolno indeksować. */
const SITEMAP_INDEX_PATH = "/sitemap.xml";
/** Google News - tylko gdy plik istnieje (patrz `newsSitemapAnnouncement`). */
const NEWS_SITEMAP_PATH = "/news-sitemap.xml";

export interface NewsSitemapAnnouncement {
  /** Czy /news-sitemap.xml wolno ogłosić (plik odpowie 200 z co najmniej jednym wpisem). */
  readonly announced: boolean;
  /** Odczyt wpisów rzucił albo przekroczył budżet - decyzja jest zdegradowana. */
  readonly failed: boolean;
}

/**
 * JEDNA decyzja „czy ogłosić /news-sitemap.xml" dla robots.txt i llms.txt -
 * ta sama, którą indeks sitemapy (`readNewsIndexEntry` w `sitemap[.]xml.ts`)
 * i trasa pliku liczą od 2026-10-10: przełącznik redakcji, potem
 * `loadNewsSitemapEntries` + `planNewsSitemap` i ogłoszenie tylko wtedy, gdy
 * plan nie jest `empty`.
 *
 * 2026-10 audyt powierzchni maszynowych: robots.txt ogłaszał plik na samą
 * flagę `news_sitemap_enabled`, a llms.txt bezwarunkowo, podczas gdy indeks
 * już sprawdzał, czy plik ma co pokazać. Tenant bez żadnego artykułu dostawał
 * więc z robots.txt i llms.txt adres, który odpowiada 404 „No news articles"
 * (Search Console raportuje to jako błąd pliku sitemap). Odczyt jest tym
 * samym wpisem `edgeTtlCache` co indeks i trasa pliku (`fetchPublishedPosts`
 * z limitem 200), więc trzeci odbiorca nie kosztuje zapytania.
 *
 * Budżet `NEWS_SITEMAP_READ_BUDGET_MS` z tego samego powodu co w indeksie:
 * `resilient` łapie błąd, nie powolność. Przekroczony budżet, awaria importu
 * i PUSTY plan (od którego awarii odczytu nie da się odróżnić) dają
 * `announced: false` z `failed: true` - wołający nie utrwala wtedy odpowiedzi
 * (robots.txt: `volatile`, llms.txt: TTL zdegradowany). Nigdy nie rzuca.
 */
export async function newsSitemapAnnouncement(
  tenantId: string,
  origin: string,
  settings: SeoSettings,
): Promise<NewsSitemapAnnouncement> {
  if (!settings.news_sitemap_enabled) return { announced: false, failed: false };
  try {
    const { NEWS_SITEMAP_READ_BUDGET_MS, loadNewsSitemapEntries } =
      await import("@/lib/server/newsSitemapEntries.server");
    const settled = await settleWithinBudget(
      loadNewsSitemapEntries(tenantId, origin),
      NEWS_SITEMAP_READ_BUDGET_MS,
    );
    if (settled === BUDGET_LAPSED) {
      console.warn(
        `[seo] news sitemap announcement timed out after ${NEWS_SITEMAP_READ_BUDGET_MS}ms`,
      );
      return { announced: false, failed: true };
    }
    const announced = planNewsSitemap(settled, Date.now()).mode !== "empty";
    // PUSTY PLAN PRZY WŁĄCZONEJ FLADZE NIE JEST PEWNIKIEM (przegląd 2026-10).
    // `fetchPublishedPosts` jest `resilient`: awaria bazy wraca jako `[]`, nie
    // jako wyjątek, więc „brak artykułów" i „odczyt padł" wyglądają tu tak
    // samo. Brak pewności = `failed`: robots.txt nie trafia do cache brzegu
    // bez linii news-sitemapy na pół godziny po chwilowej awarii. Koszt dla
    // najemcy, który naprawdę nie ma artykułów: robots.txt bez cache.
    return { announced, failed: !announced };
  } catch (e) {
    console.warn("[seo] news sitemap announcement unavailable:", e);
    return { announced: false, failed: true };
  }
}

export interface RobotsPlan {
  /** Treść pliku. */
  readonly body: string;
  /** Klasa hosta, która o wszystkim zdecydowała (diagnostyka + testy). */
  readonly hostClass: CrawlHostClass;
  /** Czy host wolno indeksować - równocześnie wartość `X-Robots-Tag`. */
  readonly indexable: boolean;
  /**
   * Odpowiedź niepewna - nie cache'ować: klasyfikacja hosta (katalog domen
   * nieosiągalny) albo decyzja o news-sitemapie (odczyt wpisów padł/za długo).
   */
  readonly volatile: boolean;
}

/**
 * Ustawienia SEO tenanta - best-effort. Awaria warstwy danych nie może wywrócić
 * robots.txt: crawler musi dostać poprawny plik (indeks sitemapy + domyślna,
 * otwarta polityka AI), a nie 500 albo zakaz indeksowania.
 */
async function tenantSeoSettings(tenantId: string): Promise<SeoSettings | null> {
  try {
    const { fetchSeoSettingsValue } = await import("@/lib/server/publishedContent.server");
    return parseSeoSettings(await fetchSeoSettingsValue(tenantId));
  } catch (e) {
    console.warn("[seo] robots.txt settings unavailable:", e);
    return null;
  }
}

async function tenantCrawlPolicy(tenantId: string, origin: string): Promise<CrawlPolicy> {
  const paths = [SITEMAP_INDEX_PATH];
  const settings = await tenantSeoSettings(tenantId);
  if (!settings) {
    // Degradacja NIE ZDEJMUJE warunku cytowania: awaria bazy nie jest zgodą na
    // nieoznaczone przejęcie treści, więc plik nadal go stawia (na domyślnych
    // ustawieniach polityki AI). News-sitemapy nie ogłaszamy - bez ustawień
    // nie wiadomo, czy redakcja jej nie wyłączyła.
    return {
      sitemapPaths: paths,
      groups: aiCrawlerGroups(DEFAULT_SEO_SETTINGS),
      usage: robotsUsagePolicy(DEFAULT_SEO_SETTINGS),
      volatile: false,
    };
  }
  // Ta sama decyzja co indeks sitemapy i llms.txt - patrz `newsSitemapAnnouncement`.
  const news = await newsSitemapAnnouncement(tenantId, origin, settings);
  if (news.announced) paths.push(NEWS_SITEMAP_PATH);
  return {
    sitemapPaths: paths,
    groups: aiCrawlerGroups(settings),
    usage: robotsUsagePolicy(settings),
    volatile: news.failed,
  };
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
  const classified = await classifyRequestHost(host);
  const { hostClass, tenantId } = classified;
  let volatile = classified.volatile;
  const indexable = crawlHostIsIndexable(hostClass);
  const origin = crawlHostOrigin(hostClass, host, proto);

  let sitemapPaths: readonly string[] = [];
  let groups: readonly RobotsGroup[] = [];
  let usage: RobotsUsagePolicy | undefined;
  if (indexable) {
    const policy: CrawlPolicy = tenantId
      ? await tenantCrawlPolicy(tenantId, origin)
      : {
          sitemapPaths: [SITEMAP_INDEX_PATH],
          groups: aiCrawlerGroups(DEFAULT_SEO_SETTINGS),
          usage: robotsUsagePolicy(DEFAULT_SEO_SETTINGS),
          volatile: false,
        };
    // Polityka crawlerów AI obowiązuje niezależnie od tego, czy mapa jest
    // serwowalna - to dwie różne decyzje redakcji.
    groups = policy.groups;
    usage = policy.usage;
    sitemapPaths = (await sitemapsAreServed(host, tenantId)) ? policy.sitemapPaths : [];
    // Plik bez news-sitemapy z powodu awarii odczytu (nie decyzji redakcji ani
    // braku artykułów) nie może utrwalić się na brzegu na pół godziny.
    volatile ||= policy.volatile;
  }

  const body = buildRobotsTxt({
    mode: indexable ? "canonical" : hostClass === "unknown" ? "unknown" : "legacy",
    origin,
    sitemapPaths,
    groups,
    usage,
  });

  return { body, hostClass, indexable, volatile };
}
