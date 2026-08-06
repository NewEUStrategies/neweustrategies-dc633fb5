// Molekuła: podgląd DOKŁADNEJ treści /robots.txt dla bieżących ustawień SEO.
//
// Skład pliku robi ten sam builder, którego używa trasa (`buildRobotsTxt` +
// `aiCrawlerDirectives`), więc panel nie ma własnej reprezentacji polityki,
// która mogłaby się rozjechać z tym, co dostaje crawler.
//
// PO CO TO JEST (audyt 2026-08-06): /robots.txt był na produkcji przesłonięty
// statycznym plikiem z `public/` i nikt tego nie zauważył przez miesiące -
// między innymi dlatego, że nigdzie w panelu nie było widać, co ta powierzchnia
// publikuje. Podgląd obok przełączników plus link do żywego pliku zamyka pętlę:
// różnica między podglądem a rzeczywistą odpowiedzią jest widoczna w dwóch
// kliknięciach, bez narzędzi deweloperskich.
import { useTranslation } from "react-i18next";
import {
  CANONICAL_SITE_ORIGIN,
  crawlerPublishOrigin,
  isEditorOrLocalHost,
  normalizeHost,
} from "@/lib/http/host";
import { buildRobotsTxt } from "@/lib/seo/robots";
import { aiCrawlerDirectives, type SeoSettings } from "@/lib/seo/settings";

/**
 * Origin, dla którego pokazujemy politykę. Host edytora/lokalny nie jest
 * adresem publikacji, więc dla niego pokazujemy origin marki - inaczej redakcja
 * widziałaby `Sitemap: http://localhost/...` i uznała to za błąd konfiguracji.
 * Dla domeny własnej tenanta obowiązuje ta sama reguła co na produkcji.
 */
function publishOriginForPreview(host: string | null): string {
  if (!host || isEditorOrLocalHost(host)) return CANONICAL_SITE_ORIGIN;
  return crawlerPublishOrigin(host) || CANONICAL_SITE_ORIGIN;
}

export function RobotsTxtPreview({ settings }: { settings: SeoSettings }) {
  const { t } = useTranslation();
  const host = typeof window === "undefined" ? null : normalizeHost(window.location.host);
  const previewHost = host === null || isEditorOrLocalHost(host);

  const body = buildRobotsTxt({
    // Podgląd zawsze pokazuje politykę hosta KANONICZNEGO - to jedyna, którą
    // redakcja może kształtować z tego ekranu. Aliasy i podglądy dostają pełny
    // zakaz niezależnie od ustawień (wyjaśnia to podpowiedź poniżej).
    mode: "canonical",
    origin: publishOriginForPreview(host),
    // Indeks jest zawsze; news sitemap tylko gdy trasa faktycznie odpowie 200.
    sitemapPaths: settings.news_sitemap_enabled
      ? ["/sitemap.xml", "/news-sitemap.xml"]
      : ["/sitemap.xml"],
    agentGroups: aiCrawlerDirectives(settings),
  });

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
          {t("admin.seoSettings.robotsOpenLive", { defaultValue: "Otwórz /robots.txt" })}
        </a>
        <span>
          {t("admin.seoSettings.robotsAliasHint", {
            defaultValue:
              "Aliasy hostingu, domeny historyczne i podglądy dostają pełny zakaz (Disallow: /).",
          })}
        </span>
        {previewHost && (
          <span>
            {t("admin.seoSettings.robotsPreviewHostHint", {
              defaultValue:
                "Panel działa na hoście podglądu - powyżej jest polityka domeny publikacji.",
            })}
          </span>
        )}
      </div>
    </div>
  );
}
