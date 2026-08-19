import {
  PanelNumberField,
  PanelSectionHeading,
  PanelSelectField,
} from "@/components/admin/postExperience/atoms";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-related-posts";
import { Button } from "@/components/ui/button";
import { FloatingInput } from "@/components/ui/floating-input";
import { SettingToggle } from "@/components/admin/atoms/SettingToggle";
import { RelatedLayoutPreview } from "@/components/admin/RelatedLayoutPreview";
import {
  RELATED_POSTS_COLUMN_CHOICES,
  SLIDER_INTERVAL_STEP,
  afterParagraphEnabled,
  layoutOptions,
  positionOptions,
  sliderIntervalEnabled,
  sourceStrategyOptions,
} from "@/lib/relatedPosts/panelRules";
import { RELATED_POSTS_LIMITS } from "@/lib/relatedPosts/settings";
import type { RelatedPostsConfig } from "@/lib/relatedPosts";

interface RelatedPostsConfigSectionProps {
  form: RelatedPostsConfig;
  onChange: <K extends keyof RelatedPostsConfig>(key: K, value: RelatedPostsConfig[K]) => void;
  onSave: () => void;
  pending: boolean;
}

/** Molekuła: konfiguracja podstawowa sekcji rekomendacji (widok, pozycja, treść kart). */
export function RelatedPostsConfigSection({
  form,
  onChange,
  onSave,
  pending,
}: RelatedPostsConfigSectionProps) {
  const { t } = useTranslation();
  return (
    <section className="space-y-5 rounded-lg border border-border bg-card p-5">
      <SettingToggle
        label={t("adminRelatedPosts.fields.enabled")}
        hint={t("adminRelatedPosts.fields.enabledHint")}
        checked={form.enabled}
        onCheckedChange={(v) => onChange("enabled", v)}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FloatingInput
          label={t("adminRelatedPosts.fields.titlePl")}
          value={form.title_pl}
          onChange={(e) => onChange("title_pl", e.target.value)}
        />
        <FloatingInput
          label={t("adminRelatedPosts.fields.titleEn")}
          value={form.title_en}
          onChange={(e) => onChange("title_en", e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <PanelSelectField
          label={t("adminRelatedPosts.fields.position")}
          value={form.position}
          options={positionOptions().map((o) => ({ value: o.value, label: t(o.labelKey) }))}
          onChange={(v) => onChange("position", v as RelatedPostsConfig["position"])}
        />
        <PanelNumberField
          label={t("adminRelatedPosts.fields.afterParagraph")}
          value={form.after_paragraph}
          bounds={RELATED_POSTS_LIMITS.afterParagraph}
          disabled={!afterParagraphEnabled(form.position)}
          onChange={(v) => onChange("after_paragraph", v)}
        />
        <PanelNumberField
          label={t("adminRelatedPosts.fields.itemsLimit")}
          value={form.items_limit}
          bounds={RELATED_POSTS_LIMITS.itemsLimit}
          onChange={(v) => onChange("items_limit", v)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <PanelSelectField
          label={t("adminRelatedPosts.fields.layout")}
          value={form.layout}
          options={layoutOptions().map((o) => ({ value: o.value, label: t(o.labelKey) }))}
          onChange={(v) => onChange("layout", v as RelatedPostsConfig["layout"])}
        />
        <PanelSelectField
          label={t("adminRelatedPosts.fields.columns")}
          value={String(form.columns)}
          options={RELATED_POSTS_COLUMN_CHOICES.map((n) => ({
            value: String(n),
            label: String(n),
          }))}
          onChange={(v) => onChange("columns", Number(v) as RelatedPostsConfig["columns"])}
        />
        <PanelSelectField
          label={t("adminRelatedPosts.fields.sourceStrategy")}
          options={sourceStrategyOptions().map((o) => ({ value: o.value, label: t(o.labelKey) }))}
          value={form.source_strategy}
          onChange={(v) => onChange("source_strategy", v as RelatedPostsConfig["source_strategy"])}
        />
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <PanelSectionHeading as="h3" tone="field">
            {t("adminRelatedPosts.fields.layoutPreview")}
          </PanelSectionHeading>
          <span className="text-xs text-muted-foreground">
            {t("adminRelatedPosts.fields.layoutPreviewHint")}
          </span>
        </div>
        <RelatedLayoutPreview value={form.layout} onChange={(v) => onChange("layout", v)} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SettingToggle
          label={t("adminRelatedPosts.fields.showCover")}
          checked={form.show_cover}
          onCheckedChange={(v) => onChange("show_cover", v)}
        />
        <SettingToggle
          label={t("adminRelatedPosts.fields.showExcerpt")}
          checked={form.show_excerpt}
          onCheckedChange={(v) => onChange("show_excerpt", v)}
        />
        <SettingToggle
          label={t("adminRelatedPosts.fields.showMeta")}
          checked={form.show_meta}
          onCheckedChange={(v) => onChange("show_meta", v)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <PanelNumberField
          label={t("adminRelatedPosts.fields.recencyBoostDays")}
          value={form.recency_boost_days}
          bounds={RELATED_POSTS_LIMITS.recencyBoostDays}
          onChange={(v) => onChange("recency_boost_days", v)}
        />
        <PanelNumberField
          label={t("adminRelatedPosts.fields.sliderIntervalMs")}
          value={form.slider_interval_ms}
          bounds={RELATED_POSTS_LIMITS.sliderIntervalMs}
          step={SLIDER_INTERVAL_STEP}
          disabled={!sliderIntervalEnabled(form.slider_autoplay)}
          onChange={(v) => onChange("slider_interval_ms", v)}
        />
        <SettingToggle
          className="self-end"
          label={t("adminRelatedPosts.fields.sliderAutoplay")}
          checked={form.slider_autoplay}
          onCheckedChange={(v) => onChange("slider_autoplay", v)}
        />
      </div>

      <div className="flex justify-end border-t border-border pt-3">
        <Button onClick={onSave} disabled={pending}>
          {pending ? t("adminRelatedPosts.actions.saving") : t("adminRelatedPosts.actions.save")}
        </Button>
      </div>
    </section>
  );
}
