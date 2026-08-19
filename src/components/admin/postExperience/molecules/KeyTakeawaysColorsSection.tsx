import { PanelColorField } from "@/components/admin/postExperience/atoms/PanelColorField";
import { PanelRangeField } from "@/components/admin/postExperience/atoms/PanelRangeField";
import { PanelSectionHeading } from "@/components/admin/postExperience/atoms/PanelSectionHeading";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-post-panes";
import {
  BORDER_WIDTH_BOUNDS,
  borderWidthValue,
  colorFieldValue,
  keyTakeawaysColorFields,
} from "@/lib/keyTakeaways/panelRules";
import type { KeyTakeawaysSettings } from "@/lib/keyTakeaways/settings";

type Colors = KeyTakeawaysSettings["colors"];

interface KeyTakeawaysColorsSectionProps {
  colors: Colors;
  onChangeColor: (key: keyof Colors, value: string) => void;
  onChangeBorderWidth: (value: number) => void;
}

/** Molekuła: jedenaście pól koloru sekcji plus grubość ramki. */
export function KeyTakeawaysColorsSection({
  colors,
  onChangeColor,
  onChangeBorderWidth,
}: KeyTakeawaysColorsSectionProps) {
  const { t } = useTranslation();
  return (
    <section>
      <PanelSectionHeading as="h3" tone="field" className="mb-2 block">
        {t("adminPostPanes.keyTakeaways.colorsHeading")}
      </PanelSectionHeading>
      <div className="grid grid-cols-2 gap-3">
        {keyTakeawaysColorFields().map((field) => (
          <PanelColorField
            key={field.key}
            label={t(field.labelKey)}
            value={colorFieldValue(colors, field.key)}
            onChange={(next) => onChangeColor(field.key, next)}
          />
        ))}
      </div>
      <PanelRangeField
        className="mt-3 space-y-1"
        label={t("adminPostPanes.keyTakeaways.borderWidth")}
        readout={`${borderWidthValue(colors)}px`}
        value={borderWidthValue(colors)}
        bounds={BORDER_WIDTH_BOUNDS}
        onChange={onChangeBorderWidth}
      />
    </section>
  );
}
