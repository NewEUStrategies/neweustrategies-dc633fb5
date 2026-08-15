// Site-wide SEO / GEO / AEO settings tab (/admin/settings/seo). One
// site_settings blob ("seo") consumed by the public head() (title suffix,
// twitter:site, publisher logo), the homepage entity JSON-LD (sameAs), the
// feeds, the news sitemap and the robots.txt AI-crawler policy.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { Field, Text, NumberInput, Checkbox, SaveBar } from "@/components/admin/settings/fields";
import { ImageSlot } from "@/components/admin/ImageSlot";
import { LinkedSourceHeader, LinkedImagePreview } from "@/components/admin/settings/LinkedSource";
import { RobotsTxtPreview } from "@/components/admin/seo/RobotsTxtPreview";
import { DEFAULT_SEO_SETTINGS, SEO_SETTINGS_KEY, type SeoSettings } from "@/lib/seo/settings";
import { SITE_NAME } from "@/lib/seo/meta";

type ThemeLogo = { main?: string; organization?: string };
type ThemeOptionsShape = { logo?: ThemeLogo };
const THEME_OPTIONS_DEFAULTS: ThemeOptionsShape = { logo: {} };

export const Route = createFileRoute("/admin/settings/seo")({
  component: SeoSettingsTab,
  head: () => ({ meta: [{ title: "SEO - Ustawienia" }] }),
});

function SeoSettingsTab() {
  const { t } = useTranslation();
  const { query, save } = useSettings<SeoSettings>(SEO_SETTINGS_KEY, DEFAULT_SEO_SETTINGS);
  const themeOptions = useSettings<ThemeOptionsShape>("theme_options", THEME_OPTIONS_DEFAULTS);
  const themeLogo = themeOptions.query.data?.logo ?? {};
  const publisherLogoSource = themeLogo.organization || themeLogo.main || "";
  const [draft, setDraft] = useDraft<SeoSettings>(query.data);

  if (!draft) return <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>;
  const set = <K extends keyof SeoSettings>(k: K, v: SeoSettings[K]) =>
    setDraft({ ...draft, [k]: v });

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">{t("admin.seoSettings.title")}</h2>
      <p className="text-xs text-muted-foreground mb-4">{t("admin.seoSettings.subtitle")}</p>

      <h3 className="text-sm font-semibold mt-6 mb-1">{t("admin.seoSettings.sectionTitles")}</h3>
      <Field
        label={t("admin.seoSettings.titleSuffix")}
        hint={t("admin.seoSettings.titleSuffixHint")}
      >
        <div className="space-y-2">
          <Checkbox
            label={t("admin.seoSettings.titleSuffixEnabled")}
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

      <h3 className="text-sm font-semibold mt-6 mb-1">{t("admin.seoSettings.sectionFeeds")}</h3>
      <Field label={t("admin.seoSettings.rss")} hint={t("admin.seoSettings.rssHint")}>
        <div className="flex flex-wrap items-center gap-4">
          <Checkbox
            label={t("admin.seoSettings.rssEnabled")}
            checked={draft.rss_enabled}
            onChange={(v) => set("rss_enabled", v)}
          />
          <label className="inline-flex items-center gap-2 text-sm">
            {t("admin.seoSettings.rssCount")}
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
        label={t("admin.seoSettings.newsSitemap")}
        hint={t("admin.seoSettings.newsSitemapHint")}
      >
        <div className="space-y-2">
          <Checkbox
            label={t("admin.seoSettings.newsSitemapEnabled")}
            checked={draft.news_sitemap_enabled}
            onChange={(v) => set("news_sitemap_enabled", v)}
          />
          <Text
            value={draft.news_publication_name}
            onChange={(e) => set("news_publication_name", e.target.value)}
            placeholder={SITE_NAME}
            maxLength={120}
          />
          <p className="text-[11px] text-muted-foreground">{t("admin.seoSettings.newsNameHint")}</p>
        </div>
      </Field>

      <h3 className="text-sm font-semibold mt-6 mb-1">{t("admin.seoSettings.sectionAi")}</h3>
      <Field label="llms.txt" hint={t("admin.seoSettings.llmsHint")}>
        <Checkbox
          label={t("admin.seoSettings.llmsEnabled")}
          checked={draft.llms_txt_enabled}
          onChange={(v) => set("llms_txt_enabled", v)}
        />
      </Field>
      <Field label={t("admin.seoSettings.aiCrawlers")} hint={t("admin.seoSettings.aiCrawlersHint")}>
        <div className="space-y-2">
          <Checkbox
            label={t("admin.seoSettings.aiSearchAllowed")}
            checked={draft.ai_search_crawlers_allowed}
            onChange={(v) => set("ai_search_crawlers_allowed", v)}
          />
          <Checkbox
            label={t("admin.seoSettings.aiTrainingAllowed")}
            checked={draft.ai_training_crawlers_allowed}
            onChange={(v) => set("ai_training_crawlers_allowed", v)}
          />
        </div>
      </Field>

      <Field
        label={t("admin.seoSettings.robotsPreview")}
        hint={t("admin.seoSettings.robotsPreviewHint")}
      >
        <RobotsTxtPreview settings={draft} />
      </Field>

      <h3 className="text-sm font-semibold mt-6 mb-1">{t("admin.seoSettings.sectionEntity")}</h3>
      <Field
        label={t("admin.seoSettings.publisherLogo")}
        hint={t("admin.seoSettings.publisherLogoHint")}
      >
        <LinkedSourceHeader
          sourceLabel={t("admin.linkedSource.themeOptionsOrgLogo")}
          sourceHref="/admin/theme-options#logo"
          sourceValue={publisherLogoSource}
          preview={<LinkedImagePreview src={publisherLogoSource} />}
          hint={t("admin.linkedSource.overrideHint")}
        />
        <ImageSlot
          label=""
          value={draft.publisher_logo_url || publisherLogoSource}
          onChange={(v) => set("publisher_logo_url", v)}
          folder="branding"
        />
      </Field>
      <Field label={t("admin.seoSettings.sameAs")} hint={t("admin.seoSettings.sameAsHint")}>
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
        label={t("admin.seoSettings.twitterSite")}
        hint={t("admin.seoSettings.twitterSiteHint")}
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
