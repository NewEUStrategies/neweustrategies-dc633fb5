import { useTranslation } from "react-i18next";
import { PanelSectionHeading } from "@/components/admin/postExperience/atoms/PanelSectionHeading";
import { PanelColorField } from "@/components/admin/postExperience/atoms/PanelColorField";
import { tocColorFields } from "@/lib/toc/panelRules";
import type { TocDefaults } from "@/lib/toc/settings";

interface TocColorsSectionProps {
  colors: TocDefaults["colors"];
  onChangeColor: (key: keyof TocDefaults["colors"], value: string) => void;
}

/** Molekuła: siedem pól koloru spisu treści (jasny i ciemny motyw + akcent). */
export function TocColorsSection({ colors, onChangeColor }: TocColorsSectionProps) {
  const { t } = useTranslation();
  return (
    <section className="space-y-3 pt-3 border-t border-border">
      <PanelSectionHeading>{t("admin.toc.colors")}</PanelSectionHeading>
      <div className="grid grid-cols-2 gap-3">
        {tocColorFields().map((field) => (
          <PanelColorField
            key={field.key}
            label={t(field.labelKey)}
            value={colors[field.key]}
            onChange={(v) => onChangeColor(field.key, v)}
          />
        ))}
      </div>
    </section>
  );
}
