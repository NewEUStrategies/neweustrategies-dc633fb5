// /admin/seo/homepage - NAZWA SERWISU, tytuł i opis strony głównej, plus
// podgląd tego, co z nich wyjdzie w Google, i lista problemów per język.
//
// DEFEKT, KTÓRY TEN EKRAN USUWA - KONKRETNY, NIE HIGIENA.
// Zapytanie "new european strategies" zwracało stronę główną z niebieskim
// linkiem "European Security Analysis": sama NAZWA MARKI z tytułu znikała.
// To nie był błąd renderu - `<title>` szedł do przeglądarki w całości. Domyślny
// tytuł EN brzmi "New European Strategies - European Security Analysis",
// a Google rysuje NAZWĘ SERWISU w osobnej linii NAD niebieskim linkiem
// i zdejmuje z tytułu powtórzony prefiks marki. Zostaje ogon po separatorze.
//
// Do tej pory panel nie pokazywał tego NIGDZIE: żaden ekran nie mówił, do
// czego rozwija się tytuł strony głównej, a nazwa serwisu (og:site_name /
// WebSite.name) nie miała ANI JEDNEGO pola - Google wnioskował ją sam.
// Redakcja poprawiała więc tytuł w ciemno i za każdym razem widziała ten sam
// wynik w wyszukiwarce. Stąd trzy rzeczy na jednym ekranie, w tej kolejności:
// nazwa (linia nad linkiem), teksty (linia linku), podgląd i audyt (skutek).
//
// ZAPIS TYLKO DLA ADMINA. `site_settings` ma polityki INSERT/UPDATE wymagające
// roli `admin`, a layout `/admin` przepuszcza cały personel (także `editor`
// i `author`). Formularz z aktywnym „Zapisz" dla redaktora byłby obietnicą,
// którą baza odrzuci - dlatego `isAdmin` wyłącza zapis, a podgląd i audyt
// działają dla wszystkich (bramka `adminRouteAuthority.gate.test.ts`).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useAuth, useRequiredTenant } from "@/hooks/useAuth";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { Field, Text, SaveBar } from "@/components/admin/settings/fields";
import { SeoTextField } from "@/components/admin/seo/SeoTextField";
import { SerpPreview } from "@/components/admin/seo/SerpPreview";
import { BrandFindingList } from "@/components/admin/seo/BrandFindingList";
import { LivePreviewLinks } from "@/components/admin/seo/LivePreviewLinks";
import { useTenantPublicOrigin } from "@/lib/seo/useTenantPublicOrigin";
import { displayHost } from "@/lib/seo/socialNetworks";
import { ensureI18n } from "@/lib/i18n-admin-seo-hub";
import { auditBrandSeo, type BrandFinding } from "@/lib/seo/brandAudit";
import {
  DEFAULT_SEO_SETTINGS,
  effectiveSiteDescription,
  effectiveSiteTitle,
  SEO_SETTINGS_KEY,
  type SeoSettings,
} from "@/lib/seo/settings";
import { resolveHomepageSeoText } from "@/lib/seo/homepageSeo";
import { useStaticHomepage, type StaticHomepageRow } from "@/lib/seo/useStaticHomepage";
import {
  SITE_DEFAULT_DESCRIPTION,
  SITE_DEFAULT_OG_IMAGE,
  SITE_DEFAULT_TITLE,
  SITE_NAME,
  type Lang,
} from "@/lib/seo/meta";

export const Route = createFileRoute("/admin/seo/homepage")({
  component: SeoHomepageTab,
  // Tytuł karty przeglądarki jest literałem, a nie `t()` - `head()` czytające
  // słownik wciąga go do chunku wejściowego KAŻDEJ strony (patrz komentarz
  // w `admin.seo.tsx` i `scripts/check-entry-purity.ts`).
  head: () => ({ meta: [{ title: "SEO - Strona główna" }] }),
});

/**
 * Kolumny ekranu: jeden język = jeden podgląd i jedna lista problemów.
 *
 * Klucz nagłówka stoi W DANYCH, a nie w warunku `lang === "pl" ? ... : ...`:
 * wybór napisu po języku interfejsu jest robotą słownika, a nie kodu.
 */
interface HomepageLangColumn {
  readonly lang: Lang;
  readonly headingKey: string;
}

const HOMEPAGE_LANGS: readonly HomepageLangColumn[] = [
  { lang: "pl", headingKey: "adminSeoHub.previewPl" },
  { lang: "en", headingKey: "adminSeoHub.previewEn" },
];

/** Czy ta strona ma WŁASNE nadpisanie tytułu SEO dla danego języka. */
function hasSeoTitleOverride(row: StaticHomepageRow, lang: Lang): boolean {
  const override = lang === "en" ? row.seo_title_en : row.seo_title_pl;
  return (override ?? "").trim().length > 0;
}

function SeoHomepageTab() {
  // Rejestracja słownika w chunku KOMPONENTU trasy (nie w entry) - patrz
  // komentarz przy ensureI18n w lib/i18n-admin-seo-hub.ts.
  ensureI18n();
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const tenantId = useRequiredTenant();
  const siteNameId = useId();
  const siteNameAlternateId = useId();
  const { query, save } = useSettings<SeoSettings>(SEO_SETTINGS_KEY, DEFAULT_SEO_SETTINGS);
  const [draft, setDraft] = useDraft<SeoSettings>(query.data);
  // Host w linii adresu podglądu Google = host, na który prowadzą linki
  // „na żywo" pod nim. Bez tego tenant z własną domeną widział w podglądzie
  // host marki, a obok link do własnej strony - dwa różne adresy jednej strony.
  // `null` = tenant bez publicznej domeny: jawny zapis „brak domeny", nie host
  // marki (a `undefined` dałby w `SerpPreview` właśnie host marki).
  const publicOrigin = useTenantPublicOrigin();
  const previewHost =
    publicOrigin === null ? t("adminSeoHub.noPublicDomainHost") : displayHost(publicOrigin);

  /**
   * SZCZEROŚĆ EKRANU: statyczna strona główna NADPISUJE te pola.
   *
   * Gdy `homepage_mode` to "static_page" (albo jest nieustawiony, a istnieje
   * opublikowana strona najwyższego poziomu o slugu "home"), to TA STRONA jest
   * stroną główną, a jej własne `seo_title_*` wygrywa w `head()` trasy `/`
   * (`resolveHomepageSeoText`, src/routes/index.tsx). Bez tego odczytu redakcja
   * poprawia tytuł tutaj, nie widzi żadnej zmiany w Google i słusznie uznaje,
   * że panel jest zepsuty. Ten sam hook czyta edytor strony w /admin/pages.
   */
  const { staticHomepage } = useStaticHomepage(tenantId);
  const staticHomepageRow = staticHomepage.data ?? null;

  if (!draft) return <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>;
  const set = <K extends keyof SeoSettings>(k: K, v: SeoSettings[K]) =>
    setDraft({ ...draft, [k]: v });

  // ROZWIĄZANIE TEKSTÓW JEDEN DO JEDNEGO Z PUBLICZNYM <head>. `siteTitle()` /
  // `siteDescription()` (src/lib/seo/meta.ts) czytają DOKŁADNIE te ustawienia
  // przez pamięć per host, którą wypełnia root loader (rememberBrandDefaults),
  // i spadają na stałe marki, gdy pole jest puste. Podgląd musi liczyć to samo
  // z tych samych wartości - inaczej pokazuje coś, czego crawler nie zobaczy.
  const effectiveSiteName = draft.site_name.trim() || SITE_NAME;
  const resolveTitle = (lang: Lang): string => effectiveSiteTitle(draft, lang);
  const resolveDescription = (lang: Lang): string => effectiveSiteDescription(draft, lang);
  // Tytuł, który NAPRAWDĘ dostanie `/`: własny tytuł SEO statycznej strony
  // głównej wygrywa z tytułem serwisu (ta sama reguła co `head()` trasy `/`).
  // Opis zostaje przy polach tego ekranu - odczyt strony niesie wyłącznie
  // nadpisanie tytułu.
  const servedTitle = (lang: Lang): string =>
    resolveHomepageSeoText(
      staticHomepageRow
        ? {
            seo_title_pl: staticHomepageRow.seo_title_pl,
            seo_title_en: staticHomepageRow.seo_title_en,
          }
        : null,
      lang,
      { title: resolveTitle(lang), description: resolveDescription(lang) },
    ).title;

  // Audyt liczony OSOBNO dla każdego języka, z tych samych wartości, które
  // trafiają do podglądu obok. Karta społecznościowa i sygnały encji są
  // wspólne dla obu języków - różnią się tylko tytuł i opis.
  const findingsFor = (lang: Lang): BrandFinding[] =>
    auditBrandSeo({
      siteName: effectiveSiteName,
      title: resolveTitle(lang),
      description: resolveDescription(lang),
      ogImageUrl: draft.default_og_image_url.trim() || SITE_DEFAULT_OG_IMAGE,
      ogImageIsBuiltIn: !draft.default_og_image_url.trim(),
      ogImageAlt: draft.default_og_image_alt,
      sameAs: draft.organization_same_as,
      publisherLogoUrl: draft.publisher_logo_url,
      twitterSite: draft.twitter_site,
      // Strona główna nie ma w tych ustawieniach własnego przełącznika
      // noindex - widocznością całego serwisu steruje /admin/settings/reading.
      noindex: false,
    });

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t("adminSeoHub.homepageIntro")}</p>

      {!isAdmin && (
        <p className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
          {t("adminSeoHub.readOnlyNotice")}
        </p>
      )}

      {publicOrigin === null ? (
        <p
          className="rounded-lg border border-brand/40 bg-brand/5 px-3 py-2 text-xs text-brand-ink dark:text-brand"
          data-seo-no-domain
        >
          {t("adminSeoHub.noPublicDomain")}
        </p>
      ) : null}

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">{t("adminSeoHub.sectionIdentity")}</h2>
        <Field
          label={t("adminSeoHub.siteName")}
          hint={t("adminSeoHub.siteNameHint")}
          htmlFor={siteNameId}
        >
          <Text
            id={siteNameId}
            value={draft.site_name}
            onChange={(e) => set("site_name", e.target.value)}
            maxLength={120}
            // Placeholder pokazuje WBUDOWANĄ nazwę marki, czyli wartość, która
            // pójdzie do <head> przy pustym polu. To dana, nie komunikat.
            placeholder={SITE_NAME}
          />
        </Field>
        <Field
          label={t("adminSeoHub.siteNameAlternate")}
          hint={t("adminSeoHub.siteNameAlternateHint")}
          htmlFor={siteNameAlternateId}
        >
          <Text
            id={siteNameAlternateId}
            value={draft.site_name_alternate}
            onChange={(e) => set("site_name_alternate", e.target.value)}
            maxLength={120}
          />
        </Field>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">{t("adminSeoHub.sectionTexts")}</h2>
          <p className="text-xs text-muted-foreground">{t("adminSeoHub.textsHint")}</p>
          <p className="text-xs text-muted-foreground">{t("adminSeoHub.titleIsH1Hint")}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <SeoTextField
            label={t("adminSeoHub.titlePl")}
            kind="title"
            value={draft.site_title_pl}
            fallback={SITE_DEFAULT_TITLE.pl}
            maxLength={120}
            onChange={(v) => set("site_title_pl", v ?? "")}
          />
          <SeoTextField
            label={t("adminSeoHub.titleEn")}
            kind="title"
            value={draft.site_title_en}
            fallback={SITE_DEFAULT_TITLE.en}
            maxLength={120}
            onChange={(v) => set("site_title_en", v ?? "")}
          />
          <SeoTextField
            label={t("adminSeoHub.descriptionPl")}
            kind="description"
            value={draft.site_description_pl}
            fallback={SITE_DEFAULT_DESCRIPTION.pl}
            maxLength={320}
            onChange={(v) => set("site_description_pl", v ?? "")}
          />
          <SeoTextField
            label={t("adminSeoHub.descriptionEn")}
            kind="description"
            value={draft.site_description_en}
            fallback={SITE_DEFAULT_DESCRIPTION.en}
            maxLength={320}
            onChange={(v) => set("site_description_en", v ?? "")}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t("adminSeoHub.sectionPreview")}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {HOMEPAGE_LANGS.map(({ lang, headingKey }) => {
            const overriding =
              staticHomepageRow && hasSeoTitleOverride(staticHomepageRow, lang)
                ? staticHomepageRow
                : null;
            return (
              <div key={lang} className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground">{t(headingKey)}</h3>
                {overriding && (
                  <div className="rounded-lg border border-brand/40 bg-card p-3">
                    <p className="text-xs text-brand">{t("adminSeoHub.staticHomepageNotice")}</p>
                    <Link
                      to="/admin/pages/$slug"
                      params={{ slug: overriding.slug }}
                      className="mt-1 inline-block text-xs text-brand hover:underline"
                    >
                      {t("adminSeoHub.staticHomepageOpen")}
                    </Link>
                  </div>
                )}
                {/* path="" - strona główna siedzi pod samym originem, więc
                    w linii adresu nie ma ani jednego okruszka. */}
                <SerpPreview
                  title={servedTitle(lang)}
                  description={resolveDescription(lang)}
                  siteName={effectiveSiteName}
                  host={previewHost}
                  path={lang === "en" ? "en" : ""}
                />
                {/* Wyjścia „na żywo": ten sam adres, który rysuje podgląd. */}
                <LivePreviewLinks path={lang === "en" ? "en" : ""} />
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">{t("adminSeoHub.sectionAudit")}</h2>
          <p className="text-xs text-muted-foreground">{t("adminSeoHub.auditIntro")}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {HOMEPAGE_LANGS.map(({ lang, headingKey }) => (
            <div key={lang} className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground">{t(headingKey)}</h3>
              <BrandFindingList findings={findingsFor(lang)} emptyKey="adminSeoHub.auditClean" />
            </div>
          ))}
        </div>
      </section>

      <SaveBar saving={save.isPending} disabled={!isAdmin} onSave={() => save.mutate(draft)} />
    </div>
  );
}
