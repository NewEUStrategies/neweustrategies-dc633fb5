// KOKPIT SEO (/admin/seo) - odpowiedź na pytanie „co jest dziś nie tak i gdzie
// to kliknąć", a nie kolejna tabela.
//
// PO CO. Do 2026-09 wejście na /admin/seo otwierało listę 76 pozycji: każdy
// wpis i każda strona ze swoim wynikiem. To odpowiada na pytanie o STAN
// POJEDYNCZEJ treści i nie odpowiada na żadne inne - a redakcja przychodzi tu
// najczęściej z pytaniem o całość: czy marka wygląda poprawnie w wyszukiwarce.
// Tabela została (zakładka „Treści"), a to miejsce zajęło podsumowanie.
//
// KOLEJNOŚĆ SEKCJI JEST TEZĄ, nie układem bazy: najpierw MARKA, bo to strona
// główna rozstrzyga wynik na nazwę własną serwisu i to ona była źródłem
// defektu, od którego zaczęła się ta przebudowa (Google zdejmował nazwę marki
// z tytułu - patrz nagłówek `admin.seo.homepage.tsx`). Dopiero potem zaległości
// w treściach, a na końcu skróty do plików generowanych.
//
// EKRAN JEST TYLKO DO CZYTANIA. Nie ma tu ani jednej mutacji i tak ma zostać -
// pilnuje tego `adminRouteAuthority.gate.test.ts`. Każda liczba jest linkiem do
// ekranu, który ją naprawia.
//
// ŻADNEJ WŁASNEJ REGUŁY OCENY. Audyt marki liczy `@/lib/seo/brandAudit`, a stan
// treści `@/lib/seo/contentStatus` - te same moduły, których używają zakładki
// szczegółowe. Druga kopia reguły oznaczałaby kokpit i zakładkę mówiące
// o tej samej treści co innego.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRequiredTenant } from "@/hooks/useAuth";
import { useSettings } from "@/lib/admin/useSettings";
import { SeoScorePill } from "@/components/admin/seo/SeoScorePill";
import { BrandFindingList } from "@/components/admin/seo/BrandFindingList";
import { ExternalLink } from "@/lib/lucide-shim";
import { ensureI18n } from "@/lib/i18n-admin-seo-hub";
import {
  auditBrandSeo,
  brandAuditScore,
  countBySeverity,
  type BrandFinding,
} from "@/lib/seo/brandAudit";
import { SEO_FIELDS_SELECT } from "@/lib/seo/fields";
import {
  seoContentStatus,
  seoGrade,
  summarizeSeoStatuses,
  type SeoContentStatus,
  type SeoStatusInput,
} from "@/lib/seo/contentStatus";
import {
  DEFAULT_SEO_SETTINGS,
  SEO_SETTINGS_KEY,
  siteDescriptionOverride,
  siteTitleOverride,
  type SeoSettings,
} from "@/lib/seo/settings";
import {
  SITE_DEFAULT_DESCRIPTION,
  SITE_DEFAULT_OG_IMAGE,
  SITE_DEFAULT_TITLE,
  SITE_NAME,
  type Lang,
} from "@/lib/seo/meta";

export const Route = createFileRoute("/admin/seo/")({
  component: SeoDashboard,
  // Literał, nie `t()` - `head()` czytające słownik wciąga jego graf do chunku
  // wejściowego KAŻDEJ strony (scripts/check-entry-purity.ts).
  head: () => ({ meta: [{ title: "SEO - Kokpit" }] }),
});

/** Te same kolumny, co w zakładce „Treści" - jedno zapytanie, jedna prawda. */
const CONTENT_SELECT = `id, slug, status, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, ${SEO_FIELDS_SELECT}`;

/** Czy ta treść jest „gotowa": ma oba opisy i własną kartę. */
function isContentComplete(status: SeoContentStatus): boolean {
  return (
    status.description.pl !== "missing" &&
    status.description.en !== "missing" &&
    status.socialImage !== "default"
  );
}

interface Tile {
  key: string;
  label: string;
  value: number;
  tone: string;
}

function TileGrid({ tiles }: { tiles: readonly Tile[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.key} className="rounded-lg border border-border bg-card p-3">
          <div className={`text-2xl font-bold tabular-nums ${tile.tone}`}>{tile.value}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{tile.label}</div>
        </div>
      ))}
    </div>
  );
}

function SeoDashboard() {
  // Rejestracja słownika w chunku KOMPONENTU trasy (nie w entry) - patrz
  // komentarz przy ensureI18n w lib/i18n-admin-seo-hub.ts.
  ensureI18n();
  const { t } = useTranslation();
  const tenantId = useRequiredTenant();
  // Czytamy ustawienia, ale NIGDY nie wołamy `save` - patrz nagłówek pliku.
  const { query } = useSettings<SeoSettings>(SEO_SETTINGS_KEY, DEFAULT_SEO_SETTINGS);
  const settings = query.data;

  const { data: posts } = useQuery({
    queryKey: ["admin-seo-posts", tenantId],
    enabled: !!tenantId,
    queryFn: async (): Promise<SeoStatusInput[]> => {
      const { data, error } = await supabase
        .from("posts")
        .select(CONTENT_SELECT)
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: pages } = useQuery({
    queryKey: ["admin-seo-pages", tenantId],
    enabled: !!tenantId,
    queryFn: async (): Promise<SeoStatusInput[]> => {
      const { data, error } = await supabase
        .from("pages")
        .select(CONTENT_SELECT)
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const statuses = useMemo(
    () => [...(pages ?? []), ...(posts ?? [])].map((row) => seoContentStatus(row)),
    [posts, pages],
  );
  const contentSummary = useMemo(() => summarizeSeoStatuses(statuses), [statuses]);
  const contentDone = useMemo(() => statuses.filter(isContentComplete).length, [statuses]);

  /**
   * Audyt marki liczony dla OBU języków i scalony po identyfikatorze problemu.
   *
   * Scalenie jest istotne: brak karty społecznościowej albo brak profili
   * `sameAs` to JEDEN problem serwisu, nie dwa - te ustawienia są wspólne dla
   * wersji PL i EN. Bez scalenia licznik na kokpicie pokazywałby podwojoną
   * liczbę problemów i nie zgadzałby się z listą na zakładce strony głównej.
   * Rozjeżdżają się wyłącznie reguły o tytule i opisie, i te słusznie zostają
   * policzone osobno dla każdego języka.
   */
  const findings = useMemo<BrandFinding[]>(() => {
    if (!settings) return [];
    const forLang = (lang: Lang): BrandFinding[] =>
      auditBrandSeo({
        siteName: settings.site_name.trim() || SITE_NAME,
        title: siteTitleOverride(settings, lang) || SITE_DEFAULT_TITLE[lang],
        description: siteDescriptionOverride(settings, lang) || SITE_DEFAULT_DESCRIPTION[lang],
        ogImageUrl: settings.default_og_image_url.trim() || SITE_DEFAULT_OG_IMAGE,
        ogImageIsBuiltIn: !settings.default_og_image_url.trim(),
        ogImageAlt: settings.default_og_image_alt,
        sameAs: settings.organization_same_as,
        publisherLogoUrl: settings.publisher_logo_url,
        twitterSite: settings.twitter_site,
        noindex: false,
      });
    const merged = new Map<string, BrandFinding>();
    for (const finding of [...forLang("pl"), ...forLang("en")]) {
      if (!merged.has(finding.id)) merged.set(finding.id, finding);
    }
    return [...merged.values()];
  }, [settings]);

  if (!settings) return <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>;

  const severity = countBySeverity(findings);
  const score = brandAuditScore(findings);

  const shortcuts: Array<{ id: string; label: string; hint: string; href?: string; to?: string }> =
    [
      {
        id: "robots",
        label: t("adminSeoHub.shortcutRobots"),
        hint: t("adminSeoHub.shortcutRobotsHint"),
        href: "/robots.txt",
      },
      {
        id: "sitemap",
        label: t("adminSeoHub.shortcutSitemap"),
        hint: t("adminSeoHub.shortcutSitemapHint"),
        href: "/sitemap.xml",
      },
      {
        id: "llms",
        label: t("adminSeoHub.shortcutLlms"),
        hint: t("adminSeoHub.shortcutLlmsHint"),
        href: "/llms.txt",
      },
      {
        id: "settings",
        label: t("adminSeoHub.shortcutSettings"),
        hint: t("adminSeoHub.shortcutSettingsHint"),
        to: "/admin/settings/seo",
      },
      {
        id: "redirects",
        label: t("adminSeoHub.shortcutRedirects"),
        hint: t("adminSeoHub.shortcutRedirectsHint"),
        to: "/admin/redirects",
      },
    ];

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t("adminSeoHub.dashboardIntro")}</p>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t("adminSeoHub.sectionBrand")}</h2>

        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
          <div>
            <div className="text-[11px] text-muted-foreground">{t("adminSeoHub.scoreLabel")}</div>
            <div className="mt-1">
              <SeoScorePill score={score} grade={seoGrade(score)} />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("adminSeoHub.scoreHint")}</p>
        </div>

        <TileGrid
          tiles={[
            {
              key: "errors",
              label: t("adminSeoHub.tileErrors"),
              value: severity.errors,
              tone: severity.errors ? "text-destructive" : "text-emerald-500",
            },
            {
              key: "warnings",
              label: t("adminSeoHub.tileWarnings"),
              value: severity.warnings,
              tone: severity.warnings ? "text-amber-500" : "text-emerald-500",
            },
          ]}
        />

        <BrandFindingList findings={findings} emptyKey="adminSeoHub.allGood" />

        <div className="flex flex-wrap gap-4 text-xs">
          <Link to="/admin/seo/homepage" className="text-brand hover:underline">
            {t("adminSeoHub.openHomepage")}
          </Link>
          <Link to="/admin/seo/social" className="text-brand hover:underline">
            {t("adminSeoHub.openSocial")}
          </Link>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t("adminSeoHub.sectionContent")}</h2>
        <TileGrid
          tiles={[
            {
              key: "total",
              label: t("adminSeoHub.tileContent"),
              value: contentSummary.total,
              tone: "text-foreground",
            },
            {
              key: "missing",
              label: t("adminSeoHub.tileMissingDesc"),
              value: contentSummary.missingDescription,
              tone: contentSummary.missingDescription ? "text-destructive" : "text-emerald-500",
            },
            {
              key: "image",
              label: t("adminSeoHub.tileDefaultImage"),
              value: contentSummary.defaultImage,
              tone: contentSummary.defaultImage ? "text-amber-500" : "text-emerald-500",
            },
          ]}
        />
        <p className="text-xs text-muted-foreground">
          {t("adminSeoHub.contentSummary", { done: contentDone, total: contentSummary.total })}
        </p>
        <Link to="/admin/seo/content" className="text-xs text-brand hover:underline">
          {t("adminSeoHub.openContent")}
        </Link>
      </section>

      <TechnicalFoundationCard />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t("adminSeoHub.sectionShortcuts")}</h2>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <tbody>
              {shortcuts.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="w-1/3 px-3 py-2 align-top font-medium">{row.label}</td>
                  <td className="px-3 py-2 align-top text-xs text-muted-foreground">{row.hint}</td>
                  <td className="w-24 px-3 py-2 text-right align-top">
                    {/* Pliki generowane NIE są trasami routera - muszą iść
                        zwykłym <a>, inaczej router próbowałby dopasować je do
                        drzewa tras i wyświetlił stronę 404 zamiast pliku. */}
                    {row.href ? (
                      <a
                        href={row.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-brand hover:underline"
                      >
                        {t("adminSeoHub.open")}
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    ) : null}
                    {row.to ? (
                      <Link to={row.to} className="text-brand hover:underline">
                        {t("adminSeoHub.open")}
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
