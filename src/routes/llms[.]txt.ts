// llms.txt (llmstxt.org) - the GEO surface: a concise markdown guide served to
// AI assistants and answer engines describing the publication, its sections,
// the freshest articles per language and the machine-readable resources. This
// is how the site earns accurate, canonical citations in AI answers
// (zero-click brand visibility).
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { trustedPublicHost } from "@/lib/http/requestHost";
import { classifyCrawlHost, crawlerPublishOrigin, isPreviewHost } from "@/lib/http/host";
import { localizedPath } from "@/lib/i18n/localePath";
import { SITE_DEFAULT_DESCRIPTION } from "@/lib/seo/meta";
import { feedCacheControl, LLMS_TXT_CACHE_CONTROL_FULL } from "@/lib/seo/feedCache";
import {
  buildLlmsTxt,
  llmsTxtTaxonomy,
  resolvePrimarySectionHref,
  type LlmsTxtArticle,
} from "@/lib/seo/llms";
import { llmsTxtResourceLines, type MachineSurfaceFilter } from "@/lib/seo/machineSurfaces";
import { primarySiteSections } from "@/lib/seo/primaryNavigation";
import {
  parseSeoSettings,
  robotsUsagePolicy,
  siteDescriptionOverride,
  type SeoSettings,
} from "@/lib/seo/settings";
import {
  fetchLiveCoverageEntries,
  fetchPublicCategories,
  fetchPublishedPodcasts,
  fetchPublishedPosts,
  fetchSeoSettingsValue,
  fetchTrackerFeedSources,
  type PublishedCategoryRow,
  type PublishedPodcastRow,
  type PublishedPostRow,
} from "@/lib/server/publishedContent.server";
import {
  newsSitemapAnnouncement,
  type NewsSitemapAnnouncement,
} from "@/lib/server/robotsRequest.server";
import { crawlerDegradeIsSafe, resolveCrawlerTenantIdForHost } from "@/lib/server/tenant.server";

// Adres publikowany w llms.txt liczy WSPÓLNA reguła crawlerowa
// (`crawlerPublishOrigin`) - ten sam origin, który emituje mapa strony i
// ogłasza robots.txt. Wcześniej origin brał się wprost z hosta żądania, więc na
// podglądzie (gdzie zwalidowany host to `localhost`) asystenci AI dostawali
// listę artykułów pod adresami `https://localhost/...`.
async function requestContext(): Promise<{ origin: string; host: string }> {
  const req = getRequest();
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = (await trustedPublicHost(req)) ?? "";
  return { origin: crawlerPublishOrigin(host, proto), host };
}

const LATEST_COUNT = 15;

/**
 * Czy statyczny przewodnik zdegradowany jest na tym hoście JEDNOZNACZNY.
 *
 * `crawlerDegradeIsSafe` przy pustym/nieosiągalnym katalogu domen zwraca true
 * dla KAŻDEGO hosta (nie ma czego wyciekać). Dla mapy i kanałów to wystarcza,
 * bo ich szkielet nie mówi nic o tożsamości serwisu. Przewodnik mówi: nazywa
 * serwis i wskazuje źródło do cytowania. Na domenie innego tenanta (np.
 * `tenant2.example` w czasie timeoutu katalogu) przypisałby jej treść marce
 * domyślnej, a robots.txt tego samego hosta w tym samym stanie daje klasę
 * `unknown`, czyli `Disallow: /` - dwie sprzeczne polityki dla jednego
 * crawlera. Dlatego przewodnik zdegradowany dostają tylko host marki (jego
 * tożsamość jest znana bez bazy) i host podglądu/lokalny (publikuje na
 * originie kanonicznym, nigdy nie jest indeksowany). Reszta: 404, tak samo jak
 * fail-closed.
 */
function degradedGuideIsUnambiguous(host: string): boolean {
  return isPreviewHost(host) || classifyCrawlHost({ host }) === "brand";
}

/** Wariant kanału: `<ścieżka>|<język>` - klucz zbioru pustych kanałów. */
function feedVariant(path: string, lang: "pl" | "en" | null): string {
  return `${path}|${lang ?? ""}`;
}

/**
 * Sekcja główna sieci podcastów. Przegląd 2026-10: bez ani jednego
 * opublikowanego odcinka strona renderuje „Brak opublikowanych odcinków.",
 * a przewodnik dalej kierował tam modele jako na „najważniejszą sekcję" -
 * ta sama klasa co puste archiwum `/category/wywiady`. Programy bez odcinków
 * nie ratują strony: każda karta prowadzi do „0 odcinków".
 */
const PODCASTS_INDEX_HREF = "/podcasts";

/**
 * Warianty kanałów tematycznych, które w tej chwili nie mają ANI JEDNEJ pozycji.
 *
 * 2026-10 audyt: przewodnik ogłaszał modelom kanał podcastu, trackera
 * i relacji na żywo także wtedy, gdy redakcja nie ma ani odcinka, ani
 * dossier, ani wpisu relacji - poprawny, ale pusty dokument, czyli adres
 * bez wartości dla asystenta. Pustość liczymy TYMI SAMYMI odczytami i z TYMI
 * SAMYMI argumentami co trasy kanałów (wspólny klucz `edgeTtlCache`), więc
 * przewodnik nie dokłada zapytań ponad ruch samych kanałów:
 *   * podcast - odcinki z `audio_url` (bez audio odcinek nie jest pozycją);
 *   * tracker - opublikowane dossier (każde jest pozycją kanału);
 *   * relacje - wpisy w danym języku (kanał EN to wpisy `lang = 'en'`).
 * Kanał główny (/rss.xml) zostaje zawsze: jego pustka to ślad awarii odczytu
 * wpisów, a ta i tak daje przewodnikowi TTL zdegradowany.
 *
 * Odcinki przychodzą jako obietnica wspólna z decyzją o sekcji głównej
 * `/podcasts` - jeden odczyt na dwie decyzje.
 */
async function emptyFeedVariants(
  tenantId: string,
  settings: SeoSettings,
  podcastsRead: Promise<PublishedPodcastRow[]>,
): Promise<Set<string>> {
  const [podcasts, tracker, live] = await Promise.all([
    podcastsRead,
    fetchTrackerFeedSources(tenantId, settings.rss_item_count),
    fetchLiveCoverageEntries(tenantId, settings.rss_item_count * 2),
  ]);
  const empty = new Set<string>();
  const mark = (path: string, hasItems: (lang: "pl" | "en") => boolean) => {
    for (const lang of ["pl", "en"] as const) {
      if (!hasItems(lang)) empty.add(feedVariant(path, lang));
    }
  };
  mark("/podcast/rss.xml", () => podcasts.some((episode) => !!episode.audio_url));
  mark("/tracker/rss.xml", () => tracker.items.length > 0);
  mark("/live/rss.xml", (lang) =>
    live.some((entry) => (lang === "en" ? entry.lang === "en" : entry.lang !== "en")),
  );
  return empty;
}

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: async () => {
        const { origin, host } = await requestContext();
        // Service-role reads below bypass RLS - scope them to the host's
        // tenant. FAIL-CLOSED: a host no tenant has claimed (and that is not
        // a preview host) gets a 404 instead of the default tenant's guide on
        // a foreign domain.
        // DEGRADACJA ≠ fail-closed (ujednolicone 2026-10 z /rss.xml,
        // /news-sitemap.xml i mapą strony): pusty/nieosiągalny katalog domen
        // albo host podglądowy/lokalny dostaje STATYCZNY przewodnik - tożsamość
        // serwisu, opis domyślny, zasoby maszynowe i odesłanie do polityki
        // robots.txt, bez sekcji i artykułów, bo bez tenanta nie ma czego
        // czytać (ani czego wyciekać). Wcześniej ta trasa jako JEDYNA powierzchnia adresowana
        // samym hostem nie miała tego członu i oddawała tam 404 - choć
        // robots.txt wskazuje `/llms.txt` jako warunki wykorzystania treści.
        // Degradacja jest jednak WĘŻSZA niż w kanałach: tylko host marki
        // i host podglądu (`degradedGuideIsUnambiguous`), a przewodnik nie
        // udziela zgody na wykorzystanie treści (`usage: null` niżej).
        const tenantId = await resolveCrawlerTenantIdForHost(host);
        if (
          !tenantId &&
          !(degradedGuideIsUnambiguous(host) && (await crawlerDegradeIsSafe(host)))
        ) {
          return new Response("Unknown host", { status: 404 });
        }
        const settings = parseSeoSettings(tenantId ? await fetchSeoSettingsValue(tenantId) : null);
        if (!settings.llms_txt_enabled) {
          return new Response("llms.txt disabled", { status: 404 });
        }

        // Wszystkie odczyty RÓWNOLEGLE, każdy z własną degradacją (`resilient`
        // w czytnikach, budżet i `failed` w decyzji o news-sitemapie), więc
        // przewodnik czeka najwyżej na najwolniejszy z nich.
        const podcastsRead: Promise<PublishedPodcastRow[]> = tenantId
          ? fetchPublishedPodcasts(tenantId)
          : Promise.resolve([]);
        const [posts, categories, news, podcasts, emptyFeeds]: [
          PublishedPostRow[],
          PublishedCategoryRow[],
          NewsSitemapAnnouncement,
          PublishedPodcastRow[],
          Set<string> | null,
        ] = tenantId
          ? await Promise.all([
              fetchPublishedPosts(tenantId, LATEST_COUNT * 2),
              fetchPublicCategories(tenantId),
              newsSitemapAnnouncement(tenantId, origin, settings),
              podcastsRead,
              // Przy `rss_enabled: false` kanały i tak wypadają (404) - bez odczytów.
              settings.rss_enabled ? emptyFeedVariants(tenantId, settings, podcastsRead) : null,
            ])
          : // Bez tenanta news-sitemapa odpowiada 404 („No news articles"), więc
            // jej nie ogłaszamy; kanały RSS oddają wtedy poprawny pusty
            // dokument i zostają w statycznym przewodniku jak dotąd.
            [[], [], { announced: false, failed: false }, [], null];

        const toArticle = (lang: "pl" | "en") =>
          posts
            .filter((p) => (lang === "en" ? p.title_en : p.title_pl))
            .slice(0, LATEST_COUNT)
            .map((p): LlmsTxtArticle => ({
              title: lang === "en" ? p.title_en : p.title_pl,
              url: `${origin}${localizedPath(p.path, lang)}`,
              // Surowa zajawka - builder czyści ją tym samym `plainText` co RSS
              // (encje, znacznik „[…]" z WordPressa), dokładnie raz.
              description: lang === "en" ? p.excerpt_en : p.excerpt_pl,
              publishedAt: p.published_at,
            }));

        // Zasoby maszynowe ogłaszane WYŁĄCZNIE wtedy, gdy trasa odpowie 200
        // z treścią: news-sitemapa - ta sama decyzja co robots.txt i indeks
        // sitemapy; kanały RSS - nie przy wyłączonym `rss_enabled` (każdy
        // kanał to wtedy 404) i nie wtedy, gdy kanał tematyczny jest pusty.
        const announce: MachineSurfaceFilter = (surface, lang) => {
          if (surface.setting === "news_sitemap_enabled") return news.announced;
          if (surface.setting === "rss_enabled" && !settings.rss_enabled) return false;
          return !emptyFeeds?.has(feedVariant(surface.path, lang));
        };
        const taxonomy = llmsTxtTaxonomy(origin, categories);
        // Awaria odczytu odcinków (`resilient` -> `[]`) też zdejmuje sekcję -
        // pominięcie, a nie odesłanie modelu na pustą stronę.
        const emptyTargets = new Set(podcasts.length === 0 ? [PODCASTS_INDEX_HREF] : []);

        const latestPl = toArticle("pl");
        const latestEn = toArticle("en");
        // Warunki wykorzystania z TEGO SAMEGO obiektu, z którego robots.txt
        // składa blok warunków i `Content-Signal` (`robotsUsagePolicy`):
        // nazwa źródła (`site_name` z ustawień SEO, ta sama co `og:site_name`
        // i `WebSite.name`) oraz zgody `ai-input` / `ai-train`. Wcześniej trasa
        // sprawdzała tylko `llms_txt_enabled`, a builder deklarował zgodę
        // bezwarunkowo - przy wyłączonych crawlerach AI llms.txt udzielał zgody,
        // której robots.txt tego samego hosta odmawiał.
        const usage = robotsUsagePolicy(settings);
        const body = buildLlmsTxt({
          siteName: usage.siteName,
          origin,
          descriptionPl: siteDescriptionOverride(settings, "pl") || SITE_DEFAULT_DESCRIPTION.pl,
          descriptionEn: siteDescriptionOverride(settings, "en") || SITE_DEFAULT_DESCRIPTION.en,
          // Kolejność sekcji głównych - wspólna z JSON-LD strony głównej.
          // Adresy są adresami MARKI (FOOTER_LINKS), więc blok wychodzi tylko
          // na hoście marki z rozpoznanym tenantem: domena innego tenanta nie
          // może ogłaszać cudzych sekcji, a przewodnik zdegradowany (bez
          // tenanta) jest z założenia „bez sekcji i artykułów". Lista jest
          // statyczna, więc nie wchodzi do oceny degradacji niżej.
          // Sekcja główna prowadząca na PUSTE archiwum kategorii albo na sieć
          // podcastów bez odcinka wypada (na produkcji „Wywiady", „Policy
          // papers" i „Podcast" - patrz `resolvePrimarySectionHref`),
          // a duplikaty z listą kategorii usuwa builder.
          primarySections:
            tenantId && classifyCrawlHost({ host }) === "brand"
              ? primarySiteSections().flatMap((l) => {
                  const href = resolvePrimarySectionHref(l.href, categories, emptyTargets);
                  if (!href) return [];
                  return [
                    {
                      name:
                        l.label.pl === l.label.en ? l.label.pl : `${l.label.pl} / ${l.label.en}`,
                      url: `${origin}${href}`,
                    },
                  ];
                })
              : [],
          // Archiwa tylko z wpisami, organizacje pod `/organization/<slug>` -
          // ta sama reguła co sekcja `taxonomy` mapy strony.
          sections: taxonomy.sections,
          organizations: taxonomy.organizations,
          latestPl,
          latestEn,
          // Jedno źródło prawdy o powierzchniach maszynowych - dopisanie feedu
          // bez ogłoszenia go tutaj nie przechodzi testu kontraktu.
          resources: llmsTxtResourceLines(origin, localizedPath, announce),
          // Bez tenanta trasa nie zna ustawień redakcji (ani `llms_txt_enabled`,
          // ani polityki AI) - `settings` to wtedy wartości domyślne, a nie
          // decyzja redakcji. Awaria bazy nie jest zgodą: przewodnik
          // zdegradowany nie udziela żadnej i odsyła do robots.txt.
          usage: tenantId ? usage : null,
        });

        // Przewodnik BEZ artykułów albo BEZ sekcji jest odpowiedzią
        // zdegradowaną (brak tenanta, czytnik zdegradował do `[]` przez
        // `resilient`, redakcja bez treści) i dostaje TTL kanału pustego - bez
        // `stale-while-revalidate`, żeby brzeg nie podawał zapamiętanej pustki
        // przez pół godziny po powrocie bazy. Patrz `feedCache.ts`.
        // „Sekcje" liczymy po WIERSZACH czytnika, nie po wypisanych archiwach:
        // tenant, którego wszystkie archiwa są puste (produkcja 2026-10), ma
        // zdrowy odczyt i nie może dostać na stałe TTL awaryjnego. Tak samo
        // zdegradowany jest przewodnik, w którym decyzja o news-sitemapie nie
        // zapadła (odczyt padł albo przekroczył budżet) - brak tej pozycji
        // jest wtedy śladem awarii, nie stanem redakcji.
        const articleCount = latestPl.length + latestEn.length;
        return new Response(body, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": feedCacheControl(
              news.failed ? 0 : Math.min(articleCount, categories.length),
              LLMS_TXT_CACHE_CONTROL_FULL,
            ),
          },
        });
      },
    },
  },
});
