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
import { SITE_DEFAULT_DESCRIPTION, SITE_NAME } from "@/lib/seo/meta";
import { feedCacheControl, LLMS_TXT_CACHE_CONTROL_FULL } from "@/lib/seo/feedCache";
import { buildLlmsTxt, type LlmsTxtArticle } from "@/lib/seo/llms";
import { llmsTxtResourceLines } from "@/lib/seo/machineSurfaces";
import { parseSeoSettings, siteDescriptionOverride, siteNameOverride } from "@/lib/seo/settings";
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

/** Nagłówek bloku warunków - stała z `buildLlmsTxt` (`lib/seo/llms.ts`). */
const USAGE_TERMS_HEADING = "## Warunki wykorzystania i cytowania / Usage and citation terms";

/**
 * Przewodnik zdegradowany NIE udziela zgody na wykorzystanie treści.
 *
 * Bez tenanta trasa nie zna ustawień redakcji - ani `llms_txt_enabled`, ani
 * polityki AI. Blok warunków z `buildLlmsTxt` deklaruje zgodę („DOZWOLONE /
 * PERMITTED"), więc na zdegradowanej odpowiedzi byłby zgodą, której redakcja
 * mogła nie wydać (np. wyłączyła llms.txt, a timeout bazy podał przewodnik
 * zamiast 404). Awaria bazy nie jest zgodą: blok zostaje zastąpiony odesłaniem
 * do robots.txt, który jest wiążącą polityką maszynową serwisu.
 */
function withoutUsageGrant(body: string, origin: string): string {
  const at = body.indexOf(`\n${USAGE_TERMS_HEADING}`);
  const head = at === -1 ? body : body.slice(0, at);
  const policy = `${origin.replace(/\/+$/, "")}/robots.txt`;
  return [
    head.trimEnd(),
    "",
    USAGE_TERMS_HEADING,
    "",
    `- Ten dokument nie udziela zgody na wykorzystanie treści - warunki serwisu są chwilowo niedostępne. Wiążąca polityka maszynowa: ${policy} (Content-Signal).`,
    `- This document grants no permission to reuse content - the site's terms are temporarily unavailable. Binding machine-readable policy: ${policy} (Content-Signal).`,
    "",
  ].join("\n");
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
        // udziela zgody na wykorzystanie treści (`withoutUsageGrant`).
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
        const guide = buildLlmsTxt({
          // Nazwa serwisu z tego samego źródła, co `og:site_name`,
          // `WebSite.name` i blok warunków robots.txt (`site_name` z ustawień
          // SEO, już pobranych wyżej - bez dodatkowego odczytu). Stała marki
          // kazała asystentom AI cytować inną nazwę niż ta, którą redakcja
          // ustawiła w /admin/seo/homepage, a warunek cytowania niżej w
          // przewodniku nazywa źródło właśnie tym polem.
          siteName: siteNameOverride(settings) || SITE_NAME,
          origin,
          descriptionPl: siteDescriptionOverride(settings, "pl") || SITE_DEFAULT_DESCRIPTION.pl,
          descriptionEn: siteDescriptionOverride(settings, "en") || SITE_DEFAULT_DESCRIPTION.en,
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
        });
        const body = tenantId ? guide : withoutUsageGrant(guide, origin);

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
