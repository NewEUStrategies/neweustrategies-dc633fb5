import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-post-panes";
import { PanelSectionHeading } from "@/components/admin/postExperience/atoms/PanelSectionHeading";
import { PanelColorField } from "@/components/admin/postExperience/atoms/PanelColorField";
import { PanelRangeField } from "@/components/admin/postExperience/atoms/PanelRangeField";
import { SelectableOptionCard } from "@/components/admin/postExperience/atoms/SelectableOptionCard";
import { toggleIndex } from "@/lib/admin/panelDraft";
import {
  HIGHLIGHT_OFFSET_BOUNDS,
  HIGHLIGHT_SIZE_BOUNDS,
  HIGHLIGHT_SIZE_STEP,
  highlightIndicesKey,
  highlightOffsetY,
  highlightSizeScale,
  highlightWords,
  isWordHighlighted,
} from "@/lib/keyTakeaways/panelRules";
import type { KeyTakeawaysSettings } from "@/lib/keyTakeaways/settings";

type Highlight = KeyTakeawaysSettings["highlight"];

interface KeyTakeawaysHighlightSectionProps {
  labelPl: string;
  labelEn: string;
  highlight: Highlight;
  accent: string;
  onChange: (next: Highlight) => void;
}

/**
 * Molekuła: podświetlenie wybranych słów etykiety (wariant ghost).
 *
 * Chipy słów to ten sam atom co karty wyboru - kontrakt jest jeden, różni się
 * wyłącznie kształt. Lista indeksów przechodzi przez `toggleIndex`, więc
 * kolejność w bazie nie zależy od kolejności klikania.
 */
export function KeyTakeawaysHighlightSection({
  labelPl,
  labelEn,
  highlight,
  accent,
  onChange,
}: KeyTakeawaysHighlightSectionProps) {
  const { t } = useTranslation();
  const sizeScale = highlightSizeScale(highlight);
  const offsetY = highlightOffsetY(highlight);

  return (
    <section className="space-y-3">
      <PanelSectionHeading as="h3" tone="field">
        {t("adminPostPanes.keyTakeaways.highlightHeading")}
      </PanelSectionHeading>
      <p className="text-xs text-muted-foreground">
        {t("adminPostPanes.keyTakeaways.highlightHint")}
      </p>

      {(["pl", "en"] as const).map((locale) => {
        const words = highlightWords(locale === "pl" ? labelPl : labelEn);
        if (words.length === 0) return null;
        const indicesKey = highlightIndicesKey(locale);
        return (
          <div key={locale}>
            <PanelSectionHeading as="h3" tone="field" className="text-xs text-muted-foreground">
              {t(`adminPostPanes.keyTakeaways.highlightWords.${locale}`)}
            </PanelSectionHeading>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {words.map((word, index) => (
                <SelectableOptionCard
                  key={`${locale}-${index}`}
                  variant="chip"
                  label={word}
                  selected={isWordHighlighted(highlight, locale, index)}
                  onSelect={() =>
                    onChange({
                      ...highlight,
                      [indicesKey]: toggleIndex(highlight?.[indicesKey] ?? [], index),
                    })
                  }
                />
              ))}
            </div>
          </div>
        );
      })}

      <div className="grid grid-cols-2 gap-3">
        <PanelColorField
          label={t("adminPostPanes.keyTakeaways.highlightColor")}
          value={highlight?.color ?? accent}
          onChange={(next) => onChange({ ...highlight, color: next || accent })}
        />
        <PanelRangeField
          label={t("adminPostPanes.keyTakeaways.highlightSize")}
          readout={`${sizeScale.toFixed(2)}×`}
          value={sizeScale}
          bounds={HIGHLIGHT_SIZE_BOUNDS}
          step={HIGHLIGHT_SIZE_STEP}
          onChange={(next) => onChange({ ...highlight, sizeScale: next })}
        />
        <PanelRangeField
          label={t("adminPostPanes.keyTakeaways.highlightOffset")}
          readout={`${offsetY}px`}
          value={offsetY}
          bounds={HIGHLIGHT_OFFSET_BOUNDS}
          scaleLabels={[String(HIGHLIGHT_OFFSET_BOUNDS.min), `+${HIGHLIGHT_OFFSET_BOUNDS.max}`]}
          resetLabel={t("adminPostPanes.keyTakeaways.highlightOffsetReset")}
          onReset={() => onChange({ ...highlight, offsetY: 0 })}
          onChange={(next) => onChange({ ...highlight, offsetY: next })}
        />
      </div>
    </section>
  );
}
