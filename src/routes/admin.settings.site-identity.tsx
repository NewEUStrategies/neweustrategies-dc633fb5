// /admin/settings/site-identity - redakcyjny tytuł i opis CAŁEGO serwisu.
//
// Model danych: pola `site_title_pl/en` i `site_description_pl/en` w blobie
// site_settings["seo"]. Root loader zapamiętuje je per host
// (src/lib/seo/brandDefaults.ts), a `siteTitle()` / `siteDescription()`
// (src/lib/seo/meta.ts) podają je do <title>, meta description oraz kart
// og:/twitter: na każdej trasie bez własnych tekstów. Trasy serwerowe
// (rss.xml, llms.txt) czytają blob bezpośrednio, więc kanały i przewodnik dla
// AI zmieniają się tym samym zapisem. Druga sekcja to wspólny organizm
// `SeoEcosystemPanel` (ta sama instancja co w zakładce SEO): lista plików
// liczona z rejestru i przełączników oraz robots.txt z tymi samymi polami.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { SaveBar } from "@/components/admin/settings/fields";
import { SeoTextField } from "@/components/admin/seo/SeoTextField";
import { SeoEcosystemPanel } from "@/components/admin/seo/SeoEcosystemPanel";
import { ensureI18n } from "@/lib/i18n-admin-site-identity";
import { DEFAULT_SEO_SETTINGS, SEO_SETTINGS_KEY, type SeoSettings } from "@/lib/seo/settings";
import { SITE_DEFAULT_DESCRIPTION, SITE_DEFAULT_TITLE } from "@/lib/seo/meta";

export const Route = createFileRoute("/admin/settings/site-identity")({
  component: SiteIdentityTab,
  head: () => ({ meta: [{ title: "Tytuł i opis serwisu - Ustawienia" }] }),
});

function SiteIdentityTab() {
  // Rejestracja słownika w chunku KOMPONENTU trasy (nie w entry) - wywołanie
  // na poziomie modułu trzymało import w shellu trasy, czyli w entry.
  ensureI18n();
  const { t } = useTranslation();
  const { query, save } = useSettings<SeoSettings>(SEO_SETTINGS_KEY, DEFAULT_SEO_SETTINGS);
  const [draft, setDraft] = useDraft<SeoSettings>(query.data);

  if (!draft) return <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>;
  const set = <K extends keyof SeoSettings>(k: K, v: SeoSettings[K]) =>
    setDraft({ ...draft, [k]: v });

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">{t("adminSiteIdentity.pageTitle")}</h2>
      <p className="text-xs text-muted-foreground mb-4">{t("adminSiteIdentity.intro")}</p>

      <h3 className="text-sm font-semibold mt-6 mb-2">{t("adminSiteIdentity.sectionTexts")}</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <SeoTextField
          label={t("adminSiteIdentity.titlePl")}
          kind="title"
          value={draft.site_title_pl}
          fallback={SITE_DEFAULT_TITLE.pl}
          maxLength={120}
          onChange={(v) => set("site_title_pl", v ?? "")}
        />
        <SeoTextField
          label={t("adminSiteIdentity.titleEn")}
          kind="title"
          value={draft.site_title_en}
          fallback={SITE_DEFAULT_TITLE.en}
          maxLength={120}
          onChange={(v) => set("site_title_en", v ?? "")}
        />
        <SeoTextField
          label={t("adminSiteIdentity.descriptionPl")}
          kind="description"
          value={draft.site_description_pl}
          fallback={SITE_DEFAULT_DESCRIPTION.pl}
          maxLength={320}
          onChange={(v) => set("site_description_pl", v ?? "")}
        />
        <SeoTextField
          label={t("adminSiteIdentity.descriptionEn")}
          kind="description"
          value={draft.site_description_en}
          fallback={SITE_DEFAULT_DESCRIPTION.en}
          maxLength={320}
          onChange={(v) => set("site_description_en", v ?? "")}
        />
      </div>

      <SeoEcosystemPanel
        settings={draft}
        onChange={(patch) => setDraft({ ...draft, ...patch })}
        host="site-identity"
      />

      <SaveBar saving={save.isPending} onSave={() => save.mutate(draft)} />
    </div>
  );
}
