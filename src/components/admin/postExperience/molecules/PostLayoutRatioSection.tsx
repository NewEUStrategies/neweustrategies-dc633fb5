import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-layouts";
import { PanelNumberField } from "@/components/admin/postExperience/atoms/PanelNumberField";
import { PanelSectionHeading } from "@/components/admin/postExperience/atoms/PanelSectionHeading";
import {
  FEATURED_RATIO_BOUNDS,
  FEATURED_RATIO_FIELDS,
  featuredRatioLayoutNumber,
  numericSetting,
} from "@/lib/post/layoutPanelRules";
import type { PostLayoutSettings } from "@/lib/postLayouts";

interface PostLayoutRatioSectionProps {
  settings: PostLayoutSettings;
  onPatch: (patch: Partial<PostLayoutSettings>) => void;
}

/**
 * Molekuła: proporcje obrazu wyróżniającego dla trzech układów, które je
 * czytają.
 *
 * Pola miały wcześniej etykietę zbudowaną z nazwy KOLUMNY BAZY
 * (`k.replace("featured_ratio_", "Layout ")`), więc administrator widział
 * „Layout l6" - nazwa techniczna wyciekała do interfejsu i nie dawała się
 * przetłumaczyć.
 */
export function PostLayoutRatioSection({ settings, onPatch }: PostLayoutRatioSectionProps) {
  const { t } = useTranslation();
  return (
    <section className="space-y-2">
      <PanelSectionHeading tone="display">
        {t("adminLayouts.postLayouts.featuredRatioHeading")}
      </PanelSectionHeading>
      <p className="text-[11px] text-muted-foreground">
        {t("adminLayouts.postLayouts.featuredRatioHint")}
      </p>
      <div className="grid sm:grid-cols-3 gap-2">
        {FEATURED_RATIO_FIELDS.map((field) => (
          <PanelNumberField
            key={field}
            label={t("adminLayouts.postLayouts.featuredRatioField", {
              layout: featuredRatioLayoutNumber(field),
            })}
            value={numericSetting(settings, field)}
            bounds={FEATURED_RATIO_BOUNDS}
            onChange={(next) => onPatch({ [field]: next } as Partial<PostLayoutSettings>)}
          />
        ))}
      </div>
    </section>
  );
}
