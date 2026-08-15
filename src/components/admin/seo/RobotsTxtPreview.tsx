// Molekuła: podgląd DOKŁADNEJ treści /robots.txt dla bieżących ustawień SEO.
//
// Skład pliku robi ten sam builder, którego używa trasa (`buildRobotsTxt` +
// `aiCrawlerGroups`), więc panel nie ma własnej reprezentacji polityki, która
// mogłaby się rozjechać z tym, co dostaje crawler.
//
// PRZYCZYNA (audyt 2026-08-06): /robots.txt był na produkcji przesłonięty
// statycznym plikiem z `public/` i nikt tego nie zauważył przez miesiące - bo
// nigdzie w panelu nie było widać, co ta powierzchnia w ogóle publikuje.
// Podgląd obok przełączników plus link do żywego pliku zamyka tę pętlę: różnica
// między podglądem a plikiem jest teraz widoczna w dwóch kliknięciach.
import { useTranslation } from "react-i18next";
import {
  CANONICAL_SITE_ORIGIN,
  classifyCrawlHost,
  crawlHostIsIndexable,
  crawlHostOrigin,
  normalizeHost,
  type CrawlHostClass,
} from "@/lib/http/host";
import { buildRobotsTxt } from "@/lib/seo/robots";
import { aiCrawlerGroups, type SeoSettings } from "@/lib/seo/settings";

/**
 * Origin, którym podgląd się posługuje. Host podglądu/edytora nie jest adresem
 * publikacji, więc dla niego pokazujemy politykę hosta marki - inaczej redakcja
 * widziałaby `Sitemap: http://localhost/...` i uznała to za błąd konfiguracji.
 */
function previewOrigin(host: string | null): { origin: string; hostClass: CrawlHostClass } {
  const hostClass = classifyCrawlHost({ host, tenantDomain: true });
  if (!crawlHostIsIndexable(hostClass)) return { origin: CANONICAL_SITE_ORIGIN, hostClass };
  return { origin: crawlHostOrigin(hostClass, host), hostClass };
}

export function RobotsTxtPreview({ settings }: { settings: SeoSettings }) {
  const { t } = useTranslation();
  const host = typeof window === "undefined" ? null : normalizeHost(window.location.host);
  const { origin, hostClass } = previewOrigin(host);

  const body = buildRobotsTxt({
    mode: "canonical",
    origin,
    // Indeks jest zawsze; news sitemap tylko gdy trasa faktycznie odpowiada.
    sitemapPaths: settings.news_sitemap_enabled
      ? ["/sitemap.xml", "/news-sitemap.xml"]
      : ["/sitemap.xml"],
    groups: aiCrawlerGroups(settings),
  });

  const nonCanonicalHost = !crawlHostIsIndexable(hostClass);

  return (
    <div className="space-y-2">
      <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] leading-relaxed font-mono whitespace-pre text-foreground">
        {body}
      </pre>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <a
          href="/robots.txt"
          target="_blank"
          rel="noreferrer"
          className="text-brand hover:underline"
        >
          {t("admin.seoSettings.robotsOpenLive")}
        </a>
        <span>{t("admin.seoSettings.robotsAliasHint")}</span>
        {nonCanonicalHost && <span>{t("admin.seoSettings.robotsPreviewHostHint")}</span>}
      </div>
    </div>
  );
}
