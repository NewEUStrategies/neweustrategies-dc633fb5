// RSS relacji na żywo: /live/rss.xml (+ /en/live/rss.xml).
//
// Drugi brakujący kanał. /live było wyłącznie stroną HTML, więc jedyną formą
// "subskrypcji" trwającej relacji było odświeżanie przeglądarki - a relacja live
// jest z natury kanałem push.
//
// Elementem feedu jest WPIS relacji, nie post: aktualizacją jest pojedynczy
// wpis, więc czytnik pokazuje kolejne wpisy jak kolejne wiadomości, a link
// prowadzi do posta z zakotwiczeniem. Nazwa pliku ma sufiks `_` (`live_.rss`),
// żeby trasa NIE zagnieżdżała się pod komponentem strony /live.
//
// Kontrakt jak w /rss.xml: fail-closed na tenancie, respektowanie rss_enabled,
// język z prefiksu URL - a dodatkowo filtr języka wpisu, bo wpisy relacji są
// jednojęzyczne (kolumna live_blog_entries.lang).
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { trustedPublicHost } from "@/lib/http/requestHost";
import { DEFAULT_LANG, localizedPath, stripLangPrefix, type AppLang } from "@/lib/i18n/localePath";
import { SITE_NAME } from "@/lib/seo/meta";
import { buildRssXml, plainText, type RssItem } from "@/lib/seo/rss";
import { LIVE_FEED_CACHE_CONTROL_FULL, rssResponseHeaders } from "@/lib/seo/feedCache";
import { parseSeoSettings } from "@/lib/seo/settings";
import {
  fetchLiveCoverageEntries,
  fetchSeoSettingsValue,
} from "@/lib/server/publishedContent.server";
import { crawlerDegradeIsSafe, resolveCrawlerTenantIdForHost } from "@/lib/server/tenant.server";

async function requestContext(): Promise<{ origin: string; host: string; lang: AppLang }> {
  const req = getRequest();
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = (await trustedPublicHost(req)) ?? "";
  const origin = host ? `${proto}://${host}` : "";
  let lang: AppLang = DEFAULT_LANG;
  try {
    lang = stripLangPrefix(new URL(req.url).pathname).lang ?? DEFAULT_LANG;
  } catch {
    /* keep default */
  }
  return { origin, host, lang };
}

export const Route = createFileRoute("/live_/rss.xml")({
  server: {
    handlers: {
      GET: async () => {
        const { origin, host, lang } = await requestContext();
        // POPRAWKA 2026-08-03: ten sam brak, co w /tracker/rss.xml - predykat
        // miał tylko człon fail-closed, bez członu degradacji. `/rss.xml`
        // rozdziela oba (patrz `crawlerDegradeIsSafe`: „utrzymywane razem (...),
        // żeby predykat bezpieczeństwa był jeden"), więc na hoście podglądu i przy
        // pustym katalogu domen zwracał 200 z pustym feedem, a ten kanał 404.
        // Fail-closed dla realnych obcych domen zostaje nietknięty.
        const tenantId = await resolveCrawlerTenantIdForHost(host);
        if (!tenantId && !(await crawlerDegradeIsSafe(host))) {
          return new Response("Unknown host", { status: 404 });
        }

        const settings = parseSeoSettings(tenantId ? await fetchSeoSettingsValue(tenantId) : null);
        if (!settings.rss_enabled) return new Response("Feed disabled", { status: 404 });

        // Zapas nad limitem: część wpisów odpadnie na filtrze języka.
        const entries = tenantId
          ? await fetchLiveCoverageEntries(tenantId, settings.rss_item_count * 2)
          : [];
        const items: RssItem[] = entries
          .filter((entry) => (entry.lang === "en" ? lang === "en" : lang !== "en"))
          .slice(0, settings.rss_item_count)
          .map((entry) => {
            const postTitle =
              (lang === "en" ? entry.postTitleEn || entry.postTitlePl : entry.postTitlePl) || "";
            // Wpis bez własnego tytułu (najczęstszy przypadek - redakcja wrzuca
            // sam tekst) dostaje tytuł posta + pierwsze słowa treści, żeby lista
            // w czytniku nie była ścianą identycznych nagłówków.
            const fallback = plainText(entry.bodyHtml, 80);
            const title =
              entry.title?.trim() || (fallback ? `${postTitle}: ${fallback}` : postTitle);
            return {
              // Zakotwiczenie na wpisie - kliknięcie w czytniku prowadzi do
              // konkretnej aktualizacji, nie na początek długiej relacji.
              url: `${origin}${localizedPath(entry.postPath, lang)}#live-${entry.id}`,
              title,
              description: entry.bodyHtml,
              publishedAt: entry.occurredAt,
              categories: [postTitle].filter(Boolean),
            };
          });

        const xml = buildRssXml({
          title: lang === "en" ? `Live coverage - ${SITE_NAME}` : `Relacje na żywo - ${SITE_NAME}`,
          description:
            lang === "en"
              ? "Live updates from ongoing coverage of key European events."
              : "Aktualizacje na żywo z trwających relacji z kluczowych wydarzeń europejskich.",
          siteUrl: `${origin}${localizedPath("/live", lang)}`,
          feedUrl: `${origin}${localizedPath("/live/rss.xml", lang)}`,
          language: lang,
          copyright: `© ${new Date().getFullYear()} ${SITE_NAME}`,
          items,
        });

        // Relacja live starzeje się w minutach, nie w godzinach - krótszy cache
        // niż pozostałe feedy (`LIVE_FEED_CACHE_CONTROL_FULL`), inaczej czytnik
        // dostaje wpisy z półgodzinnym opóźnieniem. Kanał PUSTY (degradacja
        // albo relacja jeszcze bez wpisów w tym języku) dostaje TTL jeszcze
        // krótszy i bez `stale-while-revalidate` - patrz `feedCache.ts`.
        return new Response(xml, {
          headers: rssResponseHeaders(items.length, LIVE_FEED_CACHE_CONTROL_FULL),
        });
      },
    },
  },
});
