// RSS trackera legislacyjnego UE: /tracker/rss.xml (+ /en/tracker/rss.xml).
//
// Brakujący kanał. Serwis miał feedy treści (globalny, kategorii, tagów,
// programów) i podcastu, ale tracker - powierzchnia z najkrótszym cyklem życia
// informacji i najbardziej "subskrybowalna" (analityk chce wiedzieć, że dossier
// ruszyło o etap dalej) - nie miał żadnego. Ten sam kontrakt co /rss.xml:
// fail-closed na tenancie, respektowanie rss_enabled, język z prefiksu URL.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { trustedPublicHost } from "@/lib/http/requestHost";
import { DEFAULT_LANG, localizedPath, stripLangPrefix, type AppLang } from "@/lib/i18n/localePath";
import { SITE_NAME } from "@/lib/seo/meta";
import { buildRssXml, type RssItem } from "@/lib/seo/rss";
import { parseSeoSettings } from "@/lib/seo/settings";
import {
  fetchPublishedTrackerItems,
  fetchSeoSettingsValue,
} from "@/lib/server/publishedContent.server";
import { resolveCrawlerTenantIdForHost } from "@/lib/server/tenant.server";

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

export const Route = createFileRoute("/tracker/rss.xml")({
  server: {
    handlers: {
      GET: async () => {
        const { origin, host, lang } = await requestContext();
        // Service role omija RLS, więc odczyt MUSI być zescope'owany do tenanta
        // właściciela hosta; nieznany host = 404 (fail-closed, jak /rss.xml).
        const tenantId = await resolveCrawlerTenantIdForHost(host);
        if (!tenantId) return new Response("Unknown host", { status: 404 });

        const settings = parseSeoSettings(await fetchSeoSettingsValue(tenantId));
        if (!settings.rss_enabled) return new Response("Feed disabled", { status: 404 });

        const dossiers = await fetchPublishedTrackerItems(tenantId, settings.rss_item_count);
        const items: RssItem[] = dossiers.map((item) => ({
          url: `${origin}${localizedPath(`/tracker/${item.slug}`, lang)}`,
          title:
            (lang === "en" ? item.title_en || item.title_pl : item.title_pl || item.title_en) ||
            item.slug,
          description:
            lang === "en" ? item.summary_en || item.summary_pl : item.summary_pl || item.summary_en,
          // `updated_at` jest datą publikacji ELEMENTU FEEDU, nie dossier: ruch
          // sprawy jest tu nowiną, więc czytnik ma pokazać dossier ponownie na
          // górze, gdy zmienił się etap.
          publishedAt: item.updated_at ?? item.created_at,
          // Obszar polityki i etap jako kategorie - agregatory branżowe filtrują
          // po nich bez parsowania treści.
          categories: [item.policy_area, item.stage].filter(Boolean),
        }));

        const xml = buildRssXml({
          title:
            lang === "en"
              ? `EU policy tracker - ${SITE_NAME}`
              : `Tracker legislacyjny UE - ${SITE_NAME}`,
          description:
            lang === "en"
              ? "Tracked EU legislative files: stage changes, next milestones and rapporteurs."
              : "Śledzone akty legislacyjne UE: zmiany etapów, kolejne kamienie milowe i sprawozdawcy.",
          siteUrl: `${origin}${localizedPath("/tracker", lang)}`,
          feedUrl: `${origin}${localizedPath("/tracker/rss.xml", lang)}`,
          language: lang,
          copyright: `© ${new Date().getFullYear()} ${SITE_NAME}`,
          items,
        });

        return new Response(xml, {
          headers: {
            "Content-Type": "application/rss+xml; charset=utf-8",
            "Cache-Control": "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400",
          },
        });
      },
    },
  },
});
