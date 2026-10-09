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
import { buildLlmsTxt, type LlmsTxtArticle } from "@/lib/seo/llms";
import { llmsTxtResourceLines } from "@/lib/seo/machineSurfaces";
import { primarySiteSections } from "@/lib/seo/primaryNavigation";
import { parseSeoSettings, robotsUsagePolicy, siteDescriptionOverride } from "@/lib/seo/settings";
import {
  fetchPublicCategories,
  fetchPublishedPosts,
  fetchSeoSettingsValue,
  type PublishedCategoryRow,
  type PublishedPostRow,
} from "@/lib/server/publishedContent.server";
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

        const [posts, categories]: [PublishedPostRow[], PublishedCategoryRow[]] = tenantId
          ? await Promise.all([
              fetchPublishedPosts(tenantId, LATEST_COUNT * 2),
              fetchPublicCategories(tenantId),
            ])
          : [[], []];

        const toArticle = (lang: "pl" | "en") =>
          posts
            .filter((p) => (lang === "en" ? p.title_en : p.title_pl))
            .slice(0, LATEST_COUNT)
            .map((p): LlmsTxtArticle => ({
              title: lang === "en" ? p.title_en : p.title_pl,
              url: `${origin}${localizedPath(p.path, lang)}`,
              description: lang === "en" ? p.excerpt_en : p.excerpt_pl,
              publishedAt: p.published_at,
            }));

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
          primarySections:
            tenantId && classifyCrawlHost({ host }) === "brand"
              ? primarySiteSections().map((l) => ({
                  name: l.label.pl === l.label.en ? l.label.pl : `${l.label.pl} / ${l.label.en}`,
                  url: `${origin}${l.href}`,
                }))
              : [],
          sections: categories.map((c) => ({
            name:
              c.name_pl && c.name_en && c.name_pl !== c.name_en
                ? `${c.name_pl} / ${c.name_en}`
                : c.name_pl || c.name_en,
            url: `${origin}/category/${c.slug}`,
            description: c.description_pl || c.description_en,
          })),
          latestPl,
          latestEn,
          // Jedno źródło prawdy o powierzchniach maszynowych - dopisanie feedu
          // bez ogłoszenia go tutaj nie przechodzi testu kontraktu.
          resources: llmsTxtResourceLines(origin, localizedPath),
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
        const articleCount = latestPl.length + latestEn.length;
        return new Response(body, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": feedCacheControl(
              Math.min(articleCount, categories.length),
              LLMS_TXT_CACHE_CONTROL_FULL,
            ),
          },
        });
      },
    },
  },
});
