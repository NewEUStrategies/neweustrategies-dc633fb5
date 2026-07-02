// Site-wide SEO / GEO / AEO settings tab (/admin/settings/seo). One
// site_settings blob ("seo") consumed by the public head() (title suffix,
// twitter:site, publisher logo), the homepage entity JSON-LD (sameAs), the
// feeds, the news sitemap and the robots.txt AI-crawler policy.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { Field, Text, NumberInput, Checkbox, SaveBar } from "@/components/admin/settings/fields";
import { ImageSlot } from "@/components/admin/ImageSlot";
import {
  AI_SEARCH_CRAWLERS,
  AI_TRAINING_CRAWLERS,
  DEFAULT_SEO_SETTINGS,
  SEO_SETTINGS_KEY,
  type SeoSettings,
} from "@/lib/seo/settings";
import { SITE_NAME } from "@/lib/seo/meta";

export const Route = createFileRoute("/admin/settings/seo")({
  component: SeoSettingsTab,
  head: () => ({ meta: [{ title: "SEO - Ustawienia" }] }),
});

function SeoSettingsTab() {
  const { t } = useTranslation();
  const { query, save } = useSettings<SeoSettings>(SEO_SETTINGS_KEY, DEFAULT_SEO_SETTINGS);
  const [draft, setDraft] = useDraft<SeoSettings>(query.data);

  if (!draft) return <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>;
  const set = <K extends keyof SeoSettings>(k: K, v: SeoSettings[K]) =>
    setDraft({ ...draft, [k]: v });

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">
        {t("admin.seoSettings.title", { defaultValue: "SEO, GEO i AEO" })}
      </h2>
      <p className="text-xs text-muted-foreground mb-4">
        {t("admin.seoSettings.subtitle", {
          defaultValue:
            "Widoczność w Google, w wynikach zero-click i w odpowiedziach asystentów AI.",
        })}
      </p>

      <h3 className="text-sm font-semibold mt-6 mb-1">
        {t("admin.seoSettings.sectionTitles", { defaultValue: "Tytuły stron" })}
      </h3>
      <Field
        label={t("admin.seoSettings.titleSuffix", { defaultValue: "Sufiks tytułu" })}
        hint={t("admin.seoSettings.titleSuffixHint", {
          defaultValue: `Dopisywany do tytułów: "Nagłówek - ${SITE_NAME}". Ręcznie ustawione tytuły SEO pozostają bez zmian. Puste pole = nazwa serwisu.`,
        })}
      >
        <div className="space-y-2">
          <Checkbox
            label={t("admin.seoSettings.titleSuffixEnabled", {
              defaultValue: "Dopisuj sufiks do tytułów",
            })}
            checked={draft.title_suffix_enabled}
            onChange={(v) => set("title_suffix_enabled", v)}
          />
          <Text
            value={draft.title_suffix}
            onChange={(e) => set("title_suffix", e.target.value)}
            placeholder={SITE_NAME}
            maxLength={120}
          />
        </div>
      </Field>

      <h3 className="text-sm font-semibold mt-6 mb-1">
        {t("admin.seoSettings.sectionFeeds", { defaultValue: "Kanały i sitemapy" })}
      </h3>
      <Field
        label={t("admin.seoSettings.rss", { defaultValue: "Kanały RSS" })}
        hint={t("admin.seoSettings.rssHint", {
          defaultValue:
            "/rss.xml (PL) i /en/rss.xml (EN). Stary adres /feed przekierowuje automatycznie.",
        })}
      >
        <div className="flex flex-wrap items-center gap-4">
          <Checkbox
            label={t("admin.seoSettings.rssEnabled", { defaultValue: "Włączone" })}
            checked={draft.rss_enabled}
            onChange={(v) => set("rss_enabled", v)}
          />
          <label className="inline-flex items-center gap-2 text-sm">
            {t("admin.seoSettings.rssCount", { defaultValue: "Liczba wpisów" })}
            <NumberInput
              value={draft.rss_item_count}
              min={5}
              max={100}
              onChange={(e) =>
                set("rss_item_count", Math.max(5, Math.min(100, Number(e.target.value) || 30)))
              }
            />
          </label>
        </div>
      </Field>
      <Field
        label={t("admin.seoSettings.newsSitemap", { defaultValue: "Sitemap Google News" })}
        hint={t("admin.seoSettings.newsSitemapHint", {
          defaultValue:
            "/news-sitemap.xml - artykuły z ostatnich 48h. Obowiązkowy dla wydawcy w Google News.",
        })}
      >
        <div className="space-y-2">
          <Checkbox
            label={t("admin.seoSettings.newsSitemapEnabled", { defaultValue: "Włączony" })}
            checked={draft.news_sitemap_enabled}
            onChange={(v) => set("news_sitemap_enabled", v)}
          />
          <Text
            value={draft.news_publication_name}
            onChange={(e) => set("news_publication_name", e.target.value)}
            placeholder={SITE_NAME}
            maxLength={120}
          />
          <p className="text-[11px] text-muted-foreground">
            {t("admin.seoSettings.newsNameHint", {
              defaultValue:
                "Nazwa publikacji (news:name) - musi być stała i zgodna z nazwą w Google Publisher Center.",
            })}
          </p>
        </div>
      </Field>

      <h3 className="text-sm font-semibold mt-6 mb-1">
        {t("admin.seoSettings.sectionAi", { defaultValue: "GEO - widoczność w AI" })}
      </h3>
      <Field
        label="llms.txt"
        hint={t("admin.seoSettings.llmsHint", {
          defaultValue:
            "Przewodnik po serwisie dla asystentów AI (llmstxt.org) - sekcje, najnowsze artykuły i zasady cytowania. Zwiększa szansę na poprawne cytowania z kanonicznymi linkami.",
        })}
      >
        <Checkbox
          label={t("admin.seoSettings.llmsEnabled", { defaultValue: "Serwuj /llms.txt" })}
          checked={draft.llms_txt_enabled}
          onChange={(v) => set("llms_txt_enabled", v)}
        />
      </Field>
      <Field
        label={t("admin.seoSettings.aiCrawlers", { defaultValue: "Crawlery AI" })}
        hint={t("admin.seoSettings.aiCrawlersHint", {
          defaultValue:
            "Wyszukiwawcze: " +
            AI_SEARCH_CRAWLERS.join(", ") +
            ". Treningowe: " +
            AI_TRAINING_CRAWLERS.join(", ") +
            ".",
        })}
      >
        <div className="space-y-2">
          <Checkbox
            label={t("admin.seoSettings.aiSearchAllowed", {
              defaultValue:
                "Wpuszczaj crawlery wyszukiwawcze AI (cytowania w odpowiedziach - zalecane)",
            })}
            checked={draft.ai_search_crawlers_allowed}
            onChange={(v) => set("ai_search_crawlers_allowed", v)}
          />
          <Checkbox
            label={t("admin.seoSettings.aiTrainingAllowed", {
              defaultValue: "Wpuszczaj crawlery treningowe (uczenie modeli)",
            })}
            checked={draft.ai_training_crawlers_allowed}
            onChange={(v) => set("ai_training_crawlers_allowed", v)}
          />
        </div>
      </Field>

      <h3 className="text-sm font-semibold mt-6 mb-1">
        {t("admin.seoSettings.sectionEntity", { defaultValue: "Marka i dane strukturalne" })}
      </h3>
      <Field
        label={t("admin.seoSettings.publisherLogo", { defaultValue: "Logo wydawcy" })}
        hint={t("admin.seoSettings.publisherLogoHint", {
          defaultValue:
            "Używane w JSON-LD (NewsArticle/Organization) - wymagane do rich results w Google News.",
        })}
      >
        <ImageSlot
          label=""
          value={draft.publisher_logo_url}
          onChange={(v) => set("publisher_logo_url", v)}
          folder="branding"
        />
      </Field>
      <Field
        label={t("admin.seoSettings.sameAs", { defaultValue: "Profile marki (sameAs)" })}
        hint={t("admin.seoSettings.sameAsHint", {
          defaultValue:
            "Po jednym adresie w linii (LinkedIn, X, Facebook, YouTube, Wikipedia…). Wzmacnia encję marki w grafach wiedzy i odpowiedziach AI.",
        })}
      >
        <textarea
          value={draft.organization_same_as.join("\n")}
          onChange={(e) =>
            set(
              "organization_same_as",
              e.target.value
                .split("\n")
                .map((l) => l.trim())
                .filter((l) => /^https?:\/\//i.test(l))
                .slice(0, 20),
            )
          }
          rows={4}
          placeholder={"https://www.linkedin.com/company/…\nhttps://x.com/…"}
          className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </Field>
      <Field
        label={t("admin.seoSettings.twitterSite", { defaultValue: "Konto X/Twitter" })}
        hint={t("admin.seoSettings.twitterSiteHint", {
          defaultValue: 'Opcjonalny uchwyt "@marka" dla twitter:site (karty udostępniania).',
        })}
      >
        <Text
          value={draft.twitter_site}
          onChange={(e) => set("twitter_site", e.target.value)}
          placeholder="@neweustrategies"
          maxLength={60}
        />
      </Field>

      <SaveBar saving={save.isPending} onSave={() => save.mutate(draft)} />
    </div>
  );
}
