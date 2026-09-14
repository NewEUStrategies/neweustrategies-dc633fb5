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
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useRequiredTenant } from "@/hooks/useAuth";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { Field, Text, SaveBar } from "@/components/admin/settings/fields";
import { SeoTextField } from "@/components/admin/seo/SeoTextField";
import { SerpPreview } from "@/components/admin/seo/SerpPreview";
import { BrandFindingList } from "@/components/admin/seo/BrandFindingList";
import { LivePreviewLinks } from "@/components/admin/seo/LivePreviewLinks";
import { ensureI18n } from "@/lib/i18n-admin-seo-hub";
import { auditBrandSeo, type BrandFinding } from "@/lib/seo/brandAudit";
// Jedna definicja tego, czym jest tryb strony głównej - ta sama funkcja, której
// używa publiczna rezolucja (`homePageQueryOptions`). Własna kopia warunku
// rozjechałaby się z nią przy pierwszej zmianie.
import { normalizeHomepageMode } from "@/lib/queries/public";
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

/** Ustawienia czytania w zakresie, w jakim decydują o stronie głównej. */
type HomepageReading = {
  homepage_mode: string;
  homepage_page_id: string;
  homepage_page_slug: string;
};

const READING_SETTINGS_KEY = "reading";

const DEFAULT_HOMEPAGE_READING: HomepageReading = {
  homepage_mode: "",
  homepage_page_id: "",
  homepage_page_slug: "",
};

/** Strona CMS-a pełniąca rolę strony głównej - tylko to, co przesądza o SEO. */
interface StaticHomepageRow {
  id: string;
  slug: string;
  seo_title_pl: string | null;
  seo_title_en: string | null;
}

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

  // Ustawienia czytania odczytujemy WYŁĄCZNIE po to, by wiedzieć, czy stroną
  // główną nie jest strona z CMS-a (patrz zapytanie niżej). Ten ekran ich nie
  // zapisuje - od tego jest /admin/settings/reading.
  const { query: readingQuery } = useSettings<HomepageReading>(
    READING_SETTINGS_KEY,
    DEFAULT_HOMEPAGE_READING,
  );
  const reading = readingQuery.data;
  const homepageMode = normalizeHomepageMode(reading?.homepage_mode);
  const homepagePageId = reading?.homepage_page_id ?? "";
  const homepagePageSlug = reading?.homepage_page_slug ?? "";

  /**
   * SZCZEROŚĆ EKRANU: statyczna strona główna NADPISUJE te pola.
   *
   * Gdy `homepage_mode` to "static_page" (albo jest nieustawiony, a istnieje
   * opublikowana strona najwyższego poziomu o slugu "home"), to TA STRONA jest
   * stroną główną, a jej własne `seo_title_*` wygrywa w `head()` trasy `/`
   * (`resolveSeoText`, src/routes/index.tsx). Bez tego zapytania redakcja
   * poprawia tytuł tutaj, nie widzi żadnej zmiany w Google i słusznie uznaje,
   * że panel jest zepsuty. Kolejność prób jest ta sama, co w
   * `homePageQueryOptions` (src/lib/queries/public.ts): id -> slug -> "home".
   */
  const staticHomepage = useQuery({
    queryKey: [
      "admin-seo-static-homepage",
      tenantId,
      homepageMode,
      homepagePageId,
      homepagePageSlug,
    ],
    enabled: !!tenantId && !!reading && homepageMode !== "latest_posts",
    queryFn: async (): Promise<StaticHomepageRow | null> => {
      const published = () =>
        supabase
          .from("pages")
          .select("id, slug, seo_title_pl, seo_title_en")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .eq("status", "published");
      if (homepageMode === "static_page") {
        if (homepagePageId) {
          const { data, error } = await published().eq("id", homepagePageId).maybeSingle();
          if (error) throw error;
          if (data) return data;
        }
        if (homepagePageSlug) {
          const { data, error } = await published()
            .eq("slug", homepagePageSlug)
            .is("parent_id", null)
            .maybeSingle();
          if (error) throw error;
          if (data) return data;
        }
      }
      const { data, error } = await published()
        .eq("slug", "home")
        .is("parent_id", null)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });
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
  const resolveTitle = (lang: Lang): string =>
    siteTitleOverride(draft, lang) || SITE_DEFAULT_TITLE[lang];
  const resolveDescription = (lang: Lang): string =>
    siteDescriptionOverride(draft, lang) || SITE_DEFAULT_DESCRIPTION[lang];

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
                  <div className="rounded-lg border border-amber-500/40 bg-card p-3">
                    <p className="text-xs text-amber-500">
                      {t("adminSeoHub.staticHomepageNotice")}
                    </p>
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
                  title={resolveTitle(lang)}
                  description={resolveDescription(lang)}
                  siteName={effectiveSiteName}
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
