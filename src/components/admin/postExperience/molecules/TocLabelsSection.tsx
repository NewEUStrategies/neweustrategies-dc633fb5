import { useTranslation } from "react-i18next";
import { PanelSectionHeading } from "@/components/admin/postExperience/atoms/PanelSectionHeading";
import { PanelTextField } from "@/components/admin/postExperience/atoms/PanelTextField";
import type { TocDefaults } from "@/lib/toc/settings";

interface TocLabelsSectionProps {
  draft: TocDefaults;
  onChange: <K extends keyof TocDefaults>(key: K, value: TocDefaults[K]) => void;
}

/** Molekuła: tytuł spisu treści w obu językach publikacji. */
export function TocLabelsSection({ draft, onChange }: TocLabelsSectionProps) {
  const { t } = useTranslation();
  return (
    <section className="space-y-3 pt-3 border-t border-border">
      <PanelSectionHeading>{t("admin.toc.labels")}</PanelSectionHeading>
      <div className="grid grid-cols-2 gap-3">
        <PanelTextField
          label={t("admin.toc.titlePl")}
          value={draft.titlePl}
          onChange={(v) => onChange("titlePl", v)}
        />
        <PanelTextField
          label={t("admin.toc.titleEn")}
          value={draft.titleEn}
          onChange={(v) => onChange("titleEn", v)}
        />
      </div>
    </section>
  );
}
