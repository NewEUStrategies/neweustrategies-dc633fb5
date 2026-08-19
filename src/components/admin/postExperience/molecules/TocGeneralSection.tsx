import { useTranslation } from "react-i18next";
import { PanelSectionHeading } from "@/components/admin/postExperience/atoms/PanelSectionHeading";
import { PanelNumberField } from "@/components/admin/postExperience/atoms/PanelNumberField";
import { PanelSelectField } from "@/components/admin/postExperience/atoms/PanelSelectField";
import { SettingToggle } from "@/components/admin/atoms/SettingToggle";
import { TocColumnsPicker } from "@/components/admin/postExperience/molecules/TocColumnsPicker";
import {
  TOC_MIN_HEADINGS_BOUNDS,
  TOC_POSITION_BOUNDS,
  tocLayoutOptions,
  tocLevelOptions,
} from "@/lib/toc/panelRules";
import type { TocColumns, TocDefaults, TocLayout } from "@/lib/toc/settings";

interface TocGeneralSectionProps {
  draft: TocDefaults;
  onChange: <K extends keyof TocDefaults>(key: K, value: TocDefaults[K]) => void;
}

/** Molekuła: sekcja „Ogólne" panelu spisu treści. */
export function TocGeneralSection({ draft, onChange }: TocGeneralSectionProps) {
  const { t } = useTranslation();
  return (
    <section className="space-y-3">
      <PanelSectionHeading>{t("admin.toc.general")}</PanelSectionHeading>

      <SettingToggle
        label={t("admin.toc.enabled")}
        hint={t("admin.toc.enabledHint")}
        checked={draft.enabled}
        onCheckedChange={(v) => onChange("enabled", v)}
      />

      <PanelSelectField
        label={t("admin.toc.layout")}
        value={draft.layout}
        options={tocLayoutOptions().map((o) => ({ value: o.value, label: t(o.labelKey) }))}
        onChange={(v) => onChange("layout", v as TocLayout)}
      />

      <div className="grid grid-cols-2 gap-3">
        <PanelNumberField
          label={t("admin.toc.position")}
          value={draft.position}
          bounds={TOC_POSITION_BOUNDS}
          hint={t("admin.toc.positionHint")}
          onChange={(v) => onChange("position", v)}
        />
        <PanelNumberField
          label={t("admin.toc.minHeadings")}
          value={draft.minHeadings}
          bounds={TOC_MIN_HEADINGS_BOUNDS}
          onChange={(v) => onChange("minHeadings", v)}
        />
        <PanelSelectField
          label={t("admin.toc.minLevel")}
          value={String(draft.minLevel)}
          options={tocLevelOptions("min", draft).map((o) => ({
            value: String(o.level),
            label: `H${o.level}`,
            disabled: o.disabled,
          }))}
          onChange={(v) => onChange("minLevel", parseInt(v, 10))}
        />
        <PanelSelectField
          label={t("admin.toc.maxLevel")}
          value={String(draft.maxLevel)}
          options={tocLevelOptions("max", draft).map((o) => ({
            value: String(o.level),
            label: `H${o.level}`,
            disabled: o.disabled,
          }))}
          onChange={(v) => onChange("maxLevel", parseInt(v, 10))}
        />
        <SettingToggle
          className="self-end"
          label={t("admin.toc.ordered")}
          hint={t("admin.toc.orderedHint")}
          checked={draft.ordered}
          onCheckedChange={(v) => onChange("ordered", v)}
        />
      </div>

      <div>
        <PanelSectionHeading as="h3" tone="field">
          {t("admin.toc.columns")}
        </PanelSectionHeading>
        <TocColumnsPicker
          value={draft.columns}
          onChange={(v: TocColumns) => onChange("columns", v)}
        />
      </div>

      <SettingToggle
        label={t("admin.toc.sticky")}
        checked={draft.sticky}
        onCheckedChange={(v) => onChange("sticky", v)}
      />
      <SettingToggle
        label={t("admin.toc.showInBody")}
        hint={t("admin.toc.showInBodyHint")}
        checked={draft.showInBody}
        onCheckedChange={(v) => onChange("showInBody", v)}
      />
    </section>
  );
}
