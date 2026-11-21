// Organizm: ekosystem SEO + robots.txt - JEDEN komponent w dwóch zakładkach
// (/admin/settings/site-identity i /admin/settings/seo).
//
// SYNCHRONIZACJA. Obie zakładki edytują ten sam blob `seo` przez `useSettings`
// (wspólny klucz zapytania), a ten panel renderuje te same przełączniki
// i ten sam podgląd robots.txt z tego samego szkicu. Zapis w jednej zakładce
// aktualizuje pamięć podręczną zapytania, więc druga otwiera się już ze
// zmianą - nie ma dwóch reprezentacji polityki, które mogłyby się rozjechać.
//
// SAMOOBSŁUGA. Lista plików nie jest wpisana tutaj: liczy ją
// `seoEcosystemEntries` z rejestru powierzchni i bieżącego szkicu. Włączenie
// przełącznika dodaje pliki do listy, robots.txt i llms.txt; wyłączenie
// wycofuje je ze wszystkich trzech naraz - jeszcze przed zapisem w podglądzie.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/admin/settings/fields";
import { RobotsTxtPreview } from "@/components/admin/seo/RobotsTxtPreview";
import { ensureI18n } from "@/lib/i18n-admin-site-identity";
import {
  ECOSYSTEM_TOGGLES,
  seoEcosystemEntries,
  type EcosystemEntry,
  type EcosystemToggle,
} from "@/lib/seo/seoEcosystem";
import type { SeoSettings } from "@/lib/seo/settings";

/** Klucze tłumaczeń znanych powierzchni; nowe pokazują etykietę z rejestru. */
const SURFACE_KEYS: Readonly<Record<string, string>> = {
  "/sitemap.xml": "sitemap",
  "/sitemap-index.xml": "sitemapIndex",
  "/sitemap": "htmlSitemap",
  "/news-sitemap.xml": "newsSitemap",
  "/rss.xml": "rss",
  "/podcast/rss.xml": "podcastRss",
  "/tracker/rss.xml": "trackerRss",
  "/live/rss.xml": "liveRss",
  "/llms.txt": "llms",
  "/robots.txt": "robots",
};

type SeoSettingsPatch = Partial<
  Pick<SeoSettings, EcosystemToggle | "ai_search_crawlers_allowed" | "ai_training_crawlers_allowed">
>;

export interface SeoEcosystemPanelProps {
  settings: SeoSettings;
  onChange: (patch: SeoSettingsPatch) => void;
  /** Zakładka, w której panel jest osadzony - link prowadzi do drugiej. */
  host: "site-identity" | "seo";
}

function LangBadge({ lang }: { lang: "pl" | "en" | null }) {
  if (!lang) return null;
  return (
    <span className="ml-1.5 inline-flex items-center rounded border border-border px-1 text-[10px] font-medium uppercase leading-4 text-muted-foreground">
      {lang}
    </span>
  );
}

export function SeoEcosystemPanel({ settings, onChange, host }: SeoEcosystemPanelProps) {
  ensureI18n();
  const { t } = useTranslation();
  const { active, disabled } = seoEcosystemEntries(settings);

  const label = (entry: EcosystemEntry): string => {
    const key = SURFACE_KEYS[entry.path];
    return key ? t(`adminSiteIdentity.surfaces.${key}.label`) : entry.registryLabel;
  };
  const hint = (entry: EcosystemEntry): string => {
    const key = SURFACE_KEYS[entry.path];
    return key ? t(`adminSiteIdentity.surfaces.${key}.hint`) : "";
  };
  const disabledNames = Array.from(
    new Set(
      disabled.map(
        (entry) => `${label(entry)}${entry.lang ? ` (${entry.lang.toUpperCase()})` : ""}`,
      ),
    ),
  );

  return (
    <section data-testid="SeoEcosystemPanel" className="mt-8">
      <h3 className="text-sm font-semibold mb-1">{t("adminSiteIdentity.sectionEcosystem")}</h3>
      <p className="text-xs text-muted-foreground mb-3">{t("adminSiteIdentity.ecosystemIntro")}</p>

      <div className="mb-3 flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-border bg-card px-3 py-2.5">
        {ECOSYSTEM_TOGGLES.map((toggle) => (
          <Checkbox
            key={toggle}
            label={t(`adminSiteIdentity.toggles.${toggle}`)}
            checked={settings[toggle]}
            onChange={(v) => onChange({ [toggle]: v })}
          />
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <tbody>
            {active.map((entry) => (
              <tr key={entry.id} className="border-b border-border last:border-0">
                <td className="w-1/3 px-3 py-2 font-medium align-top">
                  {label(entry)}
                  <LangBadge lang={entry.lang} />
                </td>
                <td className="px-3 py-2 text-muted-foreground align-top">
                  {hint(entry)}
                  {entry.inRobots && (
                    <span className="ml-2 inline-flex items-center rounded border border-brand/40 px-1 text-[10px] font-medium leading-4 text-brand">
                      {t("adminSiteIdentity.inRobots")}
                    </span>
                  )}
                </td>
                <td className="w-24 px-3 py-2 text-right align-top">
                  <a
                    href={entry.href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand hover:underline"
                  >
                    {t("adminSiteIdentity.open")}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {disabledNames.length > 0 && (
        <p data-testid="SeoEcosystemDisabled" className="mt-2 text-[11px] text-muted-foreground">
          {t("adminSiteIdentity.disabledSummary", { names: disabledNames.join(", ") })}
        </p>
      )}

      <h4 className="text-sm font-semibold mt-6 mb-1">robots.txt</h4>
      <p className="text-xs text-muted-foreground mb-2">{t("adminSiteIdentity.robotsSync")}</p>
      <div className="mb-3 flex flex-col items-start gap-2">
        <Checkbox
          label={t("admin.seoSettings.aiSearchAllowed")}
          checked={settings.ai_search_crawlers_allowed}
          onChange={(v) => onChange({ ai_search_crawlers_allowed: v })}
        />
        <Checkbox
          label={t("admin.seoSettings.aiTrainingAllowed")}
          checked={settings.ai_training_crawlers_allowed}
          onChange={(v) => onChange({ ai_training_crawlers_allowed: v })}
        />
        <p className="text-[11px] text-muted-foreground">{t("admin.seoSettings.aiCrawlersHint")}</p>
      </div>
      <RobotsTxtPreview settings={settings} />

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {host === "site-identity" ? (
          <Link to="/admin/settings/seo" className="text-brand hover:underline">
            {t("adminSiteIdentity.moreSettings")}
          </Link>
        ) : (
          <Link to="/admin/settings/site-identity" className="text-brand hover:underline">
            {t("adminSiteIdentity.identityLink")}
          </Link>
        )}
        <Link to="/admin/settings/social-preview" className="text-brand hover:underline">
          {t("adminSiteIdentity.socialSettings")}
        </Link>
      </div>
    </section>
  );
}
