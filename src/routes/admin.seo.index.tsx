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
// w treściach, potem kolejność sekcji głównych i pliki generowane, a na końcu
// skróty do ustawień.
//
// PLIKI GENEROWANE IDĄ Z REJESTRU (`MACHINE_SURFACES`), nie z listy w tym
// pliku. Do 2026-10 kokpit wymieniał na sztywno trzy pliki (robots.txt,
// sitemap.xml, llms.txt), podczas gdy rejestr powierzchni GLOBALNYCH liczył
// dziesięć - mapę Google News, feedy RSS (PL i EN), alias indeksu mapy. Rejestr
// jest tym samym źródłem, z którego llms.txt ogłasza zasoby, a test kontraktu
// pilnuje, że każda globalna trasa maszynowa jest w nim wpisana - nowy plik
// globalny pojawia się tu sam. Feedy per element (kategoria, tag, podcast)
// i shardy mapy nie mają jednego adresu i zostają poza tą listą.
//
// EKRAN JEST TYLKO DO CZYTANIA. Nie ma tu ani jednej mutacji i tak ma zostać -
// pilnuje tego `adminRouteAuthority.gate.test.ts`. Każda liczba jest linkiem do
// ekranu, który ją naprawia.
//
// ŻADNEJ WŁASNEJ REGUŁY OCENY. Audyt marki liczy `@/lib/seo/brandAudit`, a stan
// treści `@/lib/seo/contentStatus` - te same moduły, których używają zakładki
// szczegółowe. Druga kopia reguły oznaczałaby kokpit i zakładkę mówiące
// o tej samej treści co innego. Z tego samego powodu ODCZYT treści (kolumny,
// kolejność, limity, liczność) pochodzi z `@/lib/seo/seoContentQuery`, wspólnego
// z zakładką „Treści" - kafelki mówią wprost, gdy lista została przycięta
// albo odczyt padł, zamiast liczyć z części jak z całości.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useRequiredTenant } from "@/hooks/useAuth";
import { useTenantPublicOrigin } from "@/lib/seo/useTenantPublicOrigin";
import { useSettings } from "@/lib/admin/useSettings";
import { SeoScorePill } from "@/components/admin/seo/SeoScorePill";
import { BrandFindingList } from "@/components/admin/seo/BrandFindingList";
import { TechnicalFoundationCard } from "@/components/admin/seo/TechnicalFoundationCard";
import {
  ContentCoverageNotice,
  ContentReadError,
  PartialTag,
} from "@/components/admin/seo/ContentCoverageNotice";
import { ExternalLink } from "@/lib/lucide-shim";
import { ensureI18n } from "@/lib/i18n-admin-seo-hub";
import {
  auditBrandSeo,
  brandAuditScore,
  countBySeverity,
  type BrandFinding,
} from "@/lib/seo/brandAudit";
import {
  seoContentStatus,
  seoGrade,
  summarizeSeoStatuses,
  type SeoContentStatus,
} from "@/lib/seo/contentStatus";
import { seoContentCoverage, seoContentQueryOptions } from "@/lib/seo/seoContentQuery";
import { MACHINE_SURFACES } from "@/lib/seo/machineSurfaces";
import { primarySiteSections } from "@/lib/seo/primaryNavigation";
import { labelFor } from "@/lib/seo/footerNavigation";
import { localizedPath } from "@/lib/i18n/localePath";
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

/** `partial` = liczby policzone z niepełnej listy - każdy kafelek to mówi. */
function TileGrid({ tiles, partial = false }: { tiles: readonly Tile[]; partial?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.key} className="rounded-lg border border-border bg-card p-3">
          <div className={`text-2xl font-bold tabular-nums ${tile.tone}`}>{tile.value}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {tile.label}
            {partial ? <PartialTag /> : null}
          </div>
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
  // Linki do plików i sekcji idą na PUBLICZNY origin tenanta, nie na host
  // panelu - ta sama reguła co w `TechnicalFoundationCard`: względny
  // `/sitemap.xml` otwarty z panelu na innym hoście pokazałby pliki CUDZEGO
  // serwisu. `null` = tenant bez publicznego adresu (komunikat zamiast linków).
  const publicOrigin = useTenantPublicOrigin();

  const postsQuery = useQuery(seoContentQueryOptions("posts", tenantId));
  const pagesQuery = useQuery(seoContentQueryOptions("pages", tenantId));
  const posts = postsQuery.data;
  const pages = pagesQuery.data;
  const contentReadFailed = postsQuery.isError || pagesQuery.isError;
  const contentSettled = !postsQuery.isPending && !pagesQuery.isPending;
  const coverage = useMemo(() => seoContentCoverage([posts, pages]), [posts, pages]);
  // Kafelki są „częściowe", gdy lista jest przycięta albo jej liczności nie da
  // się ustalić - ale dopiero po udanym odczycie obu tabel (awarię komunikuje
  // osobny stan, a w trakcie ładowania „nieznane" byłoby fałszywym alarmem).
  const contentPartial = contentSettled && !contentReadFailed && coverage.state !== "complete";
  // Ponawiamy WYŁĄCZNIE tabelę, która padła - udany odczyt drugiej zostaje w cache.
  const retryContent = () => {
    if (postsQuery.isError) void postsQuery.refetch();
    if (pagesQuery.isError) void pagesQuery.refetch();
  };

  const statuses = useMemo(
    () => [...(pages?.rows ?? []), ...(posts?.rows ?? [])].map((row) => seoContentStatus(row)),
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

  // Opisy redakcyjne dla plików, które redakcja zna z nazwy; pozostałe wpisy
  // rejestru niosą własną, dwujęzyczną etykietę (tę samą co w llms.txt).
  const fileHints: Record<string, string> = {
    "/robots.txt": t("adminSeoHub.shortcutRobotsHint"),
    "/sitemap.xml": t("adminSeoHub.shortcutSitemapHint"),
    "/llms.txt": t("adminSeoHub.shortcutLlmsHint"),
  };
  const sections = primarySiteSections();

  const shortcuts: Array<{ id: string; label: string; hint: string; to: string }> = [
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
              tone: severity.warnings ? "text-brand" : "text-emerald-500",
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
        {contentReadFailed ? (
          // Zera w kafelkach niżej NIE są stanem serwisu - odczyt padł. Bez
          // tego komunikatu kokpit raportowałby „0 treści bez opisu" jako
          // dobrą wiadomość.
          <ContentReadError onRetry={retryContent} />
        ) : contentPartial ? (
          <ContentCoverageNotice coverage={coverage} />
        ) : null}
        <TileGrid
          partial={contentPartial}
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
              tone: contentSummary.defaultImage ? "text-brand" : "text-emerald-500",
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
        <h2 className="text-sm font-semibold">{t("adminSeoHub.sectionPrimaryNav")}</h2>
        <p className="text-xs text-muted-foreground">{t("adminSeoHub.primaryNavIntro")}</p>
        <ol className="overflow-hidden rounded-lg border border-border text-sm">
          {sections.map((section, i) => (
            <li
              key={section.href}
              data-section-href={section.href}
              className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-0"
            >
              <span className="w-5 shrink-0 font-mono text-xs text-muted-foreground">{i + 1}</span>
              <span className="font-medium">{labelFor(section, "pl")}</span>
              <span className="text-xs text-muted-foreground">{labelFor(section, "en")}</span>
              {/* Sekcje to strony CMS-owe (trasa catch-all) - zwykły <a>. */}
              {publicOrigin ? (
                <a
                  href={`${publicOrigin}${section.href}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto inline-flex items-center gap-1 font-mono text-xs text-brand hover:underline"
                >
                  {section.href}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              ) : (
                <span className="ml-auto font-mono text-xs text-muted-foreground">
                  {section.href}
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t("adminSeoHub.sectionFiles")}</h2>
        <p className="text-xs text-muted-foreground">{t("adminSeoHub.filesIntro")}</p>
        {publicOrigin === null ? (
          <p className="text-xs text-muted-foreground" data-seo-files-origin="none">
            {t("adminSeoHub.noPublicDomain")}
          </p>
        ) : null}
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <tbody>
              {MACHINE_SURFACES.map((file) => (
                <tr key={file.path} className="border-b border-border last:border-0">
                  <td className="w-1/3 px-3 py-2 align-top font-mono text-xs font-medium">
                    {file.path}
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                    {fileHints[file.path] ?? file.label}
                  </td>
                  <td className="w-32 px-3 py-2 text-right align-top">
                    {/* Pliki generowane NIE są trasami routera - muszą iść
                        zwykłym <a>, inaczej router próbowałby dopasować je do
                        drzewa tras i wyświetlił stronę 404 zamiast pliku. */}
                    {publicOrigin ? (
                      <span className="inline-flex flex-col items-end gap-1">
                        <a
                          href={`${publicOrigin}${file.path}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-brand hover:underline"
                        >
                          {t("adminSeoHub.open")}
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                        {file.localized ? (
                          <a
                            href={`${publicOrigin}${localizedPath(file.path, "en")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-brand hover:underline"
                          >
                            {t("adminSeoHub.fileOpenEn")}
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        ) : null}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

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
                    <Link to={row.to} className="text-brand hover:underline">
                      {t("adminSeoHub.open")}
                    </Link>
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
