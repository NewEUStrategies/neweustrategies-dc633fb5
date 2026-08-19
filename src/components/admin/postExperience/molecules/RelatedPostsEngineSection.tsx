import { PanelNumberField } from "@/components/admin/postExperience/atoms/PanelNumberField";
import { PanelSectionHeading } from "@/components/admin/postExperience/atoms/PanelSectionHeading";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-related-posts";
import { Button } from "@/components/ui/button";
import { SettingToggle } from "@/components/admin/atoms/SettingToggle";
import { WeightSlider } from "@/components/admin/atoms/WeightSlider";
import { weightSignals } from "@/lib/relatedPosts/panelRules";
import { RELATED_POSTS_LIMITS } from "@/lib/relatedPosts/settings";
import type { RelatedPostsConfig } from "@/lib/relatedPosts";

interface RelatedPostsEngineSectionProps {
  form: RelatedPostsConfig;
  onChange: <K extends keyof RelatedPostsConfig>(key: K, value: RelatedPostsConfig[K]) => void;
  onSave: () => void;
  pending: boolean;
}

/**
 * Molekuła: wagi sygnałów silnika doboru.
 *
 * Siedem suwaków jedzie z JEDNEJ listy deskryptorów, więc nazwa pola, etykieta
 * i podpowiedź nie mają jak się rozejść - poprzednia wersja panelu sklejała je
 * osobno w siedmiu wywołaniach.
 */
export function RelatedPostsEngineSection({
  form,
  onChange,
  onSave,
  pending,
}: RelatedPostsEngineSectionProps) {
  const { t } = useTranslation();
  return (
    <section className="space-y-5 rounded-lg border border-border bg-card p-5">
      <div className="space-y-1">
        <PanelSectionHeading as="h2" tone="display">
          {t("adminRelatedPosts.engine.heading")}
        </PanelSectionHeading>
        <p className="text-xs text-muted-foreground">{t("adminRelatedPosts.engine.intro")}</p>
      </div>

      {weightSignals().map((signal) => (
        <WeightSlider
          key={signal.field}
          label={t(signal.labelKey)}
          hint={t(signal.hintKey)}
          value={form[signal.field] as number}
          min={RELATED_POSTS_LIMITS.weight.min}
          max={RELATED_POSTS_LIMITS.weight.max}
          onChange={(v) => onChange(signal.field, v as RelatedPostsConfig[typeof signal.field])}
        />
      ))}

      <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <SettingToggle
          label={t("adminRelatedPosts.fields.useIdf")}
          checked={form.use_idf}
          onCheckedChange={(v) => onChange("use_idf", v)}
        />
        <PanelNumberField
          label={t("adminRelatedPosts.fields.minScore")}
          value={form.min_score}
          bounds={RELATED_POSTS_LIMITS.minScore}
          hint={t("adminRelatedPosts.fields.minScoreHint")}
          onChange={(v) => onChange("min_score", v)}
        />
      </div>

      <div className="flex justify-end border-t border-border pt-3">
        <Button onClick={onSave} disabled={pending}>
          {pending
            ? t("adminRelatedPosts.actions.saving")
            : t("adminRelatedPosts.actions.saveWeights")}
        </Button>
      </div>
    </section>
  );
}
